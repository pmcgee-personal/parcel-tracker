const assert = require("assert");
const test = require("node:test");
const { withRetry, isTransientError, getErrorType } = require("../src/lib/dynamodbRetry");
const { OperationTracker } = require("../src/lib/operationTracker");

// Mock DynamoDB errors
const createDdbError = (code, httpStatusCode = null) => {
  const error = new Error(`DynamoDB error: ${code}`);
  error.code = code;
  error.name = code;
  if (httpStatusCode) {
    error.$metadata = { httpStatusCode };
  }
  return error;
};

// Helper to create a mock docClient
const createMockDocClient = (responses = []) => {
  let callCount = 0;
  return {
    send: async () => {
      const response = responses[callCount] || responses[responses.length - 1];
      callCount++;
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
    getCallCount: () => callCount,
  };
};

// ============================================================================
// A. Retry Logic Tests
// ============================================================================

test("A.1: Successful operation on first attempt (no retry needed)", async () => {
  const mockClient = createMockDocClient([{ Item: { id: "123" } }]);
  const result = await withRetry(
    { TableName: "test" },
    mockClient,
    null,
    { requestId: "req1", operationName: "TestOp" },
  );

  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.data, { Item: { id: "123" } });
  assert.strictEqual(result.attempt, 1);
  assert.strictEqual(mockClient.getCallCount(), 1);
});

test("A.2: Transient error (429) retries and succeeds on 2nd attempt", async () => {
  const mockClient = createMockDocClient([
    createDdbError("ThrottlingException", 429),
    { Item: { id: "456" } },
  ]);

  const result = await withRetry(
    { TableName: "test" },
    mockClient,
    null,
    { requestId: "req2", operationName: "TestOp", baseDelayMs: 10 },
  );

  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.data, { Item: { id: "456" } });
  assert.strictEqual(result.attempt, 2);
  assert.strictEqual(mockClient.getCallCount(), 2);
});

test("A.3: Transient error (5xx) retries and succeeds on 3rd attempt", async () => {
  const mockClient = createMockDocClient([
    createDdbError("ServiceUnavailable", 503),
    createDdbError("ServiceUnavailable", 503),
    { Item: { id: "789" } },
  ]);

  const result = await withRetry(
    { TableName: "test" },
    mockClient,
    null,
    { requestId: "req3", operationName: "TestOp", baseDelayMs: 10 },
  );

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.attempt, 3);
  assert.strictEqual(mockClient.getCallCount(), 3);
});

test("A.4: Permanent error fails immediately without retry", async () => {
  const mockClient = createMockDocClient([
    createDdbError("ValidationException", 400),
  ]);

  const result = await withRetry(
    { TableName: "test" },
    mockClient,
    null,
    { requestId: "req4", operationName: "TestOp" },
  );

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.isTransient, false);
  assert.strictEqual(result.attempt, 1);
  assert.strictEqual(mockClient.getCallCount(), 1);
});

test("A.5: Exhausts max retries on persistent transient error", async () => {
  const mockClient = createMockDocClient([
    createDdbError("ThrottlingException", 429),
    createDdbError("ThrottlingException", 429),
    createDdbError("ThrottlingException", 429),
    createDdbError("ThrottlingException", 429),
    createDdbError("ThrottlingException", 429),
  ]);

  const result = await withRetry(
    { TableName: "test" },
    mockClient,
    null,
    { requestId: "req5", operationName: "TestOp", maxAttempts: 5, baseDelayMs: 10 },
  );

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.isTransient, true);
  assert.strictEqual(result.attempt, 5);
  assert.strictEqual(mockClient.getCallCount(), 5);
});

test("A.6: Handles different transient errors", async () => {
  const transientErrors = [
    "ThrottlingException",
    "ProvisionedThroughputExceededException",
    "RequestLimitExceeded",
  ];

  for (const errorCode of transientErrors) {
    const mockClient = createMockDocClient([
      createDdbError(errorCode, 500),
      { Item: {} },
    ]);

    const result = await withRetry(
      { TableName: "test" },
      mockClient,
      null,
      { requestId: `req-${errorCode}`, operationName: "TestOp", baseDelayMs: 10 },
    );

    assert.strictEqual(
      result.success,
      true,
      `Failed to retry on ${errorCode}`,
    );
    assert.strictEqual(result.attempt, 2);
  }
});

