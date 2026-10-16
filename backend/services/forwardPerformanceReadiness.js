"use strict";

const DEFAULT_MIN_SETTLED = 100;
const DEFAULT_MIN_PAIRED = 100;

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function assessForwardPerformanceReadiness({
  storageMode,
  ledgerStatus,
  performanceReport,
  reconciliation,
  minSettledPerModel = DEFAULT_MIN_SETTLED,
  minPairedSamples = DEFAULT_MIN_PAIRED,
} = {}) {
  const checks = [];
  const add = (code, passed, details) => checks.push({ code, passed: Boolean(passed), details });

  const status = ledgerStatus && typeof ledgerStatus === "object" ? ledgerStatus : {};
  const report = performanceReport && typeof performanceReport === "object" ? performanceReport : {};
  const models = report.models && typeof report.models === "object" ? report.models : {};
  const comparison = report.comparison && typeof report.comparison === "object" ? report.comparison : {};
  const integrity = reconciliation && typeof reconciliation === "object" ? reconciliation : {};

  add("NEON_STORAGE_ACTIVE", storageMode === "neon_postgres", { storageMode: storageMode ?? null });
  const countsValid = ["total", "pending", "settled", "conflicts"].every(key => nonNegativeInteger(status[key]));
  add("LEDGER_COUNTS_VALID", countsValid, {
    total: status.total ?? null, pending: status.pending ?? null,
    settled: status.settled ?? null, conflicts: status.conflicts ?? null,
  });
  add("LEDGER_COUNTS_RECONCILE", countsValid && status.total === status.pending + status.settled, {
    total: status.total ?? null,
    pendingPlusSettled: countsValid ? status.pending + status.settled : null,
  });
  add("NO_UNRESOLVED_CONFLICTS", countsValid && status.conflicts === 0, { conflicts: status.conflicts ?? null });

  const eventCount = integrity.eventCount;
  const uniqueEventIds = integrity.uniqueEventIds;
  const uniqueLedgerIds = integrity.uniqueLedgerIds;
  const integrityCountsValid = [eventCount, uniqueEventIds, uniqueLedgerIds].every(nonNegativeInteger);
  // A healthy ledger can contain several events for one prediction (prediction,
  // settlement, and conflict audit events), so ledger IDs need not equal event IDs.
  add("EVENT_ID_INTEGRITY", integrityCountsValid && eventCount === uniqueEventIds &&
    uniqueLedgerIds <= uniqueEventIds, {
      eventCount: eventCount ?? null, uniqueEventIds: uniqueEventIds ?? null,
      uniqueLedgerIds: uniqueLedgerIds ?? null,
    });

  const modelResults = ["MODEL_4_0", "MODEL_4_1"].map(name => {
    const model = models[name] && typeof models[name] === "object" ? models[name] : {};
    return { name, sampleSize: model.sampleSize, settledPredictions: model.settledPredictions };
  });
  const modelSamplesValid = modelResults.every(model =>
    nonNegativeInteger(model.sampleSize) && nonNegativeInteger(model.settledPredictions));
  const enoughPerModel = modelSamplesValid && modelResults.every(model =>
    model.sampleSize >= minSettledPerModel && model.settledPredictions >= minSettledPerModel);
  add("MIN_SETTLED_SAMPLE_PER_MODEL", enoughPerModel, { minimum: minSettledPerModel, models: modelResults });

  const pairedSample = comparison.sampleSize;
  add("MIN_PAIRED_COMPARISON_SAMPLE", nonNegativeInteger(pairedSample) && pairedSample >= minPairedSamples, {
    minimum: minPairedSamples, sampleSize: pairedSample ?? null,
  });

  const passed = checks.every(check => check.passed);
  return {
    ready: passed,
    status: passed ? "READY_FOR_REVIEW" : "NOT_READY",
    policy: "Operational/data-integrity gate only; not evidence that either model is more accurate or profitable.",
    checks,
    blockingReasons: checks.filter(check => !check.passed).map(check => check.code),
  };
}

module.exports = { DEFAULT_MIN_SETTLED, DEFAULT_MIN_PAIRED, assessForwardPerformanceReadiness };
