const {
  docClient,
  SHIPMENTS_TABLE: TABLE_NAME,
  EVENTS_TABLE,
  scanAll,
  queryEventsForTracking,
} = require("../../lib/ddb");
const { generateRequestId, makeJsonResponse } = require("../../lib/http");

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

const RESPONSE_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "X-Robots-Tag": "noindex, nofollow",
};

const jsonResponse = makeJsonResponse(RESPONSE_HEADERS);

exports.handler = async (event) => {
  const requestId = generateRequestId();
  try {
    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const page = Math.max(parseInt(queryParams.page, 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(queryParams.pageSize, 10) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );

    console.log(
      `[${requestId}] Fetching shipments (page: ${page}, pageSize: ${pageSize})`,
    );

    // 1. Scan the full Shipments table. There's no index to sort by recency, and
    // the dataset is personal-project scale, so we read it all and sort/slice in
    // memory rather than paying for a GSI + migration.
    const shipmentItems = await scanAll({
      TableName: TABLE_NAME,
      ProjectionExpression:
        "carrier, trackingNumber, #src, direction, statusCode, statusDescription, estimatedDeliveryDate, estimatedDeliveryHistory, actualDeliveryDate, shipDate, lastEventTimestamp, serviceLevel",
      ExpressionAttributeNames: {
        "#src": "source",
      },
    });

    // 2. Sort newest-activity-first, then slice to the requested page.
    shipmentItems.sort((a, b) => {
      if (!a.lastEventTimestamp) return 1;
      if (!b.lastEventTimestamp) return -1;
      return new Date(b.lastEventTimestamp) - new Date(a.lastEventTimestamp);
    });

    const totalItems = shipmentItems.length;
    const totalPages = Math.max(Math.ceil(totalItems / pageSize), 1);
    const start = (page - 1) * pageSize;
    const pageItems = shipmentItems.slice(start, start + pageSize);

    console.log(
      `[${requestId}] Returning ${pageItems.length} of ${totalItems} shipments (page ${page} of ${totalPages})`,
    );

    // 3. Fetch event history only for the shipments on this page — a handful of
    // partition-key queries instead of scanning the entire Events table.
    let shipmentsWithEvents = pageItems.map((shipment) => ({
      ...shipment,
      events: [],
    }));

    if (!EVENTS_TABLE) {
      console.warn(
        `[${requestId}] EVENTS_TABLE environment variable is missing. Events will not be loaded.`,
      );
    } else if (pageItems.length > 0) {
      const eventLists = await Promise.all(
        pageItems.map((shipment) =>
          queryEventsForTracking(shipment.trackingNumber),
        ),
      );
      shipmentsWithEvents = pageItems.map((shipment, i) => ({
        ...shipment,
        events: eventLists[i],
      }));
    }

    console.log(`[${requestId}] Successfully fetched and formatted data`);

    return jsonResponse(200, {
      shipments: shipmentsWithEvents,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    });
  } catch (error) {
    console.error(`[${requestId}] Error retrieving shipments:`, error.message);
    return jsonResponse(500, {
      message: "Internal Server Error",
      requestId,
    });
  }
};
