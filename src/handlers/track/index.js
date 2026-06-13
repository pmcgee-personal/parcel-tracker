const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION,
});

const SHIPMENTS_TABLE = process.env.SHIPMENTS_TABLE;
const EVENTS_TABLE = process.env.EVENTS_TABLE;
const SECRET_NAME = process.env.SECRET_NAME;

let shipStationApiKey = null;

const getApiKey = async () => {
  if (shipStationApiKey) return shipStationApiKey;
  console.log("Fetching API key from Secrets Manager...");
  const command = new GetSecretValueCommand({ SecretId: SECRET_NAME });
  const response = await secretsClient.send(command);
  const secret = JSON.parse(response.SecretString);
  shipStationApiKey = secret.ShipStationApiKey;
  return shipStationApiKey;
};

exports.handler = async (event) => {
  console.log(
    "TrackLambda invoked with event:",
    JSON.stringify(event, null, 2),
  );

  try {
    const body = JSON.parse(event.body);
    const { trackingNumber, carrier, direction, source } = body;

    if (!trackingNumber || !carrier) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "trackingNumber and carrier are required",
        }),
      };
    }

    const apiKey = await getApiKey();
    console.log(
      `Fetching initial tracking data for ${trackingNumber} from ShipEngine API...`,
    );

    const apiUrl = `https://api.shipengine.com/v1/tracking?carrier_code=${carrier}&tracking_number=${trackingNumber}`;
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: { "API-Key": apiKey, "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ShipEngine API error:", errorText);
      throw new Error(
        `ShipEngine API failed with status ${response.status}: ${errorText}`,
      );
    }

    const trackingData = await response.json();

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
      console.warn(
        "Could not retrieve existing shipment (might be a new package):",
        dbErr.message,
      );
    }

    const newEstimatedDeliveryDate =
      trackingData.estimated_delivery_date || null;

    // 2. Track change if old date exists, new date exists, and they are different
    if (
      oldEstimatedDeliveryDate &&
      newEstimatedDeliveryDate &&
      oldEstimatedDeliveryDate !== newEstimatedDeliveryDate
    ) {
      console.log(
        `Detected estimated delivery date change from ${oldEstimatedDeliveryDate} to ${newEstimatedDeliveryDate}. Logging to history.`,
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
      estimatedDeliveryHistory: existingHistory, // 3. Save the updated history list
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
      for (const trackingEvent of trackingData.events) {
        const eventPutCommand = new PutCommand({
          TableName: EVENTS_TABLE,
          Item: {
            trackingNumber: trackingData.tracking_number,
            occurredAt: trackingEvent.occurred_at,
            carrierOccurredAt: trackingEvent.carrier_occurred_at || null,
            description: trackingEvent.description || null,
            cityLocality: trackingEvent.city_locality || null,
            stateProvince: trackingEvent.state_province || null,
            postalCode: trackingEvent.postal_code || null,
            countryCode: trackingEvent.country_code || null,
            companyName: trackingEvent.company_name || null,
            signer: trackingEvent.signer || null,
            eventCode: trackingEvent.event_code || null,
            carrierDetailCode: trackingEvent.carrier_detail_code || null,
            statusCode: trackingEvent.status_code || null,
            statusDescription: trackingEvent.status_description || null,
            carrierStatusCode: trackingEvent.carrier_status_code || null,
            carrierStatusDescription:
              trackingEvent.carrier_status_description || null,
            latitude: trackingEvent.latitude || null,
            longitude: trackingEvent.longitude || null,
          },
        });
        await docClient.send(eventPutCommand);
      }
      console.log(`Initial events written: ${trackingData.events.length}`);
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify({ message: "Successfully registered package" }),
    };
  } catch (error) {
    console.error("Error in TrackLambda:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify({
        message: "Internal Server Error",
        error: error.message,
      }),
    };
  }
};
