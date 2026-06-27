const test = require("node:test");
const assert = require("node:assert/strict");
const { getDateOnly, getLocalDateString } = require("../src/lib/dates");

test("getDateOnly extracts the date from an ISO timestamp", () => {
  assert.equal(getDateOnly("2026-06-27T10:00:00Z"), "2026-06-27");
});

test("getDateOnly handles a plain date", () => {
  assert.equal(getDateOnly("2026-06-27"), "2026-06-27");
});

test("getDateOnly returns null for empty input", () => {
  assert.equal(getDateOnly(null), null);
  assert.equal(getDateOnly(""), null);
});

test("getLocalDateString uses the given timezone, not UTC", () => {
  // 05:30 UTC is still the previous calendar day in Los Angeles (UTC-7/8).
  const d = new Date("2026-06-28T05:30:00Z");
  assert.equal(getLocalDateString(d, "America/Los_Angeles"), "2026-06-27");
  assert.equal(getLocalDateString(d, "UTC"), "2026-06-28");
});
