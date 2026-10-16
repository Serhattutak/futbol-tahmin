"use strict";

const { assessForwardPerformanceReadiness } = require("./forwardPerformanceReadiness");
const { auditSettlementIntegrity } = require("./settlementIntegrityAudit");

/**
 * Read-only, fail-closed aggregation of settlement structure and forward-evidence
 * gates. READY_FOR_REVIEW means only that supplied evidence passed these gates;
 * it is not a model approval, deployment authorization, or profitability claim.
 */
function assessOperationalReleaseReadiness(input = {}) {
  const integrity = auditSettlementIntegrity(input.events);
  const performance = assessForwardPerformanceReadiness({
    storageMode: input.storageMode,
    ledgerStatus: input.ledgerStatus,
    performanceReport: input.performanceReport,
    reconciliation: input.reconciliation,
    minSettledPerModel: input.minSettledPerModel,
    minPairedSamples: input.minPairedSamples,
  });

  const checks = [
    {
      code: "SETTLEMENT_EVENT_INTEGRITY",
      passed: integrity.ready,
      details: {
        status: integrity.status,
        counts: integrity.counts,
        blockingReasons: integrity.blockingReasons,
      },
    },
    ...performance.checks,
  ];
  const blockingReasons = checks.filter(check => !check.passed).map(check => check.code);
  const ready = blockingReasons.length === 0;
  return {
    ready,
    status: ready ? "READY_FOR_REVIEW" : "NOT_READY",
    policy: "Read-only operational gate. Does not authorize model switching, betting, merge, deployment, or production writes.",
    checks,
    blockingReasons: [...new Set(blockingReasons)],
    settlementIntegrity: integrity,
    forwardPerformance: performance,
  };
}

module.exports = { assessOperationalReleaseReadiness };
