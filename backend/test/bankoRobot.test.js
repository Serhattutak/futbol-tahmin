const test = require("node:test");
const assert = require("node:assert/strict");
const { BankoRobot, leagueState, predictMatch, settle, seasonOf, marketProbabilities, tierFor } = require("../services/bankoRobot");
const model = require("../data/engine-v2.json");

function season(teams, startDate, rounds, scoreFn, league = "Premier League") {
  const matches = []; let day = Date.parse(`${startDate}T12:00:00Z`);
  for (let r = 0; r < rounds; r += 1) {
    for (let i = 0; i < teams.length; i += 2) {
      const [home, away] = r % 2 ? [teams[i + 1], teams[i]] : [teams[i], teams[i + 1]];
      const [hg, ag] = scoreFn(home, away, r);
      matches.push({ date: new Date(day).toISOString().slice(0, 10), home, away, homeGoals: hg, awayGoals: ag, league });
    }
    teams = [teams[0], ...teams.slice(2), teams[1]]; day += 7 * 86_400_000;
  }
  return matches;
}
const TEAMS = ["Strong FC", "Weak United", "Mid Town", "Other City", "Fourth Rovers", "Fifth Albion"];
const strongWins = (home, away) => home === "Strong FC" ? [3, 0] : away === "Strong FC" ? [0, 2] : home === "Weak United" ? [0, 1] : [1, 1];
const fixture = (id, date, home, away, short = "NS", goals = {}, league = { name: "Premier League", country: "England" }) => ({ fixture: { id, date, status: { short } }, league, teams: { home: { name: home }, away: { name: away } }, goals });

test("season key follows July-June football seasons", () => {
  assert.equal(seasonOf("2026-10-17"), "2026-27");
  assert.equal(seasonOf("2026-05-24"), "2025-26");
});

test("1X2 probabilities sum to one and markets are consistent", () => {
  const p = marketProbabilities(model, {});
  assert.ok(Math.abs(p["1"] + p.X + p["2"] - 1) < 1e-9);
  assert.ok(Math.abs(p["1X"] - (p["1"] + p.X)) < 1e-12);
  assert.ok(Math.abs(p["U2.5"] + p["O2.5"] - 1) < 1e-12);
});

test("features and Elo only use matches strictly before the target day", () => {
  const matches = season(TEAMS, "2026-08-01", 12, strongWins);
  const target = matches[matches.length - 1].date;
  const base = predictMatch(model, leagueState(matches, target, model.elo), "Strong FC", "Weak United");
  const withSameDay = predictMatch(model, leagueState([...matches, { date: target, home: "Strong FC", away: "Weak United", homeGoals: 0, awayGoals: 9 }], target, model.elo), "Strong FC", "Weak United");
  assert.deepEqual(withSameDay, base);
});

test("a dominant team is favoured and Elo moves with results", () => {
  const matches = season(TEAMS, "2026-08-01", 14, strongWins);
  const state = leagueState(matches, "2026-12-30", model.elo);
  assert.ok(state.elo.get("Strong FC") > state.elo.get("Weak United"));
  const result = predictMatch(model, state, "Strong FC", "Weak United");
  assert.equal(result.eligible, true);
  assert.equal(result.ms.market, "1");
});

test("unvalidated (provider-only) leagues are capped below GÜÇLÜ", () => {
  assert.equal(tierFor(model, 0.99, false), "orta");
  assert.equal(tierFor(model, 0.99, true), "banko");
  assert.equal(tierFor(model, 0.10, true), "zayif");
});

test("predictions settle only from finished scores", () => {
  assert.equal(settle("1X", fixture(1, "x", "A", "B", "FT", { home: 1, away: 1 })).result, "hit");
  assert.equal(settle("1X", fixture(1, "x", "A", "B", "FT", { home: 0, away: 2 })).result, "miss");
  assert.equal(settle("1X", fixture(1, "x", "A", "B", "2H", { home: 0, away: 2 })).result, "live");
  assert.equal(settle("1X", fixture(1, "x", "A", "B", "NS")).result, "pending");
  assert.equal(settle("1X", fixture(1, "x", "A", "B", "PST")).result, "void");
});

test("provider names resolve to archive names; unknown teams do not", () => {
  const history = new Map([["Premier League", [{ date: "2026-08-01", home: "Manchester United FC", away: "Chelsea FC", homeGoals: 1, awayGoals: 0 }]]]);
  const resolved = BankoRobot.resolve(history, "Manchester United", "Chelsea");
  assert.equal(resolved.home, "Manchester United FC"); assert.equal(resolved.validated, true);
  assert.equal(BankoRobot.resolve(history, "Manchester City", "Chelsea"), null);
});

test("every fixture gets an entry; provider-only leagues become dynamic, unvalidated leagues", async () => {
  const archive = season(TEAMS, "2026-08-01", 14, strongWins);
  const brazil = ["Flamengo", "Palmeiras", "Santos", "Gremio", "Bahia", "Vasco"];
  const brazilMatches = season(brazil, "2026-09-07", 11, (h, a) => h === "Flamengo" ? [2, 0] : a === "Flamengo" ? [0, 1] : [1, 1], "Série A");
  const byDay = new Map();
  for (const m of brazilMatches) byDay.set(m.date, [...(byDay.get(m.date) || []), fixture(`${m.home}-${m.date}`, `${m.date}T20:00:00Z`, m.home, m.away, "FT", { home: m.homeGoals, away: m.awayGoals }, { name: "Série A", country: "Brazil" })]);
  const robot = new BankoRobot({
    leagues: ["Premier League"], now: () => Date.parse("2026-11-20T12:00:00Z"),
    fetcher: async (league, s) => ({ status: "downloaded", matches: s === "2026-27" ? archive : [] }),
    recentResults: async day => byDay.get(day) || [],
  });
  const day = [
    fixture(2, "2026-11-20T18:00:00Z", "Strong FC", "Weak United"),
    fixture(1, "2026-11-20T12:00:00Z", "Mid Town", "Other City"),
    fixture(4, "2026-11-20T22:00:00Z", "Flamengo", "Santos", "NS", {}, { name: "Série A", country: "Brazil" }),
    fixture(3, "2026-11-20T12:00:00Z", "Unknown A", "Unknown B"),
  ];
  const result = await robot.picksForDay("2026-11-20", day);
  assert.equal(result.predictions.length, 4);
  assert.equal(result.summary.fixtures, 4);
  const flamengo = result.predictions.find(item => item.home === "Flamengo");
  assert.equal(flamengo.available, true); assert.equal(flamengo.validated, false);
  assert.ok(["orta", "zayif"].includes(flamengo.tier));
  assert.equal(result.predictions.find(item => item.home === "Unknown A").available, false);
  for (const item of result.predictions.filter(entry => entry.available)) {
    assert.ok(Math.abs(item.oneXTwo.home + item.oneXTwo.draw + item.oneXTwo.away - 100) < 0.5);
  }
});
