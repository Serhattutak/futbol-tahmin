const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zeus-settle-")), "predictions.json");
process.env.ZEUS_PREDICTION_STORE = store;
const { checkPendingPredictions, providerRegistry } = require("../server");
const unsupported = async () => { const error = new Error("No enabled result provider."); error.category = "unsupported"; throw error; };

function withDiscovery(fixtures, run) {
  const originalResults = providerRegistry.getResults;
  const originalDiscovery = providerRegistry.fixtureDiscovery;
  providerRegistry.getResults = unsupported;
  providerRegistry.fixtureDiscovery = { getFixturesByDate: async () => ({ fixtures, source: "espn", cached: false, stale: false, providerError: null }) };
  return run().finally(() => { providerRegistry.getResults = originalResults; providerRegistry.fixtureDiscovery = originalDiscovery; });
}
const canonical = (kickoff, status, result) => ({ provider: "espn", providerFixtureId: "espn-9", providerFixtureIds: { espn: "espn-9" }, canonicalFixtureId: "x", league: { name: "LaLiga", country: "Spain" }, kickoff, kickoffPrecision: "time", homeTeam: { canonicalTeamId: "realbetis", name: "Real Betis" }, awayTeam: { canonicalTeamId: "sevilla", name: "Sevilla FC" }, status, result, live: null, sources: ["espn"], dataConflict: false });

test("a removed provider's fixture id settles from the merged daily fixture list", async () => {
  const kickoff = "2026-09-17T17:00:00.000Z";
  fs.writeFileSync(store, JSON.stringify([{ fixtureId: "1570386", providerFixtureIds: { "api-football": "1570386" }, date: kickoff, homeTeam: "Real Betis", awayTeam: "Sevilla", market: "1", status: "pending" }]));
  await withDiscovery([canonical(kickoff, "FINISHED", { homeGoals: 2, awayGoals: 0, status: "FINISHED" })], () => checkPendingPredictions());
  const [record] = JSON.parse(fs.readFileSync(store, "utf8"));
  assert.equal(record.status, "won");
  assert.equal(record.result, "2-0");
  assert.match(record.resultSource, /^fixture-list:/);
});

test("an old record without any verifiable score is closed as unverifiable, never guessed", async () => {
  fs.writeFileSync(store, JSON.stringify([{ fixtureId: "1570384", providerFixtureIds: { "api-football": "1570384" }, date: "2026-09-16T17:00:00.000Z", homeTeam: "Atletico Madrid", awayTeam: "Getafe", market: "1", status: "pending" }]));
  await withDiscovery([], () => checkPendingPredictions());
  const [record] = JSON.parse(fs.readFileSync(store, "utf8"));
  assert.equal(record.status, "unverifiable");
  assert.equal(record.result, undefined);
});
