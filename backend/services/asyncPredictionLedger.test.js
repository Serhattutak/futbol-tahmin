"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AsyncPredictionLedger } = require("./asyncPredictionLedger");
const { stableEventId } = require("./neonPredictionLedgerStore");

function fakeStore(initial = []) {
  const events = new Map(initial.map(event => [stableEventId(event), event]));
  return {
    events,
    failLoad: null,
    failAppend: null,
    async loadEvents() {
      if (this.failLoad) throw this.failLoad;
      return [...events.values()];
    },
    async append(event) {
      if (this.failAppend) throw this.failAppend;
      const id = stableEventId(event);
      if (events.has(id)) return { saved: false, eventId: id };
      events.set(id, event);
      return { saved: true, eventId: id };
    },
  };
}

test("requires a store and blocks reads until initialization finishes", async () => {
  assert.throws(() => new AsyncPredictionLedger(), /ASYNC_LEDGER_STORE_REQUIRED/);
  let release;
  const store = fakeStore();
  store.loadEvents = () => new Promise(resolve => { release = resolve; });
  const ledger = new AsyncPredictionLedger({ store });
  const initializing = ledger.initialize();
  assert.throws(() => ledger.entries(), /ASYNC_LEDGER_NOT_INITIALIZED/);
  release([]);
  assert.deepEqual(await initializing, {
    initialized: true, eventCount: 0, predictionCount: 0, settlementCount: 0, conflictCount: 0,
  });
  assert.equal(ledger.entries().length, 0);
});

test("restores events and projects predictions with settlement and conflicts", async () => {
  const prediction = {
    type: "prediction", ledgerId: "fixture-1",
    snapshot: { ledgerId: "fixture-1", predictionCreatedAt: "2026-10-01T10:00:00.000Z", homeProbability: 0.6 },
  };
  const settlement = { type: "settlement", ledgerId: "fixture-1", result: { resultStatus: "settled", actualHomeGoals: 2 } };
  const conflict = { type: "conflict", ledgerId: "fixture-1", evidence: [{ home: 2, away: 0 }] };
  const ledger = new AsyncPredictionLedger({ store: fakeStore([prediction, settlement, conflict]) });
  await ledger.initialize();
  assert.deepEqual(ledger.entries(), [{
    ...prediction.snapshot,
    ...settlement.result,
    conflicts: [conflict],
  }]);
  assert.deepEqual(ledger.status(), {
    initialized: true, eventCount: 3, predictionCount: 1, settlementCount: 1, conflictCount: 1,
  });
});

test("append is idempotent and refreshes projection after a competing writer wins", async () => {
  const store = fakeStore();
  const ledger = new AsyncPredictionLedger({ store });
  await ledger.initialize();
  const event = {
    type: "prediction", ledgerId: "fixture-2",
    snapshot: { ledgerId: "fixture-2", predictionCreatedAt: "2026-10-02T10:00:00.000Z" },
  };
  assert.equal((await ledger.appendEvent(event)).saved, true);
  assert.equal((await ledger.appendEvent(event)).saved, false);
  assert.equal(ledger.status().predictionCount, 1);
});

test("database read and write errors propagate without silently switching stores", async () => {
  const loadError = new Error("database unavailable");
  const failedLoadStore = fakeStore();
  failedLoadStore.failLoad = loadError;
  const failedLoadLedger = new AsyncPredictionLedger({ store: failedLoadStore });
  await assert.rejects(failedLoadLedger.initialize(), /database unavailable/);
  assert.throws(() => failedLoadLedger.entries(), /ASYNC_LEDGER_NOT_INITIALIZED/);

  const store = fakeStore();
  const ledger = new AsyncPredictionLedger({ store });
  await ledger.initialize();
  store.failAppend = new Error("write failed");
  await assert.rejects(ledger.appendEvent({
    type: "prediction", ledgerId: "fixture-3", snapshot: { ledgerId: "fixture-3" },
  }), /write failed/);
  assert.equal(ledger.status().eventCount, 0);
});

test("rejects duplicate event IDs returned by a corrupt or inconsistent store", async () => {
  const event = { type: "prediction", ledgerId: "fixture-4", snapshot: { ledgerId: "fixture-4" } };
  const store = fakeStore([event]);
  store.loadEvents = async () => [event, event];
  const ledger = new AsyncPredictionLedger({ store });
  await assert.rejects(ledger.initialize(), /DUPLICATE_LEDGER_EVENT_ID/);
  assert.throws(() => ledger.status(), /ASYNC_LEDGER_NOT_INITIALIZED/);
});
