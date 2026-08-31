// Build a DynamoDB Events-table item from a raw carrier tracking event.
// Shared by the track and webhook handlers so the field mapping stays in one place.
function mapTrackingEvent(trackingNumber, e) {
  return {
    trackingNumber,
    occurredAt: e.occurred_at,
    carrierOccurredAt: e.carrier_occurred_at || null,
    description: e.description || null,
    cityLocality: e.city_locality || null,
    stateProvince: e.state_province || null,
    postalCode: e.postal_code || null,
    countryCode: e.country_code || null,
    companyName: e.company_name || null,
    signer: e.signer || null,
    eventCode: e.event_code || null,
    carrierDetailCode: e.carrier_detail_code || null,
    statusCode: e.status_code || null,
    statusDescription: e.status_description || null,
    carrierStatusCode: e.carrier_status_code || null,
    carrierStatusDescription: e.carrier_status_description || null,
    latitude: e.latitude || null,
    longitude: e.longitude || null,
    createdAt: new Date().toISOString(),
  };
}

// Identity of a single physical carrier event within one shipment.
//
// `occurred_at` cannot serve this purpose even though it is the Events sort key.
// ShipEngine reports it differently depending on the feed: GET /v1/tracking adds
// the account's UTC offset unconditionally, so once USPS began sending an explicit
// offset the GET path double-applies it. The same scan then arrives as
// 2026-08-29T23:57:55Z from the webhook and 2026-08-30T06:57:55Z from the GET, and
// lands twice under two different sort keys. `carrier_occurred_at` is the carrier's
// own stamp and agrees across both feeds; pairing it with the description keeps
// distinct events that share a timestamp from collapsing into one.
//
// Deliberately compares the raw string rather than a parsed instant. Carriers
// change timestamp format over time — USPS gained offsets, FedEx is mid-migration,
// and some international shipments switch partway through a single shipment — so
// normalising here would shift identities mid-flight and reintroduce the very
// duplicates this guards against.
function eventIdentity(carrierOccurredAt, description) {
  return `${carrierOccurredAt || ""}|${description || ""}`;
}

const rawEventIdentity = (e) =>
  eventIdentity(e.carrier_occurred_at, e.description);

const storedEventIdentity = (item) =>
  eventIdentity(item.carrierOccurredAt, item.description);

// Select which of a carrier payload's events still need writing, given the events
// already stored for that shipment. Also collapses repeats within the payload.
// Events with no occurred_at are unwritable (it is the sort key) and are dropped.
function dedupeIncomingEvents(rawEvents, existingItems = []) {
  const seen = new Set(existingItems.map(storedEventIdentity));
  const toWrite = [];
  let duplicates = 0;
  let unwritable = 0;

  for (const e of rawEvents || []) {
    if (!e.occurred_at) {
      unwritable++;
      continue;
    }
    const identity = rawEventIdentity(e);
    if (seen.has(identity)) {
      duplicates++;
      continue;
    }
    seen.add(identity);
    toWrite.push(e);
  }

  return { toWrite, duplicates, unwritable };
}

module.exports = {
  mapTrackingEvent,
  eventIdentity,
  rawEventIdentity,
  storedEventIdentity,
  dedupeIncomingEvents,
};
