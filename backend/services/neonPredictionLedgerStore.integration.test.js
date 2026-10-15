"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { NeonPredictionLedgerStore } = require("./neonPredictionLedgerStore");

test("real PostgreSQL round-trip, idempotency, and restart restore", {
  skip: !process.env.ZEUS_TEST_DATABASE_URL
}, async () => {
  // Load the driver only when the explicit isolated-test URL is supplied.
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: process.env.ZEUS_TEST_DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000
  });
  const table = "public.zeus_prediction_ledger_events_test";
  try {
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
    await pool.query(`
      CREATE TABLE ${table} (
        event_id text PRIMARY KEY,
        ledger_id text NOT NULL,
        event_type text NOT NULL CHECK (event_type IN ('prediction', 'settlement', 'conflict')),
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const store = new NeonPredictionLedgerStore({ pool, table });
    const prediction = {
      type: "prediction", ledgerId: "integration-fixture-model",
      snapshot: { homeProbability: 0.52, drawProbability: 0.27, awayProbability: 0.21 }
    };
    assert.deepEqual(await store.append(prediction), {
      saved: true, eventId: "prediction:integration-fixture-model"
    });
    assert.deepEqual(await store.append(prediction), {
      saved: false, eventId: "prediction:integration-fixture-model"
    });
    const settlement = {
      type: "settlement", ledgerId: prediction.ledgerId,
      result: { actual1X2: "home", actualHomeGoals: 2, actualAwayGoals: 0 }
    };
    assert.equal((await store.append(settlement)).saved, true);

    // Simulate a process restart by creating a fresh store instance over the same DB.
    const restored = new NeonPredictionLedgerStore({ pool, table });
    const events = await restored.loadEvents();
    assert.equal(events.length, 2);
    assert.deepEqual(events[0], prediction);
    assert.deepEqual(events[1], settlement);
    assert.deepEqual(await restored.status(), {
      connected: true, event_count: 2, prediction_count: 1,
      settlement_count: 1, conflict_count: 0
    });
  } finally {
    await pool.query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
    await pool.end();
  }
});
