const test = require("node:test");
const assert = require("node:assert/strict");
const { selectHistory, apiHistory } = require("../services/historicalForm");
const { teamKey } = require("../services/fixtureNormalization");
const { MultiProviderRegistry, canonicalFixture, createLegacyAdapter } = require("../services/multiProviderRegistry");
const team = { name: "Real Betis", id: 1 };
const before = "2026-09-17T17:00:00Z";
const row = (id, date = "2026-05-01", status = "FT", league = "La Liga") => ({ fixture: { id, date, status: { short: status } }, teams: { home: team, away: { id: 2, name: "Getafe CF" } }, league: { name: league }, goals: { home: 2, away: 1 } });
test("current season two plus previous eight yields ten without last parameter", async () => {
  const calls = [];
  const result = await apiHistory(async (_, params) => { calls.push(params); return params.season === 2026 ? [row(1), row(2)] : Array.from({ length: 8 }, (_, i) => row(i + 3)); }, 1, before, { team, season: 2026 });
  assert.equal(result.length, 10); assert.deepEqual(calls.map(c => c.season), [2026, 2025]); assert.ok(calls.every(c => !('last' in c) && c.status === "FT-AET-PEN"));
});
test("exclude future, current fixture, friendlies, live and duplicate results", () => {
  const rows = [row(1), row(1), row(2, "2027-01-01"), row(3, "2026-05-01", "LIVE"), row(4, "2026-05-01", "FT", "Friendlies Clubs"), row(5)];
  assert.deepEqual(selectHistory(rows, { team, before, fixtureId: 5 }).map(m => m.fixture.id), [1]);
});
test("API team history infers actual team identity and respects the requested cutoff", async () => {
  const matches = await apiHistory(async () => [row(1), row(2, "2027-01-01")], 1, before);
  assert.equal(matches.length, 1); assert.equal(matches[0].fixture.id, 1);
});
test("Unknown kickoff time cannot leak a same-day result into historical statistics", () => {
  const cutoff = "2026-09-17T12:00:00Z";
  const rows = [row(1, "2026-09-17"), row(2, "2026-09-16")];
  assert.deepEqual(selectHistory(rows, { team, before: cutoff, now: Date.parse("2026-09-18") }).map(m => m.fixture.id), [2]);
});
test("team suffix normalization and ambiguous IDs fail closed", () => {
  assert.equal(teamKey("  Getafe C.F. "), teamKey("Getafe"));
  assert.equal(teamKey("Fenerbahçe SK"), teamKey("Fenerbahce"));
  assert.equal(teamKey("Real Betis Balompié"), teamKey("Real Betis"));
  const other = row(2); other.teams = { ...other.teams, home: { id: 99, name: "Real Betis FC" } };
  assert.equal(selectHistory([row(1), other], { team, before }).length, 0);
});
test("historical fallback does not require secondary to list upcoming fixture", async () => {
  let secondaryCalls = 0;
  const fixture = canonicalFixture({ provider: "api-football", fixture: { id: 100, date: before }, homeTeam: team, awayTeam: { id: 2, name: "Getafe" }, league: { id: 140, name: "La Liga", season: 2026 }, status: "NS" });
  const registry = new MultiProviderRegistry([
    { name: "api-football", enabled: true, capabilities: ["historicalResults"], getTeamForm: async () => [] },
    createLegacyAdapter({ name: "openfootball", enabled: true, capabilities: ["teamForm", "historicalResults"], getTeamForm: async () => { secondaryCalls++; return Array.from({ length: 10 }, (_, i) => row(i + 1)); }, getFixtures: async () => { throw Error("Must not discover fixtures"); } }),
  ]);
  const history = await registry.getHistoricalForm(fixture, "home");
  assert.equal(history.matches.length, 10); assert.equal(history.provider, "openfootball"); assert.equal(secondaryCalls, 1);
});

