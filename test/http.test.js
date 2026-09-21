const test = require("node:test");
const assert = require("node:assert/strict");
const { generateRequestId, makeJsonResponse } = require("../src/lib/http");

test("generateRequestId returns unique, non-empty ids", () => {
  const a = generateRequestId();
  const b = generateRequestId();
  assert.equal(typeof a, "string");
  assert.ok(a.length > 0);
  assert.notEqual(a, b);
});

test("generateRequestId embeds a timestamp prefix", () => {
  const before = Date.now();
  const id = generateRequestId();
  const after = Date.now();
  const timestampPart = Number(id.split("-")[0]);
  assert.ok(timestampPart >= before && timestampPart <= after);
});

test("makeJsonResponse binds fixed headers and serializes the body", () => {
  const headers = { "Content-Type": "application/json", "X-Test": "1" };
  const jsonResponse = makeJsonResponse(headers);

  const response = jsonResponse(200, { message: "ok" });

  assert.deepEqual(response, {
    statusCode: 200,
    headers,
    body: JSON.stringify({ message: "ok" }),
  });
});

test("makeJsonResponse reuses the same headers object across calls", () => {
  const headers = { "Content-Type": "application/json" };
  const jsonResponse = makeJsonResponse(headers);

  const a = jsonResponse(200, { a: 1 });
  const b = jsonResponse(500, { error: "fail" });

  assert.equal(a.headers, headers);
  assert.equal(b.headers, headers);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 500);
});
