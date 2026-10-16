"use strict";

const crypto = require("node:crypto");
const { NeonPredictionLedgerStore } = require("../services/neonPredictionLedgerStore");
const { AsyncPredictionLedger } = require("../services/asyncPredictionLedger");
const { stableEventId } = require("../services/neonPredictionLedgerStore");

const CONFIRMATION = "I_UNDERSTAND_THIS_IS_STAGING";
const DEFAULT_SOURCE = "https://zeus-one-betting-api.onrender.com";
const RESULT_FIELDS = [
  "resultStatus", "actualHomeGoals", "actualAwayGoals", "actual1X2",
  "actualOver15", "actualOver25", "actualOver35", "actualBTTS", "settledAt",
  "predictionCorrect1X2", "brier1X2", "logLoss1X2",
  "predictionCorrectOver15", "predictionCorrectOver25",
  "predictionCorrectOver35", "predictionCorrectBTTS",
];

async function fetchProductionEntries({ sourceUrl = process.env.ZEUS_LEDGER_SOURCE_API_URL || DEFAULT_SOURCE, fetchImpl = fetch } = {}) {
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== "zeus-one-betting-api.onrender.com") {
    throw new Error("MIGRATION_REHEARSAL_SOURCE_NOT_PRODUCTION_API");
  }
  const entries = [];
  let expectedTotal = null;
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const response = await fetchImpl(`${parsed.origin}/api/ledger/entries?limit=${limit}&offset=${offset}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`PRODUCTION_LEDGER_EXPORT_HTTP_${response.status}`);
    const body = await response.json();
    if (!body || body.success !== true || !Array.isArray(body.entries) ||
        !Number.isInteger(body.total) || body.total < 0) {
      throw new Error("PRODUCTION_LEDGER_EXPORT_INVALID_RESPONSE");
    }
    if (expectedTotal === null) expectedTotal = body.total;
    if (body.total !== expectedTotal) throw new Error("PRODUCTION_LEDGER_CHANGED_DURING_EXPORT");
    entries.push(...body.entries);
    if (entries.length >= expectedTotal || body.entries.length < limit) break;
  }
  if (entries.length !== expectedTotal) throw new Error("PRODUCTION_LEDGER_EXPORT_INCOMPLETE");
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.ledgerId !== "string" || !entry.ledgerId ||
        typeof entry.fixtureId !== "string" || !entry.fixtureId ||
        typeof entry.predictionCreatedAt !== "string") {
      throw new Error("PRODUCTION_LEDGER_ENTRY_INVALID");
    }
    if (ids.has(entry.ledgerId)) throw new Error("PRODUCTION_LEDGER_DUPLICATE_LEDGER_ID");
    ids.add(entry.ledgerId);
  }
  return entries;
}

function entryToEvents(entry) {
  const { conflicts = [], resultProviders, resultVerification, ...flat } = entry;
  const snapshot = { ...flat };
  for (const field of RESULT_FIELDS) snapshot[field] = null;
  const events = [{ type: "prediction", ledgerId: entry.ledgerId, snapshot }];
  if (entry.resultStatus === "settled") {
    const result = Object.fromEntries(RESULT_FIELDS.filter(key => Object.hasOwn(entry, key)).map(key => [key, entry[key]]));
    if (resultProviders !== undefined) result.resultProviders = resultProviders;
    if (resultVerification !== undefined) result.resultVerification = resultVerification;
    events.push({ type: "settlement", ledgerId: entry.ledgerId, result });
  }
  for (const conflict of conflicts) {
    if (!conflict || conflict.type !== "conflict" || conflict.ledgerId !== entry.ledgerId ||
        !Array.isArray(conflict.evidence)) {
      throw new Error("PRODUCTION_LEDGER_CONFLICT_INVALID");
    }
    events.push({
      type: "conflict",
      ledgerId: conflict.ledgerId,
      detectedAt: conflict.detectedAt,
      evidence: conflict.evidence,
    });
  }
  return events;
}

async function rehearseProductionLedgerMigration({
  connectionString = process.env.DATABASE_URL,
  sourceUrl = process.env.ZEUS_LEDGER_SOURCE_API_URL || DEFAULT_SOURCE,
  createPool = value => {
    const { Pool } = require("pg");
    return new Pool({ connectionString: value, connectionTimeoutMillis: 10000, max: 2 });
  },
  fetchImpl = fetch,
} = {}) {
  if (process.env.ZEUS_LEDGER_MODE !== "neon") throw new Error("MIGRATION_REHEARSAL_REQUIRES_NEON_MODE");
  if (process.env.ZEUS_LEDGER_STAGING_SMOKE_CONFIRMATION !== CONFIRMATION) {
    throw new Error("MIGRATION_REHEARSAL_CONFIRMATION_REQUIRED");
  }
  if (!connectionString) throw new Error("NEON_DATABASE_URL_REQUIRED");
  if (!new URL(connectionString).hostname.endsWith(".neon.tech")) {
    throw new Error("MIGRATION_REHEARSAL_REQUIRES_NEON_HOST");
  }

  const sourceEntries = await fetchProductionEntries({ sourceUrl, fetchImpl });
  const sourceEvents = sourceEntries.flatMap(entryToEvents);
  const sourceIds = sourceEvents.map(stableEventId);
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error("MIGRATION_REHEARSAL_DUPLICATE_EVENT_ID");
  const suffix = crypto.randomBytes(6).toString("hex");
  const table = `public.zeus_migration_smoke_${suffix}`;
  const pool = await createPool(connectionString);
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

    let inserted = 0;
    for (const event of sourceEvents) {
      const result = await ledger.appendEvent(event);
      if (result.saved) inserted += 1;
    }
    const duplicateAttempts = await Promise.all(sourceEvents.map(event => ledger.appendEvent(event)));
    if (duplicateAttempts.some(result => result.saved)) throw new Error("MIGRATION_REHEARSAL_NOT_IDEMPOTENT");

    const restoredPool = await createPool(connectionString);
    try {
      const restoredLedger = new AsyncPredictionLedger({
        store: new NeonPredictionLedgerStore({ pool: restoredPool, table }),
      });
      await restoredLedger.initialize();
      const restoredEvents = restoredLedger.events();
      const restoredIds = restoredEvents.map(stableEventId).sort();
      const expectedIds = [...sourceIds].sort();
      if (JSON.stringify(restoredIds) !== JSON.stringify(expectedIds)) {
        throw new Error("MIGRATION_REHEARSAL_EVENT_ID_MISMATCH");
      }
      const restoredEntries = restoredLedger.entries();
      if (restoredEntries.length !== sourceEntries.length) throw new Error("MIGRATION_REHEARSAL_PROJECTION_MISMATCH");
      return {
        type: "LEDGER_PRODUCTION_SOURCE_MIGRATION_REHEARSAL_PASSED",
        source: "read-only production API",
        sourceEntries: sourceEntries.length,
        sourceEvents: sourceEvents.length,
        insertedEvents: inserted,
        duplicateAppendCount: duplicateAttempts.length,
        restoredEventCount: restoredEvents.length,
        restoredEntryCount: restoredEntries.length,
        settledEntries: restoredEntries.filter(entry => entry.resultStatus === "settled").length,
        conflictEntries: restoredEntries.filter(entry => entry.conflicts?.length).length,
        table,
        cleanup: "completed in finally before return",
        productionModified: false,
        durableStagingLedgerModified: false,
      };
    } finally {
      await restoredPool.end();
    }
  } finally {
    try {
      if (created) await pool.query(`DROP TABLE IF EXISTS ${table}`);
    } finally {
      await pool.end();
    }
  }
}

module.exports = { fetchProductionEntries, entryToEvents, rehearseProductionLedgerMigration, CONFIRMATION };
