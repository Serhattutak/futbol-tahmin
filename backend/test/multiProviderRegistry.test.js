const assert = require("node:assert/strict");
const test = require("node:test");
const { ProviderError } = require("../services/apiFootballClient");
const { MultiProviderRegistry, canonicalTeamId, numericAgreement, reconcileFixtures, reconcileResults } = require("../services/multiProviderRegistry");
const fixture = (provider, kickoff = "2026-09-16T12:00:00Z", homeGoals = null, awayGoals = null) => ({ provider, providerFixtureId: provider, canonicalFixtureId: `${kickoff}:team:home:team:away:league`, league: { name: "League" }, season: 2026, kickoff, homeTeam: { canonicalTeamId: "team:home", name: "Home" }, awayTeam: { canonicalTeamId: "team:away", name: "Away" }, status: "FT", result: Number.isFinite(homeGoals) ? { homeGoals, awayGoals } : null, sources: [provider], dataConflict: false });
test("fixture discovery tum uygun providerlari birlestirir ve cache tekrar cagirmaz", async () => { let first = 0; let second = 0; const registry = new MultiProviderRegistry([{ name: "a", enabled: true, getFixtures: async () => { first += 1; return [fixture("a")]; } }, { name: "b", enabled: true, getFixtures: async () => { second += 1; return [fixture("b")]; } }]); await registry.getFixtures("2026-09-16"); await registry.getFixtures("2026-09-16"); assert.equal(first, 1); assert.equal(second, 1); });
test("hata veya quota sonrasi fallback provider kullanilir", async () => { const fallback = { name: "b", enabled: true, getFixtures: async () => [fixture("b")] }; for (const error of [new ProviderError("timeout_network", "timeout"), new ProviderError("quota", "quota")]) { const registry = new MultiProviderRegistry([{ name: "a", enabled: true, getFixtures: async () => { throw error; } }, fallback]); assert.equal((await registry.getFixtures("2026-09-16"))[0].provider, "b"); } });
test("ayni fixture tek canonical fixture olur, farkli kickoff conflict olur", () => { assert.equal(reconcileFixtures([fixture("a"), fixture("b")]).length, 1); const conflicts = reconcileFixtures([fixture("a"), fixture("b", "2026-09-16T13:00:00Z")]); assert.ok(conflicts.every((item) => item.dataConflict)); });
test("sonuc uzlasmasi verified veya conflict doner", () => { assert.equal(reconcileResults([{ homeGoals: 2, awayGoals: 1 }, { homeGoals: 2, awayGoals: 1 }]).resultVerificationStatus, "verified"); assert.equal(reconcileResults([{ homeGoals: 2, awayGoals: 1 }, { homeGoals: 1, awayGoals: 1 }]).resultVerificationStatus, "conflict"); });
test("provider team idleri stable canonical team kimligine baglanir", () => { assert.equal(canonicalTeamId({ name: "Team Name", id: 1 }), canonicalTeamId({ name: "Team Name", id: 2 })); });
test("source agreement sadece mevcut sayisal kaynaklari uzlastirir", () => { assert.equal(numericAgreement([1.42, 1.39]).status, "high"); assert.equal(numericAgreement([1.42, 2.31]).conflict, true); assert.equal(numericAgreement([]).value, null); });
test("sonuc kaynaklari quota ile bitince hata saklanmaz", async () => { const registry = new MultiProviderRegistry([{ name: "a", enabled: true, getFixture: async () => { throw new ProviderError("quota", "quota"); } }]); await assert.rejects(registry.getResults({ a: "fixture-1" }), (error) => error.category === "quota"); });
test("quota yaniti sonrasi ayni provider cooldown suresinde tekrar cagrilmaz", async () => { let calls = 0; const registry = new MultiProviderRegistry([{ name: "a", enabled: true, getFixture: async () => { calls++; throw new ProviderError("quota", "quota"); } }]); await assert.rejects(registry.getResults({ a: "fixture-1" }), (error) => error.category === "quota"); await assert.rejects(registry.getResults({ a: "fixture-1" }), (error) => error.category === "quota"); assert.equal(calls, 1); });
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
