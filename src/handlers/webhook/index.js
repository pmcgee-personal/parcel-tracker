// src/handlers/webhook/index.js

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-west-2",
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const SHIPMENTS_TABLE = process.env.SHIPMENTS_TABLE || "Shipments";
const EVENTS_TABLE = process.env.EVENTS_TABLE || "Events";

exports.handler = async (event) => {
  console.log("Received webhook event:", JSON.stringify(event, null, 2));

  try {
    if (!event.body)
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Missing request body" }),
      };

    const payload = JSON.parse(event.body);
    const data = payload.data;

    if (!data)
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Request body is missing the 'data' object",
        }),
      };

    const trackingNumber = data.tracking_number;
    if (!trackingNumber)
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Missing tracking_number within the 'data' object",
        }),
      };

    // Find the most recent event from the incoming webhook payload.
    const latestEvent = data.events?.sort(
      (a, b) => new Date(b.occurred_at) - new Date(a.occurred_at),
    )[0];

    const shipmentParams = {
      TableName: SHIPMENTS_TABLE,
      Key: { trackingNumber },
      // BUG FIX: Added lastEventTimestamp to the UpdateExpression.
      UpdateExpression:
        "SET statusCode = :sc, carrierDetailCode = :cdc, statusDescription = :sd, carrierStatusCode = :csc, carrierStatusDescription = :csd, shipDate = :sdDate, estimatedDeliveryDate = :edd, actualDeliveryDate = :ad, exceptionDescription = :ed, updatedAt = :u, lastEventTimestamp = :let",
      ExpressionAttributeValues: {
        ":sc": data.status_code || "UNKNOWN",
        ":cdc": data.carrier_detail_code || null,
        ":sd": data.status_description || "No description",
        ":csc": data.carrier_status_code || null,
        ":csd": data.carrier_status_description || null,
        ":sdDate": data.ship_date || null,
        ":edd": data.estimated_delivery_date || null,
        ":ad": data.actual_delivery_date || null,
        ":ed": data.exception_description || null,
        ":u": new Date().toISOString(),
        // BUG FIX: Set the lastEventTimestamp from the most recent event in the payload.
        ":let": latestEvent
          ? latestEvent.occurred_at
          : data.last_event?.occurred_at,
      },
    };

    console.log(`Updating shipment details for: ${trackingNumber}`);
    await docClient.send(new UpdateCommand(shipmentParams));

    const trackingEvents = data.events || [];
    let newEventsCount = 0,
      duplicateEventsCount = 0;

    for (const trackingEvent of trackingEvents) {
      const occurredAt = trackingEvent.occurred_at;
      if (!occurredAt) continue;

      const eventParams = {
        TableName: EVENTS_TABLE,
        Item: {
          trackingNumber: trackingNumber,
          occurredAt: occurredAt,
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
          createdAt: new Date().toISOString(),
        },
        // BUG FIX: Corrected ConditionExpression to only check the composite key (trackingNumber + occurredAt).
        ConditionExpression: "attribute_not_exists(occurredAt)",
      };

      try {
        await docClient.send(new PutCommand(eventParams));
        newEventsCount++;
      } catch (err) {
        if (err.name === "ConditionalCheckFailedException")
          duplicateEventsCount++;
        else throw err;
      }
    }

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
