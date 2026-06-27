// Timezone for "calendar day" decisions (e.g. once-per-day notification dedup).
// Lambda runs in UTC, so without this a late-evening local event would be
// attributed to the next UTC day. Override via the APP_TIMEZONE env var.
const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/Los_Angeles";

// Extract just the YYYY-MM-DD calendar date from an ISO string (or null).
function getDateOnly(dateString) {
  if (!dateString) return null;
  return dateString.includes("T")
    ? dateString.split("T")[0]
    : dateString.substring(0, 10);
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

module.exports = { getDateOnly, getLocalDateString };
