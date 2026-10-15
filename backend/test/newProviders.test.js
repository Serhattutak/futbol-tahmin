const assert = require("node:assert/strict");
const test = require("node:test");
const sportmonks = require("../providers/sportmonks");
const footballData = require("../providers/footballData");
const openFootball = require("../providers/openFootball");
const openFootballText = require("../providers/openFootballText");
const espn = require("../providers/espn");
const theSportsDb = require("../providers/theSportsDb");

test("Sportmonks fixture response canonical legacy formuna normalize edilir", () => {
  const fixture = sportmonks.toFixture({ id: 1, starting_at: "2026-09-20T18:00:00Z", state: { short_name: "NS" }, league: { id: 2, name: "League" }, season: { id: 3 }, participants: [{ id: 10, name: "Home", meta: { location: "home" } }, { id: 20, name: "Away", meta: { location: "away" } }] });
  assert.equal(fixture.fixture.id, "sm-1"); assert.equal(fixture.teams.home.name, "Home"); assert.equal(fixture.goals.home, null);
});

test("football-data fixture response canonical legacy formuna normalize edilir", () => {
  const fixture = footballData.toFixture({ id: 1, utcDate: "2026-09-20T18:00:00Z", status: "SCHEDULED", competition: { id: 2, name: "League" }, season: { id: 3 }, homeTeam: { id: 10, name: "Home" }, awayTeam: { id: 20, name: "Away" }, score: { fullTime: { home: null, away: null } } });
  assert.equal(fixture.fixture.id, "fd-1"); assert.equal(fixture.teams.away.name, "Away"); assert.equal(fixture.goals.away, null);
});

test("football-data errors expose numeric HTTP status without leaking provider response body", () => {
  const error = footballData.providerError({ response: { status: 400, data: { message: "sensitive response body" } } });
  assert.equal(error.category, "unexpected_provider_response");
  assert.equal(error.httpStatus, 400);
  assert.equal(JSON.stringify(error).includes("sensitive response body"), false);
  assert.equal(footballData.providerError({ response: { status: 403 } }).category, "authentication");
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
    { name: "2. Liga", country: "Austria" },
  ]) assert.equal(openFootball.supportsHistoricalLeague(league), true, league.name);
});

test("OpenFootball does not advertise historical leagues absent from its configured data repository", () => {
  for (const league of [
    { name: "Liga MX", country: "Mexico" },
    { name: "Egyptian Premier League", country: "Egypt" },
    { name: "A-League", country: "Australia" },
  ]) assert.equal(openFootball.supportsHistoricalLeague(league), false, league.name);
});

test("OpenFootball date filtering uses Turkey local calendar date for timed kickoffs", () => {
  assert.equal(openFootball.turkeyDate("2026-10-14T21:30:00.000Z"), "2026-10-15");
});

test("ESPN scheduled fixtures with null scores stay scoreless; real zero scores remain valid", () => {
  const event = {
    id: "scheduled-1",
    date: "2026-10-16T18:00:00Z",
    competitions: [{
      status: { type: { name: "STATUS_SCHEDULED" } },
      competitors: [
        { homeAway: "home", team: { id: "1", displayName: "Home" }, score: null },
        { homeAway: "away", team: { id: "2", displayName: "Away" }, score: null },
      ],
    }],
  };
  const scheduled = espn.toFixture(event, "League One", { code: "eng.3", country: "England" });
  assert.equal(scheduled.goals.home, null);
  assert.equal(scheduled.goals.away, null);
  assert.equal(scheduled.fixture.status.short, "SCHEDULED");

  const finished = espn.toFixture({
    ...event,
    id: "finished-1",
    competitions: [{
      status: { type: { name: "STATUS_FINAL" } },
      competitors: [
        { homeAway: "home", team: { id: "1", displayName: "Home" }, score: "0" },
        { homeAway: "away", team: { id: "2", displayName: "Away" }, score: "0" },
      ],
    }],
  }, "League One", { code: "eng.3", country: "England" });
  assert.equal(finished.goals.home, 0);
  assert.equal(finished.goals.away, 0);
  assert.equal(finished.fixture.status.short, "FINISHED");
});

