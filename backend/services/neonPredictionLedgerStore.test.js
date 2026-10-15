"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { NeonPredictionLedgerStore, stableEventId } = require("./neonPredictionLedgerStore");

function fakePool() {
  const events = new Map();
  return {
    events,
    async query(sql, params = []) {
      if (sql.startsWith("INSERT")) {
        const [eventId, ledgerId, type, payload] = params;
        if (events.has(eventId)) return { rowCount: 0, rows: [] };
        events.set(eventId, { event_id: eventId, ledger_id: ledgerId, event_type: type, payload: JSON.parse(payload) });
        return { rowCount: 1, rows: [{ event_id: eventId }] };
      }
      if (sql.startsWith("SELECT payload")) {
        return { rows: [...events.values()].map(row => ({ payload: row.payload })) };
      }
      if (sql.startsWith("SELECT COUNT")) {
        const rows = [...events.values()];
        return { rows: [{ event_count: rows.length, prediction_count: rows.filter(e => e.event_type === "prediction").length, settlement_count: rows.filter(e => e.event_type === "settlement").length, conflict_count: rows.filter(e => e.event_type === "conflict").length }] };
      }
      throw new Error("UNEXPECTED_QUERY");
    }
  };
}

test("requires a PostgreSQL-compatible pool and validates table identifier", () => {
  assert.throws(() => new NeonPredictionLedgerStore(), /POSTGRES_POOL_REQUIRED/);
  assert.throws(() => new NeonPredictionLedgerStore({ pool: { query() {} }, table: "public.events; DROP TABLE users" }), /INVALID_LEDGER_TABLE/);
});

test("prediction and settlement writes are idempotent", async () => {
  const pool = fakePool();
  const store = new NeonPredictionLedgerStore({ pool });
  const prediction = { type: "prediction", ledgerId: "fixture-model-input", snapshot: { homeProbability: 0.5 } };
  assert.equal((await store.append(prediction)).saved, true);
  assert.equal((await store.append(prediction)).saved, false);
  assert.equal((await store.append({ type: "settlement", ledgerId: prediction.ledgerId, result: { actual1X2: "home" } })).saved, true);
  const events = await store.loadEvents();
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], prediction);
});

test("distinct conflict observations are retained while exact repeats deduplicate", async () => {
  const store = new NeonPredictionLedgerStore({ pool: fakePool() });
  const first = { type: "conflict", ledgerId: "entry-1", evidence: [{ score: "1:0" }] };
  const second = { type: "conflict", ledgerId: "entry-1", evidence: [{ score: "2:0" }] };
  assert.notEqual(stableEventId(first), stableEventId(second));
  assert.equal((await store.append(first)).saved, true);
  assert.equal((await store.append(first)).saved, false);
  assert.equal((await store.append(second)).saved, true);
  assert.equal((await store.loadEvents()).length, 2);
});

test("rejects malformed persisted events instead of silently accepting them", async () => {
  const pool = fakePool();
  pool.events.set("bad", { payload: { type: "unknown", ledgerId: "x" } });
  const store = new NeonPredictionLedgerStore({ pool });
  await assert.rejects(store.loadEvents(), /INVALID_LEDGER_EVENT/);
});

test("status reports event counts without exposing payloads", async () => {
  const store = new NeonPredictionLedgerStore({ pool: fakePool() });
  await store.append({ type: "prediction", ledgerId: "p", snapshot: {} });
  await store.append({ type: "settlement", ledgerId: "p", result: {} });
  assert.deepEqual(await store.status(), { connected: true, event_count: 2, prediction_count: 1, settlement_count: 1, conflict_count: 0 });
});
