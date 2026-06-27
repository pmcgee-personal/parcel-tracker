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

module.exports = { mapTrackingEvent };
