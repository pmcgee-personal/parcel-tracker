// src/handlers/track/index.js
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

// Initialize AWS clients
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION,
});

const SHIPMENTS_TABLE = process.env.SHIPMENTS_TABLE;
const EVENTS_TABLE = process.env.EVENTS_TABLE;
const SECRET_NAME = process.env.SECRET_NAME;

// Cache for the secret
let shipStationApiKey = null;

const getApiKey = async () => {
  if (shipStationApiKey) {
    return shipStationApiKey;
  }
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

    // CORRECTED: Use api.shipengine.com and the API-Key header
    console.log(
      `Fetching initial tracking data for ${trackingNumber} from ShipEngine API...`,
    );
    const apiUrl = `https://api.shipengine.com/v1/tracking?carrier_code=${carrier}&tracking_number=${trackingNumber}`;

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "API-Key": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ShipEngine API error:", errorText);
      throw new Error(
        `ShipEngine API failed with status ${response.status}: ${errorText}`,
      );
    }

    const trackingData = await response.json();

    const shipmentItem = {
      trackingNumber: trackingData.tracking_number,
      carrier: carrier,
      direction: direction || null,
      source: source || null,
      statusCode: trackingData.status_code || "UNKNOWN",
      statusDescription:
        trackingData.status_description || "Awaiting tracking data",
      estimatedDeliveryDate: trackingData.estimated_delivery_date || null,
      actualDeliveryDate: trackingData.actual_delivery_date || null,
      shipDate: trackingData.ship_date || null,
      lastEventTimestamp:
        trackingData.events?.[0]?.occurred_at || new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const shipmentPutCommand = new PutCommand({
      TableName: SHIPMENTS_TABLE,
      Item: shipmentItem,
    });
    await docClient.send(shipmentPutCommand);
    console.log("Initial shipment record written.");

    if (trackingData.events && trackingData.events.length > 0) {
      for (const trackingEvent of trackingData.events) {
        const eventPutCommand = new PutCommand({
          TableName: EVENTS_TABLE,
          Item: {
            trackingNumber: trackingData.tracking_number,
            occurredAt: trackingEvent.occurred_at,
            description: trackingEvent.description,
            cityLocality: trackingEvent.city_locality,
            stateProvince: trackingEvent.state_province,
            postalCode: trackingEvent.postal_code,
            countryCode: trackingEvent.country_code,
          },
          ConditionExpression: "attribute_not_exists(trackingNumber)",
        });
        try {
          await docClient.send(eventPutCommand);
        } catch (err) {
          if (err.name !== "ConditionalCheckFailedException") throw err;
        }
      }
      console.log(`Initial events written: ${trackingData.events.length}`);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shipmentItem),
    };
  } catch (error) {
    console.error("Error in TrackLambda:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal Server Error",
        error: error.message,
      }),
    };
  }
};
