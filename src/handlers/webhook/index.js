const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-west-2",
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const SHIPMENTS_TABLE = process.env.SHIPMENTS_TABLE || "Shipments";
const EVENTS_TABLE = process.env.EVENTS_TABLE || "Events";

// NEW: Helper function to evaluate and send push notifications
async function sendPushNotification(data) {
  const ntfyUrl = process.env.NTFY_URL;
  if (!ntfyUrl) {
    console.warn(
      "NTFY_URL environment variable is not set. Skipping notification.",
    );
    return;
  }

  const trackingNumber = data.tracking_number;
  const statusCode = data.status_code;

  // 1. Get descriptions safely and convert to lowercase for case-insensitive matching
  const topLevelDesc = (data.carrier_status_description || "").toLowerCase();

  let latestEventDesc = "";
  if (data.events && data.events.length > 0) {
    const sortedEvents = data.events.sort(
      (a, b) => new Date(b.occurred_at) - new Date(a.occurred_at),
    );
    latestEventDesc = (sortedEvents[0].description || "").toLowerCase();
  }

  // 2. Evaluate notification rules
  const isDelivered = statusCode === "DE";
  const isException = statusCode === "EX";
  const isOutForDelivery =
    statusCode === "IT" &&
    (topLevelDesc.includes("out for delivery") ||
      latestEventDesc.includes("out for delivery"));

  // Exit early if it doesn't match our criteria
  if (!isDelivered && !isException && !isOutForDelivery) {
    return;
  }

  let title = "Parcel Update";
  let message = `Package ${trackingNumber} status updated.`;
  let priority = "default";
  let tags = "package";

  if (isDelivered) {
    title = "Package Delivered!"; // Removed emoji, ntfy will use the "tada" tag below
    message = `Your package ${trackingNumber} has been successfully delivered.`;
    tags = "tada,white_check_mark";
  } else if (isException) {
    title = "Exception Alert";
    message = `Alert: Exception occurred on package ${trackingNumber}.`;
    priority = "high";
    tags = "warning,exclamation";
  } else if (isOutForDelivery) {
    title = "Out for Delivery!";
    message = `Get ready! Package ${trackingNumber} is out for delivery today.`;
    tags = "truck";
  }

  try {
    const response = await fetch(ntfyUrl, {
      method: "POST",
      body: message, // Emojis in the BODY are perfectly fine, just not in headers!
      headers: {
        Title: title,
        Priority: priority,
        Tags: tags,
      },
    });

    if (!response.ok) {
      console.error(`ntfy responded with HTTP ${response.status}`);
    } else {
      console.log(`Successfully sent push notification for ${trackingNumber}`);
    }
  } catch (error) {
    console.error("Failed to send push notification via ntfy:", error);
  }
}

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

    // 1. Fetch the existing shipment to check for date changes
    let existingEdd = null;
    try {
      const getResult = await docClient.send(
        new GetCommand({
          TableName: SHIPMENTS_TABLE,
          Key: { trackingNumber },
        }),
      );

      if (getResult.Item) {
        existingEdd = getResult.Item.estimatedDeliveryDate || null;
      }
    } catch (err) {
      console.warn(
        "Could not retrieve existing shipment for comparison:",
        err.message,
      );
    }

    // Find the most recent event from the incoming webhook payload.
    const latestEvent = data.events?.sort(
      (a, b) => new Date(b.occurred_at) - new Date(a.occurred_at),
    )[0];

    const incomingEdd = data.estimated_delivery_date || null;

    // 2. Build the base Update parameters
    let updateExpression =
      "SET statusCode = :sc, carrierDetailCode = :cdc, statusDescription = :sd, carrierStatusCode = :csc, carrierStatusDescription = :csd, shipDate = :sdDate, estimatedDeliveryDate = :edd, actualDeliveryDate = :ad, exceptionDescription = :ed, updatedAt = :u, lastEventTimestamp = :let";

    let expressionAttributeValues = {
      ":sc": data.status_code || "UNKNOWN",
      ":cdc": data.carrier_detail_code || null,
      ":sd": data.status_description || "No description",
      ":csc": data.carrier_status_code || null,
      ":csd": data.carrier_status_description || null,
      ":sdDate": data.ship_date || null,
      ":edd": incomingEdd,
      ":ad": data.actual_delivery_date || null,
      ":ed": data.exception_description || null,
      ":u": new Date().toISOString(),
      ":let": latestEvent
        ? latestEvent.occurred_at
        : data.last_event?.occurred_at || null,
    };

    // 3. If dates differ, dynamically add the history append logic to the update command
    if (existingEdd && incomingEdd && existingEdd !== incomingEdd) {
      console.log(
        `Detected EDD change via webhook from ${existingEdd} to ${incomingEdd}. Logging history.`,
      );
      updateExpression +=
        ", estimatedDeliveryHistory = list_append(if_not_exists(estimatedDeliveryHistory, :empty_list), :new_history)";
      expressionAttributeValues[":empty_list"] = [];
      expressionAttributeValues[":new_history"] = [
        {
          date: existingEdd,
          recordedAt: new Date().toISOString(),
        },
      ];
    }

    const shipmentParams = {
      TableName: SHIPMENTS_TABLE,
      Key: { trackingNumber },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    };

    console.log(`Updating shipment details for: ${trackingNumber}`);
    await docClient.send(new UpdateCommand(shipmentParams));

    // ==============================================================
    // NEW: TRIGGER NOTIFICATION AFTER SUCCESSFUL SHIPMENT UPDATE
    // ==============================================================
    await sendPushNotification(data);

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
