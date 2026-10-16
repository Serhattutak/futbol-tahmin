"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchProductionEntries, entryToEvents } = require("./rehearseProductionLedgerMigration");

test("production export is read-only, paginated, and requires a stable complete result", async () => {
  const calls = [];
  const pages = [
    { success: true, total: 2, limit: 100, offset: 0, entries: [
      { ledgerId: "l1", fixtureId: "f1", predictionCreatedAt: "2026-10-15T10:00:00.000Z" },
      { ledgerId: "l2", fixtureId: "f2", predictionCreatedAt: "2026-10-15T11:00:00.000Z" },
    ] },
  ];
  const result = await fetchProductionEntries({
    sourceUrl: "https://zeus-one-betting-api.onrender.com",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, json: async () => pages.shift() };
    },
  });
  assert.equal(result.length, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.accept, "application/json");
  assert.equal(calls[0].options.method, undefined);
});

test("production export rejects non-production sources, duplicate IDs, and incomplete pages", async () => {
  await assert.rejects(
    fetchProductionEntries({ sourceUrl: "https://example.com", fetchImpl: async () => { throw new Error("must not fetch"); } }),
    /MIGRATION_REHEARSAL_SOURCE_NOT_PRODUCTION_API/
  );
  await assert.rejects(fetchProductionEntries({
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, total: 2, entries: [
      { ledgerId: "l1", fixtureId: "f1", predictionCreatedAt: "2026-10-15T10:00:00.000Z" },
      { ledgerId: "l1", fixtureId: "f2", predictionCreatedAt: "2026-10-15T11:00:00.000Z" },
    ] }) }),
  }), /PRODUCTION_LEDGER_DUPLICATE_LEDGER_ID/);
  await assert.rejects(fetchProductionEntries({
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, total: 2, entries: [
      { ledgerId: "l1", fixtureId: "f1", predictionCreatedAt: "2026-10-15T10:00:00.000Z" },
    ] }) }),
  }), /PRODUCTION_LEDGER_EXPORT_INCOMPLETE/);
});

test("flattened production entries reconstruct prediction, settlement and conflict events", () => {
  const entry = {
    ledgerId: "ledger-1", fixtureId: "fixture-1", predictionCreatedAt: "2026-10-15T10:00:00.000Z",
    homeProbability: 0.5, drawProbability: 0.25, awayProbability: 0.25,
    resultStatus: "settled", actualHomeGoals: 2, actualAwayGoals: 1, actual1X2: "home",
    settledAt: "2026-10-15T12:00:00.000Z", resultProviders: [{ provider: "espn", home: 2, away: 1 }],
    resultVerification: "single_provider",
    conflicts: [{ type: "conflict", ledgerId: "ledger-1", detectedAt: "2026-10-15T12:01:00.000Z", evidence: [{ provider: "espn", home: 2, away: 1 }, { provider: "thesportsdb", home: 1, away: 1 }] }],
  };
  const events = entryToEvents(entry);
  assert.deepEqual(events.map(e => e.type), ["prediction", "settlement", "conflict"]);
  assert.equal(events[0].snapshot.resultStatus, null);
  assert.equal(events[1].result.actualHomeGoals, 2);
  assert.equal(events[1].result.resultVerification, "single_provider");
  assert.equal(events[2].evidence.length, 2);
});
