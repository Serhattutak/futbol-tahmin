const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { normalizeStatus, normalizeKickoff } = require("../services/fixtureNormalization");
const { canonicalFixture, canonicalTeamId, reconcileFixtures, MultiProviderRegistry, createLegacyAdapter } = require("../services/multiProviderRegistry");
const { saveSnapshot, readArchive, settlePending, reconciledSettlement, summarizeArchive } = require("../services/historicalArchive");
const { ProviderError } = require("../services/apiFootballClient");

test.before(() => {
  const { providerRegistry } = require("../server");
  // Unit histories must never be read from or written to the live durable cache.
  providerRegistry.historicalData.file = undefined;
  providerRegistry.historicalData.cache.clear();
});

function fixture(provider = "sportmonks", id = "sm-1", home = "Manchester United", kickoff = "2026-09-20T18:00:00Z") {
  return canonicalFixture({ provider, fixture: { id, date: kickoff }, homeTeam: { id: "sm-team-10", name: home }, awayTeam: { id: "sm-team-20", name: "Fenerbahçe" }, league: { id: 1, name: "League", season: 2026 }, status: "NS" });
}
function isolated(code) {
  const result = spawnSync(process.execPath, ["-e", code], { cwd: path.join(__dirname, ".."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

test("dotenv initializes providers before their environment is captured", () => isolated(`
  const assert = require('node:assert/strict');
  delete process.env.SPORTMONKS_API_TOKEN; delete process.env.FOOTBALL_DATA_API_TOKEN;
  require('dotenv').config = () => { process.env.SPORTMONKS_API_TOKEN = 'test-only'; process.env.FOOTBALL_DATA_API_TOKEN = 'test-only'; };
  const { providerRegistry } = require('./server');
  assert.equal(providerRegistry.getStatus().find(p => p.name === 'sportmonks').configured, true);
  assert.equal(providerRegistry.getStatus().find(p => p.name === 'football-data').configured, true);
`));

test("Sportmonks accepts object, array and empty single fixture responses", () => isolated(`
  const assert = require('node:assert/strict');
  process.env.SPORTMONKS_API_TOKEN = 'test-only';
  const row = { id: 1, starting_at: '2026-09-20 18:00:00', state: { short_name: 'FT' }, participants: [{ id: 10, name: 'Home', meta: { location: 'home' } }, { id: 20, name: 'Away', meta: { location: 'away' } }] };
  let data = row;
  require('axios').create = () => ({ get: async () => ({ data: { data } }) });
  const provider = require('./providers/sportmonks');
  (async () => {
    assert.equal((await provider.getFixture('sm-1')).fixture.status.short, 'FINISHED');
    data = [row]; assert.equal((await provider.getFixture('sm-2')).fixture.date, '2026-09-20T18:00:00.000Z');
    data = null; assert.equal(await provider.getFixture('sm-3'), null);
    assert.equal(provider.toFixture(undefined), null);
    assert.equal(provider.toFixture({ ...row, starting_at: 'bad date' }), null);
  })().catch(() => process.exitCode = 1);
`));

test("canonical statuses and UTC kickoff never expose provider statuses", () => {
  for (const status of ["NS", "TIMED", "SCHEDULED"]) assert.equal(normalizeStatus(status), "SCHEDULED");
  for (const status of ["FT", "AET", "FT_PEN", "FINISHED"]) assert.equal(normalizeStatus(status), "FINISHED");
  assert.equal(normalizeStatus("INPLAY_1ST_HALF"), "LIVE");
  assert.equal(normalizeStatus("PST"), "POSTPONED");
  assert.equal(normalizeStatus("CANC"), "CANCELLED");
  assert.equal(normalizeStatus("unexpected"), "UNKNOWN");
  assert.equal(normalizeKickoff("2026-09-20 18:00:00"), "2026-09-20T18:00:00.000Z");
  assert.equal(fixture("openfootball", "of-1", "Home", "2026-09-20").kickoffPrecision, "date");
});

test("aliases and kickoff tolerance reconcile IDs without merging different leagues", () => {
  const primary = fixture(); const secondary = fixture("api-football", "123", "Man Utd", "2026-09-20T18:05:00Z");
  assert.equal(canonicalTeamId({ name: "Fenerbahçe" }), canonicalTeamId({ name: "Fenerbahce" }));
  const merged = reconcileFixtures([primary, secondary]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].providerFixtureIds, { sportmonks: "sm-1", "api-football": "123" });
  secondary.league.name = "Other league";
  assert.equal(reconcileFixtures([primary, secondary]).length, 2);
});

test("discovery stays cheap; selected fixture enrichment calls and caches secondary", async () => {
  let requests = 0;
  const registry = new MultiProviderRegistry([
    { name: "sportmonks", enabled: true, getFixtures: async () => [fixture()] },
    { name: "api-football", enabled: true, getFixtures: async () => { requests++; return [fixture("api-football", "123", "Man United")]; } },
  ]);
  const [primary] = await registry.getFixtures("2026-09-20");
  assert.equal(requests, 0);
  assert.equal((await registry.enrich(primary)).sources.length, 2);
  await registry.enrich(primary); assert.equal(requests, 1);
  assert.equal((await registry.getFixture("sm-1"))[0].providerFixtureIds["api-football"], "123");
});

test("provider capability fallback uses matched team IDs and excludes future form", async () => {
  const current = fixture(); const alternate = fixture("api-football", "123");
  alternate.providerTeams["api-football"].home.id = 10; alternate.providerTeams["api-football"].away.id = 20;
  const seen = [];
  const registry = new MultiProviderRegistry([
    { name: "sportmonks", enabled: true, capabilities: ["fixture"], getFixtures: async () => [current] },
    { name: "api-football", enabled: true, capabilities: ["teamForm"], getFixtures: async () => [alternate], getTeamForm: async (id) => {
      seen.push(id); return ["2026-09-01", "2027-01-01"].map((date) => ({ fixture: { id: date, date, status: { short: "FT" } }, league: { name: "League" }, teams: { home: { id: 10, name: "Man United" }, away: { id: 20, name: "Fenerbahce" } }, goals: { home: 2, away: 1 } }));
    } },
  ], { now: () => Date.parse("2026-09-16") });
  const data = await registry.collectAnalysis(current);
  assert.deepEqual(seen, [10, 20]); assert.equal(data.homeMatches.length, 1);
  assert.equal(data.homeMatches[0].teams.home.id, "team:manchesterunited");
  assert.equal(data.sourceMetadata.unavailable.oddsResponse, "not_supported");
});

function archiveInput() { return { predictionEligible: true, fixture: { id: "sm-1", canonicalFixtureId: "canonical-1", providerFixtureIds: { sportmonks: "sm-1", apiFootball: "123" }, sourceProviders: ["sportmonks", "api-football"], date: "2026-09-20T18:00:00Z", home: { name: "Home" }, away: { name: "Away" }, league: "League" }, model: { version: "4.0", confidence: 70 }, recommendation: { bestMarket: { market: "1", probability: 60 } }, markets: { "1": { probability: 60 } } }; }
function archivePath(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), "provider-flow-")); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return path.join(directory, "archive.json"); }

