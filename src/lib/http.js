// Shared per-request helpers used by every API Gateway-backed Lambda handler.
// Response CORS headers stay handler-specific (Allow-Methods/-Headers differ
// per route), so only the request-id and response-envelope shapes are shared.

function generateRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Returns a jsonResponse(statusCode, body) function bound to a fixed set of
// response headers, so each handler only declares its headers object once.
function makeJsonResponse(headers) {
  return (statusCode, body) => ({
    statusCode,
    headers,
    body: JSON.stringify(body),
  });
}

module.exports = { generateRequestId, makeJsonResponse };