// ============================================================================
// B. Error Classification Tests
// ============================================================================

test("B.1: 429 errors classified as transient", () => {
  const error = createDdbError("ThrottlingException", 429);
  assert.strictEqual(isTransientError(error), true);
});

test("B.2: 500+ errors classified as transient", () => {
  [500, 502, 503, 504].forEach((status) => {
    const error = createDdbError("ServiceUnavailable", status);
    assert.strictEqual(isTransientError(error), true);
  });
});

test("B.3: 4xx errors (except 429) classified as permanent", () => {
  [400, 401, 403, 404].forEach((status) => {
    const error = createDdbError("ValidationException", status);
    assert.strictEqual(isTransientError(error), false);
  });
});

test("B.4: Named exceptions classified correctly", () => {
  const transientCodes = [
    "ThrottlingException",
    "ProvisionedThroughputExceededException",
    "RequestLimitExceeded",
    "TransactionConflictException",
    "InternalFailure",
    "ServiceUnavailable",
  ];

  transientCodes.forEach((code) => {
    const error = createDdbError(code);
    assert.strictEqual(isTransientError(error), true, `${code} should be transient`);
  });
});

test("B.5: ConditionalCheckFailedException handled correctly", () => {
  const error = createDdbError("ConditionalCheckFailedException");
  // This is context-dependent - the retry wrapper returns it but doesn't classify as transient
  assert.strictEqual(isTransientError(error), false);
});

test("B.6: getErrorType extracts error code/name correctly", () => {
  const error = createDdbError("ValidationException", 400);
  assert.strictEqual(getErrorType(error), "ValidationException");

  const genericError = new Error("Generic error");
  assert.strictEqual(getErrorType(genericError), "Error");

  assert.strictEqual(getErrorType(null), "UnknownError");
});

// ============================================================================
// C. Structured Logging Tests
// ============================================================================

test("C.1: Logs include operation name, error type, attempt count for failures", async () => {
  const mockClient = createMockDocClient([
    createDdbError("ValidationException", 400),
  ]);

  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(" "));

  await withRetry(
    { TableName: "test" },
    mockClient,
    null,
    { requestId: "req-log1", operationName: "TestOp" },
  );

  console.error = originalError;

  assert.strictEqual(logs.length > 0, true, "Should have logged an error");
  const logMessage = logs[0];
  assert.strictEqual(logMessage.includes("[req-log1]"), true);
  assert.strictEqual(logMessage.includes("op=TestOp"), true);
  assert.strictEqual(logMessage.includes("error=ValidationException"), true);
  assert.strictEqual(logMessage.includes("attempt=1"), true);
});

test("C.2: Logs include delay for retry attempts", async () => {
  const mockClient = createMockDocClient([
    createDdbError("ThrottlingException", 429),
    { Item: {} },
  ]);

  const logs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => logs.push(args.join(" "));

  await withRetry(
    { TableName: "test" },
    mockClient,
    null,
    { requestId: "req-log2", operationName: "TestOp", baseDelayMs: 100 },
  );

  console.warn = originalWarn;

  assert.strictEqual(logs.length > 0, true, "Should have logged a retry");
  const logMessage = logs[0];
  assert.strictEqual(logMessage.includes("delay="), true, "Should include delay");
});

test("C.3: Distinguishes transient vs permanent in logs", async () => {
  const mockClient1 = createMockDocClient([
    createDdbError("ThrottlingException", 429),
  ]);
  const mockClient2 = createMockDocClient([
    createDdbError("ValidationException", 400),
  ]);

  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(" "));

  // Transient
  logs.length = 0;
  await withRetry(
    { TableName: "test" },
    mockClient1,
    null,
    {
      requestId: "req-log3a",
      operationName: "TestOp",
      maxAttempts: 1,
    },
  );

  // Permanent
  await withRetry(
    { TableName: "test" },
    mockClient2,
    null,
    { requestId: "req-log3b", operationName: "TestOp" },
  );

  console.error = originalError;

  const transientLog = logs[0];
  const permanentLog = logs[1];
  assert.strictEqual(transientLog.includes("transient"), true);
  assert.strictEqual(permanentLog.includes("permanent"), true);
});

// ============================================================================
// D. Per-Operation Tracking Tests
// ============================================================================

