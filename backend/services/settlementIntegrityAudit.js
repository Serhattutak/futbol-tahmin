"use strict";

const { stableEventId } = require("./neonPredictionLedgerStore");

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Read-only structural audit for an event ledger. It does not mutate or repair
 * events and deliberately reports malformed evidence instead of guessing.
 */
function auditSettlementIntegrity(events) {
  const inputValid = Array.isArray(events);
  const rows = inputValid ? events : [];
  const eventIds = new Set();
  const predictionIds = new Set();
  const settlementIds = new Set();
  const conflictIds = new Set();
  const issues = [];
  let malformedEvents = 0;

  const addIssue = (code, ledgerId = null, index = null) => {
    issues.push({ code, ledgerId, index });
  };

  if (!inputValid) addIssue("EVENTS_NOT_ARRAY");

  rows.forEach((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      malformedEvents += 1;
      addIssue("EVENT_NOT_OBJECT", null, index);
      return;
    }
    if (!nonEmptyString(event.type) || !nonEmptyString(event.ledgerId)) {
      malformedEvents += 1;
      addIssue("EVENT_IDENTITY_MISSING", nonEmptyString(event.ledgerId) ? event.ledgerId : null, index);
      return;
    }
    let eventId;
    try {
      eventId = stableEventId(event);
    } catch {
      malformedEvents += 1;
      addIssue("EVENT_PAYLOAD_INVALID", event.ledgerId, index);
      return;
    }
    if (eventIds.has(eventId)) {
      addIssue("DUPLICATE_EVENT_ID", event.ledgerId, index);
    } else {
      eventIds.add(eventId);
    }

    if (event.type === "prediction") {
      if (predictionIds.has(event.ledgerId)) addIssue("DUPLICATE_PREDICTION", event.ledgerId, index);
      predictionIds.add(event.ledgerId);
    } else if (event.type === "settlement") {
      if (settlementIds.has(event.ledgerId)) addIssue("DUPLICATE_SETTLEMENT", event.ledgerId, index);
      settlementIds.add(event.ledgerId);
    } else if (event.type === "conflict") {
      conflictIds.add(event.ledgerId);
    } else {
      addIssue("UNKNOWN_EVENT_TYPE", event.ledgerId, index);
    }
  });

  for (const ledgerId of settlementIds) {
    if (!predictionIds.has(ledgerId)) addIssue("ORPHAN_SETTLEMENT", ledgerId);
  }
  for (const ledgerId of conflictIds) {
    if (!predictionIds.has(ledgerId)) addIssue("ORPHAN_CONFLICT", ledgerId);
  }

  const blockingIssues = issues.filter(issue => issue.code !== "UNKNOWN_EVENT_TYPE");
  return {
    status: blockingIssues.length === 0 ? "INTEGRITY_OK" : "INTEGRITY_BLOCKED",
    ready: blockingIssues.length === 0,
    counts: {
      eventCount: rows.length,
      uniqueEventIds: eventIds.size,
      predictionCount: predictionIds.size,
      settlementCount: settlementIds.size,
      conflictLedgerCount: conflictIds.size,
      malformedEvents,
    },
    issues,
    blockingReasons: [...new Set(blockingIssues.map(issue => issue.code))].sort(),
  };
}

module.exports = { auditSettlementIntegrity };
