// src/handlers/list/index.js

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.SHIPMENTS_TABLE;

exports.handler = async (event) => {
  console.log("EVENT: \\n" + JSON.stringify(event, null, 2));

  try {
    const params = {
      TableName: TABLE_NAME,
      // MODIFICATION: Added 'shipDate' to the ProjectionExpression
      ProjectionExpression:
        "carrier, trackingNumber, #src, direction, statusCode, statusDescription, estimatedDeliveryDate, actualDeliveryDate, shipDate, lastEventTimestamp",
      ExpressionAttributeNames: {
        "#src": "source",
      },
    };

    const command = new ScanCommand(params);
    const { Items } = await docClient.send(command);

    // This backend sort is now a fallback, as the primary sorting is handled on the frontend.
    Items.sort((a, b) => {
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
      body: JSON.stringify(Items),
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
