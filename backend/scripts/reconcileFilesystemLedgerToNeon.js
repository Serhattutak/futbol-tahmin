"use strict";

const { PredictionLedger } = require("../services/predictionLedger");
const { NeonPredictionLedgerStore } = require("../services/neonPredictionLedgerStore");
const { reconcileFilesystemEvents, compareEventSets } = require("../services/reconcileFilesystemLedger");
const { stableEventId } = require("../services/neonPredictionLedgerStore");
const { normalizePostgresConnectionString } = require("../services/postgresConnectionConfig");

const APPLY_FLAG = "--apply";
const APPLY_CONFIRMATION = "I_HAVE_VERIFIED_SOURCE_AND_TARGET";

function compareEventIds(sourceEvents, destinationEvents) {
  return compareEventSets(sourceEvents, destinationEvents);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.env.ZEUS_LEDGER_DIR?.trim()) throw new Error("ZEUS_LEDGER_DIR_REQUIRED_FOR_APPLY");
  if (apply && process.env.ZEUS_RECONCILE_CONFIRM !== APPLY_CONFIRMATION) {
    throw new Error("RECONCILIATION_CONFIRMATION_REQUIRED");
  }

  // Use the current filesystem source read-only. Never delete or mutate it.
  const sourceEvents = new PredictionLedger().events();
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: normalizePostgresConnectionString(process.env.DATABASE_URL) });
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
    if (apply && initial.payloadMismatches.length) {
      throw new Error("DESTINATION_PAYLOAD_MISMATCH");
    }

    if (!apply) {
      const report = {
        mode: "dry-run",
        source: "filesystem",
        destination: "neon",
        ...initial,
        wouldAppend: initial.missingFromDestination.length,
        sourceDirectoryConfigured: Boolean(process.env.ZEUS_LEDGER_DIR?.trim()),
        safeToApply: Boolean(process.env.ZEUS_LEDGER_DIR?.trim()) &&
          initial.destinationOnly.length === 0 && initial.payloadMismatches.length === 0,
      };
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      return report;
    }

    const report = await reconcileFilesystemEvents({ sourceEvents, destinationStore });
    process.stdout.write(JSON.stringify({ mode: "apply", ...report }, null, 2) + "\n");
    if (!report.verified) process.exitCode = 2;
    return { mode: "apply", ...report };
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
