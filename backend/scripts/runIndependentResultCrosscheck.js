const fs = require("node:fs");
const path = require("node:path");
const openFootball = require("../providers/openFootball");
const espn = require("../providers/espn");
const { forEachConcurrent } = require("../services/forEachConcurrent");

const DAY_MS = 86400000;
const LEAGUES = [
  "Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1",
  "Championship", "Segunda División", "League One", "League Two",
  "2. Bundesliga", "Serie B", "Ligue 2", "Eredivisie", "Primeira Liga",
  "Scottish Premiership", "Süper Lig", "Pro League",
];
const day = value => new Date(value).toISOString().slice(0, 10);
const shift = (value, offset) => day(Date.parse(value + "T00:00:00Z") + offset * DAY_MS);
const norm = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/\b(fc|cf|afc|sc|ac|as|club|football|de|the)\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const dateOf = f => String(f?.fixture?.date || "").slice(0, 10);
const isFinal = f => f?.fixture?.status?.short === "FINISHED" &&
  Number.isInteger(f?.goals?.home) && Number.isInteger(f?.goals?.away);
const teams = f => [norm(f?.teams?.home?.name), norm(f?.teams?.away?.name)];

function pairScore(a, b) {
  const [ah, aa] = teams(a); const [bh, ba] = teams(b);
  const same = (x, y) => Boolean(x && y && (x === y || x.includes(y) || y.includes(x)));
  return same(ah, bh) && same(aa, ba) ? 1 : same(ah, ba) && same(aa, bh) ? -1 : 0;
}
function scoreMatches(a, b) {
  return pairScore(a, b) === 1
    ? a.goals.home === b.goals.home && a.goals.away === b.goals.away
    : pairScore(a, b) === -1
      ? a.goals.home === b.goals.away && a.goals.away === b.goals.home
      : false;
}

async function runIndependentResultCrosscheck({ now = new Date(), days = 30, leagues = LEAGUES } = {}) {
  const to = shift(day(now), -1); const from = shift(to, -(days - 1));
  const dates = Array.from({ length: days }, (_, i) => shift(from, i));
  const tasks = dates.flatMap(date => leagues.map(league => ({ date, league })));
  const rows = [];
  const failures = [];
  await forEachConcurrent(tasks, 5, async ({ date, league }) => {
    try {
      const fixtures = await espn.getLeagueFixtures(date, league);
      rows.push(...fixtures.filter(isFinal).map(f => ({ ...f, _queriedDate: date, _queriedLeague: league })));
    } catch (error) {
      failures.push({ date, league, reason: error.category || error.code || "fetch_failed" });
    }
  });

  // Current-day archive endpoints are not sufficient for a rolling window; load each season's history.
  const archiveRows = [];
  const seasons = ["2025-26", "2026-27"];
  for (const league of leagues) {
    for (const season of seasons) {
      try { archiveRows.push(...(await openFootball.getSeasonFixtures(league, season)).filter(isFinal)); }
      catch (error) { failures.push({ league, season, provider: "openfootball", reason: error.category || error.code || "fetch_failed" }); }
    }
  }
  const sourceRows = archiveRows.filter(f => dateOf(f) >= from && dateOf(f) <= to);
  const usedEspn = new Set();
  const matched = [], conflicts = [], archiveOnly = [];
  for (const fixture of sourceRows) {
    const candidates = rows.filter(r => r._queriedLeague === fixture.league?.name &&
      Math.abs(Date.parse(dateOf(r) + "T00:00:00Z") - Date.parse(dateOf(fixture) + "T00:00:00Z")) <= DAY_MS &&
      pairScore(fixture, r) !== 0 && !usedEspn.has(r.fixture.id));
    if (!candidates.length) { archiveOnly.push({ date: dateOf(fixture), league: fixture.league?.name, home: fixture.teams?.home?.name, away: fixture.teams?.away?.name, score: fixture.goals }); continue; }
    const other = candidates[0]; usedEspn.add(other.fixture.id);
    const record = { date: dateOf(fixture), league: fixture.league?.name, home: fixture.teams?.home?.name, away: fixture.teams?.away?.name,
      archiveScore: fixture.goals, espnScore: other.goals, espnDate: dateOf(other) };
    (scoreMatches(fixture, other) ? matched : conflicts).push(record);
  }
  const espnOnly = rows.filter(r => !usedEspn.has(r.fixture.id)).map(r => ({
    date: dateOf(r), league: r._queriedLeague, home: r.teams?.home?.name, away: r.teams?.away?.name, score: r.goals
  }));
  const totalComparable = matched.length + conflicts.length;
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), from, to, requestedDays: days,
    sources: ["openfootball", "espn"], scope: "Completed results only; independent result comparison, not a model-accuracy score.",
    summary: {
      espnFinalRows: rows.length, openFootballFinalRowsInWindow: sourceRows.length,
      exactOrAliasMatched: totalComparable, scoreAgreement: matched.length, scoreConflicts: conflicts.length,
      agreementRateAmongMatched: totalComparable ? Number((matched.length / totalComparable * 100).toFixed(2)) : null,
      archiveWithoutEspnMatch: archiveOnly.length, espnWithoutArchiveMatch: espnOnly.length, requestFailures: failures.length,
    },
    matched, conflicts, archiveOnly, espnOnly, failures,
    limitation: "Team aliases are normalized conservatively. Unmatched records are not counted as disagreements; conflicts require manual review before either source is treated as authoritative."
  };
}
if (require.main === module) {
  runIndependentResultCrosscheck().then(report => {
    const output = process.env.ZEUS_CROSSCHECK_OUTPUT || "artifacts/independent-result-crosscheck.json";
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ from: report.from, to: report.to, summary: report.summary, sampleConflicts: report.conflicts.slice(0, 10), sampleArchiveOnly: report.archiveOnly.slice(0, 5) }, null, 2));
    if (report.summary.exactOrAliasMatched < 30) {
      console.error("Independent result cross-check has fewer than 30 matched games; report is incomplete.");
      process.exitCode = 1;
    }
  }).catch(error => { console.error(JSON.stringify({ type: "INDEPENDENT_RESULT_CROSSCHECK_FAILED", message: error.message })); process.exitCode = 1; });
}
module.exports = { runIndependentResultCrosscheck, pairScore, scoreMatches, norm };
