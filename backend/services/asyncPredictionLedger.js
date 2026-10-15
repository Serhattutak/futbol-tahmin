"use strict";

const { snapshot, evaluate } = require("./predictionLedger");
const { normalizeStatus } = require("./fixtureNormalization");
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
    this.runningSettlement = null;
    this.settlementCursor = 0;
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

  async settle(ledgerId, fixtures) {
    this.assertInitialized();
    const record = this.entries().find(row => row.ledgerId === ledgerId);
    if (!record) return { reason: "NOT_FOUND" };
    if (this.now() < Date.parse(record.kickoffTime)) return { reason: "NOT_STARTED" };
    const finals = (fixtures || []).filter(fixture =>
      fixture.provider &&
      record.providerFixtureIds?.[fixture.provider] != null &&
      fixture.providerFixtureId != null &&
      String(record.providerFixtureIds[fixture.provider]) === String(fixture.providerFixtureId) &&
      normalizeStatus(fixture.status) === "FINISHED" &&
      normalizeStatus(fixture.result?.status) === "FINISHED" &&
      Number.isInteger(fixture.result.homeGoals) && fixture.result.homeGoals >= 0 &&
      Number.isInteger(fixture.result.awayGoals) && fixture.result.awayGoals >= 0
    );
    if (!finals.length) return { reason: "NO_FINAL_RESULT" };
    const scores = [...new Set(finals.map(f => `${f.result.homeGoals}:${f.result.awayGoals}`))];
    const [home, away] = scores[0].split(":").map(Number);
    const evidence = finals.map(f => ({
      provider: f.provider,
      providerFixtureId: f.providerFixtureId,
      home: f.result.homeGoals,
      away: f.result.awayGoals,
    }));
    const scoreChanged = record.resultStatus &&
      (record.actualHomeGoals !== home || record.actualAwayGoals !== away);
    if (scores.length > 1 || finals.some(f => f.dataConflict) || scoreChanged) {
      await this.appendEvent({
        type: "conflict", ledgerId,
        detectedAt: new Date(this.now()).toISOString(),
        evidence,
      });
      return { reason: "RESULT_CONFLICT" };
    }
    const event = {
      type: "settlement",
      ledgerId,
      result: {
        ...evaluate(record, home, away, this.now()),
        resultProviders: evidence,
        resultVerification: new Set(finals.map(f => f.provider)).size > 1 ? "verified" : "single_provider",
      },
    };
    const saved = await this.appendEvent(event);
    if (saved.saved) return { saved: true, reason: null };
    const current = this.entries().find(row => row.ledgerId === ledgerId);
    if (current && (current.actualHomeGoals !== home || current.actualAwayGoals !== away)) {
      await this.appendEvent({
        type: "conflict", ledgerId,
        detectedAt: new Date(this.now()).toISOString(),
        evidence,
      });
      return { reason: "RESULT_CONFLICT" };
    }
    return { saved: false, reason: "ALREADY_SETTLED" };
  }

  async settleFromProviders(getResults, limit = 10) {
    this.assertInitialized();
    if (this.runningSettlement) return this.runningSettlement;
    this.runningSettlement = (async () => {
      const groups = new Map();
      for (const row of this.entries().filter(row => Date.parse(row.kickoffTime) <= this.now())) {
        groups.set(row.fixtureId, [...(groups.get(row.fixtureId) || []), row]);
      }
      const all = [...groups.values()];
      const results = [];
      const count = Math.min(Math.max(0, limit), all.length);
      for (let i = 0; i < count; i++) {
        const rows = all[(this.settlementCursor + i) % all.length];
        try {
          const fixtures = await getResults(rows[0].providerFixtureIds);
          for (const row of rows) results.push(await this.settle(row.ledgerId, fixtures));
        } catch (error) {
          results.push({ fixtureId: rows[0].fixtureId, reason: error.category || "PROVIDER_UNAVAILABLE" });
          if (error.category === "quota") break;
        }
      }
      this.settlementCursor = all.length ? (this.settlementCursor + count) % all.length : 0;
      return results;
    })().finally(() => { this.runningSettlement = null; });
    return this.runningSettlement;
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
