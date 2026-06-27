const { PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const {
  docClient,
  SHIPMENTS_TABLE,
  EVENTS_TABLE,
  batchWrite,
} = require("../../lib/ddb");
const { mapTrackingEvent } = require("../../lib/events");
const { getDateOnly } = require("../../lib/dates");

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION,
});

const SECRET_NAME = process.env.SECRET_NAME;

const RESPONSE_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "X-Robots-Tag": "noindex, nofollow",
};

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: RESPONSE_HEADERS,
  body: JSON.stringify(body),
});

let shipStationApiKey = null;

const getApiKey = async () => {
  if (shipStationApiKey) return shipStationApiKey;
  console.log("Fetching API key from Secrets Manager...");
  const command = new GetSecretValueCommand({ SecretId: SECRET_NAME });
  const response = await secretsClient.send(command);
  const secret = JSON.parse(response.SecretString);
  if (!secret.ShipStationApiKey) {
    throw new Error(
      `Secret '${SECRET_NAME}' is missing the 'ShipStationApiKey' field`,
    );
  }
  shipStationApiKey = secret.ShipStationApiKey;
  return shipStationApiKey;
};

exports.handler = async (event) => {
  try {
    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return jsonResponse(400, { message: "Invalid JSON body" });
    }

    const { trackingNumber, carrier, direction, source, serviceLevel } = body;

    if (!trackingNumber || !carrier) {
      return jsonResponse(400, {
        message: "trackingNumber and carrier are required",
      });
    }

    // These values are interpolated into the ShipEngine URL, so constrain them
    // to safe characters before use (and URL-encode them below).
    if (!/^[A-Za-z0-9 -]{4,40}$/.test(trackingNumber)) {
      return jsonResponse(400, { message: "Invalid trackingNumber format" });
    }
    if (!/^[a-z0-9_]{2,40}$/.test(carrier)) {
      return jsonResponse(400, { message: "Invalid carrier format" });
    }

    const apiKey = await getApiKey();

    console.log(`Registering ${trackingNumber} via carrier ${carrier}`);

    const query = `carrier_code=${encodeURIComponent(carrier)}&tracking_number=${encodeURIComponent(trackingNumber)}`;
    const trackingUrl = `https://api.shipengine.com/v1/tracking?${query}`;
    const startTrackingUrl = `https://api.shipengine.com/v1/tracking/start?${query}`;

    // Execute both requests simultaneously
    const [trackingResponse, startTrackingResponse] = await Promise.all([
      fetch(trackingUrl, {
        method: "GET",
        headers: { "API-Key": apiKey, "Content-Type": "application/json" },
      }),
      fetch(startTrackingUrl, {
        method: "POST", // The start endpoint requires a POST request
        headers: { "API-Key": apiKey, "Content-Type": "application/json" },
      }),
    ]);

    // Check if the get tracking data request failed
    if (!trackingResponse.ok) {
      const errorText = await trackingResponse.text();
      console.error("ShipEngine API GET Tracking error:", errorText);
      throw new Error(
        `ShipEngine API (Get Tracking) failed with status ${trackingResponse.status}: ${errorText}`,
      );
    }

    // Check if the webhook registration request failed
    if (!startTrackingResponse.ok) {
      const errorText = await startTrackingResponse.text();
      console.error("ShipEngine API POST Start Tracking error:", errorText);
      throw new Error(
        `ShipEngine API (Start Webhook) failed with status ${startTrackingResponse.status}: ${errorText}`,
      );
    }

    // Only parse the tracking data if both requests succeeded
    const trackingData = await trackingResponse.json();

    // 1. Fetch the existing shipment to check for previous estimated delivery date
    let existingHistory = [];
    let oldEstimatedDeliveryDate = null;

    try {
      const getCommand = new GetCommand({
        TableName: SHIPMENTS_TABLE,
        Key: { trackingNumber: trackingData.tracking_number },
      });
      const getResult = await docClient.send(getCommand);
      if (getResult.Item) {
        existingHistory = getResult.Item.estimatedDeliveryHistory || [];
        oldEstimatedDeliveryDate = getResult.Item.estimatedDeliveryDate || null;
      }
    } catch (dbErr) {
      console.warn("Could not retrieve existing shipment:", dbErr.message);
    }

    const newEstimatedDeliveryDate =
      trackingData.estimated_delivery_date || null;
    const oldDateString = getDateOnly(oldEstimatedDeliveryDate);
    const newDateString = getDateOnly(newEstimatedDeliveryDate);

    // 2. Track change if old date exists, new date exists, and CALENDAR dates are different
    if (oldDateString && newDateString && oldDateString !== newDateString) {
      console.log(
        `Detected estimated delivery date change from ${oldDateString} to ${newDateString}. Logging to history.`,
      );
      existingHistory.push({
        date: oldEstimatedDeliveryDate,
        recordedAt: new Date().toISOString(),
      });
    }

    const shipmentItem = {
      trackingNumber: trackingData.tracking_number,
      carrier: carrier,
      direction: direction || null,
      source: source || null,
      serviceLevel: serviceLevel || null,
      lastEventTimestamp:
        trackingData.events?.[0]?.occurred_at || new Date().toISOString(),
      createdAt: new Date().toISOString(),
      statusCode: trackingData.status_code || "UNKNOWN",
      carrierDetailCode: trackingData.carrier_detail_code || null,
      statusDescription:
        trackingData.status_description || "Awaiting tracking data",
      carrierStatusCode: trackingData.carrier_status_code || null,
      carrierStatusDescription: trackingData.carrier_status_description || null,
      shipDate: trackingData.ship_date || null,
      estimatedDeliveryDate: newEstimatedDeliveryDate,
      estimatedDeliveryHistory: existingHistory,
      actualDeliveryDate: trackingData.actual_delivery_date || null,
      exceptionDescription: trackingData.exception_description || null,
    };

    const shipmentPutCommand = new PutCommand({
      TableName: SHIPMENTS_TABLE,
      Item: shipmentItem,
    });
    await docClient.send(shipmentPutCommand);
    console.log(
      "Shipment record written with history size:",
      existingHistory.length,
    );

    if (trackingData.events && trackingData.events.length > 0) {
      // Drop events without a sort key and de-duplicate by occurredAt, since
      // BatchWrite rejects a batch containing duplicate primary keys.
      const byOccurredAt = new Map();
      for (const trackingEvent of trackingData.events) {
        if (!trackingEvent.occurred_at) continue;
        byOccurredAt.set(
          trackingEvent.occurred_at,
          mapTrackingEvent(trackingData.tracking_number, trackingEvent),
        );
      }
      const eventItems = [...byOccurredAt.values()];
      if (eventItems.length > 0) {
        await batchWrite(EVENTS_TABLE, eventItems);
        console.log(`Initial events written: ${eventItems.length}`);
      }
    }

    return jsonResponse(200, { message: "Successfully registered package" });
  } catch (error) {
    // Log the detail for CloudWatch, but don't leak internals to the client.
    console.error("Error in TrackLambda:", error);
    return jsonResponse(500, { message: "Internal Server Error" });
  }
};