test("immutable snapshot preserves all source IDs and verified settlement counts", async (t) => {
  const filePath = archivePath(t); saveSnapshot(archiveInput(), { filePath }); const before = readArchive(filePath)[0].snapshot;
  assert.equal(before.providerFixtureIds["api-football"], "123"); assert.equal(before.sourceProviders.length, 2);
  await settlePending({ filePath, getResults: async (ids) => { assert.equal(ids.sportmonks, "sm-1"); return ["sportmonks", "api-football"].map((provider) => ({ provider, result: { status: "FINISHED", homeGoals: 2, awayGoals: 1 } })); } });
  assert.deepEqual(readArchive(filePath)[0].snapshot, before);
  assert.equal(summarizeArchive(readArchive(filePath)).verified, 1);
});

test("live scores cannot settle a match; differing completed scores conflict", () => {
  assert.equal(reconciledSettlement([{ provider: "sportmonks", result: { status: "LIVE", homeGoals: 2, awayGoals: 1 } }]), null);
  const results = [1, 2].map((awayGoals) => ({ result: { status: "FINISHED", homeGoals: 2, awayGoals } }));
  assert.equal(reconciledSettlement(results).resultVerificationStatus, "conflict");
  const duplicate = { provider: "sportmonks", result: { status: "FINISHED", homeGoals: 2, awayGoals: 1 } };
  assert.equal(reconciledSettlement([duplicate, duplicate]).resultVerificationStatus, "unverified");
});

test("secondary verification network errors preserve pending rather than settling prematurely", async () => {
  const first = { ...fixture(), status: "FINISHED", result: { homeGoals: 2, awayGoals: 1, status: "FINISHED" } };
  const registry = new MultiProviderRegistry([
    { name: "sportmonks", enabled: true, getFixture: async () => [first] },
    { name: "api-football", enabled: true, getFixtures: async () => { throw new ProviderError("timeout_network", "test"); } },
  ]);
  await assert.rejects(registry.getResults({ sportmonks: "sm-1" }), (error) => error.category === "timeout_network");
});

