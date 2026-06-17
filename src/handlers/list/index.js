const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.SHIPMENTS_TABLE;
const EVENTS_TABLE = process.env.EVENTS_TABLE;

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

exports.handler = async (event) => {
  console.log("EVENT: \n" + JSON.stringify(event, null, 2));

  try {
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

    // 2. Scan Events with Pagination Support
    let eventItems = [];
    if (EVENTS_TABLE) {
      eventItems = await scanAll(docClient, { TableName: EVENTS_TABLE });
    } else {
      console.warn(
        "EVENTS_TABLE environment variable is missing. Events will not be loaded.",
      );
    }

    // 3. Map events to their respective shipments
    const shipmentsWithEvents = shipmentItems.map((shipment) => {
      const shipmentEvents = eventItems.filter(
        (e) => e.trackingNumber === shipment.trackingNumber,
      );
      return {
        ...shipment,
        events: shipmentEvents,
      };
    });

    // 4. Fallback sorting (primary sorting is on frontend)
    shipmentsWithEvents.sort((a, b) => {
      if (!a.lastEventTimestamp) return 1;
      if (!b.lastEventTimestamp) return -1;
      return new Date(b.lastEventTimestamp) - new Date(a.lastEventTimestamp);
    });

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
    console.error("Error retrieving shipments:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Robots-Tag": "noindex, nofollow",
      },
      body: JSON.stringify({ message: "Internal Server Error" }),
    };
  }
};
