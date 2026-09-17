const test = require("node:test");
const assert = require("node:assert/strict");
const { collectDivisionHistory, mergeHistory, localDatasets, VERSION, provenance } = require("../services/divisionHistory");
const { HistoryCacheV2 } = require("../services/historyCacheV2");
const of = require("../providers/openFootball");
const datasets = localDatasets();
const before = "2026-09-17T19:30:00Z";
const now = Date.parse("2026-09-17T16:44:12.530Z");
const collect = (name, extra = {}) => collectDivisionHistory({ team: { name }, before, now, league: { name: "La Liga", country: "Spain" }, catalog: of.historicalLeagues, datasets, ...extra });

test("Promoted Malaga: four current results completed by six real Segunda results", async () => {
  let calls = 0;
  const rows = await collect("Malaga", { load: async () => { calls++; throw Error("Local history must win"); } });
  assert.equal(rows.length, 10);
  assert.equal(calls, 0);
  assert.equal(rows.filter(m => m.league.name === "La Liga").length, 4);
  assert.equal(rows.filter(m => m.league.name === "Segunda División").length, 6);
  assert.ok(rows.every(m => Date.parse(m.fixture.date) < now));
  assert.equal(provenance(rows, rows).historyStrategyVersion, VERSION);
});
test("Recorded source conflict is quarantined instead of creating a second meeting", async () => {
  const rows = await collect("Malaga");
  const conflict = structuredClone(rows[0]);
  conflict.provider = "api-football"; conflict.fixture.id = "conflicting-provider-envelope";
  // Deliberately invalid envelope tests rejection, never enters production data.
  conflict.fixture.date = new Date(Date.parse(conflict.fixture.date) + 3600_000).toISOString();
  const result = mergeHistory([...rows, conflict], { team: { name: "Malaga" }, before, now });
  assert.equal(result.length, 9); assert.ok(result.every(m => m.fixture.id !== rows[0].fixture.id));
});
test("Relegated Valladolid: actual first Segunda fixture finds previous La Liga history", async () => {
  const target = datasets.find(s => s.league === "Segunda División" && s.season === "2025-26").matches.find(m => [m.teams.home.name, m.teams.away.name].includes("Real Valladolid"));
  const rows = await collect("Real Valladolid", { before: target.fixture.date, fixtureId: target.fixture.id, league: target.league });
  assert.equal(rows.length, 10); assert.ok(rows.every(m => m.league.name === "La Liga" && Date.parse(m.fixture.date) < Date.parse(target.fixture.date)));
});
test("Same-division Villarreal completes last ten across previous season", async () => {
  const rows = await collect("Villarreal");
  assert.equal(rows.length, 10); assert.ok(rows.every(m => m.league.name === "La Liga"));
  assert.ok(rows.some(m => m.league.season === "2025-26"));
});
test("Ten current-season real results avoid previous-season/network lookup", async () => {
  let calls = 0;
  const rows = await collect("Villarreal", { before: "2026-05-01T00:00:00Z", load: async () => { calls++; throw Error("Unexpected lookup"); } });
  assert.equal(rows.length, 10); assert.equal(calls, 0); assert.ok(rows.every(m => m.league.season === "2025-26"));
});
test("Unknown team and wrong country never acquire another team's history", async () => {
  assert.equal((await collect("Unknown historical identity")).length, 0);
  assert.equal((await collect("Malaga", { league: { name: "La Liga", country: "Brazil" } })).length, 0);
});
test("Real target result, equal kickoff, later same-day and post-kickoff results excluded", async () => {
  const real = datasets.find(s => s.league === "La Liga" && s.season === "2026-27").matches.find(m => m.fixture.date.startsWith("2026-09-06") && m.teams.home.name.includes("Málaga"));
  const time = Date.parse(real.fixture.date);
  for (const cutoff of [new Date(time - 3600_000).toISOString(), real.fixture.date]) {
    const rows = await collect("Malaga", { before: cutoff, fixtureId: real.fixture.id });
    assert.ok(rows.every(m => Date.parse(m.fixture.date) < Date.parse(cutoff)));
    assert.ok(rows.every(m => m.fixture.id !== real.fixture.id));
  }
});
test("Provider duplicate uses deterministic source priority, preserves original scores", async () => {
  const rows = await collect("Malaga"), original = rows[0];
  // A duplicate envelope of a recorded result; no invented match or score.
  const duplicate = { ...structuredClone(original), provider: "api-football", fixture: { ...original.fixture, id: "provider-duplicate-envelope" } };
  const options = { team: { name: "Malaga" }, before, now };
  const merged = mergeHistory([duplicate, ...rows], options);
  assert.equal(merged.length, 10); assert.equal(merged[0].provider, "openfootball");
  assert.deepEqual(merged[0].goals, original.goals);
  assert.deepEqual(merged, mergeHistory([...rows, duplicate], options));
});
test("Ambiguous normalized identity fails closed across divisions", async () => {
  const rows = await collect("Malaga");
  const duplicate = structuredClone(rows[0]);
  for (const t of Object.values(duplicate.teams)) if (t.name.includes("Málaga")) t.id = "ambiguous-second-team";
  duplicate.fixture.id += "-ambiguous";
  assert.equal(mergeHistory([...rows, duplicate], { team: { name: "Malaga" }, before, now }).length, 0);
});
test("V2 cache coalesces, separates team/cutoff/version and does not read old keys", async () => {
  const rows = await collect("Malaga"); let calls = 0;
  const cache = new HistoryCacheV2(async () => { calls++; return { matches: rows, provider: "openfootball" }; }, { now: () => now });
  const fixture = { provider: "api-football", providerFixtureId: "1570390", league: { country: "Spain", name: "La Liga" } };
  const team = { name: "Malaga", provider: "api-football", providerTeamId: "535" };
  cache.cache.set(`malaga:Spain:La Liga:${before}`, { expiresAt: now + 999999, value: { matches: [] } });
  const results = await Promise.all([cache.getTeamHistoricalMatches(team, before, { fixture }), cache.getTeamHistoricalMatches(team, before, { fixture })]);
  assert.equal(calls, 1); assert.equal(results[0].matches.length, 10);
  await cache.getTeamHistoricalMatches(team, before, { fixture }); assert.equal(calls, 1);
  await cache.getTeamHistoricalMatches(team, "2026-09-01T00:00:00Z", { fixture }); assert.equal(calls, 2);
  assert.ok([...cache.cache.keys()].some(k => k.startsWith(`${VERSION}:sources-v1:api-football:535`)));
});
test("Historical Segunda capability is separate from capture fixture discovery", () => {
  assert.equal(of.supportsLeague("Segunda División"), false);
  assert.equal(of.supportsHistoricalLeague({ name: "Segunda División", country: "Spain" }), true);
  assert.equal(of.supportsHistoricalLeague({ name: "Segunda División", country: "Mexico" }), false);
});
