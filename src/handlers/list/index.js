const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const {
  docClient,
  SHIPMENTS_TABLE: TABLE_NAME,
  EVENTS_TABLE,
} = require("../../lib/ddb");

const generateRequestId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// Helper to scan all items (used for events where we need full dataset)
async function scanAll(docClient, params) {
  let accumulatedItems = [];
  let lastEvaluatedKey = null;

  do {
    const scanParams = { ...params };
    if (lastEvaluatedKey) {
      scanParams.ExclusiveStartKey = lastEvaluatedKey;
    }

    const command = new ScanCommand(scanParams);
    const response = await docClient.send(command);

    if (response.Items) {
      accumulatedItems = accumulatedItems.concat(response.Items);
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return accumulatedItems;
}

// Helper to scan with pagination support
async function scanWithPagination(docClient, params, limit, nextToken) {
  const scanParams = { ...params, Limit: limit };
  if (nextToken) {
    scanParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, "base64").toString());
  }

  const command = new ScanCommand(scanParams);
  const response = await docClient.send(command);

  return {
    items: response.Items || [],
    nextToken: response.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString("base64")
      : null,
    hasMore: !!response.LastEvaluatedKey,
  };
}

// Helper to filter important shipments (active or recently delivered)
function filterImportantShipments(shipments) {
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const activeStatuses = ["IT", "EX", "AC", "OFD"];

  return shipments.filter((shipment) => {
    // Keep all active shipments
    if (activeStatuses.includes(shipment.statusCode)) {
      return true;
    }

    // Keep delivered shipments from last 3 days
    if (shipment.statusCode === "DE") {
      const lastActivityTime = shipment.lastEventTimestamp
        ? new Date(shipment.lastEventTimestamp).getTime()
        : 0;
      return now - lastActivityTime <= THREE_DAYS_MS;
    }

    return false;
  });
}

// Helper to sort shipments (mirrors frontend sortShipments.js)
function sortShipmentsByPriority(shipments) {
  return [...shipments].sort((a, b) => {
    const activeStatuses = ["IT", "EX", "AC", "OFD"];
    const isA_Active = activeStatuses.includes(a.statusCode);
    const isB_Active = activeStatuses.includes(b.statusCode);

    // Active items come first
    if (isA_Active && !isB_Active) return -1;
    if (!isA_Active && isB_Active) return 1;

    // Both active: sort by estimated delivery date ascending (soonest first)
    if (isA_Active && isB_Active) {
      const dateA = a.estimatedDeliveryDate
        ? new Date(a.estimatedDeliveryDate)
        : null;
      const dateB = b.estimatedDeliveryDate
        ? new Date(b.estimatedDeliveryDate)
        : null;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA - dateB;
    }

    // Both delivered: sort by last event activity descending (most recent activity first)
    const timeA = a.lastEventTimestamp
      ? new Date(a.lastEventTimestamp)
      : null;
    const timeB = b.lastEventTimestamp
      ? new Date(b.lastEventTimestamp)
      : null;
    if (!timeA) return 1;
    if (!timeB) return -1;
    return timeB - timeA;
  });
}

