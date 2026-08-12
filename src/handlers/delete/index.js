const { GetCommand, DeleteCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { docClient, SHIPMENTS_TABLE, EVENTS_TABLE } = require("../../lib/ddb");

const generateRequestId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION,
});

const SECRET_NAME = process.env.SECRET_NAME;
const NTFY_URL = process.env.NTFY_URL;

let cachedApiKey = null;
let cachedApiKeyExpiry = 0;

const RESPONSE_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
  "X-Robots-Tag": "noindex, nofollow",
};

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: RESPONSE_HEADERS,
  body: JSON.stringify(body),
});

// Retrieve and cache the ShipStation API key
const getApiKey = async () => {
  const now = Date.now();
  if (cachedApiKey && cachedApiKeyExpiry > now) {
    return cachedApiKey;
  }

  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: SECRET_NAME }),
    );
    cachedApiKey = response.SecretString;
    cachedApiKeyExpiry = now + 3600000; // Cache for 1 hour
    return cachedApiKey;
  } catch (error) {
    console.error("Failed to retrieve API key from Secrets Manager:", error);
    throw new Error("Internal Server Error: Unable to retrieve API key");
  }
};

// Allowed statuses for deletion: NY (Not Yet In System), AC (Accepted), IT (In Transit)
const DELETABLE_STATUSES = new Set(["NY", "AC", "IT"]);

const fetchWithRetry = async (url, options, maxAttempts = 3) => {
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) {
        return response;
      }

      const isRetryable = response.status >= 500 || response.status === 429;
      if (!isRetryable || attempt === maxAttempts - 1) {
        return response;
      }

      console.warn(
        `[fetchWithRetry] Attempt ${attempt + 1} failed with ${response.status}, retrying in ${delays[attempt]}ms`,
      );

      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    } catch (error) {
      if (attempt === maxAttempts - 1) {
        throw error;
      }

      console.warn(
        `[fetchWithRetry] Attempt ${attempt + 1} failed with network error, retrying in ${delays[attempt]}ms`,
      );

      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
};

