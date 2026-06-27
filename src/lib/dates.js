// Extract just the YYYY-MM-DD calendar date from an ISO string (or null).
function getDateOnly(dateString) {
  if (!dateString) return null;
  return dateString.includes("T")
    ? dateString.split("T")[0]
    : dateString.substring(0, 10);
}

module.exports = { getDateOnly };
