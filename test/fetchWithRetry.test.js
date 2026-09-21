const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchWithRetry } = require("../src/lib/fetchWithRetry");

// fetchWithRetry sleeps between attempts via the real setTimeout (1s/2s/4s
// backoff). Stub it to fire immediately so these tests don't take seconds
// each; only the retry-triggering tests below need this.
function withInstantRetries(fn) {
  return async () => {
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (cb) => cb();
    try {
      await fn();
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  };
}

test("fetchWithRetry returns immediately on a successful response", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: true, status: 200 };
  };

  const response = await fetchWithRetry("https://example.com", {});

  global.fetch = originalFetch;
  assert.equal(response.ok, true);
  assert.equal(calls, 1);
});

test(
  "fetchWithRetry retries on a 5xx response and eventually succeeds",
  withInstantRetries(async () => {
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls < 3) return { ok: false, status: 503 };
      return { ok: true, status: 200 };
    };

    const response = await fetchWithRetry("https://example.com", {}, 3);

    global.fetch = originalFetch;
    assert.equal(response.ok, true);
    assert.equal(calls, 3);
  }),
);

test(
  "fetchWithRetry retries on 429 (rate limit)",
  withInstantRetries(async () => {
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls < 2) return { ok: false, status: 429 };
      return { ok: true, status: 200 };
    };

    const response = await fetchWithRetry("https://example.com", {}, 3);

    global.fetch = originalFetch;
    assert.equal(response.ok, true);
    assert.equal(calls, 2);
  }),
);

test("fetchWithRetry does not retry a non-retryable 4xx response", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: false, status: 400 };
  };

  const response = await fetchWithRetry("https://example.com", {}, 3);

  global.fetch = originalFetch;
  assert.equal(response.ok, false);
  assert.equal(response.status, 400);
  assert.equal(calls, 1);
});

test(
  "fetchWithRetry returns the last error response after exhausting attempts",
  withInstantRetries(async () => {
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return { ok: false, status: 503 };
    };

    const response = await fetchWithRetry("https://example.com", {}, 2);

    global.fetch = originalFetch;
    assert.equal(response.ok, false);
    assert.equal(response.status, 503);
    assert.equal(calls, 2);
  }),
);

test(
  "fetchWithRetry retries a network error and throws after exhausting attempts",
  withInstantRetries(async () => {
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
      calls++;
      throw new Error("network down");
    };

    await assert.rejects(
      () => fetchWithRetry("https://example.com", {}, 2),
      /network down/,
    );

    global.fetch = originalFetch;
    assert.equal(calls, 2);
  }),
);
