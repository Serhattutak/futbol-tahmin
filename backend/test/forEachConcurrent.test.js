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