test("D.1: OperationTracker records fetch success", () => {
  const tracker = new OperationTracker("req1", "PKG123");
  tracker.recordFetch(true, null, 1, null, false);

  const summary = tracker.getSummary();
  assert.strictEqual(summary.fetchResult.success, true);
  assert.strictEqual(summary.fetchResult.attempt, 1);
});

test("D.2: OperationTracker records fetch failure", () => {
  const tracker = new OperationTracker("req2", "PKG456");
  const error = new Error("Fetch failed");
  tracker.recordFetch(false, error, 2, "ServiceUnavailable", true);

  const summary = tracker.getSummary();
  assert.strictEqual(summary.fetchResult.success, false);
  assert.strictEqual(summary.fetchResult.isTransient, true);
  assert.strictEqual(summary.fetchResult.errorType, "ServiceUnavailable");
});

test("D.3: OperationTracker tracks update separately from events", () => {
  const tracker = new OperationTracker("req3", "PKG789");
  tracker.recordFetch(true, null, 1);
  tracker.recordUpdate(true, null, 1);
  tracker.recordEventWrite(0, true, null, 1);

  const summary = tracker.getSummary();
  assert.strictEqual(summary.fetchResult.success, true);
  assert.strictEqual(summary.updateResult.success, true);
  assert.strictEqual(summary.eventResults.length, 1);
  assert.strictEqual(summary.eventResults[0].success, true);
});

test("D.4: OperationTracker handles individual event write failures", () => {
  const tracker = new OperationTracker("req4", "PKG999");
  tracker.recordEventWrite(0, true, null, 1);
  tracker.recordEventWrite(1, false, new Error("Failed"), 1, "ThrottlingException", true);
  tracker.recordEventWrite(2, true, null, 1);

  const summary = tracker.getSummary();
  assert.strictEqual(summary.summary.totalEvents, 3);
  assert.strictEqual(summary.summary.eventSuccesses, 2);
  assert.strictEqual(summary.summary.eventFailures, 1);
  assert.strictEqual(summary.summary.transientFailures, 1);
});

test("D.5: OperationTracker provides status checks", () => {
  const tracker = new OperationTracker("req5", "PKG111");
  tracker.recordFetch(true);
  tracker.recordUpdate(true);
  tracker.recordEventWrite(0, false, new Error("Fail"), 1, "ValidationException", false);

  assert.strictEqual(tracker.hadFailures(), true);
  assert.strictEqual(tracker.hadPermanentFailures(), true);
  assert.strictEqual(tracker.hadTransientFailures(), false);
});

// ============================================================================
// E. Response Structure Tests
// ============================================================================

test("E.1: Response includes operationResults summary", () => {
  const tracker = new OperationTracker("req1", "PKG123");
  tracker.recordFetch(true, null, 1);
  tracker.recordUpdate(true, null, 1);

  const summary = tracker.getSummary();
  assert.strictEqual(summary.requestId, "req1");
  assert.strictEqual(summary.trackingNumber, "PKG123");
  assert.strictEqual(typeof summary.fetchResult, "object");
  assert.strictEqual(typeof summary.updateResult, "object");
  assert.strictEqual(Array.isArray(summary.eventResults), true);
});

test("E.2: Response tracks distinct counts correctly", () => {
  const tracker = new OperationTracker("req2", "PKG456");
  tracker.recordEventWrite(0, true, null, 1);
  tracker.recordEventWrite(1, true, null, 1, "duplicate", false);
  tracker.recordEventWrite(2, false, new Error("Failed"), 1, "ThrottlingException", true);

  const summary = tracker.getSummary();
  // Note: "duplicate" is marked as success=true with errorType="duplicate"
  assert.strictEqual(summary.summary.totalEvents, 3);
  assert.strictEqual(summary.summary.eventSuccesses, 2);
  assert.strictEqual(summary.summary.eventFailures, 1);
});

test("E.3: Response indicates transient vs permanent errors", () => {
  const tracker = new OperationTracker("req3", "PKG789");
  tracker.recordEventWrite(0, false, new Error("Transient"), 1, "ThrottlingException", true);
  tracker.recordEventWrite(1, false, new Error("Permanent"), 1, "ValidationException", false);

  const summary = tracker.getSummary();
  assert.strictEqual(summary.summary.transientFailures, 1);
  assert.strictEqual(summary.summary.permanentFailures, 1);
});

