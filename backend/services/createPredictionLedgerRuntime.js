"use strict";

const { NeonPredictionLedgerStore, TABLE } = require("./neonPredictionLedgerStore");
const { AsyncPredictionLedger } = require("./asyncPredictionLedger");

/**
 * Construct a ledger without changing the application's active store.
 * Filesystem remains the default; Neon is explicit and fails closed.
 * The caller owns integration into server startup and the returned pool lifecycle.
 */
async function createPredictionLedgerRuntime({
  mode = process.env.ZEUS_LEDGER_MODE || "filesystem",
  filesystemLedger,
  createPool,
  connectionString = process.env.DATABASE_URL,
  table = TABLE,
  now,
} = {}) {
  if (mode === "filesystem") {
    if (!filesystemLedger) throw new TypeError("FILESYSTEM_LEDGER_REQUIRED");
    return { mode, ledger: filesystemLedger, pool: null, initialized: true };
  }
  if (mode !== "neon") throw new Error("UNSUPPORTED_LEDGER_MODE");
  if (typeof createPool !== "function") throw new TypeError("POSTGRES_POOL_FACTORY_REQUIRED");
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new Error("NEON_DATABASE_URL_REQUIRED");
  }

  const pool = await createPool(connectionString);
  try {
    const store = new NeonPredictionLedgerStore({ pool, table });
    const ledger = new AsyncPredictionLedger({ store, ...(now ? { now } : {}) });
    await ledger.initialize();
    return { mode, ledger, pool, initialized: true };
  } catch (error) {
    try { await pool.end?.(); } catch { /* Preserve the initialization failure. */ }
    throw error;
  }
}

module.exports = { createPredictionLedgerRuntime };
