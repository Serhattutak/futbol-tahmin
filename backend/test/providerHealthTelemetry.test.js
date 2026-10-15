const assert = require("node:assert/strict");
const test = require("node:test");
const { MultiProviderRegistry } = require("../services/multiProviderRegistry");

test("provider health starts as not checked without claiming availability", () => {
  const registry = new MultiProviderRegistry([
    { name: "alpha", enabled: true, configured: true, capabilities: ["fixtures"] },
  ], { now: () => Date.parse("2026-10-15T20:00:00Z") });

  const [status] = registry.getStatus();
  assert.equal(status.available, null);
  assert.equal(status.lastOutcome, "not_checked");
  assert.equal(status.totalOutcomes, 0);
  assert.equal(status.successfulOutcomes, 0);
  assert.equal(status.failedOutcomes, 0);
  assert.equal(status.consecutiveFailures, 0);
});

test("provider health counts failures, retains last success, and resets consecutive failures after recovery", () => {
  let now = Date.parse("2026-10-15T20:00:00Z");
  const registry = new MultiProviderRegistry([
    { name: "alpha", enabled: true, configured: true, capabilities: ["fixtures"] },
  ], { now: () => now });

  registry.updateStatus("alpha", true);
  now += 1_000;
  registry.updateStatus("alpha", false, "timeout_network");
  now += 1_000;
  registry.updateStatus("alpha", false, "quota");

  let [status] = registry.getStatus();
  assert.equal(status.totalOutcomes, 3);
  assert.equal(status.successfulOutcomes, 1);
  assert.equal(status.failedOutcomes, 2);
  assert.equal(status.consecutiveFailures, 2);
  assert.equal(status.lastOutcome, "failure");
  assert.equal(status.errorCategory, "quota");
  assert.equal(status.quotaStatus, "exhausted");
  assert.equal(status.lastSuccessfulRequest, "2026-10-15T20:00:00.000Z");
  assert.equal(status.lastRetrievedAt, "2026-10-15T20:00:02.000Z");

  now += 1_000;
  registry.updateStatus("alpha", true);
  [status] = registry.getStatus();
  assert.equal(status.totalOutcomes, 4);
  assert.equal(status.successfulOutcomes, 2);
  assert.equal(status.failedOutcomes, 2);
  assert.equal(status.consecutiveFailures, 0);
  assert.equal(status.lastOutcome, "success");
  assert.equal(status.errorCategory, null);
  assert.equal(status.quotaStatus, "unknown");
  assert.equal(status.lastSuccessfulRequest, "2026-10-15T20:00:03.000Z");
});

test("status updates for unknown providers are ignored safely", () => {
  const registry = new MultiProviderRegistry([]);
  assert.doesNotThrow(() => registry.updateStatus("missing", false, "provider_unavailable"));
  assert.deepEqual(registry.getStatus(), []);
});
