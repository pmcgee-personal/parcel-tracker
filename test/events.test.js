const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapTrackingEvent,
  eventIdentity,
  dedupeIncomingEvents,
} = require("../src/lib/events");

test("mapTrackingEvent maps snake_case fields and sets keys", () => {
  const item = mapTrackingEvent("1Z999", {
    occurred_at: "2026-06-27T10:00:00Z",
    city_locality: "Reno",
    state_province: "NV",
    country_code: "US",
    description: "In transit",
  });
  assert.equal(item.trackingNumber, "1Z999");
  assert.equal(item.occurredAt, "2026-06-27T10:00:00Z");
  assert.equal(item.cityLocality, "Reno");
  assert.equal(item.stateProvince, "NV");
  assert.equal(item.countryCode, "US");
  assert.equal(item.description, "In transit");
  assert.equal(typeof item.createdAt, "string");
});

test("mapTrackingEvent defaults missing fields to null", () => {
  const item = mapTrackingEvent("1Z999", {
    occurred_at: "2026-06-27T10:00:00Z",
  });
  assert.equal(item.cityLocality, null);
  assert.equal(item.signer, null);
  assert.equal(item.latitude, null);
});

test("eventIdentity ignores occurred_at, which differs between feeds", () => {
  // The same USPS scan as delivered by the webhook and by GET /v1/tracking.
  assert.equal(
    eventIdentity("2026-08-29T16:57:55-07:00", "Shipping Label Created"),
    eventIdentity("2026-08-29T16:57:55-07:00", "Shipping Label Created"),
  );
});

test("eventIdentity keeps same-timestamp events with different descriptions apart", () => {
  assert.notEqual(
    eventIdentity("2026-06-18T02:20:00-07:00", "Arrived at USPS Facility"),
    eventIdentity("2026-06-18T02:20:00-07:00", "Processed Through USPS Facility"),
  );
});

test("dedupeIncomingEvents skips an event already stored under a different occurredAt", () => {
  // Regression: USPS began sending an explicit offset, GET /v1/tracking then
  // double-applied it, and this scan was written twice — 2026-08-29T23:57:55Z
  // from the webhook and 2026-08-30T06:57:55Z from registration.
  const stored = [
    {
      carrierOccurredAt: "2026-08-29T16:57:55-07:00",
      description: "Shipping Label Created",
    },
  ];
  const incoming = [
    {
      occurred_at: "2026-08-30T06:57:55Z",
      carrier_occurred_at: "2026-08-29T16:57:55-07:00",
      description: "Shipping Label Created",
    },
  ];

  const { toWrite, duplicates } = dedupeIncomingEvents(incoming, stored);
  assert.deepEqual(toWrite, []);
  assert.equal(duplicates, 1);
});

test("dedupeIncomingEvents skips naive-timestamp duplicates too", () => {
  // Same defect on a date-only label event: stored verbatim by the webhook,
  // shifted to 07:00:00Z by registration.
  const stored = [
    {
      carrierOccurredAt: "2026-07-30T00:00:00",
      description: "Shipping Label Printed at Post Office",
    },
  ];
  const incoming = [
    {
      occurred_at: "2026-07-30T07:00:00Z",
      carrier_occurred_at: "2026-07-30T00:00:00",
      description: "Shipping Label Printed at Post Office",
    },
  ];

  const { toWrite, duplicates } = dedupeIncomingEvents(incoming, stored);
  assert.deepEqual(toWrite, []);
  assert.equal(duplicates, 1);
});

test("dedupeIncomingEvents keeps genuinely new events", () => {
  const stored = [
    {
      carrierOccurredAt: "2026-08-29T16:57:55-07:00",
      description: "Shipping Label Created",
    },
  ];
  const incoming = [
    {
      occurred_at: "2026-08-29T23:57:55Z",
      carrier_occurred_at: "2026-08-29T16:57:55-07:00",
      description: "Shipping Label Created",
    },
    {
      occurred_at: "2026-08-30T14:03:00Z",
      carrier_occurred_at: "2026-08-30T07:03:00-07:00",
      description: "Arrived at USPS Facility",
    },
  ];

  const { toWrite, duplicates } = dedupeIncomingEvents(incoming, stored);
  assert.equal(toWrite.length, 1);
  assert.equal(toWrite[0].description, "Arrived at USPS Facility");
  assert.equal(duplicates, 1);
});

test("dedupeIncomingEvents collapses repeats within a single payload", () => {
  const incoming = [
    {
      occurred_at: "2026-08-29T23:57:55Z",
      carrier_occurred_at: "2026-08-29T16:57:55-07:00",
      description: "Shipping Label Created",
    },
    {
      occurred_at: "2026-08-30T06:57:55Z",
      carrier_occurred_at: "2026-08-29T16:57:55-07:00",
      description: "Shipping Label Created",
    },
  ];

  const { toWrite, duplicates } = dedupeIncomingEvents(incoming, []);
  assert.equal(toWrite.length, 1);
  assert.equal(duplicates, 1);
});

test("dedupeIncomingEvents drops events with no occurred_at sort key", () => {
  const { toWrite, unwritable } = dedupeIncomingEvents(
    [{ carrier_occurred_at: "2026-08-29T16:57:55-07:00", description: "X" }],
    [],
  );
  assert.deepEqual(toWrite, []);
  assert.equal(unwritable, 1);
});

test("dedupeIncomingEvents handles a missing events array", () => {
  const { toWrite, duplicates } = dedupeIncomingEvents(undefined, []);
  assert.deepEqual(toWrite, []);
  assert.equal(duplicates, 0);
});
