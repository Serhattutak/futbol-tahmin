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
    const ledger = new AsyncPredictionLedger({ store });
    await ledger.initialize();
    const ledgerId = `staging-smoke-${suffix}`;
    const kickoffTime = new Date(Date.now() - 60_000).toISOString();
    const event = {
      type: "prediction",
      ledgerId,
      snapshot: {
        ledgerId,
        fixtureId: `staging-fixture-${suffix}`,
        predictionCreatedAt: new Date().toISOString(),
        kickoffTime,
        providerFixtureIds: { espn: `fixture-${suffix}` },
        homeProbability: 0.6,
        drawProbability: 0.2,
        awayProbability: 0.2,
        over15: 0.7,
        over25: 0.45,
        over35: 0.2,
        bttsYes: 0.5,
      },
    };
    const first = await ledger.appendEvent(event);
    const duplicate = await ledger.appendEvent(event);
    if (!first.saved || duplicate.saved) throw new Error("STAGING_SMOKE_IDEMPOTENCY_FAILED");

    const finalFixture = score => ({
      provider: "espn",
      providerFixtureId: `fixture-${suffix}`,
      status: "FINISHED",
      result: { status: "FINISHED", homeGoals: score.home, awayGoals: score.away },
    });
    const settlement = await ledger.settle(ledgerId, [finalFixture({ home: 1, away: 0 })]);
    const conflict = await ledger.settle(ledgerId, [finalFixture({ home: 0, away: 0 })]);
    if (!settlement.saved || conflict.reason !== "RESULT_CONFLICT") {
      throw new Error("STAGING_SMOKE_SETTLEMENT_OR_CONFLICT_FAILED");
    }

    restorePool = await createPool(connectionString);
    const restoredStore = new NeonPredictionLedgerStore({ pool: restorePool, table });
    const restoredLedger = new AsyncPredictionLedger({ store: restoredStore });
    await restoredLedger.initialize();
    const entries = restoredLedger.entries();
    const status = await restoredLedger.status();
    if (entries.length !== 1 || entries[0].ledgerId !== ledgerId ||
        entries[0].resultStatus !== "settled" || entries[0].actualHomeGoals !== 1 ||
        entries[0].conflicts?.length !== 1 || status.eventCount !== 3 ||
        status.predictionCount !== 1 || status.settlementCount !== 1 ||
        status.conflictCount !== 1) {
      throw new Error("STAGING_SMOKE_RESTORE_FAILED");
    }
    return {
      type: "LEDGER_STAGING_SMOKE_PASSED",
      table,
      firstAppendSaved: first.saved,
      duplicateAppendSaved: duplicate.saved,
      settlementSaved: settlement.saved,
      settlementReason: settlement.reason,
      conflictReason: conflict.reason,
      restoredEntryCount: entries.length,
      eventCount: status.eventCount,
      predictionCount: status.predictionCount,
      settlementCount: status.settlementCount,
      conflictCount: status.conflictCount,
      cleanup: "completed in finally before return",
    };
  } finally {
    try {
      if (restorePool) await restorePool.end();
    } finally {
      try {
        if (created) await pool.query(`DROP TABLE IF EXISTS ${table}`);
      } finally {
        await pool.end();
      }
    }
  }
}

module.exports = { runStagingSmoke, CONFIRMATION };