test("OpenFootball text source parses dated results in both supported match-line layouts", () => {
  const turkey = openFootballText.parseTextResults([
    "= Turkey | Süper Lig 2026/27",
    "▪ Regular Season - 1",
    "Fri Aug 14 2026",
    "  21:30   Galatasaray  2-2 (0-0)  Çorum",
    "Sat Aug 15",
    "  19:00   Atiker Konyaspor  0-1 (0-0)  Çaykur Rizespor",
  ].join("\n"), "Süper Lig", "2026-27");
  assert.equal(turkey.length, 2);
  assert.equal(turkey[0].fixture.kickoffPrecision, "time");
  assert.equal(turkey[0].fixture.date, "2026-08-14T18:30:00.000Z");
  assert.deepEqual(turkey.map(match => [match.fixture.date.slice(0, 10), match.teams.home.name, match.teams.away.name, match.goals.home, match.goals.away]), [
    ["2026-08-14", "Galatasaray", "Çorum", 2, 2],
    ["2026-08-15", "Atiker Konyaspor", "Çaykur Rizespor", 0, 1],
  ]);
  const finland = openFootballText.parseTextResults([
    "= Finland Veikkausliiga 2025",
    "Sat Apr 5 2025",
    "  15:00  Ilves Tampere v HJK Helsinki 3-2 (1-2)",
  ].join("\n"), "Veikkausliiga", "2025");
  assert.equal(finland.length, 1);
  assert.equal(finland[0].teams.home.name, "Ilves Tampere");
  assert.equal(finland[0].teams.away.name, "HJK Helsinki");
  assert.equal(finland[0].fixture.kickoffPrecision, "time");
  assert.equal(finland[0].fixture.date, "2025-04-05T12:00:00.000Z");
  assert.equal(finland[0].fixture.status.short, "FINISHED");
});

test("OpenFootball text history lookup does not require a fixture-feed match", () => {
  assert.equal(openFootballText.historyLookupByName, true);
});

test("OpenFootball text catalogue contains additional verified country and division datasets", () => {
  for (const league of [
    { name: "Swiss Challenge League", country: "Switzerland" },
    { name: "Czech First League", country: "Czech Republic" },
    { name: "Veikkausliiga", country: "Finland" },
    { name: "Primera División Argentina", country: "Argentina" },
    { name: "J1 League", country: "Japan" },
    { name: "Chinese Super League", country: "China" },
    { name: "Liga MX", country: "Mexico" },
    { name: "Major League Soccer", country: "USA" },
    { name: "Super League", country: "Switzerland" },
    { name: "NB I", country: "Hungary" },
    { name: "Primera División", country: "Argentina" },
    { name: "Superliga", country: "Denmark" },
    { name: "MLS", country: "USA" },
  ]) assert.equal(openFootballText.supportsHistoricalLeague(league), true, league.name);
  assert.equal(openFootballText.supportsHistoricalLeague({ name: "Unknown League", country: "Unknown" }), false);
});

test("OpenFootball text source advances inferred year across winter season rollover", () => {
  const matches = openFootballText.parseTextResults([
    "= Example League 2024/25",
    "Fri Dec 20 2024",
    "  Home FC  2-1 (1-0)  Away FC",
    "Sat Jan 11",
    "  Home FC  0-0 (0-0)  Away FC",
  ].join("\n"), "Danish Superliga", "2024-25");
  assert.deepEqual(matches.map(match => match.fixture.date), ["2024-12-20", "2025-01-11"]);
});

test("OpenFootball text history is eligible for different competitions in a covered country", () => {
  assert.equal(openFootballText.supportsHistoricalLeague({ name: "Liga Profesional Argentina", country: "Argentina" }), true);
  assert.equal(openFootballText.supportsHistoricalLeague({ name: "Unknown league", country: "Unknown country" }), false);
});

test("TheSportsDB history accepts only finished, scored, pre-cutoff matches involving the requested team", () => {
  const events = [
    { idEvent: "1", dateEvent: "2026-09-01", strStatus: "Match Finished", strHomeTeam: "Arsenal", strAwayTeam: "Chelsea", intHomeScore: "2", intAwayScore: "1" },
    { idEvent: "2", dateEvent: "2026-09-03", strStatus: "Match Finished", strHomeTeam: "Arsenal", strAwayTeam: "Liverpool", intHomeScore: "1", intAwayScore: "0" },
    { idEvent: "3", dateEvent: "2026-08-29", strStatus: "Not Started", strHomeTeam: "Arsenal", strAwayTeam: "Everton", intHomeScore: null, intAwayScore: null },
    { idEvent: "4", dateEvent: "2026-08-27", strStatus: "Match Finished", strHomeTeam: "Spurs", strAwayTeam: "Everton", intHomeScore: "0", intAwayScore: "0" },
  ];
  const matches = theSportsDb.selectTeamHistory(events, "Arsenal", "2026-09-02T12:00:00Z");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].teams.home.name, "Arsenal");
  assert.equal(matches[0].goals.home, 2);
  assert.equal(matches[0].goals.away, 1);
});

