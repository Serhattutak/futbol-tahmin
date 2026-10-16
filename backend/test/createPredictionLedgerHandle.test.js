"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPredictionLedgerHandle } = require("../services/createPredictionLedgerHandle");

function ledger(label) {
  return {
    label,
    entries: () => [{ label }],
    recordResponse: async () => label,
    settleFromProviders: async () => label,
  };
}

test("stable handle delegates reads and async writes to the active ledger", async () => {
  const filesystem = ledger("filesystem");
  const neon = ledger("neon");
  const handle = createPredictionLedgerHandle(filesystem);
  const reference = handle.ledger;

  assert.equal(reference.entries()[0].label, "filesystem");
  handle.replace(neon);
  assert.equal(reference.entries()[0].label, "neon");
  assert.equal(await reference.recordResponse(), "neon");
  assert.equal(handle.getCurrent(), neon);
  assert.equal(handle.isReady(), false);
  handle.markReady();
  assert.equal(handle.isReady(), true);
});

test("handle refuses store replacement after readiness", () => {
  const handle = createPredictionLedgerHandle(ledger("filesystem"));
  handle.markReady();
  assert.throws(() => handle.replace(ledger("neon")), /LEDGER_HANDLE_ALREADY_READY/);
});

test("handle rejects invalid initial or replacement stores", () => {
  assert.throws(() => createPredictionLedgerHandle({}), /INITIAL_LEDGER_REQUIRED/);
  const handle = createPredictionLedgerHandle(ledger("filesystem"));
  assert.throws(() => handle.replace({ entries() {} }), /REPLACEMENT_LEDGER_INVALID/);
});

test("readiness is idempotent and keeps the selected store", () => {
  const selected = ledger("selected");
  const handle = createPredictionLedgerHandle(selected);
  handle.markReady();
  handle.markReady();
  assert.equal(handle.getCurrent(), selected);
  assert.equal(handle.ledger.entries()[0].label, "selected");
});
