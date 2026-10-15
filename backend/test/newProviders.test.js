const assert = require("node:assert/strict");
const test = require("node:test");
const sportmonks = require("../providers/sportmonks");
const footballData = require("../providers/footballData");
const openFootball = require("../providers/openFootball");

test("Sportmonks fixture response canonical legacy formuna normalize edilir", () => {
  const fixture = sportmonks.toFixture({ id: 1, starting_at: "2026-09-20T18:00:00Z", state: { short_name: "NS" }, league: { id: 2, name: "League" }, season: { id: 3 }, participants: [{ id: 10, name: "Home", meta: { location: "home" } }, { id: 20, name: "Away", meta: { location: "away" } }] });
  assert.equal(fixture.fixture.id, "sm-1"); assert.equal(fixture.teams.home.name, "Home"); assert.equal(fixture.goals.home, null);
});

test("football-data fixture response canonical legacy formuna normalize edilir", () => {
  const fixture = footballData.toFixture({ id: 1, utcDate: "2026-09-20T18:00:00Z", status: "SCHEDULED", competition: { id: 2, name: "League" }, season: { id: 3 }, homeTeam: { id: 10, name: "Home" }, awayTeam: { id: 20, name: "Away" }, score: { fullTime: { home: null, away: null } } });
  assert.equal(fixture.fixture.id, "fd-1"); assert.equal(fixture.teams.away.name, "Away"); assert.equal(fixture.goals.away, null);
});

test("token gerektiren providerlar token yokken pasif kalir", () => { assert.equal(sportmonks.enabled, false); assert.equal(footballData.enabled, false); });
test("OpenFootball historical lookup covers additional public-domain league datasets", () => {
  for (const league of [
    { name: "League One", country: "England" },
    { name: "2. Bundesliga", country: "Germany" },
    { name: "Serie B", country: "Italy" },
    { name: "Ligue 2", country: "France" },
    { name: "Süper Lig", country: "Turkey" },
    { name: "Pro League", country: "Belgium" },
  ]) assert.equal(openFootball.supportsHistoricalLeague(league), true, league.name);
});

test("OpenFootball date filtering uses Turkey local calendar date for timed kickoffs", () => {
  assert.equal(openFootball.turkeyDate("2026-10-14T21:30:00.000Z"), "2026-10-15");
});
