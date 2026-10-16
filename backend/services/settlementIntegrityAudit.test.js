"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { auditSettlementIntegrity } = require("./settlementIntegrityAudit");

const prediction = (ledgerId) => ({
  type: "prediction", ledgerId, snapshot: { ledgerId },
});
const settlement = (ledgerId) => ({
  type: "settlement", ledgerId, result: { resultStatus: "settled" },
});

test("accepts a structurally consistent prediction and settlement", () => {
  const result = auditSettlementIntegrity([prediction("a"), settlement("a")]);
  assert.equal(result.ready, true);
  assert.equal(result.status, "INTEGRITY_OK");
  assert.deepEqual(result.counts, {
    eventCount: 2, uniqueEventIds: 2, predictionCount: 1,
    settlementCount: 1, conflictLedgerCount: 0, malformedEvents: 0,
  });
});

test("fails closed for non-array input and malformed events", () => {
  assert.equal(auditSettlementIntegrity(null).ready, false);
  const result = auditSettlementIntegrity([null, { type: "prediction" }]);
  assert.equal(result.ready, false);
  assert.ok(result.blockingReasons.includes("EVENT_NOT_OBJECT"));
  assert.ok(result.blockingReasons.includes("EVENT_IDENTITY_MISSING"));
});

test("detects duplicate event IDs, duplicate predictions, and duplicate settlements", () => {
  const result = auditSettlementIntegrity([
    prediction("a"), prediction("a"), settlement("a"), settlement("a"),
  ]);
  assert.equal(result.ready, false);
  assert.ok(result.blockingReasons.includes("DUPLICATE_EVENT_ID"));
  assert.ok(result.blockingReasons.includes("DUPLICATE_PREDICTION"));
  assert.ok(result.blockingReasons.includes("DUPLICATE_SETTLEMENT"));
});

test("detects orphan settlements and conflicts without mutating input", () => {
  const events = [settlement("missing"), { type: "conflict", ledgerId: "also-missing", evidence: [{ home: 1, away: 0 }] }];
  const before = JSON.stringify(events);
  const result = auditSettlementIntegrity(events);
  assert.equal(result.ready, false);
  assert.ok(result.blockingReasons.includes("ORPHAN_SETTLEMENT"));
  assert.ok(result.blockingReasons.includes("ORPHAN_CONFLICT"));
  assert.equal(JSON.stringify(events), before);
});

test("reports unknown event types as issues without blocking known ledger integrity", () => {
  const result = auditSettlementIntegrity([
    prediction("a"),
    { type: "future-event", ledgerId: "a" },
  ]);
  assert.equal(result.ready, true);
  assert.ok(result.issues.some(issue => issue.code === "UNKNOWN_EVENT_TYPE"));
});
