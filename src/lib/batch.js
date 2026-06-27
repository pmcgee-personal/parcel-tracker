// Pure batching + retry logic for DynamoDB BatchWrite, decoupled from the SDK
// so it can be unit-tested without AWS credentials or the SDK installed.
// `sendBatch(requestItems)` should resolve to a response with an optional
// UnprocessedItems map (the same shape DynamoDB's BatchWrite returns).
async function chunkedWrite(
  sendBatch,
  tableName,
  items,
  { chunkSize = 25, maxAttempts = 5 } = {},
) {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    let requestItems = {
      [tableName]: chunk.map((Item) => ({ PutRequest: { Item } })),
    };

    for (let attempt = 0; Object.keys(requestItems).length > 0; attempt++) {
      if (attempt >= maxAttempts) {
        throw new Error(
          `BatchWrite to ${tableName} left unprocessed items after ${attempt} attempts`,
        );
      }
      const res = await sendBatch(requestItems);
      requestItems = (res && res.UnprocessedItems) || {};
    }
  }
}

module.exports = { chunkedWrite };
