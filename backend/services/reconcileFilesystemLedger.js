"use strict";

const { stableEventId } = require("./neonPredictionLedgerStore");

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => item === undefined ? "null" : canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareEventSets(sourceEvents, destinationEvents) {
  const sourceById = new Map();
  const destinationById = new Map();
  for (const event of sourceEvents) {
    const id = stableEventId(event);
    if (!sourceById.has(id)) sourceById.set(id, event);
    else if (event.type !== "conflict" && canonicalJson(sourceById.get(id)) !== canonicalJson(event)) {
      throw new Error("SOURCE_EVENT_ID_COLLISION");
    }
  }
  for (const event of destinationEvents) {
    const id = stableEventId(event);
    if (destinationById.has(id)) throw new Error("DUPLICATE_DESTINATION_EVENT_ID");
    destinationById.set(id, event);
  }
  const missingFromDestination = [...sourceById.keys()].filter(id => !destinationById.has(id)).sort();
  const destinationOnly = [...destinationById.keys()].filter(id => !sourceById.has(id)).sort();
  // Conflict identity intentionally represents distinct score outcomes, so
  // provider evidence ordering/metadata may differ without changing the event.
  const payloadMismatches = [...sourceById.entries()]
    .filter(([id, event]) => destinationById.has(id) && event.type !== "conflict" &&
      canonicalJson(event) !== canonicalJson(destinationById.get(id)))
    .map(([id]) => id)
    .sort();
  return {
    sourceEventCount: sourceById.size,
    destinationEventCount: destinationById.size,
    missingFromDestination,
    destinationOnly,
    payloadMismatches,
  };
}

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
  const comparison = compareEventSets([...sourceById.values()], destinationEvents);
  return {
    verified: comparison.missingFromDestination.length === 0 &&
      comparison.destinationOnly.length === 0 && comparison.payloadMismatches.length === 0,
    ...comparison,
    appended,
    alreadyPresent,
  };
}

module.exports = { reconcileFilesystemEvents, compareEventSets };
