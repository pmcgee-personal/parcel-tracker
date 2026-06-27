const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  verifyShipEngineSignature,
} = require("../src/lib/verifyShipEngineSignature");

// Generate a keypair and stub the JWKS endpoint for the whole file. node:test
// runs each file in its own process, so this global stub doesn't leak.
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "test-key-1";
global.fetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });

function sign(ts, body) {
  return crypto
    .sign("RSA-SHA256", Buffer.from(`${ts}.${body}`, "utf8"), privateKey)
    .toString("base64");
}

function signedEvent(overrides = {}) {
  const body = JSON.stringify({ resource_type: "EX" });
  const ts = new Date().toISOString();
  return {
    headers: {
      "x-shipengine-rsa-sha256-key-id": "test-key-1",
      "x-shipengine-rsa-sha256-signature": sign(ts, body),
      "x-shipengine-timestamp": ts,
    },
    body,
    ...overrides,
  };
}

test("accepts a valid signature", async () => {
  const r = await verifyShipEngineSignature(signedEvent());
  assert.equal(r.ok, true);
});

test("404 when signature headers are missing", async () => {
  const r = await verifyShipEngineSignature({ headers: {}, body: "{}" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

test("header lookup is case-insensitive", async () => {
  const e = signedEvent();
  const upper = {};
  for (const [k, v] of Object.entries(e.headers)) upper[k.toUpperCase()] = v;
  const r = await verifyShipEngineSignature({ ...e, headers: upper });
  assert.equal(r.ok, true);
});

test("401 when the body is tampered", async () => {
  const e = signedEvent();
  const r = await verifyShipEngineSignature({ ...e, body: `${e.body} ` });
  assert.equal(r.status, 401);
});

test("400 when the timestamp is stale", async () => {
  const body = JSON.stringify({ resource_type: "EX" });
  const ts = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const r = await verifyShipEngineSignature({
    headers: {
      "x-shipengine-rsa-sha256-key-id": "test-key-1",
      "x-shipengine-rsa-sha256-signature": sign(ts, body),
      "x-shipengine-timestamp": ts,
    },
    body,
  });
  assert.equal(r.status, 400);
});

test("verifies a base64-encoded body", async () => {
  const e = signedEvent();
  const r = await verifyShipEngineSignature({
    ...e,
    body: Buffer.from(e.body, "utf8").toString("base64"),
    isBase64Encoded: true,
  });
  assert.equal(r.ok, true);
});
