"use strict";

const { PredictionLedger } = require("../services/predictionLedger");
const { NeonPredictionLedgerStore } = require("../services/neonPredictionLedgerStore");
const { reconcileFilesystemEvents } = require("../services/reconcileFilesystemLedger");
const { stableEventId } = require("../services/neonPredictionLedgerStore");

const APPLY_FLAG = "--apply";
const APPLY_CONFIRMATION = "I_HAVE_VERIFIED_SOURCE_AND_TARGET";

function compareEventIds(sourceEvents, destinationEvents) {
  const sourceIds = new Set(sourceEvents.map(stableEventId));
  const destinationIds = new Set(destinationEvents.map(stableEventId));
  return {
    sourceEventCount: sourceIds.size,
    destinationEventCount: destinationIds.size,
    missingFromDestination: [...sourceIds].filter(id => !destinationIds.has(id)).sort(),
    destinationOnly: [...destinationIds].filter(id => !sourceIds.has(id)).sort(),
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && process.env.ZEUS_RECONCILE_CONFIRM !== APPLY_CONFIRMATION) {
    throw new Error("RECONCILIATION_CONFIRMATION_REQUIRED");
  }

  // Use the current filesystem source read-only. Never delete or mutate it.
  const sourceEvents = new PredictionLedger().events();
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const destinationStore = new NeonPredictionLedgerStore({ pool });
    await destinationStore.validateSchema();
    const before = await destinationStore.loadEvents();
    const initial = compareEventIds(sourceEvents, before);

    // Destination-only rows imply a different source/target history. Do not
    // merge them automatically; require manual investigation before applying.
    if (apply && initial.destinationOnly.length) {
      throw new Error("DESTINATION_HAS_UNEXPECTED_EVENTS");
    }

    if (!apply) {
      process.stdout.write(JSON.stringify({
        mode: "dry-run",
        source: "filesystem",
        destination: "neon",
        ...initial,
        wouldAppend: initial.missingFromDestination.length,
        safeToApply: initial.destinationOnly.length === 0,
      }, null, 2) + "\n");
      return;
    }

    const report = await reconcileFilesystemEvents({ sourceEvents, destinationStore });
    process.stdout.write(JSON.stringify({ mode: "apply", ...report }, null, 2) + "\n");
    if (!report.verified) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ type: "LEDGER_RECONCILIATION_FAILED", message: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { compareEventIds, main };
