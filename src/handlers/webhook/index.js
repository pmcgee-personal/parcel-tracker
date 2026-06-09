// src/handlers/webhook/index.js
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

// Initialize the DynamoDB Document Client (uses native fetch / AWS SDK v3 in Node 22)
const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-west-2",
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const SHIPMENTS_TABLE = process.env.SHIPMENTS_TABLE || "Shipments";
const EVENTS_TABLE = process.env.EVENTS_TABLE || "Events";

exports.handler = async (event) => {
  console.log("Received webhook event:", JSON.stringify(event, null, 2));

  try {
    // 1. Parse the incoming webhook payload
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Missing request body" }),
      };
    }

    const payload = JSON.parse(event.body);

    const trackingNumber = payload.tracking_number;
    if (!trackingNumber) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Missing tracking_number in payload" }),
      };
    }

    // 2. Upsert high-level Shipment status
    // We use UpdateCommand (upsert) to create or overwrite the overall shipment status
    const shipmentParams = {
      TableName: SHIPMENTS_TABLE,
      Key: { trackingNumber },
      UpdateExpression:
        "SET statusCode = :sc, statusDescription = :sd, shipDate = :sdDate, actualDeliveryDate = :ad, updatedAt = :u",
      ExpressionAttributeValues: {
        ":sc": payload.status_code || "UNKNOWN",
        ":sd": payload.status_description || "No description",
        ":sdDate": payload.ship_date || null,
        ":ad": payload.actual_delivery_date || null,
        ":u": new Date().toISOString(),
      },
    };

    console.log(`Updating shipment details for: ${trackingNumber}`);
    await docClient.send(new UpdateCommand(shipmentParams));

    // 3. Process individual timeline tracking events
    const trackingEvents = payload.events || [];
    console.log(
      `Processing ${trackingEvents.length} timeline events for ${trackingNumber}`,
    );

    let newEventsCount = 0;
    let duplicateEventsCount = 0;

    for (const trackingEvent of trackingEvents) {
      const occurredAt = trackingEvent.occurred_at;
      if (!occurredAt) continue; // Skip if no timestamp

      const eventParams = {
        TableName: EVENTS_TABLE,
        Item: {
          trackingNumber: trackingNumber, // Partition Key
          occurredAt: occurredAt, // Sort Key
          description: trackingEvent.description || "No description",
          cityLocality: trackingEvent.city_locality || null,
          stateProvince: trackingEvent.state_province || null,
          postalCode: trackingEvent.postal_code || null,
          countryCode: trackingEvent.country_code || null,
          statusCode: trackingEvent.status_code || null,
          latitude: trackingEvent.latitude || null,
          longitude: trackingEvent.longitude || null,
          createdAt: new Date().toISOString(),
        },
        // CRITICAL: Only write this item if the combination of PK (trackingNumber)
        // and SK (occurredAt) does NOT already exist in the database.
        ConditionExpression:
          "attribute_not_exists(trackingNumber) AND attribute_not_exists(occurredAt)",
      };

      try {
        await docClient.send(new PutCommand(eventParams));
        newEventsCount++;
      } catch (err) {
        // If DynamoDB throws ConditionalCheckFailedException, it means we already have this event.
        if (err.name === "ConditionalCheckFailedException") {
          duplicateEventsCount++;
        } else {
          // Rethrow any other genuine database errors (e.g. throughput, connection issues)
          console.error(`Database error writing event at ${occurredAt}:`, err);
          throw err;
        }
      }
    }

    console.log(
      `Processing complete. New events added: ${newEventsCount}. Duplicates ignored: ${duplicateEventsCount}.`,
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Webhook processed successfully",
        shipment: trackingNumber,
        newEventsAdded: newEventsCount,
        duplicatesIgnored: duplicateEventsCount,
      }),
    };
  } catch (error) {
    console.error("Error handling webhook:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal Server Error",
        error: error.message,
      }),
    };
  }
};