test("free provider caches expire and retry changed fixture results", () => isolated(`
  const assert = require('node:assert/strict');
  let now = Date.now(); Date.now = () => now; let requests = 0;
  require('axios').get = async () => { requests++; return { data: { events: [] } }; };
  const provider = require('./providers/theSportsDb');
  (async () => {
    await provider.getFixtures('2026-09-20'); await provider.getFixtures('2026-09-20');
    assert.equal(requests, 1); now += 6 * 60 * 1000;
    await provider.getFixtures('2026-09-20'); assert.equal(requests, 2);
  })().catch(() => process.exitCode = 1);
`));

test("best-predictions retains non-numeric discovery as explicit insufficient assessment", async () => {
  const { app, providerRegistry } = require("../server");
  const original = providerRegistry.providers;
  const current = fixture("sportmonks", "sm-endpoint-test");
  let oddsRequests = 0;
  providerRegistry.providers = [{ name: "sportmonks", enabled: true, capabilities: ["fixtures", "odds"], getFixtures: async () => [current], getOdds: async () => { oddsRequests++; return []; } }];
  const layer = app.router.stack.find((entry) => entry.route?.path === "/api/best-predictions");
  let body;
  try {
    await layer.route.stack.at(-1).handle({ query: { date: "2026-09-20" } }, { json(value) { body = value; return this; }, status() { return this; } });
    assert.equal(body.success, true); assert.equal(body.evaluated, 1);
    assert.equal(body.assessments[0].fixture.id, "sm-endpoint-test");
    assert.equal(body.assessments[0].recommendation.main, "NO_BET");
    assert.equal(oddsRequests, 0);
  } finally { providerRegistry.providers = original; providerRegistry.known.clear(); providerRegistry.cache.clear(); }
});

test("network/quota remain pending, unavailable retries, unsupported is terminal", async (t) => {
  for (const category of ["quota", "timeout_network", "unsupported"]) {
    const filePath = archivePath(t); saveSnapshot(archiveInput(), { filePath });
    await settlePending({ filePath, getResults: async () => { throw new ProviderError(category, "test"); } });
    assert.equal(readArchive(filePath)[0].result.status, category === "unsupported" ? "unavailable" : "pending");
    assert.equal(readArchive(filePath)[0].result.retryable, category !== "unsupported");
  }
  const filePath = archivePath(t); saveSnapshot(archiveInput(), { filePath });
  await settlePending({ filePath, getResults: async () => [], now: () => "2026-09-21T00:00:00Z" });
  await settlePending({ filePath, getResults: async () => [{ result: { status: "FINISHED", homeGoals: 1, awayGoals: 0 } }], now: () => "2026-09-21T01:00:00Z" });
  assert.equal(readArchive(filePath)[0].result.resultVerificationStatus, "unverified");
});

test("non-numeric fixture reaches actual Model 4.0 analysis; insufficient data returns NO_BET", async () => {
  const { analyzeFixture, providerRegistry } = require("../server");
  const original = providerRegistry.providers;
  const current = fixture("sportmonks", "sm-local-test", "Manchester United", "2026-01-20T18:00:00Z");
  const history = Array.from({ length: 10 }, (_, index) => ({ fixture: { id: `sm-history-${index}`, date: `2026-01-${String(index + 1).padStart(2, "0")}T18:00:00Z`, status: { short: "FINISHED" } }, teams: { home: { id: "sm-team-10", name: "Manchester United" }, away: { id: "sm-team-20", name: "Fenerbahce" } }, league: { name: "League" }, goals: { home: 2, away: 1 } }));
  providerRegistry.providers = [createLegacyAdapter({ name: "sportmonks", enabled: true, capabilities: ["fixture", "teamForm"], getFixture: async () => null, getFixtures: async () => [], getTeamForm: async () => history })];
  providerRegistry.remember(current);
  try {
    const analysis = await analyzeFixture("sm-local-test", { includeMatchStatistics: false });
    assert.equal(analysis.model.version, "4.0"); assert.equal(analysis.predictionEligible, true);
    assert.equal(analysis.fixture.providerFixtureIds.sportmonks, "sm-local-test");
    assert.ok(Number.isFinite(analysis.predictions.homeWin));
    providerRegistry.providers[0].getTeamForm = async () => [];
    providerRegistry.cache.clear();
    providerRegistry.historicalData.cache.clear();
    assert.equal((await analyzeFixture("sm-local-test")).prediction, "NO_BET");
  } finally { providerRegistry.providers = original; providerRegistry.known.clear(); providerRegistry.cache.clear(); }
});
