// Set environment variables FIRST before any imports
process.env.AWS_REGION = "us-west-2";

const test = require("node:test");
const assert = require("node:assert/strict");

// Mock the AWS SDK / ddb lib before importing the handler
const Module = require("module");
const originalRequire = Module.prototype.require;

let mockShipments = [];
let queryEventsForTrackingCalls = [];

Module.prototype.require = function (id) {
  if (id === "../../lib/ddb") {
    return {
      SHIPMENTS_TABLE: "Shipments",
      EVENTS_TABLE: "Events",
      scanAll: async () => mockShipments,
      queryEventsForTracking: async (trackingNumber) => {
        queryEventsForTrackingCalls.push(trackingNumber);
        return [{ trackingNumber, occurredAt: "2026-01-01T00:00:00Z" }];
      },
    };
  }

  return originalRequire.apply(this, arguments);
};

const { handler } = require("../src/handlers/list/index.js");

// Build a shipment with a given tracking number and lastEventTimestamp.
const shipment = (trackingNumber, lastEventTimestamp) => ({
  trackingNumber,
  carrier: "USPS",
  direction: "Inbound",
  statusCode: "IT",
  statusDescription: "In Transit",
  lastEventTimestamp,
});

test("List handler - defaults to page 1 of 10, newest activity first", async () => {
  mockShipments = [
    shipment("A", "2026-01-01T00:00:00Z"),
    shipment("B", "2026-01-05T00:00:00Z"),
    shipment("C", "2026-01-03T00:00:00Z"),
  ];
  queryEventsForTrackingCalls = [];

  const response = await handler({ queryStringParameters: null });
  assert.equal(response.statusCode, 200);

  const body = JSON.parse(response.body);
  assert.deepEqual(
    body.shipments.map((s) => s.trackingNumber),
    ["B", "C", "A"],
  );
  assert.deepEqual(body.pagination, {
    page: 1,
    pageSize: 10,
    totalItems: 3,
    totalPages: 1,
  });
});

test("List handler - paginates to the requested page and size", async () => {
  mockShipments = Array.from({ length: 25 }, (_, i) =>
    shipment(`T${i}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
  );
  queryEventsForTrackingCalls = [];

  const page2 = await handler({
    queryStringParameters: { page: "2", pageSize: "10" },
  });
  const body = JSON.parse(page2.body);

  // Newest (T24) is first overall, so page 2 (items 11-20) starts at T14 descending.
  assert.deepEqual(
    body.shipments.map((s) => s.trackingNumber),
    ["T14", "T13", "T12", "T11", "T10", "T9", "T8", "T7", "T6", "T5"],
  );
  assert.deepEqual(body.pagination, {
    page: 2,
    pageSize: 10,
    totalItems: 25,
    totalPages: 3,
  });
});

test("List handler - only fetches events for shipments on the requested page", async () => {
  mockShipments = Array.from({ length: 15 }, (_, i) =>
    shipment(`E${i}`, `2026-02-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
  );
  queryEventsForTrackingCalls = [];

  await handler({ queryStringParameters: { page: "1", pageSize: "10" } });

  assert.equal(queryEventsForTrackingCalls.length, 10);
});

test("List handler - shipments missing lastEventTimestamp sort last", async () => {
  mockShipments = [
    shipment("NO_TS", undefined),
    shipment("HAS_TS", "2026-01-01T00:00:00Z"),
  ];
  queryEventsForTrackingCalls = [];

  const response = await handler({ queryStringParameters: null });
  const body = JSON.parse(response.body);

  assert.deepEqual(
    body.shipments.map((s) => s.trackingNumber),
    ["HAS_TS", "NO_TS"],
  );
});

test("List handler - empty table returns empty page with totalPages 1", async () => {
  mockShipments = [];
  queryEventsForTrackingCalls = [];

  const response = await handler({ queryStringParameters: null });
  const body = JSON.parse(response.body);

  assert.deepEqual(body.shipments, []);
  assert.deepEqual(body.pagination, {
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 1,
  });
});

test("List handler - page beyond available data returns an empty slice", async () => {
  mockShipments = [shipment("ONLY", "2026-01-01T00:00:00Z")];
  queryEventsForTrackingCalls = [];

  const response = await handler({
    queryStringParameters: { page: "5", pageSize: "10" },
  });
  const body = JSON.parse(response.body);

  assert.deepEqual(body.shipments, []);
  assert.equal(body.pagination.totalPages, 1);
  assert.equal(queryEventsForTrackingCalls.length, 0);
});
