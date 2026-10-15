"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { reconcileFilesystemEvents } = require("./reconcileFilesystemLedger");
const { stableEventId } = require("./neonPredictionLedgerStore");

function storeWith(events = []) {
  const map = new Map(events.map(event => [stableEventId(event), event]));
  return {
    map,
    failAfter: null,
    async append(event) {
      if (this.failAfter !== null && this.map.size >= this.failAfter) throw new Error("simulated destination outage");
      const eventId = stableEventId(event);
      if (this.map.has(eventId)) return { saved: false, eventId };
      this.map.set(eventId, event);
      return { saved: true, eventId };
    },
    async loadEvents() { return [...this.map.values()]; },
  };
}

const prediction = { type: "prediction", ledgerId: "reconcile-1", snapshot: { ledgerId: "reconcile-1" } };
const settlement = { type: "settlement", ledgerId: "reconcile-1", result: { actual1X2: "home" } };

test("requires an explicit source event array and destination store", async () => {
  await assert.rejects(reconcileFilesystemEvents({}), /SOURCE_EVENTS_REQUIRED/);
  await assert.rejects(reconcileFilesystemEvents({ sourceEvents: [] }), /DESTINATION_STORE_REQUIRED/);
});

test("reconciles event IDs and can be safely rerun after a partial destination failure", async () => {
  const destinationStore = storeWith();
  destinationStore.failAfter = 1;
  await assert.rejects(
    reconcileFilesystemEvents({ sourceEvents: [prediction, settlement], destinationStore }),
    /simulated destination outage/,
  );
  assert.equal(destinationStore.map.size, 1);

  destinationStore.failAfter = null;
  const report = await reconcileFilesystemEvents({ sourceEvents: [prediction, settlement], destinationStore });
  assert.equal(report.verified, true);
  assert.equal(report.sourceEventCount, 2);
  assert.equal(report.destinationEventCount, 2);
  assert.equal(report.appended, 1);
  assert.equal(report.alreadyPresent, 1);
  assert.deepEqual(report.missingFromDestination, []);
  assert.deepEqual(report.destinationOnly, []);
});

test("does not report a verified cutover when destination has extra events", async () => {
  const extra = { type: "prediction", ledgerId: "destination-only", snapshot: { ledgerId: "destination-only" } };
  const destinationStore = storeWith([extra]);
  const report = await reconcileFilesystemEvents({ sourceEvents: [prediction], destinationStore });
  assert.equal(report.verified, false);
  assert.deepEqual(report.destinationOnly, [stableEventId(extra)]);
});

test("rejects conflicting source records that reuse a stable event identity", async () => {
  const changedPrediction = { type: "prediction", ledgerId: "reconcile-1", snapshot: { ledgerId: "reconcile-1", value: "different" } };
  await assert.rejects(
    reconcileFilesystemEvents({ sourceEvents: [prediction, changedPrediction], destinationStore: storeWith() }),
    /SOURCE_EVENT_ID_COLLISION/,
  );
});
