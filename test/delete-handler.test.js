// Set environment variables FIRST before any imports
process.env.AWS_REGION = "us-west-2";
process.env.NTFY_URL = "https://ntfy.sh/test";

const test = require("node:test");
const assert = require("node:assert/strict");

// Mock the AWS SDK modules before importing the handler
const mockDocClient = {
  send: async () => {
    // Will be overridden in individual tests
  },
};

const mockSecretsClient = {
  send: async () => {
    return { SecretString: "test-api-key" };
  },
};

const mockFetch = async () => {
  // Will be overridden in individual tests
};

let capturedRequests = [];

// Override globals before importing handler
global.fetch = mockFetch;

// Mock the AWS SDK imports
const Module = require("module");
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id === "@aws-sdk/lib-dynamodb") {
    return {
      GetCommand: class {
        constructor(params) {
          this.params = params;
        }
      },
      DeleteCommand: class {
        constructor(params) {
          this.params = params;
        }
      },
      QueryCommand: class {
        constructor(params) {
          this.params = params;
        }
      },
    };
  }

  if (id === "@aws-sdk/client-secrets-manager") {
    return {
      SecretsManagerClient: function () {
        return mockSecretsClient;
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
      docClient: mockDocClient,
      SHIPMENTS_TABLE: "Shipments",
      EVENTS_TABLE: "Events",
    };
  }

  return originalRequire.apply(this, arguments);
};

// Now import the handler
const { handler } = require("../src/handlers/delete/index.js");

test("Delete handler - successful deletion of shipment in transit", async () => {
  const shipment = {
    trackingNumber: "TEST123",
    carrier: "ups",
    statusCode: "IT",
    statusDescription: "In Transit",
  };

  const events = [
    { trackingNumber: "TEST123", occurredAt: "2026-01-01T10:00:00Z" },
    { trackingNumber: "TEST123", occurredAt: "2026-01-02T10:00:00Z" },
  ];

  let deleteCount = 0;
  let getCommandExecuted = false;
  let deleteShipmentExecuted = false;

  mockDocClient.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      getCommandExecuted = true;
      return { Item: shipment };
    }

    if (command.constructor.name === "QueryCommand") {
      return { Items: events };
    }

    if (command.constructor.name === "DeleteCommand") {
      deleteCount++;
      if (
        command.params.Key.trackingNumber === "TEST123" &&
        !command.params.Key.occurredAt
      ) {
        deleteShipmentExecuted = true;
      }
      return {};
    }

    return {};
  };

  let shipEngineStopCalled = false;
  global.fetch = async (url) => {
    capturedRequests.push(url);
    if (
      url.includes("tracking/stop") &&
      url.includes("TEST123") &&
      url.includes("ups")
    ) {
      shipEngineStopCalled = true;
      return { ok: true, status: 200 };
    }
    return { ok: true, status: 200 };
  };

  const event = {
    pathParameters: { trackingNumber: "TEST123" },
  };

  const response = await handler(event);

  assert.equal(response.statusCode, 200, "Should return 200");
  assert.equal(getCommandExecuted, true, "Should fetch shipment");
  assert.equal(deleteShipmentExecuted, true, "Should delete shipment");
  assert.equal(deleteCount, 3, "Should delete 1 shipment + 2 events");
  assert.equal(shipEngineStopCalled, true, "Should call ShipEngine stop API");

  const body = JSON.parse(response.body);
  assert.equal(body.message, "Shipment deleted successfully");
  assert.equal(body.trackingNumber, "TEST123");
  assert.equal(body.webhookStopped, true);
});

test("Delete handler - reject shipment that is already delivered", async () => {
  const shipment = {
    trackingNumber: "DELIVERED123",
    carrier: "fedex",
    statusCode: "DE",
    statusDescription: "Delivered",
  };

  mockDocClient.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      return { Item: shipment };
    }
    return {};
  };

  const event = {
    pathParameters: { trackingNumber: "DELIVERED123" },
  };

  const response = await handler(event);

  assert.equal(response.statusCode, 400, "Should return 400 for delivered package");

  const body = JSON.parse(response.body);
  assert.match(body.message, /Cannot delete shipment/);
});

test("Delete handler - reject non-existent shipment", async () => {
  mockDocClient.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      return { Item: undefined };
    }
    return {};
  };

  const event = {
    pathParameters: { trackingNumber: "NONEXISTENT123" },
  };

  const response = await handler(event);

  assert.equal(response.statusCode, 404, "Should return 404");

  const body = JSON.parse(response.body);
  assert.equal(body.message, "Shipment not found");
});

test("Delete handler - missing trackingNumber parameter", async () => {
  const event = {
    pathParameters: {},
  };

  const response = await handler(event);

  assert.equal(response.statusCode, 400, "Should return 400");

  const body = JSON.parse(response.body);
  assert.match(body.message, /trackingNumber is required/);
});

test("Delete handler - invalid trackingNumber format", async () => {
  const event = {
    pathParameters: { trackingNumber: "!!invalid!!" },
  };

  const response = await handler(event);

  assert.equal(response.statusCode, 400, "Should return 400");

  const body = JSON.parse(response.body);
  assert.match(body.message, /Invalid trackingNumber format/);
});

test("Delete handler - ShipEngine failure should not fail deletion", async () => {
  const shipment = {
    trackingNumber: "TEST456",
    carrier: "usps",
    statusCode: "AC",
    statusDescription: "Accepted",
  };

  mockDocClient.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      return { Item: shipment };
    }

    if (command.constructor.name === "QueryCommand") {
      return { Items: [] };
    }

    if (command.constructor.name === "DeleteCommand") {
      return {};
    }

    return {};
  };

  const fetchCalls = [];
  global.fetch = async (url) => {
    fetchCalls.push(url);

    if (url.startsWith("https://ntfy")) {
      return { ok: true, status: 200 };
    }

    if (url.includes("tracking/stop")) {
      return { ok: false, status: 500 };
    }

    return { ok: true, status: 200 };
  };

  const event = {
    pathParameters: { trackingNumber: "TEST456" },
  };

  const response = await handler(event);

  assert.equal(
    response.statusCode,
    200,
    "Should still return 200 even if ShipEngine fails",
  );

  const body = JSON.parse(response.body);
  assert.equal(body.message, "Shipment deleted successfully");
  assert.equal(body.webhookStopped, false, "Should indicate webhook stop failed");

  const ntfyCall = fetchCalls.some((url) => url.startsWith("https://ntfy"));
  assert.equal(
    ntfyCall,
    true,
    `Should send ntfy notification on failure. Calls: ${fetchCalls}`,
  );
});

test("Delete handler - allows NY (Not Yet In System) status", async () => {
  const shipment = {
    trackingNumber: "NY123",
    carrier: "ups",
    statusCode: "NY",
    statusDescription: "Not Yet In System",
  };

  mockDocClient.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      return { Item: shipment };
    }

    if (command.constructor.name === "QueryCommand") {
      return { Items: [] };
    }

    if (command.constructor.name === "DeleteCommand") {
      return {};
    }

    return {};
  };

  global.fetch = async () => ({ ok: true, status: 200 });

  const event = {
    pathParameters: { trackingNumber: "NY123" },
  };

  const response = await handler(event);

  assert.equal(response.statusCode, 200, "Should allow NY status deletion");
});
