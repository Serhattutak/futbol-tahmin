"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { NeonPredictionLedgerStore } = require("./neonPredictionLedgerStore");

test("real PostgreSQL round-trip, idempotency, fresh-connection recovery, and row integrity", {
  skip: !process.env.ZEUS_TEST_DATABASE_URL
}, async () => {
  const connectionString = process.env.ZEUS_TEST_DATABASE_URL;
  const host = new URL(connectionString).hostname;
  // This destructive test creates/drops a fixed table; only allow an explicitly
  // isolated local CI PostgreSQL service, never a production or remote Neon URL.
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host), "integration tests require local isolated PostgreSQL");
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000
  });
  let restartedPool;
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
    assert.deepEqual(await store.validateSchema(), { valid: true, table });
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
    const conflict = {
      type: "conflict", ledgerId: prediction.ledgerId,
      evidence: [{ provider: "provider-a", home: 2, away: 0 }, { provider: "provider-b", home: 1, away: 0 }]
    };
    assert.equal((await store.append(conflict)).saved, true);

    // A fresh PostgreSQL pool models a process restart, rather than reusing the
    // same connection pool and only constructing a second adapter object.
    await pool.end();
    restartedPool = new Pool({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 1000
    });
    const restored = new NeonPredictionLedgerStore({ pool: restartedPool, table });
    assert.deepEqual(await restored.validateSchema(), { valid: true, table });
    const events = await restored.loadEvents();
    assert.equal(events.length, 3);
    assert.deepEqual(new Set(events.map(event => event.type)), new Set(["prediction", "settlement", "conflict"]));
    assert.deepEqual(events.find(event => event.type === "prediction"), prediction);
    assert.deepEqual(events.find(event => event.type === "settlement"), settlement);
    assert.deepEqual(events.find(event => event.type === "conflict"), conflict);
    assert.deepEqual(await restored.status(), {
      connected: true, event_count: 3, prediction_count: 1,
      settlement_count: 1, conflict_count: 1
    });

    // Corrupt indexed metadata must fail closed instead of being silently loaded.
    await restartedPool.query(
      `INSERT INTO ${table} (event_id, ledger_id, event_type, payload) VALUES ($1, $2, $3, $4::jsonb)`,
      ["prediction:tampered", "tampered", "prediction", JSON.stringify({
        type: "prediction", ledgerId: "different-ledger-id", snapshot: {}
      })]
    );
    await assert.rejects(restored.loadEvents(), /LEDGER_EVENT_COLUMN_MISMATCH/);
  } finally {
    const cleanupPool = restartedPool || pool;
    await cleanupPool.query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
    await Promise.allSettled([pool.end(), restartedPool?.end()]);
  }
});
