const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");

// Shared DynamoDB document client and table names for all handlers.
// AWS_REGION is auto-set in Lambda; the fallback keeps `sam local invoke` working.
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-west-2",
});
const docClient = DynamoDBDocumentClient.from(client);

const SHIPMENTS_TABLE = process.env.SHIPMENTS_TABLE || "Shipments";
const EVENTS_TABLE = process.env.EVENTS_TABLE || "Events";

module.exports = { docClient, SHIPMENTS_TABLE, EVENTS_TABLE };
