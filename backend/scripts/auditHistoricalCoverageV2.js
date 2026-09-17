// Offline, real-data replay. Only docs outputs are written; no live capture/API.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { collectDivisionHistory, VERSION, provenance } = require("../services/divisionHistory");
const { MultiProviderRegistry, createLegacyAdapter } = require("../services/multiProviderRegistry");
const { validateInputs, ProductionAnalysis } = require("../services/productionAnalysis");
const { loadArtifact } = require("../services/modelVersions");
const { ForwardCapture } = require("../services/forwardCapture");
const { PredictionLedger } = require("../services/predictionLedger");
const openFootball = require("../providers/openFootball");
const root = path.resolve(__dirname, "../..");
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), "utf8").replace(/^\uFEFF/, ""));
const write = (p, data) => fs.writeFileSync(path.join(root, p), JSON.stringify(data, null, 2));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, p))).digest("hex");
function protectedHashes() {
  const files = Object.keys(read("docs/historical-v2-integrity-before.json")).filter(f => !f.endsWith("fixture-cache.json"));
  const ledger = "backend/data/prediction-ledger";
  for (const f of fs.readdirSync(path.join(root, ledger))) if (fs.statSync(path.join(root, ledger, f)).isFile()) files.push(`${ledger}/${f}`);
  return Object.fromEntries([...new Set(files)].map(f => [f, sha(f)]));
}
async function main() {
  const before = protectedHashes();
  const baseline = read("docs/historical-coverage-audit.json");
  const now = Date.parse(baseline.cohortAsOf);
  const cached = new Map(read("backend/data/fixture-cache.json").flatMap(([, e]) => e.fixtures).map(f => [String(f.providerFixtureId), f]));
  const fixtures = baseline.fixtures.map(r => { const f = cached.get(r.fixtureId); assert.ok(f, r.fixtureId); assert.equal(f.kickoff, r.kickoff); return f; });
  assert.equal(fixtures.length, 253);
  // Uses the production registry/adapter/normalization/cache path, but injects
  // only the saved real bulk sources; no provider client can be called here.
  const registry = new MultiProviderRegistry([createLegacyAdapter({ ...openFootball,
    getTeamForm: async (_id, date, context) => collectDivisionHistory({ team: context.team, before: date, fixtureId: context.fixtureId, league: context.league, catalog: openFootball.historicalLeagues, now }),
  })], { now: () => now });
  const collected = new Map(), rows = [];
  const artifact = loadArtifact();
  let comparisons = 0;
  for (const fixture of fixtures) {
    const home = await registry.getHistoricalForm(fixture, "home"), away = await registry.getHistoricalForm(fixture, "away");
    const data = { fixture, homeMatches: home.matches, awayMatches: away.matches, h2hMatches: [], standingsResponse: [], oddsResponse: [], recentStats: [], sourceMetadata: { providers: [...new Set([...fixture.sources, ...home.matches.map(m => m.provider), ...away.matches.map(m => m.provider)])], fields: {}, unavailable: {}, history: provenance(home.matches, away.matches) } };
    collected.set(String(fixture.providerFixtureId), data);
    for (const m of [...home.matches, ...away.matches]) {
      const time = m.fixture.kickoffPrecision === "date" ? Date.parse(`${m.fixture.date.slice(0, 10)}T23:59:59.999Z`) : Date.parse(m.fixture.date);
      assert.ok(time < Math.min(now, Date.parse(fixture.kickoff))); comparisons++;
    }
    const readiness = validateInputs(data, artifact.artifact, now);
    const brief = m => ({ date: m.fixture.date, league: m.league.name, season: m.league.season, home: m.teams.home.name, away: m.teams.away.name, score: m.goals, source: m.provider, fixtureId: m.fixture.id });
    rows.push({ fixtureId: String(fixture.providerFixtureId), home: fixture.homeTeam.name, away: fixture.awayTeam.name, kickoff: fixture.kickoff, league: fixture.league,
      supportedLeague: openFootball.supportsHistoricalLeague(fixture.league), homeCount: home.matches.length, awayCount: away.matches.length,
      inputReady: readiness.ready, reason: readiness.reason, statisticsQuality: readiness.statisticsQuality,
      history: { home: home.matches.map(brief), away: away.matches.map(brief) }, provenance: data.sourceMetadata.history });
  }
  const distribution = { zero: 0, oneToFour: 0, fiveToNine: 0, ten: 0 };
  for (const r of rows) for (const count of [r.homeCount, r.awayCount]) distribution[count === 0 ? "zero" : count < 5 ? "oneToFour" : count < 10 ? "fiveToNine" : "ten"]++;
  const funnel = { windowFixtures: rows.length, supportedLeagueFixtures: rows.filter(r => r.supportedLeague).length,
    bothTeamsMapped: rows.filter(r => r.homeCount && r.awayCount).length, historyLookupPossible: rows.filter(r => r.homeCount && r.awayCount).length,
    minimumHistory: rows.filter(r => r.homeCount >= 5 && r.awayCount >= 5).length, productionInputReady: rows.filter(r => r.inputReady).length };
  // Finish the read-only coverage audit before running the isolated dry-run.
  assert.deepEqual(protectedHashes(), before);
  write("docs/historical-coverage-v2.json", { strategy: VERSION, cohortAsOf: baseline.cohortAsOf, cohortSource: baseline.cohortSource,
    mode: "OFFLINE_FROZEN_COHORT_REAL_DATA_REPLAY", providerNetworkCalls: 0, leakage: { comparisons, violations: 0 },
    oldFunnel: baseline.funnel, newFunnel: funnel, teamSampleDistribution: distribution,
    teamsAtLeastFiveSlots: distribution.fiveToNine + distribution.ten, fixturesAtLeastFiveBoth: funnel.minimumHistory,
    inputReadyIncrease: funnel.productionInputReady - baseline.funnel.productionInputReady,
    historicalLeagues: openFootball.historicalLeagues, fixtures: rows });

  const { analyzeCollectedFixture } = require("../server");
  const analysis = new ProductionAnalysis({ collect: async id => { assert.ok(collected.has(id)); return collected.get(id); }, calculate: analyzeCollectedFixture, now: () => now, file: null, logger: () => {} });
  const realLedger = new PredictionLedger();
  const capture = new ForwardCapture({
    discover: async date => ({ fixtures: fixtures.filter(f => f.kickoff.slice(0, 10) === date), stale: false, source: "frozen-real-fixture-cache" }),
    analysis, ledger: { entries: () => realLedger.entries(), recordResponse: () => { throw Error("Audit must never write ledger"); } },
    now: () => now, sleep: async () => {}, historicalCoverage: f => openFootball.supportsHistoricalLeague(f.league),
    config: { directory: path.join(root, "docs/historical-v2-dry-run-state") }, logger: () => {},
  });
  const dryRun = await capture.run({ dryRun: true });
  assert.equal(dryRun.errors, 0); assert.equal(dryRun.capturedPredictions, 0); assert.equal(dryRun.capturedFixtures, 0);
  assert.deepEqual(protectedHashes(), before);
  write("docs/historical-v2-forward-dry-run.json", { mode: "FROZEN_COHORT_REPLAY_NOT_LIVE_CAPTURE", providerNetworkCalls: 0, productionLedgerWrites: 0, ...dryRun });
  console.log(JSON.stringify({ oldFunnel: baseline.funnel, newFunnel: funnel, distribution, dryRun: { withinWindow: dryRun.withinWindowFixtures, analysed: dryRun.analysedFixtures, eligible: dryRun.eligibleFixtures, wouldCapturePredictions: dryRun.wouldCapturePredictions, errors: dryRun.errors }, ledgerUnchanged: true }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
