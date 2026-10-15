const assert = require("node:assert/strict");
const test = require("node:test");
const { createConcurrencyGuard } = require("../services/concurrencyGuard");

function response() {
  const listeners = {};
  return {
    statusCode: 200,
    payload: null,
    on(event, callback) { listeners[event] = callback; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    finish() { listeners.finish?.(); }
  };
}

test("separate dashboard endpoints do not block each other for the same IP", () => {
  const guard = createConcurrencyGuard();
  let nextA = 0; let nextB = 0;
  const a = response(); const b = response();
  guard(1)({ ip: "1.2.3.4", path: "/api/best-predictions" }, a, () => nextA++);
  guard(1)({ ip: "1.2.3.4", path: "/api/archive/performance" }, b, () => nextB++);
  assert.equal(nextA, 1); assert.equal(nextB, 1);
  assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200);
});

test("a single endpoint still enforces its own concurrency limit and releases it on finish", () => {
  const guard = createConcurrencyGuard();
  let nextCount = 0;
  const middleware = guard(1);
  const first = response();
  middleware({ ip: "1.2.3.4", path: "/api/best-predictions" }, first, () => nextCount++);
  const blocked = response();
  middleware({ ip: "1.2.3.4", path: "/api/best-predictions" }, blocked, () => nextCount++);
  assert.equal(blocked.statusCode, 429);
  assert.equal(nextCount, 1);
  first.finish();
  const after = response();
  middleware({ ip: "1.2.3.4", path: "/api/best-predictions" }, after, () => nextCount++);
  assert.equal(after.statusCode, 200);
  assert.equal(nextCount, 2);
});
