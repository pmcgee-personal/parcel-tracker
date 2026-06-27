const test = require("node:test");
const assert = require("node:assert/strict");
const { chunkedWrite } = require("../src/lib/batch");

test("chunkedWrite splits items into batches of 25", async () => {
  const sizes = [];
  const send = async (ri) => {
    sizes.push(ri.Events.length);
    return {};
  };
  const items = Array.from({ length: 57 }, (_, i) => ({ pk: String(i) }));
  await chunkedWrite(send, "Events", items);
  assert.deepEqual(sizes, [25, 25, 7]);
});

test("chunkedWrite retries UnprocessedItems", async () => {
  const sizes = [];
  let returnedUnprocessed = false;
  const send = async (ri) => {
    sizes.push(ri.Events.length);
    if (!returnedUnprocessed) {
      returnedUnprocessed = true;
      return { UnprocessedItems: { Events: [ri.Events[0]] } };
    }
    return {};
  };
  await chunkedWrite(send, "Events", [{ pk: "a" }, { pk: "b" }]);
  assert.deepEqual(sizes, [2, 1]); // first batch of 2, then a retry of the 1 leftover
});

test("chunkedWrite throws after exhausting retries", async () => {
  const send = async (ri) => ({ UnprocessedItems: ri }); // never drains
  await assert.rejects(
    () => chunkedWrite(send, "Events", [{ pk: "a" }], { maxAttempts: 3 }),
    /left unprocessed items after 3 attempts/,
  );
});

test("chunkedWrite makes no calls for empty input", async () => {
  let calls = 0;
  const send = async () => {
    calls++;
    return {};
  };
  await chunkedWrite(send, "Events", []);
  assert.equal(calls, 0);
});
