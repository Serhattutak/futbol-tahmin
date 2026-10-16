"use strict";

const { NeonPredictionLedgerStore, stableEventId } = require("../services/neonPredictionLedgerStore");
const { AsyncPredictionLedger } = require("../services/asyncPredictionLedger");
const {
  fetchProductionEntries,
  entryToEvents,
  CONFIRMATION,
} = require("./rehearseProductionLedgerMigration");

const STAGING_BRANCH_ID = "br-spring-credit-b9fuwn5g";
const STAGING_HOST = "ep-steep-base-b9bhgl2c-pooler.c-7.eu-central-1.aws.neon.tech";
const SOURCE_URL = "https://zeus-one-betting-api.onrender.com";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function assertStagingTarget(connectionString = process.env.DATABASE_URL) {
  if (process.env.ZEUS_LEDGER_MODE !== "neon") throw new Error("STAGING_IMPORT_REQUIRES_NEON_MODE");
  if (process.env.ZEUS_LEDGER_STAGING_BRANCH_ID !== STAGING_BRANCH_ID) {
    throw new Error("STAGING_IMPORT_BRANCH_ID_MISMATCH");
  }
  if (process.env.ZEUS_LEDGER_STAGING_IMPORT_CONFIRMATION !== CONFIRMATION) {
    throw new Error("STAGING_IMPORT_CONFIRMATION_REQUIRED");
  }
  if (!connectionString) throw new Error("NEON_DATABASE_URL_REQUIRED");
  const parsed = new URL(connectionString);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("STAGING_IMPORT_INVALID_DATABASE_URL");
  }
  if (parsed.hostname !== STAGING_HOST) throw new Error("STAGING_IMPORT_REFUSES_NON_STAGING_HOST");
  return { branchId: STAGING_BRANCH_ID, host: STAGING_HOST };
}

async function importProductionLedgerToStaging({
  connectionString = process.env.DATABASE_URL,
  fetchImpl = fetch,
  createPool = value => {
    const { Pool } = require("pg");
    return new Pool({ connectionString: value, connectionTimeoutMillis: 10000, max: 2 });
  },
} = {}) {
  const target = assertStagingTarget(connectionString);
  const sourceUrl = process.env.ZEUS_LEDGER_SOURCE_API_URL || SOURCE_URL;
  // Require the source export to be stable across two read-only passes before any write.
  const sourceEntries = await fetchProductionEntries({ sourceUrl, fetchImpl });
  const secondSourceEntries = await fetchProductionEntries({ sourceUrl, fetchImpl });
  if (canonicalJson(sourceEntries) !== canonicalJson(secondSourceEntries)) {
    throw new Error("STAGING_IMPORT_SOURCE_CHANGED_DURING_PREFLIGHT");
  }
  const sourceEvents = sourceEntries.flatMap(entryToEvents);
  const sourceIds = sourceEvents.map(stableEventId);
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error("STAGING_IMPORT_DUPLICATE_SOURCE_EVENT_ID");

  const pool = await createPool(connectionString);
  let restorePool;
  try {
    const store = new NeonPredictionLedgerStore({ pool, table: "public.zeus_prediction_ledger_events" });
    await store.validateSchema();
    const currentEvents = await store.loadEvents();
    const expectedById = new Map(sourceEvents.map(event => [stableEventId(event), event]));
    const currentById = new Map(currentEvents.map(event => [stableEventId(event), event]));

    for (const [id, current] of currentById) {
      const expected = expectedById.get(id);
      if (!expected) throw new Error("STAGING_IMPORT_DESTINATION_ONLY_EVENT");
      if (canonicalJson(current) !== canonicalJson(expected)) {
        throw new Error("STAGING_IMPORT_EXISTING_EVENT_PAYLOAD_MISMATCH");
      }
    }

    let insertedEvents = 0;
    for (const event of sourceEvents) {
      const result = await store.append(event);
      if (result.saved) insertedEvents += 1;
    }

    restorePool = await createPool(connectionString);
    const restoredStore = new NeonPredictionLedgerStore({
      pool: restorePool,
      table: "public.zeus_prediction_ledger_events",
    });
    const ledger = new AsyncPredictionLedger({ store: restoredStore });
    await ledger.initialize();
    const restoredEvents = ledger.events();
    const restoredById = new Map(restoredEvents.map(event => [stableEventId(event), event]));
    if (restoredById.size !== expectedById.size) throw new Error("STAGING_IMPORT_RESTORED_EVENT_COUNT_MISMATCH");
    for (const [id, expected] of expectedById) {
      const actual = restoredById.get(id);
      if (!actual || canonicalJson(actual) !== canonicalJson(expected)) {
        throw new Error("STAGING_IMPORT_RESTORED_EVENT_MISMATCH");
      }
    }
    const restoredEntries = ledger.entries();
    if (restoredEntries.length !== sourceEntries.length) throw new Error("STAGING_IMPORT_RESTORED_PROJECTION_MISMATCH");
    for (const sourceEntry of sourceEntries) {
      const restored = restoredEntries.find(entry => entry.ledgerId === sourceEntry.ledgerId);
      if (!restored || restored.fixtureId !== sourceEntry.fixtureId ||
          restored.predictionCreatedAt !== sourceEntry.predictionCreatedAt ||
          (sourceEntry.resultStatus === "settled" && restored.resultStatus !== "settled")) {
        throw new Error("STAGING_IMPORT_RESTORED_ENTRY_MISMATCH");
      }
    }
    return {
      type: "LEDGER_STAGING_PRODUCTION_IMPORT_VERIFIED",
      source: "read-only production API",
      target: "dedicated Neon staging branch",
      branchId: target.branchId,
      sourceEntries: sourceEntries.length,
      sourceEvents: sourceEvents.length,
      insertedEvents,
      alreadyPresentEvents: sourceEvents.length - insertedEvents,
      restoredEventCount: restoredEvents.length,
      restoredEntryCount: restoredEntries.length,
      settledEntries: restoredEntries.filter(entry => entry.resultStatus === "settled").length,
      conflictEntries: restoredEntries.filter(entry => entry.conflicts?.length).length,
      productionModified: false,
      targetVerified: true,
    };
  } finally {
    try {
      if (restorePool) await restorePool.end();
    } finally {
      await pool.end();
    }
  }
}

module.exports = {
  importProductionLedgerToStaging,
  assertStagingTarget,
  canonicalJson,
  STAGING_BRANCH_ID,
  STAGING_HOST,
  CONFIRMATION,
};
