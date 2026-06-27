const test = require("node:test");
const assert = require("node:assert/strict");
const { mapTrackingEvent } = require("../src/lib/events");

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
