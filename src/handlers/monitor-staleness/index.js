const { ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { docClient, SHIPMENTS_TABLE } = require("../../lib/ddb");

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
    // Scan all shipments
    const command = new ScanCommand({
      TableName: SHIPMENTS_TABLE,
      ProjectionExpression:
        "trackingNumber,carrier,statusDescription,lastEventTimestamp,lastStaleNotificationAt",
    });

    const response = await docClient.send(command);
    const shipments = response.Items || [];

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
    const message = `${staleShipments.length} shipment(s) without updates: ${trackingNumbers.join(", ")}`;

    await sendNtfyNotification(message);

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

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Sent notification for ${staleShipments.length} stale shipment(s)`,
        staleShipments: staleShipments,
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

// Send ntfy notification
async function sendNtfyNotification(message) {
  if (!NTFY_URL) {
    console.warn("NTFY_URL not configured, skipping notification");
    return;
  }

  try {
    const response = await fetch(NTFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      console.warn(
        `Failed to send ntfy notification: HTTP ${response.status}`,
      );
    } else {
      console.log("ntfy notification sent successfully");
    }
  } catch (error) {
    console.error("Error sending ntfy notification:", error);
  }
}

// Lambda handler
exports.handler = async (event) => {
  console.log("Staleness monitor triggered");
  return await monitorStaleness();
};
