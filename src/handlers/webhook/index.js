const {
  PutCommand,
  UpdateCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  verifyShipEngineSignature,
} = require("../../lib/verifyShipEngineSignature");
const { docClient, SHIPMENTS_TABLE, EVENTS_TABLE } = require("../../lib/ddb");
const { mapTrackingEvent } = require("../../lib/events");
const { getDateOnly, getLocalDateString } = require("../../lib/dates");
const { withRetry } = require("../../lib/dynamodbRetry");
const { OperationTracker } = require("../../lib/operationTracker");

const generateRequestId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// NEW: Helper function to evaluate and send push notifications
async function sendPushNotification(
  data,
  direction,
  source,
  skipOfdNotification,
) {
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
    // Use spread syntax [...] to avoid mutating the original array
    const sortedEvents = [...data.events].sort(
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

  // NEW: Exit early if we already sent an OFD today for this package
  if (isOutForDelivery && skipOfdNotification) {
    console.log(
      `Duplicate 'Out for Delivery' notification skipped for ${trackingNumber} to prevent spam.`,
    );
    return;
  }

  // Exit early if it doesn't match our criteria
  if (!isDelivered && !isException && !isOutForDelivery) {
    return;
  }

  // 3. Gracefully build the package identification sentence
  const packageParts = ["Your"];
  if (direction) packageParts.push(direction.toLowerCase());
  if (source) packageParts.push(source);
  packageParts.push("package");
  packageParts.push(trackingNumber);

  const pkgString = packageParts.join(" ");

  let title = "Parcel Update";
  let message = `${pkgString} status updated.`;
  let priority = "default";
  let tags = "package";

  if (isDelivered) {
    title = "Package Delivered!";
    message = `${pkgString} has been successfully delivered.`;
    tags = "tada,white_check_mark";
  } else if (isException) {
    title = "Exception Alert";
    message = `Alert: Exception occurred on ${pkgString}.`;
    priority = "high";
    tags = "warning,exclamation";
  } else if (isOutForDelivery) {
    title = "Out for Delivery!";
    message = `Get ready! ${pkgString} is out for delivery today.`;
    tags = "truck";
  }

  try {
    const response = await fetch(ntfyUrl, {
      method: "POST",
      body: message,
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
  const requestId = generateRequestId();
  let tracker; // Will be initialized once we have the tracking number
  // Avoid logging the full event: webhook bodies contain shipment PII
  // (signers, geolocation). Per-step logs below reference the tracking number.
  try {
    // Verify the request genuinely came from ShipEngine before trusting any of
    // its contents. Bypass only for local testing (events/event.json has no
    // signature headers); never set WEBHOOK_VERIFY_DISABLED in a deployment.
    if (process.env.WEBHOOK_VERIFY_DISABLED === "true") {
      console.warn(`[${requestId}] WEBHOOK_VERIFY_DISABLED is set`);
    } else {
      const verification = await verifyShipEngineSignature(event);
      if (!verification.ok) {
        console.warn(
          `[${requestId}] Rejected webhook (${verification.status}): ${verification.reason}`,
        );
        return {
          statusCode: verification.status,
          headers: {
            "Content-Type": "application/json",
            "X-Robots-Tag": "noindex, nofollow",
          },
          body: JSON.stringify({ message: "Unauthorized", requestId }),
        };
      }
    }

    if (!event.body) {
      console.warn(`[${requestId}] Missing request body`);
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Missing request body", requestId }),
      };
    }

    const payload = JSON.parse(event.body);
    const data = payload.data;

    if (!data) {
      console.warn(`[${requestId}] Missing data object in request body`);
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Request body is missing the 'data' object",
          requestId,
        }),
      };
    }

    const trackingNumber = data.tracking_number;
    if (!trackingNumber) {
      console.warn(`[${requestId}] Missing tracking_number in data`);
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Missing tracking_number within the 'data' object",
          requestId,
        }),
      };
    }

    tracker = new OperationTracker(requestId, trackingNumber);

    // 1. Fetch the existing shipment to check for date changes & grab metadata
    let existingEdd = null;
    let direction = null;
    let source = null;
    let lastOfdDate = null; // NEW: To track when we last sent an OFD alert

    const getResult = await withRetry(
      new GetCommand({
        TableName: SHIPMENTS_TABLE,
        Key: { trackingNumber },
      }),
      docClient,
      null,
      {
        requestId,
        operationName: "FetchShipment",
      },
    );

    tracker.recordFetch(
      getResult.success,
      getResult.error,
      getResult.attempt,
      getResult.errorType,
      getResult.isTransient,
    );

    if (getResult.success && getResult.data?.Item) {
      existingEdd = getResult.data.Item.estimatedDeliveryDate || null;
      direction = getResult.data.Item.direction || null;
      source = getResult.data.Item.source || null;
      lastOfdDate = getResult.data.Item.lastOfdDate || null; // NEW
    } else if (!getResult.success) {
      console.warn(
        `[${requestId}] Could not retrieve existing shipment (transient=${getResult.isTransient}):`,
        getResult.errorType,
      );
    }

    // Find the most recent event from the incoming webhook payload.
    // Copy before sorting so we don't mutate the original payload array.
    const latestEvent = data.events
      ? [...data.events].sort(
          (a, b) => new Date(b.occurred_at) - new Date(a.occurred_at),
        )[0]
      : undefined;

    const incomingEdd = data.estimated_delivery_date || null;

    const existingDateString = getDateOnly(existingEdd);
    const incomingDateString = getDateOnly(incomingEdd);

    // ==============================================================
    // NEW: Check if this payload represents an Out For Delivery event
    // ==============================================================
    const topLevelDesc = (data.carrier_status_description || "").toLowerCase();
    let latestEventDesc = "";
    if (latestEvent) {
      latestEventDesc = (latestEvent.description || "").toLowerCase();
    }

    const isOutForDelivery =
      data.status_code === "IT" &&
      (topLevelDesc.includes("out for delivery") ||
        latestEventDesc.includes("out for delivery"));

    const todayStr = getLocalDateString();
    let skipOfdNotification = false;

    // 2. Build the base Update parameters
    let updateExpression =
      "SET statusCode = :sc, carrierDetailCode = :cdc, statusDescription = :sd, carrierStatusCode = :csc, carrierStatusDescription = :csd, shipDate = :sdDate, estimatedDeliveryDate = :edd, actualDeliveryDate = :ad, exceptionDescription = :ed, updatedAt = :u, lastEventTimestamp = :let, lastStaleNotificationAt = :null";

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
      ":null": null,
    };

    // If it is Out For Delivery, determine if we should notify, and update the DB flag if we do
    let conditionExpression = null;
    if (isOutForDelivery) {
      if (lastOfdDate === todayStr) {
        skipOfdNotification = true; // We already sent one today
      } else {
        // First time today: Update the DB atomically so we know for next time
        // Use atomic condition to prevent race condition: only update if lastOfdDate is NOT today
        updateExpression += ", lastOfdDate = :todayStr";
        expressionAttributeValues[":todayStr"] = todayStr;
        // Atomic check: only allow this update if lastOfdDate is different from today OR doesn't exist
        conditionExpression =
          "(attribute_not_exists(lastOfdDate) OR lastOfdDate <> :todayStr)";
      }
    }

    // 3. If the CALENDAR dates differ, dynamically add the history append logic
    if (
      existingDateString &&
      incomingDateString &&
      existingDateString !== incomingDateString
    ) {
      console.log(
        `Detected EDD date change via webhook from ${existingDateString} to ${incomingDateString}. Logging history.`,
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

    // Add atomic condition for OFD dedup if needed
    if (conditionExpression) {
      shipmentParams.ConditionExpression = conditionExpression;
    }

    console.log(
      `[${requestId}] Updating shipment details for: ${trackingNumber}`,
    );

    const updateResult = await withRetry(
      new UpdateCommand(shipmentParams),
      docClient,
      null,
      {
        requestId,
        operationName: "UpdateShipment",
      },
    );

    tracker.recordUpdate(
      updateResult.success,
      updateResult.error,
      updateResult.attempt,
      updateResult.errorType,
      updateResult.isTransient,
    );

    if (!updateResult.success) {
      // If the OFD condition fails (duplicate from concurrent request), that's ok
      // We still process events and skip the notification
      if (updateResult.errorType === "ConditionalCheckFailedException" && isOutForDelivery) {
        console.info(
          `[${requestId}] op=UpdateShipment error=ConditionalCheckFailedException type=expected reason=ofd_dedup_race`,
        );
        skipOfdNotification = true;
        // Re-throw to skip further processing since this is a duplicate
        throw new Error(
          `Duplicate OFD notification for ${trackingNumber} (already processed today)`,
        );
      }
      // For other errors, log and re-throw
      console.error(
        `[${requestId}] op=UpdateShipment error=${updateResult.errorType} type=${updateResult.isTransient ? "transient" : "permanent"} attempt=${updateResult.attempt}`,
      );
      throw updateResult.error || new Error(`Update failed: ${updateResult.errorType}`);
    }

    // ==============================================================
    // TRIGGER NOTIFICATION AFTER SUCCESSFUL SHIPMENT UPDATE
    // ==============================================================
    // NEW: Passed skipOfdNotification as the 4th argument
    await sendPushNotification(data, direction, source, skipOfdNotification);

    const trackingEvents = data.events || [];

    // Write events concurrently with per-event tracking. Each keeps its conditional put
    // so duplicates (same occurredAt) are skipped — BatchWrite can't express that condition.
    const validEvents = trackingEvents.filter((trackingEvent) => trackingEvent.occurred_at);
    const eventWritePromises = validEvents.map((trackingEvent, index) =>
      (async () => {
        const writeResult = await withRetry(
          new PutCommand({
            TableName: EVENTS_TABLE,
            Item: mapTrackingEvent(trackingNumber, trackingEvent),
            ConditionExpression: "attribute_not_exists(occurredAt)",
          }),
          docClient,
          null,
          {
            requestId,
            operationName: `WriteEvent[${index}]`,
          },
        );

        // Track the event write
        if (writeResult.errorType === "ConditionalCheckFailedException") {
          // This is an expected duplicate, log as info
          console.info(
            `[${requestId}] op=WriteEvent[${index}] error=ConditionalCheckFailedException type=expected reason=duplicate`,
          );
          tracker.recordEventWrite(index, true, null, writeResult.attempt, "duplicate", false);
          return { status: "duplicate", index };
        } else if (writeResult.success) {
          tracker.recordEventWrite(index, true, null, writeResult.attempt, null, false);
          return { status: "new", index };
        } else {
          // Actual write failure
          tracker.recordEventWrite(
            index,
            false,
            writeResult.error,
            writeResult.attempt,
            writeResult.errorType,
            writeResult.isTransient,
          );
          return { status: "failed", index, error: writeResult.errorType };
        }
      })(),
    );

    const results = await Promise.all(eventWritePromises);

    const newEventsCount = results.filter((r) => r.status === "new").length;
    const duplicateEventsCount = results.filter((r) => r.status === "duplicate").length;
    const failedEventsCount = results.filter((r) => r.status === "failed").length;

    const trackerSummary = tracker.getSummary();
    const hasEventFailures = failedEventsCount > 0;
    const hasPermanentFailures = tracker.hadPermanentFailures();

    if (hasEventFailures) {
      console.warn(
        `[${requestId}] Partial webhook processing for ${trackingNumber}: ${newEventsCount} new, ${duplicateEventsCount} duplicates, ${failedEventsCount} failed`,
      );
    } else {
      console.log(
        `[${requestId}] Successfully processed webhook for ${trackingNumber}: ${newEventsCount} new, ${duplicateEventsCount} duplicates`,
      );
    }

    // Determine response status: 500 only if permanent failures, 207 for partial, 200 for all success
    const statusCode = hasPermanentFailures ? 500 : hasEventFailures ? 207 : 200;

    return {
      statusCode,
      headers: {
        "Content-Type": "application/json",
        "X-Robots-Tag": "noindex, nofollow",
      },
      body: JSON.stringify({
        message:
          statusCode === 200
            ? "Webhook processed successfully"
            : statusCode === 207
              ? "Webhook processed with partial failures"
              : "Webhook processing failed",
        shipment: trackingNumber,
        newEventsAdded: newEventsCount,
        duplicatesIgnored: duplicateEventsCount,
        failedEventWrites: failedEventsCount,
        requestId,
        operationResults: trackerSummary,
      }),
    };
  } catch (error) {
    const errorType = error.code || error.name || error.constructor.name || "UnknownError";
    const isTransient = error.$metadata?.httpStatusCode >= 500 || error.$metadata?.httpStatusCode === 429;

    console.error(
      `[${requestId}] Error handling webhook: error=${errorType} type=${isTransient ? "transient" : "permanent"} message=${error.message}`,
    );

    const statusCode = isTransient ? 503 : 500;

    return {
      statusCode,
      headers: {
        "Content-Type": "application/json",
        "X-Robots-Tag": "noindex, nofollow",
      },
      body: JSON.stringify({
        message:
          statusCode === 503
            ? "Service temporarily unavailable - please retry"
            : "Internal Server Error",
        requestId,
      }),
    };
  }
};
