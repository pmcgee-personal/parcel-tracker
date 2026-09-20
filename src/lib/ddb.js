const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  QueryCommand,
  ScanCommand,
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

// Fetch the fields needed to recognise events a shipment already has. This is a
// partition query, so it reads one shipment's timeline rather than the table.
async function queryEventIdentities(trackingNumber) {
  let items = [];
  let lastEvaluatedKey = null;

  do {
    const response = await docClient.send(
      new QueryCommand({
        TableName: EVENTS_TABLE,
        KeyConditionExpression: "trackingNumber = :tn",
        ExpressionAttributeValues: { ":tn": trackingNumber },
        ProjectionExpression: "#coa, #desc",
        ExpressionAttributeNames: {
          "#coa": "carrierOccurredAt",
          "#desc": "description",
        },
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      }),
    );

    if (response.Items) {
      items = items.concat(response.Items);
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

// Fetch the full event timeline for one shipment (partition-key query). Used by
// the list handler to join events onto a single page of shipments instead of
// scanning the entire Events table on every request.
async function queryEventsForTracking(trackingNumber) {
  let items = [];
  let lastEvaluatedKey = null;

  do {
    const response = await docClient.send(
      new QueryCommand({
        TableName: EVENTS_TABLE,
        KeyConditionExpression: "trackingNumber = :tn",
        ExpressionAttributeValues: { ":tn": trackingNumber },
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      }),
    );

    if (response.Items) {
      items = items.concat(response.Items);
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

// Scan an entire table/index, following LastEvaluatedKey until exhausted.
// Only safe for tables small enough to fully enumerate in one invocation.
async function scanAll(params) {
  let accumulatedItems = [];
  let lastEvaluatedKey = null;

  do {
    const scanParams = { ...params };
    if (lastEvaluatedKey) {
      scanParams.ExclusiveStartKey = lastEvaluatedKey;
    }

    const response = await docClient.send(new ScanCommand(scanParams));

    if (response.Items) {
      accumulatedItems = accumulatedItems.concat(response.Items);
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return accumulatedItems;
}

module.exports = {
  docClient,
  SHIPMENTS_TABLE,
  EVENTS_TABLE,
  batchWrite,
  queryEventIdentities,
  queryEventsForTracking,
  scanAll,
};
