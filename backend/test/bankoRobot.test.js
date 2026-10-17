const test = require("node:test");
const assert = require("node:assert/strict");
const { BankoRobot, leagueState, predictMatch, toPick, seasonOf, scoreMarkets, vectorize } = require("../services/bankoRobot");
const model = require("../data/banko-model.json");

function season(teams, startDate, rounds, scoreFn) {
  const matches = []; let day = Date.parse(`${startDate}T12:00:00Z`);
  for (let r = 0; r < rounds; r += 1) {
    for (let i = 0; i < teams.length; i += 2) {
      const [home, away] = r % 2 ? [teams[i + 1], teams[i]] : [teams[i], teams[i + 1]];
      const [hg, ag] = scoreFn(home, away, r);
      matches.push({ date: new Date(day).toISOString().slice(0, 10), home, away, homeGoals: hg, awayGoals: ag, league: "Premier League" });
    }
    teams = [teams[0], ...teams.slice(2), teams[1]]; day += 7 * 86_400_000;
  }
  return matches;
}
const TEAMS = ["Strong FC", "Weak United", "Mid Town", "Other City", "Fourth Rovers", "Fifth Albion"];
const strongWins = (home, away) => home === "Strong FC" ? [3, 0] : away === "Strong FC" ? [0, 2] : home === "Weak United" ? [0, 1] : [1, 1];

test("season key follows July-June football seasons", () => {
  assert.equal(seasonOf("2026-10-17"), "2026-27");
  assert.equal(seasonOf("2026-05-24"), "2025-26");
});

test("features only use matches strictly before the target day", () => {
  const matches = season(TEAMS, "2026-08-01", 12, strongWins);
  const target = matches[matches.length - 1].date;
  const state = leagueState(matches, target);
  assert.ok(state.league.every(match => match.date < target));
  const later = leagueState([...matches, { date: target, home: "Strong FC", away: "Weak United", homeGoals: 9, awayGoals: 0 }], target);
  assert.deepEqual(predictMatch(model, later, "Strong FC", "Weak United"), predictMatch(model, state, "Strong FC", "Weak United"));
});

test("no pick without minimum history", () => {
  const state = leagueState(season(TEAMS, "2026-08-01", 2, strongWins), "2026-12-01");
  assert.equal(predictMatch(model, state, "Strong FC", "Weak United").eligible, false);
});

test("probabilities are valid and missing features are imputed", () => {
  const vector = vectorize(model, {});
  assert.equal(vector.length, model.columns.length);
  for (const item of scoreMarkets(model, {})) assert.ok(item.probability > 0 && item.probability < 1);
});

test("picks settle only from finished scores", () => {
  const spec = { testHitRate: 0.92, testPicks: 400 };
  const base = { market: "1X", tier: "banko", probability: 0.91, spec };
  const make = (short, home, away) => ({ fixture: { id: 1, date: "2026-10-17T15:00:00Z", status: { short } }, teams: { home: { name: "A" }, away: { name: "B" } }, goals: { home, away } });
  assert.equal(toPick(make("FT", 1, 1), base, { league: "x" }).result, "hit");
  assert.equal(toPick(make("FT", 0, 2), base, { league: "x" }).result, "miss");
  assert.equal(toPick(make("2H", 0, 2), base, { league: "x" }).result, "live");
  assert.equal(toPick(make("NS", null, null), base, { league: "x" }).result, "pending");
  assert.equal(toPick(make("PST", null, null), base, { league: "x" }).result, "void");
});

test("provider team names resolve to archive names within one league", () => {
  const history = new Map([["Premier League", [{ date: "2026-08-01", home: "Manchester United FC", away: "Chelsea FC", homeGoals: 1, awayGoals: 0 }]]]);
  assert.deepEqual(BankoRobot.resolve(history, "Manchester United", "Chelsea"), { league: "Premier League", home: "Manchester United FC", away: "Chelsea FC", exact: 2 });
  assert.equal(BankoRobot.resolve(history, "Manchester City", "Chelsea"), null);
});

test("live-provider supplement never adds target-day or later results", async () => {
  const archive = season(TEAMS, "2026-08-01", 6, strongWins);
  const robot = new BankoRobot({
    leagues: ["Premier League"], now: () => Date.parse("2026-10-20T12:00:00Z"),
    fetcher: async (league, s) => ({ status: s === "2026-27" ? "downloaded" : "not_available", matches: s === "2026-27" ? archive : [] }),
    recentResults: async (day) => [
      { fixture: { date: `${day}T15:00:00Z`, status: { short: "FT" } }, teams: { home: { name: "Strong" }, away: { name: "Mid Town" } }, goals: { home: 2, away: 0 } },
    ],
  });
  const history = await robot.history("2026-10-20");
  const list = history.get("Premier League");
  assert.ok(list.some(match => match.source === "live-provider"));
  assert.ok(list.every(match => match.date < "2026-10-20"));
});

test("picksForDay returns picks sorted by kickoff with honest summary", async () => {
  const archive = season(TEAMS, "2026-08-01", 14, strongWins);
  const robot = new BankoRobot({ leagues: ["Premier League"], fetcher: async (league, s) => ({ status: "downloaded", matches: s === "2026-27" ? archive : [] }) });
  const day = [
    { fixture: { id: 2, date: "2026-11-20T18:00:00Z", status: { short: "NS" } }, teams: { home: { name: "Strong FC" }, away: { name: "Weak United" } }, goals: {} },
    { fixture: { id: 1, date: "2026-11-20T12:00:00Z", status: { short: "NS" } }, teams: { home: { name: "Mid Town" }, away: { name: "Other City" } }, goals: {} },
    { fixture: { id: 3, date: "2026-11-20T12:00:00Z", status: { short: "NS" } }, teams: { home: { name: "Unknown A" }, away: { name: "Unknown B" } }, goals: {} },
  ];
  const result = await robot.picksForDay("2026-11-20", day);
  assert.equal(result.summary.fixtures, 3);
  assert.equal(result.summary.covered, 2);
  const kickoffs = result.picks.map(pick => pick.kickoff);
  assert.deepEqual(kickoffs, [...kickoffs].sort());
  for (const pick of result.picks) assert.ok(pick.probability >= 0 && pick.probability <= 100);
});
