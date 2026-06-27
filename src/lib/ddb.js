const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} = require("@aws-sdk/lib-dynamodb");

// Shared DynamoDB document client and table names for all handlers.
// AWS_REGION is auto-set in Lambda; the fallback keeps `sam local invoke` working.
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-west-2",
});
const docClient = DynamoDBDocumentClient.from(client);

const SHIPMENTS_TABLE = process.env.SHIPMENTS_TABLE || "Shipments";
const EVENTS_TABLE = process.env.EVENTS_TABLE || "Events";

// Write many items to a table in batches. DynamoDB BatchWrite accepts at most
// 25 items per call and may return UnprocessedItems under load, which we retry.
// Note: items must have unique primary keys within a batch (dedupe upstream).
async function batchWrite(tableName, items) {
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    let requestItems = {
      [tableName]: chunk.map((Item) => ({ PutRequest: { Item } })),
    };

    for (let attempt = 0; Object.keys(requestItems).length > 0; attempt++) {
      if (attempt >= 5) {
        throw new Error(
          `BatchWrite to ${tableName} left unprocessed items after ${attempt} attempts`,
        );
      }
      const res = await docClient.send(
        new BatchWriteCommand({ RequestItems: requestItems }),
      );
      requestItems = res.UnprocessedItems || {};
    }
  }
}

module.exports = { docClient, SHIPMENTS_TABLE, EVENTS_TABLE, batchWrite };
