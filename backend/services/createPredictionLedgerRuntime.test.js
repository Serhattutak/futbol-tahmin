"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPredictionLedgerRuntime } = require("./createPredictionLedgerRuntime");

function poolWithSchema({ failOnLoad = false } = {}) {
  return {
    ended: false,
    async query(sql) {
      if (sql.includes("information_schema.columns")) {
        return { rows: [
          { column_name: "event_id", data_type: "text", is_nullable: "NO" },
          { column_name: "ledger_id", data_type: "text", is_nullable: "NO" },
          { column_name: "event_type", data_type: "text", is_nullable: "NO" },
          { column_name: "payload", data_type: "jsonb", is_nullable: "NO" },
          { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
        ] };
      }
      if (sql.includes("FROM pg_indexes")) return { rows: [{ indexdef: "CREATE UNIQUE INDEX ledger_event_id_idx ON public.zeus_prediction_ledger_events USING btree (event_id)" }] };
      if (sql.includes("ORDER BY created_at")) {
        if (failOnLoad) throw new Error("simulated database read failure");
        return { rows: [] };
      }
      throw new Error("unexpected query");
    },
    async end() { this.ended = true; },
  };
}

test("runtime defaults to filesystem and does not require Neon configuration", async () => {
  const filesystemLedger = { entries: () => [] };
  const runtime = await createPredictionLedgerRuntime({ filesystemLedger, connectionString: "" });
  assert.equal(runtime.mode, "filesystem");
  assert.equal(runtime.ledger, filesystemLedger);
  assert.equal(runtime.initialized, true);
  assert.equal(runtime.pool, null);
});

test("Neon mode requires explicit URL and never falls back to filesystem", async () => {
  const filesystemLedger = { entries: () => [] };
  await assert.rejects(
    createPredictionLedgerRuntime({ mode: "neon", filesystemLedger, createPool: async () => { throw new Error("must not connect"); }, connectionString: "" }),
    /NEON_DATABASE_URL_REQUIRED/
  );
  await assert.rejects(
    createPredictionLedgerRuntime({ mode: "neon", filesystemLedger, connectionString: "postgres://test" }),
    /POSTGRES_POOL_FACTORY_REQUIRED/
  );
});

test("Neon mode validates schema and restores before returning initialized runtime", async () => {
  const pool = poolWithSchema();
  const runtime = await createPredictionLedgerRuntime({
    mode: "neon",
    connectionString: "postgres://isolated-test",
    createPool: async () => pool,
  });
  assert.equal(runtime.mode, "neon");
  assert.equal(runtime.initialized, true);
  assert.equal(runtime.ledger.status().eventCount, 0);
  assert.equal(pool.ended, false);
  await pool.end();
});

test("Neon startup failure closes pool and propagates error without fallback", async () => {
  const pool = poolWithSchema({ failOnLoad: true });
  const filesystemLedger = { entries: () => [] };
  await assert.rejects(
    createPredictionLedgerRuntime({
      mode: "neon",
      filesystemLedger,
      connectionString: "postgres://isolated-test",
      createPool: async () => pool,
    }),
    /simulated database read failure/
  );
  assert.equal(pool.ended, true);
});
