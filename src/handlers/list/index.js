const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const {
  docClient,
  SHIPMENTS_TABLE: TABLE_NAME,
  EVENTS_TABLE,
} = require("../../lib/ddb");

const generateRequestId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// Helper to scan all items (used for events where we need full dataset)
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

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return accumulatedItems;
}

// Helper to scan with pagination support
async function scanWithPagination(docClient, params, limit, nextToken) {
  const scanParams = { ...params, Limit: limit };
  if (nextToken) {
    try {
      const decodedToken = decodeURIComponent(nextToken);
      const jsonString = Buffer.from(decodedToken, "base64").toString("utf8");
      scanParams.ExclusiveStartKey = JSON.parse(jsonString);
    } catch (err) {
      throw new Error(`Invalid pagination token: ${err.message}`);
    }
  }

  const command = new ScanCommand(scanParams);
  const response = await docClient.send(command);

  return {
    items: response.Items || [],
    nextToken: response.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString("base64")
      : null,
  };
}

exports.handler = async (event) => {
  const requestId = generateRequestId();
  try {
    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const limit = Math.min(parseInt(queryParams.limit) || 50, 100); // Max 100, default 50
    const nextToken = queryParams.nextToken || null;
    const statusFilter = queryParams.status || null; // Optional: filter by status

    console.log(
      `[${requestId}] Fetching shipments (limit: ${limit}, status: ${statusFilter || "all"})`,
    );

    // 1. Scan Shipments with Pagination
    const shipmentParams = {
      TableName: TABLE_NAME,
      ProjectionExpression:
        "carrier, trackingNumber, #src, direction, statusCode, statusDescription, estimatedDeliveryDate, estimatedDeliveryHistory, actualDeliveryDate, shipDate, lastEventTimestamp, serviceLevel",
      ExpressionAttributeNames: {
        "#src": "source",
      },
    };

    // Add status filter if provided (e.g., ?status=active to show only non-delivered)
    if (statusFilter === "active") {
      shipmentParams.FilterExpression = "attribute_exists(statusCode) AND statusCode <> :delivered";
      shipmentParams.ExpressionAttributeValues = { ":delivered": "DE" };
    }

    const shipmentResult = await scanWithPagination(
      docClient,
      shipmentParams,
      limit,
      nextToken,
    );
    const shipmentItems = shipmentResult.items;
    const responseNextToken = shipmentResult.nextToken;

    console.log(
      `[${requestId}] Retrieved ${shipmentItems.length} shipments (nextToken: ${responseNextToken ? "present" : "none"})`,
    );

    // 2. Scan ALL Events (needed to match with paginated shipments)
    let eventItems = [];
    if (EVENTS_TABLE) {
      eventItems = await scanAll(docClient, { TableName: EVENTS_TABLE });
      console.log(`[${requestId}] Retrieved ${eventItems.length} events`);
    } else {
      console.warn(
        `[${requestId}] EVENTS_TABLE environment variable is missing. Events will not be loaded.`,
      );
    }

    // 3. Group events by tracking number
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
      body: JSON.stringify({
        shipments: shipmentsWithEvents,
        pagination: {
          limit,
          nextToken: responseNextToken,
          hasMore: !!responseNextToken,
        },
      }),
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
