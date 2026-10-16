"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assessOperationalReleaseReadiness } = require("./operationalReleaseReadiness");

function validInput(overrides = {}) {
  const events = [];
  for (let i = 0; i < 220; i += 1) {
    const ledgerId = "ledger-" + i;
    events.push({
      type: "prediction", ledgerId,
      snapshot: { ledgerId, predictionCreatedAt: "2026-01-01T00:00:00.000Z" },
    });
    events.push({
      type: "settlement", ledgerId,
      result: { resultStatus: "settled", actualHomeGoals: 1, actualAwayGoals: 0 },
    });
  }
  return {
    events,
    storageMode: "neon_postgres",
    ledgerStatus: { total: 220, pending: 0, settled: 220, conflicts: 0 },
    performanceReport: {
      models: {
        MODEL_4_0: { sampleSize: 110, settledPredictions: 110 },
        MODEL_4_1: { sampleSize: 110, settledPredictions: 110 },
      },
      comparison: { sampleSize: 105 },
    },
    reconciliation: { eventCount: 440, uniqueEventIds: 440, uniqueLedgerIds: 220 },
    ...overrides,
  };
}

test("returns READY_FOR_REVIEW only when integrity and forward evidence gates pass", () => {
  const result = assessOperationalReleaseReadiness(validInput());
  assert.equal(result.ready, true);
  assert.equal(result.status, "READY_FOR_REVIEW");
  assert.equal(result.settlementIntegrity.status, "INTEGRITY_OK");
  assert.equal(result.forwardPerformance.status, "READY_FOR_REVIEW");
});

test("blocks release review when settlement events have structural integrity issues", () => {
  const input = validInput();
  input.events.push({
    type: "settlement", ledgerId: "orphan-ledger",
    result: { resultStatus: "settled" },
  });
  const result = assessOperationalReleaseReadiness(input);
  assert.equal(result.ready, false);
  assert.equal(result.status, "NOT_READY");
  assert.ok(result.blockingReasons.includes("SETTLEMENT_EVENT_INTEGRITY"));
  assert.ok(result.settlementIntegrity.blockingReasons.includes("ORPHAN_SETTLEMENT"));
});

test("blocks review when performance evidence is insufficient even if event structure is valid", () => {
  const result = assessOperationalReleaseReadiness(validInput({
    performanceReport: {
      models: {
        MODEL_4_0: { sampleSize: 99, settledPredictions: 99 },
        MODEL_4_1: { sampleSize: 110, settledPredictions: 110 },
      },
      comparison: { sampleSize: 100 },
    },
  }));
  assert.equal(result.settlementIntegrity.ready, true);
  assert.equal(result.ready, false);
  assert.ok(result.blockingReasons.includes("MIN_SETTLED_SAMPLE_PER_MODEL"));
});

test("missing evidence fails closed and no input data is mutated", () => {
  const input = { events: null };
  const before = JSON.stringify(input);
  const result = assessOperationalReleaseReadiness(input);
  assert.equal(result.ready, false);
  assert.equal(result.status, "NOT_READY");
  assert.equal(JSON.stringify(input), before);
  assert.ok(result.blockingReasons.includes("SETTLEMENT_EVENT_INTEGRITY"));
  assert.ok(result.blockingReasons.includes("NEON_STORAGE_ACTIVE"));
});
