// Shared ntfy.sh push notification sender. Every caller (webhook, delete,
// monitor-staleness) previously hand-rolled its own fetch/headers, which is
// how a "No Events ⏳" Title header once crashed every staleness push for a
// week: HTTP header values must be Latin-1 (ByteString), and undici's fetch
// throws synchronously on a non-Latin-1 character (e.g. an emoji) before the
// request is ever sent. Centralizing this means that class of bug can only
// be reintroduced once, not independently in every call site.
//
// Returns true only when the push was actually delivered — callers must not
// treat a falsy return as "handled": a failed send should be retried, not
// silently recorded as done.
async function sendNtfyNotification(
  ntfyUrl,
  message,
  { title, priority = "default", tags } = {},
) {
  if (!ntfyUrl) {
    console.warn("NTFY_URL not configured, skipping notification");
    return false;
  }

  try {
    const response = await fetch(ntfyUrl, {
      method: "POST",
      body: message,
      headers: {
        // Keep these ASCII-only; any visual flair belongs in the message
        // body above, which has no Latin-1 restriction.
        Title: title,
        Priority: priority,
        Tags: tags,
      },
    });

    if (!response.ok) {
      console.warn(
        `Failed to send ntfy notification: HTTP ${response.status}`,
      );
      return false;
    }

    console.log("ntfy notification sent successfully");
    return true;
  } catch (error) {
    console.error("Error sending ntfy notification:", error);
    return false;
  }
}

module.exports = { sendNtfyNotification };
