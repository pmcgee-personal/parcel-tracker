const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} = require("@aws-sdk/lib-dynamodb");
const { chunkedWrite } = require("./batch");

// Shared DynamoDB document client and table names for all handlers.
// AWS_REGION is auto-set in Lambda; the fallback keeps `sam local invoke` working.
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-west-2",
});
const docClient = DynamoDBDocumentClient.from(client);

const SHIPMENTS_TABLE = process.env.SHIPMENTS_TABLE || "Shipments";
const EVENTS_TABLE = process.env.EVENTS_TABLE || "Events";

// Write many items to a table in batches. The chunking/retry logic lives in
// ./batch (SDK-free, unit-tested); here we just supply the SDK send call.
// Note: items must have unique primary keys within a batch (dedupe upstream).
async function batchWrite(tableName, items) {
  return chunkedWrite(
    (requestItems) =>
      docClient.send(new BatchWriteCommand({ RequestItems: requestItems })),
    tableName,
    items,
  );
}

module.exports = { docClient, SHIPMENTS_TABLE, EVENTS_TABLE, batchWrite };
