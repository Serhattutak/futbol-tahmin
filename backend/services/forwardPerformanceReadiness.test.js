"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assessForwardPerformanceReadiness,
  DEFAULT_MIN_SETTLED,
  DEFAULT_MIN_PAIRED,
} = require("./forwardPerformanceReadiness");

function readyInput(overrides = {}) {
  return {
    storageMode: "neon_postgres",
    ledgerStatus: { total: 220, pending: 0, settled: 220, conflicts: 0 },
    performanceReport: {
      models: {
        MODEL_4_0: { sampleSize: 110, settledPredictions: 110 },
        MODEL_4_1: { sampleSize: 110, settledPredictions: 110 },
      },
      comparison: { sampleSize: 105 },
    },
    reconciliation: { eventCount: 220, uniqueEventIds: 220, uniqueLedgerIds: 220 },
    ...overrides,
  };
}

test("defaults require 100 settled samples per model and 100 paired samples", () => {
  assert.equal(DEFAULT_MIN_SETTLED, 100);
  assert.equal(DEFAULT_MIN_PAIRED, 100);
  assert.equal(assessForwardPerformanceReadiness(readyInput()).ready, true);
});

test("fails closed when required evidence is missing", () => {
  const result = assessForwardPerformanceReadiness({});
  assert.equal(result.ready, false);
  assert.equal(result.status, "NOT_READY");
  assert.ok(result.blockingReasons.includes("NEON_STORAGE_ACTIVE"));
  assert.ok(result.blockingReasons.includes("LEDGER_COUNTS_VALID"));
  assert.ok(result.blockingReasons.includes("EVENT_ID_INTEGRITY"));
  assert.ok(result.blockingReasons.includes("MIN_SETTLED_SAMPLE_PER_MODEL"));
  assert.ok(result.blockingReasons.includes("MIN_PAIRED_COMPARISON_SAMPLE"));
});

test("blocks insufficient real settled samples even if the ledger contains many predictions", () => {
  const result = assessForwardPerformanceReadiness(readyInput({
    performanceReport: {
      models: {
        MODEL_4_0: { sampleSize: 120, settledPredictions: 99 },
        MODEL_4_1: { sampleSize: 120, settledPredictions: 120 },
      },
      comparison: { sampleSize: 110 },
    },
  }));
  assert.equal(result.ready, false);
  assert.ok(result.blockingReasons.includes("MIN_SETTLED_SAMPLE_PER_MODEL"));
});

test("blocks conflicting ledger records and inconsistent event IDs", () => {
  const result = assessForwardPerformanceReadiness(readyInput({
    ledgerStatus: { total: 220, pending: 0, settled: 220, conflicts: 1 },
    reconciliation: { eventCount: 220, uniqueEventIds: 219, uniqueLedgerIds: 220 },
  }));
  assert.ok(result.blockingReasons.includes("NO_UNRESOLVED_CONFLICTS"));
  assert.ok(result.blockingReasons.includes("EVENT_ID_INTEGRITY"));
});

test("allows multiple event types for one ledger ID when event IDs remain unique", () => {
  const result = assessForwardPerformanceReadiness(readyInput({
    reconciliation: { eventCount: 330, uniqueEventIds: 330, uniqueLedgerIds: 220 },
  }));
  assert.equal(result.ready, true);
});

test("blocks non-Neon storage and impossible ledger count arithmetic", () => {
  const result = assessForwardPerformanceReadiness(readyInput({
    storageMode: "filesystem",
    ledgerStatus: { total: 10, pending: 9, settled: 2, conflicts: 0 },
  }));
  assert.ok(result.blockingReasons.includes("NEON_STORAGE_ACTIVE"));
  assert.ok(result.blockingReasons.includes("LEDGER_COUNTS_RECONCILE"));
});

test("supports stricter explicitly configured thresholds", () => {
  const result = assessForwardPerformanceReadiness({
    ...readyInput(),
    minSettledPerModel: 150,
    minPairedSamples: 150,
  });
  assert.equal(result.ready, false);
});

test("rejects invalid custom thresholds", () => {
  const result = assessForwardPerformanceReadiness({
    ...readyInput(),
    minSettledPerModel: -1,
    minPairedSamples: 100.5,
  });
  assert.equal(result.ready, false);
  assert.ok(result.blockingReasons.includes("VALID_THRESHOLDS"));
});
