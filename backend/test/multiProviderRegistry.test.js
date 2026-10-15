const assert = require("node:assert/strict");
const test = require("node:test");
const { ProviderError } = require("../services/apiFootballClient");
const { MultiProviderRegistry, canonicalTeamId, numericAgreement, reconcileFixtures, reconcileResults } = require("../services/multiProviderRegistry");
const fixture = (provider, kickoff = "2026-09-16T12:00:00Z", homeGoals = null, awayGoals = null) => ({ provider, providerFixtureId: provider, canonicalFixtureId: `${kickoff}:team:home:team:away:league`, league: { name: "League" }, season: 2026, kickoff, homeTeam: { canonicalTeamId: "team:home", name: "Home" }, awayTeam: { canonicalTeamId: "team:away", name: "Away" }, status: "FT", result: Number.isFinite(homeGoals) ? { homeGoals, awayGoals } : null, sources: [provider], dataConflict: false });
test("fixture discovery tum uygun providerlari birlestirir ve cache tekrar cagirmaz", async () => { let first = 0; let second = 0; const registry = new MultiProviderRegistry([{ name: "a", enabled: true, getFixtures: async () => { first += 1; return [fixture("a")]; } }, { name: "b", enabled: true, getFixtures: async () => { second += 1; return [fixture("b")]; } }]); await registry.getFixtures("2026-09-16"); await registry.getFixtures("2026-09-16"); assert.equal(first, 1); assert.equal(second, 1); });
test("hata veya quota sonrasi fallback provider kullanilir", async () => { const fallback = { name: "b", enabled: true, getFixtures: async () => [fixture("b")] }; for (const error of [new ProviderError("timeout_network", "timeout"), new ProviderError("quota", "quota")]) { const registry = new MultiProviderRegistry([{ name: "a", enabled: true, getFixtures: async () => { throw error; } }, fallback]); assert.equal((await registry.getFixtures("2026-09-16"))[0].provider, "b"); } });
test("ayni fixture tek canonical fixture olur, farkli kickoff conflict olur", () => { assert.equal(reconcileFixtures([fixture("a"), fixture("b")]).length, 1); const conflicts = reconcileFixtures([fixture("a"), fixture("b", "2026-09-16T13:00:00Z")]); assert.ok(conflicts.every((item) => item.dataConflict)); });
test("same-day cross-provider duplicates collapse and conflicting scores are hidden", () => {
  const first = { ...fixture("openfootball", "2026-09-16T12:00:00Z", 2, 1), kickoffPrecision: "time", providerFixtureIds: { openfootball: "of-1" } };
  const second = { ...fixture("espn", "2026-09-16T13:00:00Z", 1, 0), kickoffPrecision: "time", providerFixtureIds: { espn: "espn-1" } };
  const rows = reconcileFixtures([first, second]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dataConflict, true);
  assert.equal(rows[0].result, null);
  assert.equal(rows[0].status, "UNKNOWN");
  assert.deepEqual(rows[0].sources, ["openfootball", "espn"]);
});

test("sonuc uzlasmasi verified veya conflict doner", () => { assert.equal(reconcileResults([{ homeGoals: 2, awayGoals: 1 }, { homeGoals: 2, awayGoals: 1 }]).resultVerificationStatus, "verified"); assert.equal(reconcileResults([{ homeGoals: 2, awayGoals: 1 }, { homeGoals: 1, awayGoals: 1 }]).resultVerificationStatus, "conflict"); });
test("provider team idleri stable canonical team kimligine baglanir", () => { assert.equal(canonicalTeamId({ name: "Team Name", id: 1 }), canonicalTeamId({ name: "Team Name", id: 2 })); });
test("bilinen Ispanyol takim adi varyantlari ayni canonical takima eslenir", () => {
  assert.equal(canonicalTeamId({ name: "Albacete Balompié" }), canonicalTeamId({ name: "Albacete" }));
  assert.equal(canonicalTeamId({ name: "AD Ceuta FC" }), canonicalTeamId({ name: "Ceuta" }));
  assert.equal(canonicalTeamId({ name: "Real Sporting de Gijón" }), canonicalTeamId({ name: "Sporting Gijón" }));
});
test("date-only fixture and timed fixture merge into one row and retain exact kickoff", () => {
  const dateOnly = { ...fixture("openfootball", "2025-10-12T00:00:00Z"), kickoffPrecision: "date", league: { name: "Segunda División", country: "Spain" }, homeTeam: { canonicalTeamId: "team:burgos", name: "Burgos CF" }, awayTeam: { canonicalTeamId: "team:valladolid", name: "Real Valladolid" }, providerFixtureIds: { openfootball: "of-match" } };
  const timed = { ...fixture("espn", "2025-10-12T15:00:00Z"), kickoffPrecision: "time", league: { name: "Segunda División", country: "Spain" }, homeTeam: { canonicalTeamId: "team:burgos2", name: "Burgos" }, awayTeam: { canonicalTeamId: "team:valladolid2", name: "Real Valladolid CF" }, providerFixtureIds: { espn: "espn-match" } };
  const merged = reconcileFixtures([dateOnly, timed]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].kickoffPrecision, "time");
  assert.equal(merged[0].kickoff, "2025-10-12T15:00:00Z");
  assert.deepEqual(merged[0].sources, ["openfootball", "espn"]);
});

