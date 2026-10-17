const test = require("node:test");
const assert = require("node:assert/strict");
const { selectLocalDay, localDateKey, getLocalDayFixtures, similarTeam } = require("../services/localDayFixtures");

const match = (id, date, home, away, status = "SCHEDULED", goals = [null, null], provider = "espn") => ({
  provider, providers: [provider], fixture: { id, date, status: { short: status } },
  league: { name: "Test League" }, teams: { home: { name: home }, away: { name: away } }, goals: { home: goals[0], away: goals[1] },
});

test("local day uses Europe/Istanbul boundaries, not UTC or provider days", () => {
  assert.equal(localDateKey("2026-10-15T21:30:00.000Z"), "2026-10-16");
  assert.equal(localDateKey("2026-10-16T20:59:00.000Z"), "2026-10-16");
  assert.equal(localDateKey("2026-10-16T21:00:00.000Z"), "2026-10-17");
  const selected = selectLocalDay([
    match("late-previous-utc", "2026-10-15T21:30:00.000Z", "A", "B"),
    match("next-day-istanbul", "2026-10-17T00:30:00.000Z", "Boca Juniors", "Talleres"),
    match("same-day", "2026-10-16T18:00:00.000Z", "C", "D"),
  ], "2026-10-16");
  assert.deepEqual(selected.map(item => item.fixture.id), ["late-previous-utc", "same-day"]);
});

test("matches are ordered by kickoff time", () => {
  const selected = selectLocalDay([
    match("c", "2026-10-16T19:00:00.000Z", "E", "F"),
    match("a", "2026-10-16T09:00:00.000Z", "A", "B"),
    match("b", "2026-10-16T17:00:00.000Z", "C", "D"),
  ], "2026-10-16");
  assert.deepEqual(selected.map(item => item.fixture.id), ["a", "b", "c"]);
});

test("cross-provider duplicates collapse and keep the final score over a stale scheduled feed", () => {
  const selected = selectLocalDay([
    match("tsdb-1", "2026-10-16T17:30:00.000Z", "Rapid Wien", "TSV Hartberg", "SCHEDULED", [null, null], "thesportsdb"),
    match("espn-1", "2026-10-16T17:30:00.000Z", "Rapid Vienna", "TSV Hartberg", "FINISHED", [3, 1], "espn"),
    match("fd-2", "2026-10-16T18:30:00.000Z", "Eintracht Frankfurt", "1. FC Köln", "FINISHED", [1, 0], "football-data"),
    match("espn-2", "2026-10-16T18:30:00.000Z", "Eintracht Frankfurt", "FC Cologne", "FINISHED", [1, 0], "espn"),
  ], "2026-10-16");
  assert.equal(selected.length, 2);
  assert.equal(selected[0].fixture.status.short, "FINISHED");
  assert.deepEqual([selected[0].goals.home, selected[0].goals.away], [3, 1]);
  assert.deepEqual(selected[0].providers.sort(), ["espn", "thesportsdb"]);
  assert.equal(selected[1].dataConflict, false);
});

test("different fixtures between similar names are not merged", () => {
  assert.equal(similarTeam("Inter", "Internacional"), true); // containment alone is fuzzy...
  const selected = selectLocalDay([
    match("x", "2026-10-16T18:00:00.000Z", "Inter", "Milan"),
    match("y", "2026-10-16T18:00:00.000Z", "Internacional", "Gremio"), // ...so both teams must match
  ], "2026-10-16");
  assert.equal(selected.length, 2);
});

test("conflicting final scores are flagged instead of silently trusted", () => {
  const selected = selectLocalDay([
    match("a", "2026-10-16T18:00:00.000Z", "Alpha FC", "Beta FC", "FINISHED", [2, 1], "espn"),
    match("b", "2026-10-16T18:05:00.000Z", "Alpha", "Beta", "FINISHED", [1, 1], "thesportsdb"),
  ], "2026-10-16");
  assert.equal(selected.length, 1);
  assert.equal(selected[0].dataConflict, true);
});

test("getLocalDayFixtures reads the requested and previous provider day", async () => {
  const requested = [];
  const registry = { getFixturesByDate: async (date) => { requested.push(date); return { fixtures: date === "2026-10-15" ? [match("prev", "2026-10-15T22:00:00.000Z", "A", "B")] : [match("cur", "2026-10-16T12:00:00.000Z", "C", "D"), match("next", "2026-10-16T22:00:00.000Z", "E", "F")], source: "espn", cached: false, stale: false, providerError: null }; } };
  const result = await getLocalDayFixtures(registry, "2026-10-16", item => item);
  assert.deepEqual(requested.sort(), ["2026-10-15", "2026-10-16"]);
  assert.deepEqual(result.matches.map(item => item.fixture.id), ["prev", "cur"]);
});

test("live score and minute reach the frontend but never become a settled result", async () => {
  const { createLegacyAdapter, toFrontendFixture } = require("../services/multiProviderRegistry");
  const adapter = createLegacyAdapter({ name: "espn", getFixtures: async () => [{ fixture: { id: "espn-live", date: "2026-10-16T18:00:00.000Z", status: { short: "LIVE", elapsed: 67 } }, league: { name: "Test League" }, teams: { home: { name: "Alpha" }, away: { name: "Beta" } }, goals: { home: 2, away: 1 } }] });
  const [canonical] = await adapter.getFixtures("2026-10-16");
  assert.equal(canonical.result, null);
  const front = toFrontendFixture(canonical);
  assert.deepEqual(front.goals, { home: 2, away: 1 });
  assert.equal(front.fixture.status.elapsed, 67);
  assert.equal(front.fixture.status.short, "LIVE");
});