test("E.4: Response includes requestId for debugging", () => {
  const tracker = new OperationTracker("debug-req-123", "PKG999");
  const summary = tracker.getSummary();
  assert.strictEqual(summary.requestId, "debug-req-123");
});

test("E.5: Response tracking matches operations performed", () => {
  const tracker = new OperationTracker("req5", "PKG111");
  tracker.recordFetch(true, null, 1);
  tracker.recordUpdate(true, null, 1);
  tracker.recordEventWrite(0, true, null, 1);
  tracker.recordEventWrite(1, false, new Error("Fail"), 2, "ThrottlingException", true);
  tracker.recordEventWrite(3, true, null, 1); // Note: index 3 (index 2 skipped)

  const summary = tracker.getSummary();
  // Should have events at indices 0, 1, 3
  assert.strictEqual(summary.eventResults.length, 3);
  assert.deepStrictEqual(
    summary.eventResults.map((e) => e.index),
    [0, 1, 3],
  );
});

// ============================================================================
// F. End-to-End Integration Tests
// ============================================================================

test("F.1: Complete happy path with all retries succeeding", async () => {
  const mockClient = createMockDocClient([
    createDdbError("ThrottlingException", 429),
    { Item: { id: "123" } },
  ]);

  const result = await withRetry(
    { TableName: "test" },
    mockClient,
    null,
    { requestId: "e2e-1", operationName: "FetchShipment", baseDelayMs: 10 },
  );

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.attempt, 2);
  assert.strictEqual(result.data.Item.id, "123");
});

test("F.2: Complete failure path with mixed error types", async () => {
  const tracker = new OperationTracker("e2e-2", "PKG123");

  // Simulate fetch success
  tracker.recordFetch(true, null, 1);

  // Simulate update success
  tracker.recordUpdate(true, null, 1);

  // Simulate mixed event results: success, transient failure, permanent failure, duplicate
  tracker.recordEventWrite(0, true, null, 1, null, false);
  tracker.recordEventWrite(1, false, new Error("Throttle"), 3, "ThrottlingException", true);
  tracker.recordEventWrite(2, false, new Error("Validation"), 1, "ValidationException", false);
  tracker.recordEventWrite(3, true, null, 1, "duplicate", false);

  const summary = tracker.getSummary();

  assert.strictEqual(summary.fetchResult.success, true);
  assert.strictEqual(summary.updateResult.success, true);
  assert.strictEqual(summary.summary.eventSuccesses, 2); // 0 and 3
  assert.strictEqual(summary.summary.eventFailures, 2); // 1 and 2
  assert.strictEqual(summary.summary.transientFailures, 1);
  assert.strictEqual(summary.summary.permanentFailures, 1);
  assert.strictEqual(tracker.hadPermanentFailures(), true);
});

test("F.3: OFD deduplication ConditionalCheckFailedException handling", async () => {
  const mockClient = createMockDocClient([
    createDdbError("ConditionalCheckFailedException", 400),
  ]);

  const result = await withRetry(
    { TableName: "test" },
    mockClient,
    null,
    { requestId: "e2e-3", operationName: "UpdateShipment" },
  );

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorType, "ConditionalCheckFailedException");
  // Should not retry ConditionalCheckFailedException
  assert.strictEqual(result.attempt, 1);
  assert.strictEqual(mockClient.getCallCount(), 1);
});

test("F.4: Large batch of events with sparse failures", async () => {
  const tracker = new OperationTracker("e2e-4", "PKG456");

  // Simulate 10 events: 8 success, 1 duplicate, 1 failure
  for (let i = 0; i < 10; i++) {
    if (i === 5) {
      tracker.recordEventWrite(i, true, null, 1, "duplicate", false);
    } else if (i === 7) {
      tracker.recordEventWrite(i, false, new Error("Throttle"), 2, "ThrottlingException", true);
    } else {
      tracker.recordEventWrite(i, true, null, 1);
    }
  }

  const summary = tracker.getSummary();

  assert.strictEqual(summary.summary.totalEvents, 10);
  assert.strictEqual(summary.summary.eventSuccesses, 9); // 8 + 1 duplicate
  assert.strictEqual(summary.summary.eventFailures, 1);
  assert.strictEqual(summary.summary.transientFailures, 1);
  assert.strictEqual(summary.summary.permanentFailures, 0);
});
