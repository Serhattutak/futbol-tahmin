const test = require("node:test");
const assert = require("node:assert/strict");
const { MultiProviderRegistry } = require("../services/multiProviderRegistry");
const { ProviderError } = require("../services/apiFootballClient");

function fixture(provider, kickoff = "2026-10-16T15:00:00Z") {
  return {
    provider,
    providerFixtureId: provider + "-fixture",
    providerFixtureIds: { [provider]: provider + "-fixture" },
    canonicalFixtureId: "fixture-home-away-league",
    kickoff,
    kickoffPrecision: "time",
    league: { name: "Test League", country: "Testland" },
    homeTeam: { canonicalTeamId: "team:home", name: "Home FC" },
    awayTeam: { canonicalTeamId: "team:away", name: "Away FC" },
    status: "SCHEDULED",
    result: null,
    sources: [provider],
    providerTeams: {},
    dataConflict: false,
  };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test("partial provider failure returns successful fixtures and preserves provider error evidence", async () => {
  const registry = new MultiProviderRegistry([
    { name: "primary", enabled: true, configured: true, getFixtures: async () => { throw new ProviderError("timeout_network", "simulated timeout"); } },
    { name: "fallback", enabled: true, configured: true, getFixtures: async () => [fixture("fallback")] },
  ]);
  const result = await registry.getFixturesByDate("2026-10-16");
  assert.equal(result.fixtures.length, 1);
  assert.equal(result.fixtures[0].provider, "fallback");
  assert.equal(result.stale, false);
  assert.ok(result.providerError.some(error => error.provider === "primary" && error.category === "timeout_network"));
  assert.ok(result.source.includes("fallback"));
});

test("all-provider failure does not fabricate fixtures and exposes categorized errors", async () => {
  const registry = new MultiProviderRegistry([
    { name: "timeout", enabled: true, configured: true, getFixtures: async () => { throw new ProviderError("timeout_network", "timeout"); } },
    { name: "quota", enabled: true, configured: true, getFixtures: async () => { throw new ProviderError("quota", "quota"); } },
  ]);
  const result = await registry.getFixturesByDate("2026-10-16");
  assert.deepEqual(result.fixtures, []);
  assert.equal(result.source, null);
  assert.ok(result.providerError.some(error => error.category === "timeout_network"));
  assert.ok(result.providerError.some(error => error.category === "quota"));
});

test("empty response is recorded as no_data, not as a successful fixture feed", async () => {
  const registry = new MultiProviderRegistry([
    { name: "empty", enabled: true, configured: true, getFixtures: async () => [] },
  ]);
  const result = await registry.getFixturesByDate("2026-10-16");
  assert.deepEqual(result.fixtures, []);
  assert.ok(result.providerError.some(error => error.provider === "empty" && error.category === "no_data"));
});

test("stale last-success cache is retained when refresh fails", async () => {
  let now = Date.parse("2026-10-15T12:00:00Z");
  let shouldFail = false;
  const registry = new MultiProviderRegistry([
    { name: "source", enabled: true, configured: true, getFixtures: async () => {
      if (shouldFail) throw new ProviderError("timeout_network", "simulated outage");
      return [fixture("source")];
    } },
  ], { now: () => now });
  const initial = await registry.getFixturesByDate("2026-10-16");
  assert.equal(initial.fixtures.length, 1);
  assert.equal(initial.stale, false);

  now += 6 * 60 * 1000;
  shouldFail = true;
  const immediate = await registry.getFixturesByDate("2026-10-16");
  assert.equal(immediate.fixtures.length, 1);
  assert.equal(immediate.stale, true);
  await tick();
  await tick();

  const retained = registry.fixtureDiscovery.snapshot("2026-10-16");
  assert.equal(retained.fixtures.length, 1);
  assert.equal(retained.stale, true);
  assert.ok(retained.providerError.some(error => error.category === "timeout_network"));
});

test("provider cooldown after quota prevents repeated upstream calls", async () => {
  let calls = 0;
  const registry = new MultiProviderRegistry([
    { name: "quota", enabled: true, configured: true, getFixtures: async () => {
      calls += 1;
      throw new ProviderError("quota", "simulated quota");
    } },
  ]);
  const first = await registry.getFixturesByDate("2026-10-16");
  assert.equal(first.fixtures.length, 0);
  // A separate date forces discovery while the provider's quota cooldown is active.
  const second = await registry.getFixturesByDate("2026-10-17");
  assert.equal(second.fixtures.length, 0);
  assert.equal(calls, 1);
  assert.ok(second.providerError.some(error => error.category === "quota"));
});
