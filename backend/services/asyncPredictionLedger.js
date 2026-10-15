"use strict";

const { snapshot, evaluate, MODELS } = require("./predictionLedger");
const { stableEventId } = require("./neonPredictionLedgerStore");

/**
 * Async event-ledger facade. This is deliberately not wired into server startup
 * yet: callers must await initialize() before serving requests or starting jobs.
 * The supplied store owns persistence; this class owns the validated projection.
 */
class AsyncPredictionLedger {
  constructor({ store, now = () => Date.now() } = {}) {
    if (!store || typeof store.loadEvents !== "function" || typeof store.append !== "function") {
      throw new TypeError("ASYNC_LEDGER_STORE_REQUIRED");
    }
    this.store = store;
    this.now = now;
    this.initialized = false;
    this.initializing = null;
    this.eventMap = new Map();
  }

  async initialize() {
    if (this.initialized) return this.status();
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      const events = await this.store.loadEvents();
      const next = new Map();
      for (const event of events) {
        const id = stableEventId(event);
        if (next.has(id)) throw new Error("DUPLICATE_LEDGER_EVENT_ID");
        next.set(id, event);
      }
      this.eventMap = next;
      this.initialized = true;
      return this.status();
    })();
    try {
      return await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  assertInitialized() {
    if (!this.initialized) throw new Error("ASYNC_LEDGER_NOT_INITIALIZED");
  }

  events() {
    this.assertInitialized();
    return [...this.eventMap.values()];
  }

  entries() {
    const events = this.events();
    const settlements = new Map(events.filter(e => e.type === "settlement").map(e => [e.ledgerId, e]));
    const conflicts = new Map();
    for (const event of events.filter(e => e.type === "conflict")) {
      conflicts.set(event.ledgerId, [...(conflicts.get(event.ledgerId) || []), event]);
    }
    return events
      .filter(e => e.type === "prediction")
      .map(e => ({
        ...e.snapshot,
        ...settlements.get(e.ledgerId)?.result,
        conflicts: conflicts.get(e.ledgerId) || [],
      }))
      .sort((a, b) => a.predictionCreatedAt.localeCompare(b.predictionCreatedAt) || a.ledgerId.localeCompare(b.ledgerId));
  }

  async appendEvent(event) {
    this.assertInitialized();
    const id = stableEventId(event);
    const result = await this.store.append(event);
    if (result.saved) {
      this.eventMap.set(id, event);
    } else {
      // Another process may have won the idempotency race. Refresh the cache so
      // subsequent reads never pretend a locally missing event does not exist.
      const events = await this.store.loadEvents();
      const next = new Map();
      for (const persisted of events) {
        const persistedId = stableEventId(persisted);
        if (next.has(persistedId)) throw new Error("DUPLICATE_LEDGER_EVENT_ID");
        next.set(persistedId, persisted);
      }
      this.eventMap = next;
    }
    return result;
  }

  async recordResponse(response, collected, { guard = () => null } = {}) {
    this.assertInitialized();
    const now = this.now();
    const results = [];
    for (const analysis of Object.values(response.models || {}).filter(Boolean)) {
      const reason = guard(collected?.fixture, now);
      if (reason) {
        results.push({ model: analysis.modelVersion, saved: false, reason });
        continue;
      }
      const built = snapshot(analysis, response, collected, now);
      if (!built.record) {
        results.push({ model: analysis.modelVersion, saved: false, reason: built.reason });
        continue;
      }
      const record = built.record;
      const saved = await this.appendEvent({ type: "prediction", ledgerId: record.ledgerId, snapshot: record });
      results.push({
        model: record.usedModel,
        ledgerId: record.ledgerId,
        saved: saved.saved,
        reason: saved.saved ? null : "DUPLICATE",
      });
    }
    return results;
  }

  status() {
    this.assertInitialized();
    const events = [...this.eventMap.values()];
    return {
      initialized: true,
      eventCount: events.length,
      predictionCount: events.filter(e => e.type === "prediction").length,
      settlementCount: events.filter(e => e.type === "settlement").length,
      conflictCount: events.filter(e => e.type === "conflict").length,
    };
  }
}

module.exports = { AsyncPredictionLedger };
