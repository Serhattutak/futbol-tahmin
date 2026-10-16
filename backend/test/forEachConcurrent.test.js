const assert = require("node:assert/strict");
const test = require("node:test");
const { forEachConcurrent } = require("../services/forEachConcurrent");

test("processes every item once and respects the concurrency ceiling", async () => {
  const items = Array.from({ length: 37 }, (_, index) => index);
  const seen = [];
  let active = 0;
  let peak = 0;
  await forEachConcurrent(items, 4, async (item, index) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    seen.push({ item, index });
    active -= 1;
  });
  assert.equal(seen.length, items.length);
  assert.equal(new Set(seen.map(({ item }) => item)).size, items.length);
  assert.deepEqual(seen.map(({ index }) => index).sort((a, b) => a - b), items.map((_, index) => index));
  assert.ok(peak <= 4);
  assert.equal(active, 0);
});

test("empty input completes without invoking the worker", async () => {
  let calls = 0;
  await forEachConcurrent([], 3, async () => { calls += 1; });
  assert.equal(calls, 0);
});

test("rejects invalid input, concurrency, and worker arguments", async () => {
  await assert.rejects(() => forEachConcurrent(null, 2, async () => {}), { name: "TypeError", message: "items must be an array" });
  for (const concurrency of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(() => forEachConcurrent([1], concurrency, async () => {}), { name: "RangeError", message: "concurrency must be a positive integer" });
  }
  await assert.rejects(() => forEachConcurrent([1], 1, null), { name: "TypeError", message: "worker must be a function" });
});

test("stops scheduling after a worker failure and waits for in-flight work", async () => {
  const expected = new Error("synthetic worker failure");
  const started = [];
  let active = 0;
  await assert.rejects(() => forEachConcurrent([0, 1, 2, 3, 4, 5], 2, async (item) => {
    started.push(item);
    active += 1;
    try {
      if (item === 0) throw expected;
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      active -= 1;
    }
  }), (error) => error === expected);
  assert.deepEqual(started, [0, 1]);
  assert.equal(active, 0);
});

test("preserves even a null rejection reason and stops additional scheduling", async () => {
  const started = [];
  await assert.rejects(() => forEachConcurrent([0, 1, 2], 1, async (item) => {
    started.push(item);
    if (item === 0) throw null;
  }), (error) => error === null);
  assert.deepEqual(started, [0]);
});
