const assert = require("node:assert/strict");
const test = require("node:test");
const { forEachConcurrent } = require("../services/forEachConcurrent");

test("limits active workers and processes every item exactly once", async () => {
  const items = Array.from({ length: 37 }, (_, index) => index);
  const seen = [];
  let active = 0;
  let maximumActive = 0;
  await forEachConcurrent(items, 4, async (item) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setImmediate(resolve));
    seen.push(item);
    active -= 1;
  });
  assert.equal(maximumActive, 4);
  assert.equal(seen.length, items.length);
  assert.deepEqual([...seen].sort((a, b) => a - b), items);
});

test("an empty fixture pool does not start workers", async () => {
  let called = false;
  await forEachConcurrent([], 4, async () => { called = true; });
  assert.equal(called, false);
});

test("rejects invalid concurrency rather than silently running unbounded", async () => {
  await assert.rejects(forEachConcurrent([1], 0, async () => {}), RangeError);
});

test("a provider failure handled per item does not prevent later fixtures from being analyzed", async () => {
  const results = [];
  await forEachConcurrent([1, 2, 3, 4, 5], 2, async (item) => {
    try {
      if (item === 2) throw new Error("provider unavailable");
      results.push({ item, status: "ok" });
    } catch {
      results.push({ item, status: "unavailable" });
    }
  });
  assert.equal(results.length, 5);
  assert.equal(results.find(result => result.item === 2).status, "unavailable");
  assert.equal(results.filter(result => result.status === "ok").length, 4);
});
