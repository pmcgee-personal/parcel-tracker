const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getLocalDateString,
  parseCarrierTimestamp,
  getCarrierCalendarDate,
} = require("../src/lib/dates");

test("getLocalDateString uses the given timezone, not UTC", () => {
  // 05:30 UTC is still the previous calendar day in Los Angeles (UTC-7/8).
  const d = new Date("2026-06-28T05:30:00Z");
  assert.equal(getLocalDateString(d, "America/Los_Angeles"), "2026-06-27");
  assert.equal(getLocalDateString(d, "UTC"), "2026-06-28");
});

test("parseCarrierTimestamp parses an offset-bearing string natively", () => {
  const parsed = parseCarrierTimestamp("2026-09-26T10:00:00Z");
  assert.equal(parsed.toISOString(), "2026-09-26T10:00:00.000Z");
});

test("parseCarrierTimestamp reads a bare timestamp as APP_TIMEZONE wall-clock time", () => {
  // Real production example: ShipEngine sent this bare value for the same
  // shipment/estimate as "2026-09-29T00:00:00Z" recorded a day earlier.
  const parsed = parseCarrierTimestamp(
    "2026-09-28T17:00:00",
    "America/Los_Angeles",
  );
  assert.equal(parsed.toISOString(), "2026-09-29T00:00:00.000Z");
});

test("getCarrierCalendarDate agrees for the same instant in either format (regression)", () => {
  // These two strings are the same real-world delivery estimate, just
  // serialized differently by the carrier feed. Before the fix, comparing
  // them as raw strings ("2026-09-28" vs "2026-09-29") flagged a bogus
  // "Date Changed" every time the feed flipped format.
  const bare = getCarrierCalendarDate(
    "2026-09-28T17:00:00",
    "America/Los_Angeles",
  );
  const utc = getCarrierCalendarDate(
    "2026-09-29T00:00:00Z",
    "America/Los_Angeles",
  );
  assert.equal(bare, utc);
});

test("getCarrierCalendarDate still detects a genuine multi-day change", () => {
  const before = getCarrierCalendarDate("2026-09-26T10:00:00Z");
  const after = getCarrierCalendarDate("2026-09-28T10:00:00Z");
  assert.notEqual(before, after);
});

test("getCarrierCalendarDate returns null for empty input", () => {
  assert.equal(getCarrierCalendarDate(null), null);
  assert.equal(getCarrierCalendarDate(""), null);
});
