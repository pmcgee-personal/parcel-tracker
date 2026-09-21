const { UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { docClient, SHIPMENTS_TABLE, scanAll } = require("../../lib/ddb");

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION,
});

const NTFY_URL = process.env.NTFY_URL;
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours
const NOTIFICATION_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

// Scan shipments for stale ones and send notification
async function monitorStaleness() {
  console.log("Starting staleness monitoring scan");

  try {
    // Scan all shipments, following pagination so no shipments are skipped
    const shipments = await scanAll({
      TableName: SHIPMENTS_TABLE,
      ProjectionExpression:
        "trackingNumber,carrier,statusDescription,lastEventTimestamp,lastStaleNotificationAt",
    });

    console.log(`Scanned ${shipments.length} shipments`);

    const now = Date.now();
    const staleShipments = [];

    // Find stale shipments that haven't been notified recently
    const activeStatuses = ["accepted", "in transit", "exception"];
    for (const shipment of shipments) {
      if (!shipment.lastEventTimestamp) {
        continue; // Skip if no event timestamp
      }

      // Only notify for active shipments (not delivered, cancelled, etc.)
      const status = (shipment.statusDescription || "").toLowerCase();
      if (!activeStatuses.some((s) => status.includes(s))) {
        continue;
      }

      const lastEventTime = new Date(
        shipment.lastEventTimestamp,
      ).getTime();
      const timeSinceLastEvent = now - lastEventTime;

      // Check if stale
      if (timeSinceLastEvent > STALE_THRESHOLD_MS) {
        const lastNotificationTime = shipment.lastStaleNotificationAt
          ? new Date(shipment.lastStaleNotificationAt).getTime()
          : 0;
        const timeSinceLastNotification = now - lastNotificationTime;

        // Only notify if we haven't notified in the last 24 hours
        if (timeSinceLastNotification > NOTIFICATION_COOLDOWN_MS) {
          staleShipments.push({
            trackingNumber: shipment.trackingNumber,
            carrier: shipment.carrier || "unknown",
            status: shipment.statusDescription || "Unknown",
            lastEventTime: shipment.lastEventTimestamp,
            hoursWithoutUpdate: Math.round(timeSinceLastEvent / (60 * 60 * 1000)),
          });
        }
      }
    }

    if (staleShipments.length === 0) {
      console.log("No stale shipments found");
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "No stale shipments",
          count: 0,
        }),
      };
    }

    // Send ntfy notification
    console.log(`Found ${staleShipments.length} stale shipments to notify`);

    const trackingNumbers = staleShipments.map((s) => s.trackingNumber);
    // Emoji lives in the body (UTF-8 safe), never in a header (Latin-1/ByteString only).
    const message = `⏳ No events for ${staleShipments.length} shipment(s): ${trackingNumbers.join(", ")}`;

    const notified = await sendNtfyNotification(message);

    if (notified) {
      // Update lastStaleNotificationAt for each stale shipment
      for (const shipment of staleShipments) {
        const updateCommand = new UpdateCommand({
          TableName: SHIPMENTS_TABLE,
          Key: { trackingNumber: shipment.trackingNumber },
          UpdateExpression: "SET lastStaleNotificationAt = :now",
          ExpressionAttributeValues: {
            ":now": new Date().toISOString(),
          },
        });
        await docClient.send(updateCommand);
      }

      console.log(
        `Updated lastStaleNotificationAt for ${staleShipments.length} shipments`,
      );
    } else {
      // Don't stamp lastStaleNotificationAt on a failed send — that would silently
      // suppress retries for the full cooldown window even though nothing was
      // ever delivered. Leaving it untouched means these shipments are
      // re-evaluated (and re-notified) on the next scheduled run.
      console.warn(
        `ntfy notification failed; leaving lastStaleNotificationAt untouched so ${staleShipments.length} shipment(s) are retried next cycle`,
      );
    }

    return {
      statusCode: notified ? 200 : 502,
      body: JSON.stringify({
        message: notified
          ? `Sent notification for ${staleShipments.length} stale shipment(s)`
          : `Found ${staleShipments.length} stale shipment(s) but ntfy notification failed`,
        staleShipments: staleShipments,
        notified,
      }),
    };
  } catch (error) {
    console.error("Error in monitorStaleness:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal Server Error",
        error: error.message,
      }),
    };
  }
}

// Send ntfy notification. Returns true only when the push was actually
// delivered — callers must not treat a falsy return as "handled".
async function sendNtfyNotification(message) {
  if (!NTFY_URL) {
    console.warn("NTFY_URL not configured, skipping notification");
    return false;
  }

  try {
    const response = await fetch(NTFY_URL, {
      method: "POST",
      body: message,
      headers: {
        // HTTP header values must be Latin-1 (ByteString) — undici's fetch
        // throws synchronously on a non-Latin-1 character (e.g. an emoji)
        // here, before the request is ever sent. Keep these ASCII-only;
        // any visual flair belongs in the body above, which has no such
        // restriction.
        Title: "No Events",
        Priority: "default",
        Tags: "hourglass",
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

// Lambda handler
exports.handler = async (event) => {
  console.log("Staleness monitor triggered");
  return await monitorStaleness();
};

// Exported for unit testing the header-safety/success-signaling contract in
// isolation, without going through the full scan-and-notify flow.
exports.sendNtfyNotification = sendNtfyNotification;
