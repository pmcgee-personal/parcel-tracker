const test = require("node:test");
const assert = require("node:assert/strict");
const { sendNtfyNotification } = require("../src/lib/ntfy");

test("sendNtfyNotification returns false and warns when ntfyUrl is missing", async () => {
  const result = await sendNtfyNotification(null, "test message");
  assert.equal(result, false);
});

test("sendNtfyNotification posts the message body and headers, returns true on success", async () => {
  const originalFetch = global.fetch;
  let capturedUrl = null;
  let capturedOptions = null;
  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return { ok: true, status: 200 };
  };

  const result = await sendNtfyNotification(
    "https://ntfy.sh/test-topic",
    "hello world",
    { title: "Test Title", priority: "high", tags: "warning" },
  );

  global.fetch = originalFetch;

  assert.equal(result, true);
  assert.equal(capturedUrl, "https://ntfy.sh/test-topic");
  assert.equal(capturedOptions.method, "POST");
  assert.equal(capturedOptions.body, "hello world");
  assert.deepEqual(capturedOptions.headers, {
    Title: "Test Title",
    Priority: "high",
    Tags: "warning",
  });
});

test("sendNtfyNotification defaults priority to 'default' when omitted", async () => {
  const originalFetch = global.fetch;
  let capturedOptions = null;
  global.fetch = async (url, options) => {
    capturedOptions = options;
    return { ok: true, status: 200 };
  };

  await sendNtfyNotification("https://ntfy.sh/test-topic", "msg", {
    title: "T",
  });

  global.fetch = originalFetch;
  assert.equal(capturedOptions.headers.Priority, "default");
});

test("sendNtfyNotification returns false on a non-2xx response", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500 });

  const result = await sendNtfyNotification("https://ntfy.sh/test-topic", "msg");

  global.fetch = originalFetch;
  assert.equal(result, false);
});

test("sendNtfyNotification returns false when fetch throws", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new TypeError(
      "Cannot convert argument to a ByteString because the character at index 10 has a value of 9203 which is greater than 255.",
    );
  };

  const result = await sendNtfyNotification("https://ntfy.sh/test-topic", "msg");

  global.fetch = originalFetch;
  assert.equal(result, false);
});

