// src/handlers/list/index.js
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.SHIPMENTS_TABLE;
// NEW: Make sure to pass the events table name in your SAM template.yaml!
const EVENTS_TABLE = process.env.EVENTS_TABLE;

exports.handler = async (event) => {
  console.log("EVENT: \n" + JSON.stringify(event, null, 2));

  try {
    // 1. Scan Shipments
    const params = {
      TableName: TABLE_NAME,
      ProjectionExpression:
        "carrier, trackingNumber, #src, direction, statusCode, statusDescription, estimatedDeliveryDate, actualDeliveryDate, shipDate, lastEventTimestamp",
      ExpressionAttributeNames: {
        "#src": "source",
      },
    };

    const command = new ScanCommand(params);
    const { Items: shipmentItems } = await docClient.send(command);

    // 2. Scan Events
    let eventItems = [];
    if (EVENTS_TABLE) {
      const eventsCommand = new ScanCommand({ TableName: EVENTS_TABLE });
      const eventsResponse = await docClient.send(eventsCommand);
      eventItems = eventsResponse.Items || [];
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
      },
      body: JSON.stringify({ message: "Internal Server Error" }),
    };
  }
};