exports.handler = async (event) => {
  const requestId = generateRequestId();
  try {
    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const limit = Math.min(parseInt(queryParams.limit) || 50, 100); // Max 100, default 50
    let nextToken = queryParams.nextToken || null;
    const statusFilter = queryParams.status || null; // Optional: filter by status
    const isFirstPage = !nextToken;

    // Decode custom pagination token if present
    let customTokenData = null;
    if (nextToken && !statusFilter) {
      try {
        customTokenData = JSON.parse(Buffer.from(nextToken, "base64").toString());
        // If it's a custom token with filterApplied, extract the actual scan token (may be null)
        if (customTokenData.filterApplied) {
          nextToken = customTokenData.originalScanToken || null;
        }
      } catch {
        // Not a custom token, use as-is
        customTokenData = null;
      }
    }

    console.log(
      `[${requestId}] Fetching shipments (limit: ${limit}, status: ${statusFilter || "all"}, firstPage: ${isFirstPage})`,
    );

    // 1. Scan Shipments — fetch more on first page to ensure active items included
    const shipmentParams = {
      TableName: TABLE_NAME,
      ProjectionExpression:
        "carrier, trackingNumber, #src, direction, statusCode, statusDescription, estimatedDeliveryDate, estimatedDeliveryHistory, actualDeliveryDate, shipDate, lastEventTimestamp, serviceLevel",
      ExpressionAttributeNames: {
        "#src": "source",
      },
    };

    // Add status filter if provided (e.g., ?status=active to show only non-delivered)
    if (statusFilter === "active") {
      shipmentParams.FilterExpression = "attribute_exists(statusCode) AND statusCode <> :delivered";
      shipmentParams.ExpressionAttributeValues = { ":delivered": "DE" };
    }

    // On first page, scan 150 items to prioritize active shipments
    // On subsequent pages, use normal limit
    const scanLimit = isFirstPage ? Math.max(limit * 3, 150) : limit;

    const shipmentResult = await scanWithPagination(
      docClient,
      shipmentParams,
      scanLimit,
      nextToken,
    );
    let shipmentItems = shipmentResult.items;
    const scanNextToken = shipmentResult.nextToken;

    console.log(
      `[${requestId}] Retrieved ${shipmentItems.length} raw shipments (scanLimit: ${scanLimit}, hasMore: ${shipmentResult.hasMore})`,
    );

    // 2. Scan ALL Events (needed to match with paginated shipments)
    let eventItems = [];
    if (EVENTS_TABLE) {
      eventItems = await scanAll(docClient, { TableName: EVENTS_TABLE });
      console.log(`[${requestId}] Retrieved ${eventItems.length} events`);
    } else {
      console.warn(
        `[${requestId}] EVENTS_TABLE environment variable is missing. Events will not be loaded.`,
      );
    }

    // 3. Group events by tracking number
    const eventsByTracking = new Map();
    for (const e of eventItems) {
      const list = eventsByTracking.get(e.trackingNumber);
      if (list) list.push(e);
      else eventsByTracking.set(e.trackingNumber, [e]);
    }

    const shipmentsWithEvents = shipmentItems.map((shipment) => ({
      ...shipment,
      events: eventsByTracking.get(shipment.trackingNumber) || [],
    }));

    // 4. On first page: filter to important items (active + recent), then paginate
    let finalShipments = shipmentsWithEvents;
    let filteredTotal = shipmentsWithEvents.length;
    let responseNextToken = scanNextToken;

    if (isFirstPage && !statusFilter) {
      // Filter to important items and sort by priority
      const importantShipments = filterImportantShipments(shipmentsWithEvents);
      const sortedImportant = sortShipmentsByPriority(importantShipments);

      filteredTotal = sortedImportant.length;

      // Return only first `limit` items from filtered set
      finalShipments = sortedImportant.slice(0, limit);

      // Determine next token: only set if we have more filtered items OR can continue scanning
      if (sortedImportant.length > limit) {
        // More filtered items exist in current result set
        responseNextToken = Buffer.from(
          JSON.stringify({
            filteredStartIndex: limit,
            originalScanToken: scanNextToken,
            filterApplied: true,
          }),
        ).toString("base64");
      } else if (scanNextToken) {
        // Can continue scanning for more raw items
        responseNextToken = Buffer.from(
          JSON.stringify({
            filteredStartIndex: 0,
            originalScanToken: scanNextToken,
            filterApplied: true,
          }),
        ).toString("base64");
      } else {
        // No more items to scan and all filtered items shown
        responseNextToken = null;
      }

      console.log(
        `[${requestId}] Filtered to ${filteredTotal} important items, returning ${finalShipments.length}`,
      );
    } else if (!isFirstPage && !statusFilter && customTokenData) {
      // On subsequent pages with custom token: return unfiltered items (sorted by priority)
      // This shows older/non-important shipments to the user
      finalShipments = sortShipmentsByPriority(shipmentsWithEvents);

      // Set next token for further pagination if there are more items
      if (scanNextToken) {
        responseNextToken = Buffer.from(
          JSON.stringify({
            originalScanToken: scanNextToken,
            filterApplied: true,
          }),
        ).toString("base64");
      } else {
        responseNextToken = null;
      }

      console.log(
        `[${requestId}] Page ${customTokenData.loadUnfiltered ? '(unfiltered)' : ''} returning ${finalShipments.length} items`,
      );
    } else {
      // statusFilter provided, or other cases: use standard sorting
      finalShipments = sortShipmentsByPriority(shipmentsWithEvents);
      responseNextToken = scanNextToken;
    }

    console.log(`[${requestId}] Successfully fetched and formatted data`);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Robots-Tag": "noindex, nofollow",
      },
      body: JSON.stringify({
        shipments: finalShipments,
        pagination: {
          limit,
          nextToken: responseNextToken,
          hasMore: !!responseNextToken,
          ...(isFirstPage && { filteredTotal, rawTotal: shipmentItems.length }),
        },
      }),
    };
  } catch (error) {
    console.error(`[${requestId}] Error retrieving shipments:`, error.message);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Robots-Tag": "noindex, nofollow",
      },
      body: JSON.stringify({
        message: "Internal Server Error",
        requestId,
      }),
    };
  }
};
