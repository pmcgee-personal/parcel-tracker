/**
 * Calculates a human-readable relative time string from an ISO timestamp
 * using native browser APIs (no external npm dependencies required).
 *
 * @param {string} isoString - The ISO date string to compare (e.g., "2026-06-08T21:15:43Z")
 * @returns {string} - "X hours ago", "X days ago", etc.
 */
export function timeSince(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  const now = new Date();
  const secondsPast = Math.floor((now.getTime() - date.getTime()) / 1000);

  // If the time is in the future or invalid, just return a fallback
  if (secondsPast < 0) return "Just now";
  if (secondsPast < 60) {
    return "Just now";
  }
  if (secondsPast < 3600) {
    const minutes = Math.floor(secondsPast / 60);
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  }
  if (secondsPast < 86400) {
    const hours = Math.floor(secondsPast / 3600);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  }
  const days = Math.floor(secondsPast / 86400);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}