// Send ntfy notification
const sendNtfyNotification = async (message) => {
  if (!NTFY_URL) {
    console.warn("NTFY_URL not configured, skipping notification");
    return;
  }

  try {
    await fetch(NTFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch (error) {
    console.error("Failed to send ntfy notification:", error);
  }
};

// Delete all events for a tracking number
const deleteEvents = async (trackingNumber, requestId) => {
  try {
    const queryCommand = new QueryCommand({
      TableName: EVENTS_TABLE,
      KeyConditionExpression: "trackingNumber = :tn",
      ExpressionAttributeValues: {
        ":tn": trackingNumber,
      },
    });

    const response = await docClient.send(queryCommand);
    const events = response.Items || [];

    if (events.length === 0) {
      console.log(`[${requestId}] No events found for ${trackingNumber}`);
      return;
    }

    // Delete each event
    for (const event of events) {
      const deleteCommand = new DeleteCommand({
        TableName: EVENTS_TABLE,
        Key: {
          trackingNumber: event.trackingNumber,
          occurredAt: event.occurredAt,
        },
      });
      await docClient.send(deleteCommand);
    }

    console.log(
      `[${requestId}] Deleted ${events.length} events for ${trackingNumber}`,
    );
  } catch (error) {
    console.error(
      `[${requestId}] Error deleting events for ${trackingNumber}:`,
      error,
    );
    throw error;
  }
};

exports.handler = async (event) => {
  const requestId = generateRequestId();

  try {
    // Extract tracking number from path parameter
    const trackingNumber = event.pathParameters?.trackingNumber;

    if (!trackingNumber) {
      console.warn(`[${requestId}] Missing trackingNumber path parameter`);
      return jsonResponse(400, {
        message: "trackingNumber is required",
        requestId,
      });
    }

    // Validate tracking number format
    if (!/^[A-Za-z0-9 -]{4,40}$/.test(trackingNumber)) {
      console.warn(`[${requestId}] Invalid trackingNumber format`);
      return jsonResponse(400, {
        message: "Invalid trackingNumber format",
        requestId,
      });
    }

    console.log(`[${requestId}] Attempting to delete ${trackingNumber}`);

    // Fetch shipment from Shipments table
    const getCommand = new GetCommand({
      TableName: SHIPMENTS_TABLE,
      Key: { trackingNumber },
    });

    const shipmentResponse = await docClient.send(getCommand);
    const shipment = shipmentResponse.Item;

    if (!shipment) {
      console.warn(`[${requestId}] Shipment not found: ${trackingNumber}`);
      return jsonResponse(404, {
        message: "Shipment not found",
        requestId,
      });
    }

    // Check if shipment status allows deletion
    if (!DELETABLE_STATUSES.has(shipment.statusCode)) {
      console.warn(
        `[${requestId}] Cannot delete shipment with status ${shipment.statusCode}`,
      );
      return jsonResponse(400, {
        message: `Cannot delete shipment with status ${shipment.statusDescription}. Only shipments in 'Not Yet In System', 'Accepted', or 'In Transit' status can be deleted.`,
        requestId,
      });
    }

    // Delete from Shipments table
    const deleteShipmentCommand = new DeleteCommand({
      TableName: SHIPMENTS_TABLE,
      Key: { trackingNumber },
    });

    await docClient.send(deleteShipmentCommand);
    console.log(`[${requestId}] Deleted shipment record: ${trackingNumber}`);

    // Delete all associated events
    await deleteEvents(trackingNumber, requestId);

    // Attempt to stop tracking webhooks on ShipEngine
    const apiKey = await getApiKey();
    const carrier = shipment.carrier || "unknown";
    const stopTrackingUrl = `https://api.shipengine.com/v1/tracking/stop?carrier_code=${encodeURIComponent(carrier)}&tracking_number=${encodeURIComponent(trackingNumber)}`;

    console.log(
      `[${requestId}] ShipEngine request - URL: ${stopTrackingUrl}, Carrier: ${carrier}, Tracking: ${trackingNumber}`,
    );

    let shipEngineError = null;
    try {
      const stopResponse = await fetchWithRetry(stopTrackingUrl, {
        method: "POST",
        headers: { "API-Key": apiKey, "Content-Type": "application/json" },
      });

      let responseBody = "";
      try {
        responseBody = await stopResponse.clone().text();
      } catch {
        responseBody = "[unable to read response body]";
      }

      console.log(
        `[${requestId}] ShipEngine response - Status: ${stopResponse.status}, Body: ${responseBody}`,
      );

      if (!stopResponse.ok) {
        shipEngineError = `ShipEngine returned ${stopResponse.status}: ${responseBody}`;
        console.warn(
          `[${requestId}] ShipEngine stop tracking failed: ${shipEngineError}`,
        );

        // Send ntfy notification about the webhook stop failure
        await sendNtfyNotification(
          `⚠️ Parcel Tracker: Failed to stop tracking webhooks for ${trackingNumber}. The shipment was deleted locally, but carrier webhooks may still send updates.`,
        );
      } else {
        console.log(
          `[${requestId}] Successfully stopped tracking webhooks for ${trackingNumber}`,
        );
      }
    } catch (error) {
      shipEngineError = error.message;
      console.error(
        `[${requestId}] Error calling ShipEngine stop tracking: ${error.message}`,
        error,
      );

      // Send ntfy notification about the webhook stop failure
      await sendNtfyNotification(
        `⚠️ Parcel Tracker: Failed to stop tracking webhooks for ${trackingNumber}. The shipment was deleted locally, but carrier webhooks may still send updates.`,
      );
    }

    console.log(
      `[${requestId}] Successfully deleted shipment: ${trackingNumber}`,
    );

    return jsonResponse(200, {
      message: "Shipment deleted successfully",
      trackingNumber,
      carrier,
      statusDescription: shipment.statusDescription,
      requestId,
      webhookStopped: !shipEngineError,
    });
  } catch (error) {
    console.error(`[${requestId}] Error in DeleteLambda:`, error.message);
    return jsonResponse(500, {
      message: "Internal Server Error",
      requestId,
    });
  }
};
