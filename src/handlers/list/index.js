const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const {
  docClient,
  SHIPMENTS_TABLE: TABLE_NAME,
  EVENTS_TABLE,
} = require("../../lib/ddb");

const generateRequestId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// NEW helper to recursively scan a table and handle the 1MB Scan Limit
async function scanAll(docClient, params) {
  let accumulatedItems = [];
  let lastEvaluatedKey = null;

  do {
    const scanParams = { ...params };
    if (lastEvaluatedKey) {
      scanParams.ExclusiveStartKey = lastEvaluatedKey;
    }

    const command = new ScanCommand(scanParams);
    const response = await docClient.send(command);

    if (response.Items) {
      accumulatedItems = accumulatedItems.concat(response.Items);
    }

    // If this exists, there is more data left in the table!
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return accumulatedItems;
}

exports.handler = async () => {
  const requestId = generateRequestId();
  try {
    console.log(`[${requestId}] Fetching shipments and events`);

    // 1. Scan Shipments with Pagination Support
    const params = {
      TableName: TABLE_NAME,
      ProjectionExpression:
        "carrier, trackingNumber, #src, direction, statusCode, statusDescription, estimatedDeliveryDate, estimatedDeliveryHistory, actualDeliveryDate, shipDate, lastEventTimestamp, serviceLevel",
      ExpressionAttributeNames: {
        "#src": "source",
      },
    };

    const shipmentItems = await scanAll(docClient, params);
    console.log(`[${requestId}] Retrieved ${shipmentItems.length} shipments`);

    // 2. Scan Events with Pagination Support
    let eventItems = [];
    if (EVENTS_TABLE) {
      eventItems = await scanAll(docClient, { TableName: EVENTS_TABLE });
      console.log(`[${requestId}] Retrieved ${eventItems.length} events`);
    } else {
      console.warn(
        `[${requestId}] EVENTS_TABLE environment variable is missing. Events will not be loaded.`,
      );
    }

    // 3. Group events by tracking number once, then attach.
    // O(n + m) instead of filtering all events for every shipment (O(n * m)).
    const eventsByTracking = new Map();
    for (const e of eventItems) {
      const list = eventsByTracking.get(e.trackingNumber);
      if (list) list.push(e);
      else eventsByTracking.set(e.trackingNumber, [e]);
    }

    const shipmentsWithEvents = shipmentItems.map((shipment) => ({
      ...shipment,
      events: eventsByTracking.get(shipment.trackingNumber) || [],
    }));

    // 4. Fallback sorting (primary sorting is on frontend)
    shipmentsWithEvents.sort((a, b) => {
      if (!a.lastEventTimestamp) return 1;
      if (!b.lastEventTimestamp) return -1;
      return new Date(b.lastEventTimestamp) - new Date(a.lastEventTimestamp);
    });

    console.log(`[${requestId}] Successfully fetched and formatted data`);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Robots-Tag": "noindex, nofollow",
      },
      body: JSON.stringify(shipmentsWithEvents),
    };
  } catch (error) {
    console.error(`[${requestId}] Error retrieving shipments:`, error.message);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Robots-Tag": "noindex, nofollow",
      },
      body: JSON.stringify({
        message: "Internal Server Error",
        requestId,
      }),
    };
  }
};
