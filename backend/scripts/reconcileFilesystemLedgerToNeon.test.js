"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
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

test("reconciliation dry-run flags same-ID payload mismatches as unsafe", () => {
  const changed = { type: "prediction", ledgerId: "fixture-a", snapshot: { ledgerId: "fixture-a", changed: true } };
  const report = compareEventIds([source[0]], [changed]);
  assert.deepEqual(report.missingFromDestination, []);
  assert.deepEqual(report.destinationOnly, []);
  assert.deepEqual(report.payloadMismatches, [require("../services/neonPredictionLedgerStore").stableEventId(source[0])]);
  assert.equal(report.safeToApply, undefined);
});

test("reconciliation dry-run identifies destination-only records as unsafe", () => {
  const report = compareEventIds(source, [source[0], extra]);
  assert.deepEqual(report.missingFromDestination, [require("../services/neonPredictionLedgerStore").stableEventId(source[1])]);
  assert.deepEqual(report.destinationOnly, [require("../services/neonPredictionLedgerStore").stableEventId(extra)]);
});

test("apply mode refuses an implicit/default filesystem source directory", () => {
  const script = path.join(__dirname, "reconcileFilesystemLedgerToNeon.js");
  const result = spawnSync(process.execPath, [script, "--apply"], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      DATABASE_URL: "postgres://example.invalid/never-connect",
      ZEUS_LEDGER_DIR: "",
      ZEUS_RECONCILE_CONFIRM: "I_HAVE_VERIFIED_SOURCE_AND_TARGET",
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ZEUS_LEDGER_DIR_REQUIRED_FOR_APPLY/);
});