test("source agreement sadece mevcut sayisal kaynaklari uzlastirir", () => { assert.equal(numericAgreement([1.42, 1.39]).status, "high"); assert.equal(numericAgreement([1.42, 2.31]).conflict, true); assert.equal(numericAgreement([]).value, null); });
test("sonuc kaynaklari quota ile bitince hata saklanmaz", async () => { const registry = new MultiProviderRegistry([{ name: "a", enabled: true, getFixture: async () => { throw new ProviderError("quota", "quota"); } }]); await assert.rejects(registry.getResults({ a: "fixture-1" }), (error) => error.category === "quota"); });
test("quota yaniti sonrasi ayni provider cooldown suresinde tekrar cagrilmaz", async () => { let calls = 0; const registry = new MultiProviderRegistry([{ name: "a", enabled: true, getFixture: async () => { calls++; throw new ProviderError("quota", "quota"); } }]); await assert.rejects(registry.getResults({ a: "fixture-1" }), (error) => error.category === "quota"); await assert.rejects(registry.getResults({ a: "fixture-1" }), (error) => error.category === "quota"); assert.equal(calls, 1); });
test("bir provider kotaya takilsa da diger kaynagin dogrulanmis sonucu korunur", async () => { const registry = new MultiProviderRegistry([{ name: "a", enabled: true, getFixture: async () => { throw new ProviderError("quota", "quota"); } }, { name: "b", enabled: true, getFixture: async () => [{ ...fixture("b", "2026-09-16T12:00:00Z", 2, 1), providerFixtureIds: { b: "b-id" } }] }]); const results = await registry.getResults({ a: "a-id", b: "b-id" }); assert.equal(results.length, 1); assert.equal(results[0].result.homeGoals, 2); });
test("capability secimi yalnizca etkin ve uygun provideri dondurur", () => { const registry = new MultiProviderRegistry([{ name: "primary", enabled: true, capabilities: ["fixtures"] }, { name: "secondary", enabled: true, capabilities: ["odds"] }]); assert.equal(registry.getBestAvailableProvider("odds").name, "secondary"); assert.equal(registry.getBestAvailableProvider("xg"), null); });

test("historical collection explains providers that are absent or do not support history", async () => {
  const registry = new MultiProviderRegistry([{ name: "openfootball", enabled: true, capabilities: ["fixtures"] }]);
  const result = await registry.loadHistoricalForm(fixture("origin"), "home");
  const byProvider = Object.fromEntries(result.historyAttempts.map((attempt) => [attempt.provider, attempt.outcome]));
  assert.equal(byProvider.openfootball, "history_not_supported");
  assert.equal(byProvider.sportmonks, "not_installed");
  assert.equal(byProvider["football-data"], "not_installed");
  assert.equal(byProvider.espn, "not_installed");
});

test("historical H2H and standings can use league history without a live provider fixture match", async () => {
  const calls = [];
  const provider = {
    name: "openfootball", enabled: true, capabilities: ["h2h", "standings"],
    supportsLeague: () => false,
    supportsHistoricalLeague: (league) => league?.name === "League",
    getFixtures: async () => [],
    getH2H: async (_home, _away, context) => { calls.push(["h2h", context.home.name, context.away.name]); return [{ provider: "openfootball", fixture: { id: "old-1", date: "2026-08-01T12:00:00Z", status: { short: "FINISHED" } }, league: { name: "League", country: "Country" }, teams: { home: { id: "old-home", name: "Home" }, away: { id: "old-away", name: "Away" } }, goals: { home: 2, away: 1 } }]; },
    getStandings: async (_id, _season, context) => { calls.push(["standings", context.league.name]); return [{ league: { id: "league", name: "League", standings: [[{ team: { id: "old-home", name: "Home" }, rank: 1, points: 3 }]] } }]; },
  };
  const registry = new MultiProviderRegistry([provider]);
  registry.getHistoricalForm = async (match, side) => ({ matches: Array.from({ length: 5 }, (_, i) => ({ provider: "openfootball", fixture: { id: `form-${side}-${i}`, date: `2026-08-${String(10 - i).padStart(2, "0")}T12:00:00Z`, status: { short: "FINISHED" } }, league: { name: "League", country: "Country" }, teams: { home: { id: "home", name: "Home" }, away: { id: "away", name: "Away" } }, goals: { home: 1, away: 0 } })), provider: "openfootball", fixture: match, historyAttempts: [] });
  const match = { ...fixture("origin"), league: { id: "league", name: "League", country: "Country" }, homeTeam: { canonicalTeamId: "team:home", providerTeamId: "home", name: "Home" }, awayTeam: { canonicalTeamId: "team:away", providerTeamId: "away", name: "Away" }, kickoff: "2026-09-16T12:00:00Z", sources: ["espn"], providerTeams: {} };
  const result = await registry.collectAnalysis(match);
  assert.deepEqual(calls.map((call) => call[0]), ["h2h", "standings"]);
  assert.equal(result.h2hMatches.length, 1);
  assert.equal(result.standingsResponse.length, 1);
});
