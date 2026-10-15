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
      if (sql.startsWith("SELECT event_id")) return { rows: [...events.values()] };
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

test("conflict identity matches filesystem ledger: deduplicates equivalent scores, preserves different scores", async () => {
  const store = new NeonPredictionLedgerStore({ pool: fakePool() });
  const first = { type: "conflict", ledgerId: "entry-1", evidence: [
    { provider: "a", home: 1, away: 0 }, { provider: "b", home: 2, away: 0 }
  ] };
  const sameScoresDifferentEvidence = { type: "conflict", ledgerId: "entry-1", detectedAt: "later", evidence: [
    { provider: "b", home: 2, away: 0 }, { provider: "c", home: 1, away: 0 }
  ] };
  const differentScores = { type: "conflict", ledgerId: "entry-1", evidence: [
    { provider: "d", home: 3, away: 0 }
  ] };
  assert.equal(stableEventId(first), stableEventId(sameScoresDifferentEvidence));
  assert.notEqual(stableEventId(first), stableEventId(differentScores));
  assert.equal((await store.append(first)).saved, true);
  assert.equal((await store.append(sameScoresDifferentEvidence)).saved, false);
  assert.equal((await store.append(differentScores)).saved, true);
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

test("propagates database write failures so callers cannot mistake them for success", async () => {
  const store = new NeonPredictionLedgerStore({ pool: { query: async () => { throw new Error("DATABASE_UNAVAILABLE"); } } });
  await assert.rejects(store.append({ type: "prediction", ledgerId: "p", snapshot: {} }), /DATABASE_UNAVAILABLE/);
});

test("rejects unsupported event types and missing ledger identifiers before database access", async () => {
  let calls = 0;
  const store = new NeonPredictionLedgerStore({ pool: { query: async () => { calls++; return { rowCount: 1, rows: [] }; } } });
  await assert.rejects(store.append({ type: "unknown", ledgerId: "p" }), /INVALID_LEDGER_EVENT/);
  await assert.rejects(store.append({ type: "prediction", ledgerId: "" }), /INVALID_LEDGER_EVENT/);
  assert.equal(calls, 0);
});

test("rejects persisted rows whose indexed columns disagree with the payload", async () => {
  const pool = fakePool();
  const event = { type: "prediction", ledgerId: "actual-id", snapshot: { homeProbability: 0.5 } };
  pool.events.set("prediction:other-id", {
    event_id: "prediction:other-id", ledger_id: "other-id", event_type: "prediction", payload: event
  });
  const store = new NeonPredictionLedgerStore({ pool });
  await assert.rejects(store.loadEvents(), /LEDGER_EVENT_COLUMN_MISMATCH/);
});
