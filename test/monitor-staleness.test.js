const test = require("node:test");
const assert = require("node:assert/strict");

// Set environment variables first
process.env.AWS_REGION = "us-west-2";
process.env.NTFY_URL = "https://ntfy.sh/test";

// Mock the AWS SDK
const Module = require("module");
const originalRequire = Module.prototype.require;

let mockDocClientSend = async () => {};
let mockFetchCalls = [];

Module.prototype.require = function (id) {
  if (id === "@aws-sdk/lib-dynamodb") {
    class ScanCommand {
      constructor(params) {
        this.params = params;
      }
    }
    class UpdateCommand {
      constructor(params) {
        this.params = params;
      }
    }
    return { ScanCommand, UpdateCommand };
  }

  if (id === "@aws-sdk/client-secrets-manager") {
    return {
      SecretsManagerClient: function () {
        return {};
      },
      GetSecretValueCommand: class {
        constructor(params) {
          this.params = params;
        }
      },
    };
  }

  if (id === "../../lib/ddb") {
    return {
      docClient: {
        get send() {
          return mockDocClientSend;
        },
      },
      SHIPMENTS_TABLE: "Shipments",
    };
  }

  return originalRequire.apply(this, arguments);
};

// Override global fetch
global.fetch = async (url, options) => {
  mockFetchCalls.push({ url, options });
  return { ok: true, status: 200 };
};

const { handler } = require("../src/handlers/monitor-staleness/index.js");

test("Monitor staleness - finds stale shipments and sends notification", async () => {
  const now = Date.now();
  const fortyEightHoursAgo = new Date(now - 48.5 * 60 * 60 * 1000).toISOString();
  const recentTime = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const shipments = [
    {
      trackingNumber: "STALE001",
      carrier: "ups",
      statusDescription: "In Transit",
      lastEventTimestamp: fortyEightHoursAgo,
    },
    {
      trackingNumber: "STALE002",
      carrier: "usps",
      statusDescription: "In Transit",
      lastEventTimestamp: fortyEightHoursAgo,
    },
    {
      trackingNumber: "ACTIVE001",
      carrier: "fedex",
      statusDescription: "In Transit",
      lastEventTimestamp: recentTime,
    },
    {
      trackingNumber: "DELIVERED001",
      carrier: "ups",
      statusDescription: "Delivered",
      lastEventTimestamp: fortyEightHoursAgo,
    },
  ];

  let updateCount = 0;
  mockDocClientSend = async (command) => {
    if (command.constructor.name === "ScanCommand") {
      return { Items: shipments };
    }
    if (command.constructor.name === "UpdateCommand") {
      updateCount++;
      return {};
    }
    return {};
  };

  mockFetchCalls = [];

  const response = await handler({});

  assert.equal(response.statusCode, 200);

  const body = JSON.parse(response.body);
  assert.equal(body.staleShipments.length, 2);
  assert.equal(body.staleShipments[0].trackingNumber, "STALE001");
  assert.equal(body.staleShipments[1].trackingNumber, "STALE002");

  // Verify ntfy notification was sent with tracking numbers
  assert.equal(mockFetchCalls.length, 1);
  assert(mockFetchCalls[0].url.includes("ntfy.sh"));
  assert(mockFetchCalls[0].options.body.includes("STALE001"));
  assert(mockFetchCalls[0].options.body.includes("STALE002"));
  assert(!mockFetchCalls[0].options.body.includes("DELIVERED001")); // Delivered shipments excluded

  // Verify updates were made only for active shipments
  assert.equal(updateCount, 2);
});

test("Monitor staleness - skips recently notified shipments", async () => {
  const now = Date.now();
  const fortyEightHoursAgo = new Date(now - 48.5 * 60 * 60 * 1000).toISOString();
  const fiveHoursAgo = new Date(now - 5 * 60 * 60 * 1000).toISOString(); // Within 24 hour cooldown

  const shipments = [
    {
      trackingNumber: "STALE001",
      carrier: "ups",
      statusDescription: "In Transit",
      lastEventTimestamp: fortyEightHoursAgo,
      lastStaleNotificationAt: fiveHoursAgo, // Recently notified
    },
  ];

  mockDocClientSend = async (command) => {
    if (command.constructor.name === "ScanCommand") {
      return { Items: shipments };
    }
    return {};
  };

  mockFetchCalls = [];

  const response = await handler({});

  assert.equal(response.statusCode, 200);

  const body = JSON.parse(response.body);
  assert.equal(body.count, 0);

  // Verify no notification was sent
  assert.equal(mockFetchCalls.length, 0);
});

