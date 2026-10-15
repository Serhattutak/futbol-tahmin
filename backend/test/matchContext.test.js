const test = require("node:test");
const assert = require("node:assert/strict");

test("match-context route adapts canonical team identities for ESPN news", async () => {
  const { app, providerRegistry } = require("../server");
  const espn = require("../providers/espn");
  const originalGetFixture = providerRegistry.getFixture;
  const originalNews = espn.getNewsForFixture;
  let received;
  providerRegistry.getFixture = async () => [{
    canonicalFixtureId: "canonical-test",
    providerFixtureId: "espn-test",
    league: { name: "Premier League" },
    homeTeam: { name: "Arsenal" },
    awayTeam: { name: "Chelsea" },
  }];
  espn.getNewsForFixture = async fixture => {
    received = fixture;
    return { provider: "ESPN", available: true, articles: [] };
  };
  try {
    const layer = app.router.stack.find(entry => entry.route?.path === "/api/match-context/:fixtureId");
    assert.ok(layer, "route is registered");
    let body;
    await layer.route.stack.at(-1).handle({ params: { fixtureId: "espn-test" } }, {
      json(value) { body = value; return this; },
      status() { return this; },
    });
    assert.equal(body.success, true);
    assert.equal(received.teams.home.name, "Arsenal");
    assert.equal(received.teams.away.name, "Chelsea");
    assert.equal(body.context.provider, "ESPN");
  } finally {
    providerRegistry.getFixture = originalGetFixture;
    espn.getNewsForFixture = originalNews;
  }
});