test("OpenFootball text source preserves scoreless scheduled fixtures for live discovery", () => {
  const fixtures = openFootballText.parseTextResults([
    "= Turkey | Süper Lig 2026/27",
    "Fri Oct 16 2026",
    "  21:30 Galatasaray v Fenerbahçe",
  ].join("\n"), "Süper Lig", "2026-27");
  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].fixture.status.short, "SCHEDULED");
  assert.equal(fixtures[0].fixture.kickoffPrecision, "time");
  assert.equal(fixtures[0].fixture.date, "2026-10-16T18:30:00.000Z");
  assert.equal(fixtures[0].goals.home, null);
  assert.equal(fixtures[0].goals.away, null);
});

test("weekly OpenFootball source audit script is syntactically valid", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const path = require("node:path");
  const file = path.resolve(__dirname, "../scripts/auditOpenFootballTextSources.js");
  assert.doesNotThrow(() => new vm.Script(fs.readFileSync(file, "utf8"), { filename: file }));
});

test("weekly source audit discovers unmapped season files without mistaking regional sub-leagues for new top-level sources", () => {
  const { buildDiscoveryCandidates } = require("../scripts/auditOpenFootballTextSources");
  const catalog = {
    "Example League": { root: "https://raw.githubusercontent.com/openfootball/europe/master", path: "example", file: "{season}_ex1.txt", seasons: ["2025-26"] },
    "Premier League": { root: "https://raw.githubusercontent.com/openfootball/england/master", path: "{season}", file: "1-premierleague.txt", seasons: ["2026-27"] },
  };
  const trees = new Map([
    ["openfootball/europe", ["example/2025-26_ex1.txt", "new-country/2026-27_nl1.txt", "new-country/README.md"]],
    ["openfootball/england", ["2026-27/1-premierleague.txt", "2026-27/3-league1.txt", "2025-26/region/1_Prov.txt"]],
  ]);
  const candidates = buildDiscoveryCandidates(catalog, trees);
  assert.ok(candidates.some(candidate => candidate.repository === "openfootball/europe" && candidate.path === "new-country/2026-27_nl1.txt"));
  assert.ok(candidates.some(candidate => candidate.repository === "openfootball/england" && candidate.path === "2026-27/3-league1.txt"));
  assert.equal(candidates.some(candidate => candidate.path === "example/2025-26_ex1.txt"), false);
  assert.equal(candidates.some(candidate => candidate.path === "2025-26/region/1_Prov.txt"), false);
});

test("TheSportsDB cache windows respect the free API update cadence", () => {
  assert.equal(theSportsDb.cacheTtl("searchteams.php"), 24 * 60 * 60 * 1000);
  assert.equal(theSportsDb.cacheTtl("eventspastleague.php"), 15 * 60 * 1000);
  assert.equal(theSportsDb.cacheTtl("eventslast.php"), 15 * 60 * 1000);
  assert.equal(theSportsDb.cacheTtl("eventsday.php"), 30 * 60 * 1000);
  assert.equal(theSportsDb.cacheTtl("lookupevent.php"), 5 * 60 * 1000);
});

test("TheSportsDB team history matches accent and Turkish dotted/dotless-I variants safely", () => {
  const events = [
    { idEvent: "accent-1", dateEvent: "2026-09-01", strStatus: "Match Finished", strHomeTeam: "Málaga CF", strAwayTeam: "Sevilla FC", intHomeScore: "2", intAwayScore: "1" },
    { idEvent: "turkish-1", dateEvent: "2026-08-28", strStatus: "Match Finished", strHomeTeam: "İstanbul Başakşehir", strAwayTeam: "Konyaspor", intHomeScore: "1", intAwayScore: "0" },
  ];
  const malaga = theSportsDb.selectTeamHistory(events, "Malaga CF", "2026-09-02T12:00:00Z");
  assert.equal(malaga.length, 1);
  assert.equal(malaga[0].teams.home.name, "Málaga CF");
  const istanbul = theSportsDb.selectTeamHistory(events, "Istanbul Basaksehir", "2026-08-29T12:00:00Z");
  assert.equal(istanbul.length, 1);
  assert.equal(istanbul[0].teams.home.name, "İstanbul Başakşehir");
});


test("OpenFootball text historical catalog includes only the newly verified prior seasons", () => {
  const expected = [
    ["Championship", "2024-25"],
    ["League One", "2024-25"],
    ["League Two", "2024-25"],
    ["National League", "2024-25"],
    ["2. Bundesliga", "2024-25"],
    ["3. Liga", "2024-25"],
    ["Serie B", "2024-25"],
    ["Segunda División", "2024-25"],
    ["2. Liga", "2024-25"],
    ["Eerste Divisie", "2023-24"],
    ["Liga Portugal 2", "2023-24"],
  ];
  for (const [league, season] of expected) {
    assert.ok(openFootballText.historicalLeagues[league].seasons.includes(season), league + " " + season);
  }
});