test("Monitor staleness - no stale shipments", async () => {
  const now = Date.now();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const shipments = [
    {
      trackingNumber: "ACTIVE001",
      carrier: "ups",
      statusDescription: "In Transit",
      lastEventTimestamp: twentyFourHoursAgo,
    },
  ];

  mockDocClientSend = async (command) => {
    if (command.constructor.name === "ScanCommand") {
      return { Items: shipments };
    }
    return {};
  };

  mockFetchCalls = [];

  const response = await handler({});

  assert.equal(response.statusCode, 200);

  const body = JSON.parse(response.body);
  assert.equal(body.count, 0);

  // Verify no notification was sent
  assert.equal(mockFetchCalls.length, 0);
});

test("Monitor staleness - skips shipments with no timestamp", async () => {
  const shipments = [
    {
      trackingNumber: "NO_TIMESTAMP",
      carrier: "ups",
      statusDescription: "In Transit",
      // No lastEventTimestamp
    },
  ];

  mockDocClientSend = async (command) => {
    if (command.constructor.name === "ScanCommand") {
      return { Items: shipments };
    }
    return {};
  };

  mockFetchCalls = [];

  const response = await handler({});

  assert.equal(response.statusCode, 200);

  const body = JSON.parse(response.body);
  assert.equal(body.count, 0);

  // Verify no notification was sent
  assert.equal(mockFetchCalls.length, 0);
});

test("Monitor staleness - filters by active status only", async () => {
  const now = Date.now();
  const fortyEightHoursAgo = new Date(now - 48.5 * 60 * 60 * 1000).toISOString();

  const shipments = [
    {
      trackingNumber: "STALE_IN_TRANSIT",
      carrier: "ups",
      statusDescription: "In Transit",
      lastEventTimestamp: fortyEightHoursAgo,
    },
    {
      trackingNumber: "STALE_ACCEPTED",
      carrier: "ups",
      statusDescription: "Accepted",
      lastEventTimestamp: fortyEightHoursAgo,
    },
    {
      trackingNumber: "STALE_EXCEPTION",
      carrier: "ups",
      statusDescription: "Exception",
      lastEventTimestamp: fortyEightHoursAgo,
    },
    {
      trackingNumber: "STALE_DELIVERED",
      carrier: "ups",
      statusDescription: "Delivered",
      lastEventTimestamp: fortyEightHoursAgo,
    },
    {
      trackingNumber: "STALE_CANCELLED",
      carrier: "ups",
      statusDescription: "Cancelled",
      lastEventTimestamp: fortyEightHoursAgo,
    },
  ];

  mockDocClientSend = async (command) => {
    if (command.constructor.name === "ScanCommand") {
      return { Items: shipments };
    }
    if (command.constructor.name === "UpdateCommand") {
      return {};
    }
    return {};
  };

  mockFetchCalls = [];

  const response = await handler({});

  assert.equal(response.statusCode, 200);

  const body = JSON.parse(response.body);
  // Only 3 active statuses should be notified (in transit, accepted, exception)
  assert.equal(body.staleShipments.length, 3);

  const trackingNumbers = body.staleShipments.map((s) => s.trackingNumber);
  assert(trackingNumbers.includes("STALE_IN_TRANSIT"));
  assert(trackingNumbers.includes("STALE_ACCEPTED"));
  assert(trackingNumbers.includes("STALE_EXCEPTION"));
  assert(!trackingNumbers.includes("STALE_DELIVERED"));
  assert(!trackingNumbers.includes("STALE_CANCELLED"));

  // Verify notification contains only active shipments
  assert.equal(mockFetchCalls.length, 1);
  const notificationBody = mockFetchCalls[0].options.body;
  assert(notificationBody.includes("STALE_IN_TRANSIT"));
  assert(!notificationBody.includes("STALE_DELIVERED"));
  assert(!notificationBody.includes("STALE_CANCELLED"));
});
