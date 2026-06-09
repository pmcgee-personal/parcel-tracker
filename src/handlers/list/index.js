const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.SHIPMENTS_TABLE;

exports.handler = async (event) => {
  console.log("EVENT: \n" + JSON.stringify(event, null, 2));

  try {
    const params = {
      TableName: TABLE_NAME,
      ProjectionExpression:
        "carrier, trackingNumber, source, direction, statusCode, statusDescription, estimatedDeliveryDate, lastEventTimestamp",
    };

    const command = new ScanCommand(params);
    const { Items } = await docClient.send(command);

    // Sort by lastEventTimestamp descending (newest activity at the top)
    Items.sort((a, b) => {
      if (!a.lastEventTimestamp) return 1;
      if (!b.lastEventTimestamp) return -1;
      return new Date(b.lastEventTimestamp) - new Date(a.lastEventTimestamp);
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // Required for upcoming React local/prod frontend communication
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
