const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateTeamStatistics, buildMatchStatistics } = require("../services/teamStatistics");
const { HistoricalDataService } = require("../services/historicalForm");
const { canonicalFixture } = require("../services/multiProviderRegistry");
const before = "2026-09-12T12:00:00Z";
const now = Date.parse("2026-09-12T00:00:00Z");
const team = { id: "team:alpha", name: "Alpha" };
function match(day, home, gf, ga) {
  return { provider: "unit-test", fixture: { id: `history-${day}`, date: `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`, status: { short: "FINISHED" } },
    league: { name: "League" }, teams: { home: home ? team : { id: "team:beta", name: "Beta" }, away: home ? { id: "team:beta", name: "Beta" } : team },
    goals: { home: home ? gf : ga, away: home ? ga : gf } };
}
const history = [match(10, true, 2, 0), match(9, false, 1, 3), match(8, true, 1, 1), match(7, false, 2, 0), match(6, true, 0, 1)];
const stats = rows => calculateTeamStatistics(rows, team, before, { now });
test("W/D/L, GF/GA, PPG and venue splits are exact", () => {
  const s = stats(history); assert.equal(s.sampleSize, 5); assert.deepEqual(s.last5, ["W", "L", "D", "W", "L"]);
  assert.deepEqual([s.raw.wins, s.raw.draws, s.raw.losses], [2, 1, 2]); assert.equal(s.raw.pointsPerGame, 1.4);
  assert.equal(s.raw.goalsFor, 6); assert.equal(s.raw.goalsAgainst, 5); assert.equal(s.raw.goalsForPerMatch, 1.2);
  assert.deepEqual([s.raw.homeMatches, s.raw.homeWins, s.raw.homeDraws, s.raw.homeLosses], [3, 1, 1, 1]);
  assert.equal(s.raw.homeGoalsForPerMatch, 1); assert.equal(s.raw.awayGoalsForPerMatch, 1.5);
});
test("Over, BTTS, clean sheet and failed-to-score rates are observed fractions", () => {
  const s = stats(history).raw;
  assert.equal(s.over25Rate, .2); assert.equal(s.bttsRate, .4); assert.equal(s.cleanSheetRate, .4); assert.equal(s.failedToScoreRate, .2);
  assert.deepEqual([s.winRate, s.drawRate, s.lossRate], [.4, .2, .4]);
  assert.equal(s.winRate + s.drawRate + s.lossRate, 1);
  assert.equal(s.over25Rate + s.under25Rate, 1); assert.equal(s.bttsRate + s.bttsNoRate, 1);
  for (const mode of [stats(history).raw, stats(history).weighted]) for (const [key, value] of Object.entries(mode)) if (key.endsWith("Rate") && value !== null) assert.ok(value >= 0 && value <= 1, key);
});
test("Future, unfinished, incomplete and negative scores never enter history", () => {
  const future = match(13, true, 9, 9);
  const incomplete = { ...match(11, true, 1, 1), goals: { home: null, away: 1 } };
  const scheduled = { ...match(11, true, 1, 1), fixture: { ...match(11, true, 1, 1).fixture, status: { short: "SCHEDULED" } } };
  assert.equal(stats([...history, future, incomplete, scheduled, match(11, true, -1, 0)]).sampleSize, 5);
  assert.equal(stats([match(12, true, 3, 0)]).sampleSize, 0); // Before kickoff, but still future relative to now.
  assert.equal(calculateTeamStatistics([match(10, true, 2, 0)], team, "2026-09-10T10:00:00Z", { now }).sampleSize, 0);
});
test("Empty history stays null; half-time denominators use only observed complete scores", () => {
  const empty = stats([]); assert.equal(empty.raw.goalsForPerMatch, null); assert.equal(empty.raw.bttsRate, null); assert.equal(empty.raw.firstHalfGoalsFor, null);
  assert.equal(empty.raw.winRate, null); assert.equal(empty.weighted.lossRate, null);
  const rows = history.map((m, i) => ({ ...m, score: { halftime: i === 0 ? { home: 1, away: 0 } : { home: null, away: 0 } } }));
  const s = stats(rows); assert.equal(s.raw.firstHalfSample, 1); assert.equal(s.raw.firstHalfOver05Rate, 1); assert.equal(s.weighted.firstHalfOver05Rate, 1);
});
test("Recency weighting is deterministic, order-independent and retains raw statistics", () => {
  assert.deepEqual(stats(history), stats([...history].reverse())); assert.notEqual(stats(history).weighted.goalsForPerMatch, stats(history).raw.goalsForPerMatch);
});
const fixture = canonicalFixture({ provider: "unit-test", fixture: { id: "statistics-unit", date: before }, homeTeam: team, awayTeam: { id: "team:beta", name: "Beta" }, league: { id: 1, name: "League" }, status: "SCHEDULED" });
test("Match profile deduplicates real meetings; absent H2H is null", () => {
  const p = buildMatchStatistics(fixture, { homeMatches: history, awayMatches: history, now });
  assert.equal(p.h2h.sampleSize, 5); assert.equal(p.h2h.homeWins, 2); assert.equal(p.h2h.awayWins, 2);
  assert.equal(buildMatchStatistics(fixture, { now }).h2h, null);
  assert.equal(p.matchup.combinedBTTSRate >= 0 && p.matchup.combinedBTTSRate <= 1, true);
});
test("Historical service coalesces concurrent loads and isolates cutoffs", async () => {
  let calls = 0; const service = new HistoricalDataService(async () => { calls++; return { matches: history, provider: "unit-test", fixture }; }, { now: () => now });
  const options = { fixture, side: "home" };
  const results = await Promise.all([service.getTeamHistoricalMatches(team, before, options), service.getTeamHistoricalMatches(team, before, options)]);
  assert.equal(calls, 1); assert.equal(results[0].matches.length, 5);
  await service.getTeamHistoricalMatches(team, before, options); assert.equal(calls, 1);
  const early = await service.getTeamHistoricalMatches(team, "2026-09-08T00:00:00Z", options); assert.equal(early.matches.length, 2); assert.equal(calls, 2);
});
test("Historical cache retains completed results on outage and throttles retries", async () => {
  let clock = now; let calls = 0;
  const service = new HistoricalDataService(async () => { if (++calls > 1) throw Error("provider unavailable"); return { matches: history, provider: "unit-test", fixture }; }, { now: () => clock });
  const options = { fixture, side: "home" };
  await service.getTeamHistoricalMatches(team, before, options);
  clock += 7 * 60 * 60_000;
  const retained = await service.getTeamHistoricalMatches(team, before, options);
  assert.equal(retained.matches.length, 5); assert.equal(retained.stale, true);
  await service.getTeamHistoricalMatches(team, before, options); assert.equal(calls, 2);
});
test("Model 4.0 consumes profile: normalized finite probabilities, no fake xG/odds, insufficient sample NO_BET", async t => {
  const { providerRegistry, analyzeFixture } = require("../server");
  const originalGet = providerRegistry.getFixture; const originalCollect = providerRegistry.collectAnalysis;
  t.after(() => { providerRegistry.getFixture = originalGet; providerRegistry.collectAnalysis = originalCollect; });
  providerRegistry.getFixture = async () => [fixture];
  let rows = history;
  providerRegistry.collectAnalysis = async () => ({ fixture, homeMatches: rows, awayMatches: rows, h2hMatches: [], standingsResponse: [], oddsResponse: [], recentStats: [], sourceMetadata: { providers: ["unit-test"] } });
  const a = await analyzeFixture(fixture.providerFixtureId);
  assert.equal(a.model.version, "4.0"); assert.equal(a.statisticsProfile.home.sampleSize, 5);
  for (const value of Object.values(a.probabilities)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  assert.ok(Math.abs(a.probabilities.home + a.probabilities.draw + a.probabilities.away - 1) < 1e-10);
  for (const m of Object.values(a.markets)) { assert.ok(Number.isFinite(m.confidence)); assert.ok(Number.isFinite(m.dataQuality)); assert.equal(m.bookmakerOdds, null); assert.equal(m.value, null); }
  assert.equal(a.statistics.home.expectedGoals, null); assert.equal(a.dataAvailability.apiXg, false);
  rows = history.slice(0, 2); const insufficient = await analyzeFixture(fixture.providerFixtureId);
  assert.equal(insufficient.eligible, false); assert.equal(insufficient.prediction, "NO_BET"); assert.equal(insufficient.recommendation.main, "NO_BET"); assert.equal(insufficient.strongestPrediction, null);
});
