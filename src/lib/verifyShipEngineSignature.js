const crypto = require("crypto");

// ShipEngine signs webhooks with RSA-SHA256. We verify the signature against
// the raw request body using the public key published in their JWKS.
// Docs: https://www.shipengine.com/docs/webhooks/
const JWKS_URL = "https://api.shipengine.com/jwks";
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes, per ShipEngine docs

// Module-scoped cache of kid -> KeyObject. Survives warm Lambda invocations so
// we only hit the JWKS endpoint on a cold start or when a new key id appears.
const keyCache = new Map();

// Case-insensitive header lookup. API Gateway preserves header casing, but
// callers can send any casing, so normalise to be safe.
function getHeader(event, name) {
  const headers = event.headers || {};
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return undefined;
}

// The signature is computed over the exact bytes ShipEngine sent. If API
// Gateway base64-encoded the body we must decode it before verifying, and we
// must NOT JSON.parse/re-serialize (that would change whitespace/ordering).
function getRawBody(event) {
  if (event.body == null) return "";
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

async function getPublicKey(kid) {
  if (keyCache.has(kid)) return keyCache.get(kid);

  // Unknown key id: (re)fetch the JWKS. This also handles ShipEngine key
  // rotation, where a new public key is published before it is used to sign.
  const response = await fetch(JWKS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: HTTP ${response.status}`);
  }
  const jwks = await response.json();

  keyCache.clear();
  for (const jwk of jwks.keys || []) {
    if (!jwk.kid) continue;
    keyCache.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
  }

  return keyCache.get(kid);
}

// Returns { ok, status, reason }. On failure, `status` is the HTTP status the
// handler should return. Fails closed: any error during verification rejects.
async function verifyShipEngineSignature(event) {
  const keyId = getHeader(event, "x-shipengine-rsa-sha256-key-id");
  const signature = getHeader(event, "x-shipengine-rsa-sha256-signature");
  const timestamp = getHeader(event, "x-shipengine-timestamp");

  // Missing signature headers: respond 404 to avoid revealing the endpoint.
  if (!keyId || !signature || !timestamp) {
    return { ok: false, status: 404, reason: "Missing signature headers" };
  }

  // Reject stale/future timestamps to prevent replay attacks.
  const timestampMs = Date.parse(timestamp);
  if (Number.isNaN(timestampMs)) {
    return { ok: false, status: 400, reason: "Unparseable timestamp" };
  }
  if (Math.abs(Date.now() - timestampMs) > TIMESTAMP_TOLERANCE_MS) {
    return { ok: false, status: 400, reason: "Timestamp outside tolerance" };
  }

  let publicKey;
  try {
    publicKey = await getPublicKey(keyId);
  } catch (err) {
    console.error("Could not load JWKS for signature verification:", err);
    return { ok: false, status: 401, reason: "Key retrieval failed" };
  }
  if (!publicKey) {
    return { ok: false, status: 401, reason: "Unknown key id" };
  }

  // Signed payload = timestamp + "." + raw body.
  const signedPayload = `${timestamp}.${getRawBody(event)}`;

  let valid = false;
  try {
    valid = crypto.verify(
      "RSA-SHA256",
      Buffer.from(signedPayload, "utf8"),
      publicKey,
      Buffer.from(signature, "base64"),
    );
  } catch (err) {
    console.error("Signature verification threw:", err);
    return { ok: false, status: 401, reason: "Verification error" };
  }

  if (!valid) {
    return { ok: false, status: 401, reason: "Invalid signature" };
  }

  return { ok: true, status: 200 };
}

module.exports = { verifyShipEngineSignature, getRawBody, getHeader };
