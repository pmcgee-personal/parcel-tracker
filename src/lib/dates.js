// Timezone for "calendar day" decisions (e.g. once-per-day notification dedup).
// Lambda runs in UTC, so without this a late-evening local event would be
// attributed to the next UTC day. Override via the APP_TIMEZONE env var.
const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/Los_Angeles";

// ShipEngine's estimated_delivery_date is inconsistent about timezone: it
// sometimes carries an explicit UTC/offset marker ("...Z") and sometimes a
// bare local timestamp ("...T17:00:00", no offset) for what is otherwise the
// same delivery estimate. Confirmed against production data: a bare
// "2026-09-28T17:00:00" and a "2026-09-29T00:00:00Z" recorded moments apart
// for the same shipment are the same instant when the bare string is read as
// America/Los_Angeles wall-clock time. Comparing the raw strings (old
// getDateOnly behavior) made every format flip look like a real EDD change,
// flapping "Date Changed" on/off forever with no actual drift.
function hasTimezoneOffset(dateString) {
  return /Z$|[+-]\d{2}:?\d{2}$/.test(dateString);
}

// Resolve a bare "YYYY-MM-DDTHH:mm:ss" wall-clock string to the UTC instant it
// represents in `timeZone`, using only Intl (no date library dependency).
function zonedWallTimeToUtc(dateString, timeZone) {
  const wanted = new Date(`${dateString}Z`).getTime();
  let guess = wanted;
  // Two passes converge even across DST transitions.
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(guess));
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const displayedAsUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      map.hour === "24" ? 0 : Number(map.hour),
      Number(map.minute),
      Number(map.second),
    );
    const delta = wanted - displayedAsUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

// Parse a carrier timestamp into a real Date instant. Offset-bearing strings
// parse natively; bare strings are read as wall-clock time in `timeZone`.
function parseCarrierTimestamp(dateString, timeZone = APP_TIMEZONE) {
  if (!dateString) return null;
  if (hasTimezoneOffset(dateString)) return new Date(dateString);
  return zonedWallTimeToUtc(dateString, timeZone);
}

// The YYYY-MM-DD calendar date for `date` in the configured timezone.
// en-CA locale formats as YYYY-MM-DD.
function getLocalDateString(date = new Date(), timeZone = APP_TIMEZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// The carrier's calendar-day for an EDD/timestamp value, normalized so format
// differences (bare vs UTC) for the *same instant* never register as a date
// change. This replaces the old getDateOnly() raw-string comparison used for
// EDD drift detection.
function getCarrierCalendarDate(dateString, timeZone = APP_TIMEZONE) {
  const instant = parseCarrierTimestamp(dateString, timeZone);
  return instant ? getLocalDateString(instant, timeZone) : null;
}

module.exports = {
  getLocalDateString,
  parseCarrierTimestamp,
  getCarrierCalendarDate,
};
