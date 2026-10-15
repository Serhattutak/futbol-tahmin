"use strict";

const { stableEventId } = require("./neonPredictionLedgerStore");

/**
 * Copy filesystem ledger events into an empty/preview Neon ledger without
 * deleting or mutating the source. Re-running after partial failure is safe
 * because the destination uses stable event IDs and idempotent inserts.
 *
 * This helper never switches an active store. Callers must inspect the
 * returned reconciliation report and separately approve any cutover.
 */
async function reconcileFilesystemEvents({ sourceEvents, destinationStore } = {}) {
  if (!Array.isArray(sourceEvents)) throw new TypeError("SOURCE_EVENTS_REQUIRED");
  if (!destinationStore || typeof destinationStore.append !== "function" ||
      typeof destinationStore.loadEvents !== "function") {
    throw new TypeError("DESTINATION_STORE_REQUIRED");
  }

  const sourceById = new Map();
  for (const event of sourceEvents) {
    const id = stableEventId(event);
    if (sourceById.has(id)) {
      // Equivalent conflict observations can share an identity by design;
      // duplicate non-conflict events in the source indicate corruption.
      const previous = sourceById.get(id);
      if (event.type !== "conflict" && JSON.stringify(previous) !== JSON.stringify(event)) {
        throw new Error("SOURCE_EVENT_ID_COLLISION");
      }
      continue;
    }
    sourceById.set(id, event);
  }

  let appended = 0;
  let alreadyPresent = 0;
  for (const [id, event] of sourceById) {
    const result = await destinationStore.append(event);
    if (result.saved) appended++;
    else alreadyPresent++;
    if (result.eventId && result.eventId !== id) throw new Error("DESTINATION_EVENT_ID_MISMATCH");
  }

  const destinationEvents = await destinationStore.loadEvents();
  const destinationById = new Map();
  for (const event of destinationEvents) {
    const id = stableEventId(event);
    if (destinationById.has(id)) throw new Error("DUPLICATE_DESTINATION_EVENT_ID");
    destinationById.set(id, event);
  }

  const missingFromDestination = [...sourceById.keys()].filter(id => !destinationById.has(id)).sort();
  const destinationOnly = [...destinationById.keys()].filter(id => !sourceById.has(id)).sort();
  return {
    verified: missingFromDestination.length === 0 && destinationOnly.length === 0,
    sourceEventCount: sourceById.size,
    destinationEventCount: destinationById.size,
    appended,
    alreadyPresent,
    missingFromDestination,
    destinationOnly,
  };
}

module.exports = { reconcileFilesystemEvents };
