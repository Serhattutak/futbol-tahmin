"use strict";

const crypto = require("node:crypto");
const { NeonPredictionLedgerStore } = require("../services/neonPredictionLedgerStore");
const { AsyncPredictionLedger } = require("../services/asyncPredictionLedger");

const CONFIRMATION = "I_UNDERSTAND_THIS_IS_STAGING";

async function runStagingSmoke({
  connectionString = process.env.DATABASE_URL,
  createPool = value => {
    const { Pool } = require("pg");
    return new Pool({ connectionString: value, connectionTimeoutMillis: 10000, max: 2 });
  },
} = {}) {
  if (process.env.ZEUS_LEDGER_MODE !== "neon") throw new Error("STAGING_SMOKE_REQUIRES_NEON_MODE");
  if (process.env.ZEUS_LEDGER_STAGING_SMOKE_CONFIRMATION !== CONFIRMATION) {
    throw new Error("STAGING_SMOKE_CONFIRMATION_REQUIRED");
  }
  if (!connectionString) throw new Error("NEON_DATABASE_URL_REQUIRED");
  const host = new URL(connectionString).hostname;
  if (!host.endsWith(".neon.tech")) throw new Error("STAGING_SMOKE_REQUIRES_NEON_HOST");

  const suffix = crypto.randomBytes(6).toString("hex");
  const table = `public.zeus_ledger_smoke_${suffix}`;
  const pool = await createPool(connectionString);
  let restorePool;
  let created = false;
  try {
    await pool.query(`CREATE TABLE ${table} (
      event_id text PRIMARY KEY,
      ledger_id text NOT NULL,
      event_type text NOT NULL CHECK (event_type IN ('prediction', 'settlement', 'conflict')),
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    created = true;

    const store = new NeonPredictionLedgerStore({ pool, table });
    await store.validateSchema();
    const ledgerId = `staging-smoke-${suffix}`;
    const event = {
      type: "prediction",
      ledgerId,
      snapshot: { ledgerId, predictionCreatedAt: new Date().toISOString() },
    };
    const first = await store.append(event);
    const duplicate = await store.append(event);
    if (!first.saved || duplicate.saved) throw new Error("STAGING_SMOKE_IDEMPOTENCY_FAILED");

    restorePool = await createPool(connectionString);
    const restoredStore = new NeonPredictionLedgerStore({ pool: restorePool, table });
    const ledger = new AsyncPredictionLedger({ store: restoredStore });
    await ledger.initialize();
    const entries = ledger.entries();
    const status = await ledger.status();
    if (entries.length !== 1 || entries[0].ledgerId !== ledgerId ||
        status.eventCount !== 1 || status.predictionCount !== 1) {
      throw new Error("STAGING_SMOKE_RESTORE_FAILED");
    }

    const report = {
      type: "LEDGER_STAGING_SMOKE_PASSED",
      table,
      firstAppendSaved: first.saved,
      duplicateAppendSaved: duplicate.saved,
      restoredEntryCount: entries.length,
      eventCount: status.eventCount,
      predictionCount: status.predictionCount,
      cleanup: "pending",
    };
    return report;
  } finally {
    if (restorePool) await restorePool.end();
    if (created) await pool.query(`DROP TABLE IF EXISTS ${table}`);
    await pool.end();
  }
}

module.exports = { runStagingSmoke, CONFIRMATION };
