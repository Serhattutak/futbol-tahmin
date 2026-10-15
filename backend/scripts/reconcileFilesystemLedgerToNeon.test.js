"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { compareEventIds } = require("./reconcileFilesystemLedgerToNeon");

const source = [
  { type: "prediction", ledgerId: "fixture-a", snapshot: { ledgerId: "fixture-a" } },
  { type: "settlement", ledgerId: "fixture-a", result: { actual1X2: "home" } },
];
const extra = { type: "prediction", ledgerId: "unexpected", snapshot: { ledgerId: "unexpected" } };

test("reconciliation dry-run reports missing IDs without mutating either source", () => {
  const destination = [source[0]];
  const report = compareEventIds(source, destination);
  assert.equal(report.sourceEventCount, 2);
  assert.equal(report.destinationEventCount, 1);
  assert.equal(report.missingFromDestination.length, 1);
  assert.deepEqual(report.destinationOnly, []);
  assert.equal(source.length, 2);
  assert.equal(destination.length, 1);
});

test("reconciliation dry-run identifies destination-only records as unsafe", () => {
  const report = compareEventIds(source, [source[0], extra]);
  assert.deepEqual(report.missingFromDestination, [require("../services/neonPredictionLedgerStore").stableEventId(source[1])]);
  assert.deepEqual(report.destinationOnly, [require("../services/neonPredictionLedgerStore").stableEventId(extra)]);
});
