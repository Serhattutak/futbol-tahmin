const fs = require("node:fs");
const path = require("node:path");
const openFootball = require("../providers/openFootball");
const espn = require("../providers/espn");
const { forEachConcurrent } = require("../services/forEachConcurrent");
const { runChronologicalBenchmark } = require("../services/chronologicalBenchmark");

const LEAGUES = [
  "Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1",
  "Championship", "Segunda División", "League One", "League Two",
  "2. Bundesliga", "Serie B", "Ligue 2", "Eredivisie", "Primeira Liga",
  "Scottish Premiership", "Süper Lig", "Pro League",
];
const SEASONS = ["2024-25", "2025-26", "2026-27"];
const DAY_MS = 86400000;
const isoDay = value => new Date(value).toISOString().slice(0, 10);
const dateOffset = (date, days) => isoDay(Date.parse(date + "T00:00:00Z") + days * DAY_MS);

async function loadHistoricalFixtures({ leagues = LEAGUES, seasons = SEASONS, loadSeason = openFootball.getSeasonFixtures } = {}) {
  const fixtures = [];
  const sources = [];
  const unavailable = [];
  for (const league of leagues) {
    for (const season of seasons) {
      try {
        const rows = await loadSeason(league, season);
        if (!rows.length) {
          unavailable.push({ provider: "openfootball", league, season, reason: "no_rows_or_not_published" });
          continue;
        }
        fixtures.push(...rows);
        sources.push({ provider: "openfootball", league, season, matches: rows.length });
      } catch (error) {
        unavailable.push({ provider: "openfootball", league, season, reason: error.category || error.code || "fetch_failed" });
      }
    }
  }
  return { fixtures, sources, unavailable };
}

function compareModelOutputs(report) {
  const rows = (report.records || []).filter(row => row.baseline?.probabilities && row.stats?.probabilities);
  let sameProbabilities = 0;
  let sameTopPick = 0;
  let totalAbsoluteProbabilityDelta = 0;
  let maxAbsoluteProbabilityDelta = 0;
  let comparisons = 0;
  for (const row of rows) {
    const keys = ["home", "draw", "away"];
    const base = row.baseline.probabilities;
    const current = row.stats.probabilities;
    let rowDelta = 0;
    for (const key of keys) {
      const delta = Math.abs(Number(base[key]) - Number(current[key]));
      rowDelta += delta;
      totalAbsoluteProbabilityDelta += delta;
      maxAbsoluteProbabilityDelta = Math.max(maxAbsoluteProbabilityDelta, delta);
      comparisons++;
    }
    if (rowDelta < 1e-12) sameProbabilities++;
    if (keys.reduce((best, key) => current[key] > current[best] ? key : best, keys[0]) ===
        keys.reduce((best, key) => base[key] > base[best] ? key : best, keys[0])) sameTopPick++;
  }
  return {
    sampleSize: rows.length,
    same1X2Probabilities: sameProbabilities,
    same1X2ProbabilityRate: rows.length ? Number((sameProbabilities / rows.length * 100).toFixed(2)) : null,
    sameTopPick,
    sameTopPickRate: rows.length ? Number((sameTopPick / rows.length * 100).toFixed(2)) : null,
    meanAbsoluteProbabilityDelta: comparisons ? Number((totalAbsoluteProbabilityDelta / comparisons).toFixed(6)) : null,
    maxAbsoluteProbabilityDelta: maxAbsoluteProbabilityDelta || 0,
  };
}

function marketSummary(report, modelKey) {
  const model = report[modelKey];
  const market = model?.markets?.["1X2"];
  if (!market) return { sampleSize: 0, correct: 0, incorrect: 0, accuracy: null, brier: null, logLoss: null };
  return {
    sampleSize: market.sampleSize,
    correct: market.correct,
    incorrect: market.incorrect,
    accuracy: Number((market.hitRate * 100).toFixed(2)),
    brier: Number(market.brier.toFixed(5)),
    logLoss: Number(market.logLoss.toFixed(5)),
  };
}

function normalizedTeam(value) {
  return String(value || "").normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase()
    .replace(/\\b(fc|cf|afc|sc|ac|as|club|football|de|the)\\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\\s+/g, " ");
}
function fixtureIdentity(fixture) {
  const home = normalizedTeam(fixture?.teams?.home?.name);
  const away = normalizedTeam(fixture?.teams?.away?.name);
  const date = String(fixture?.fixture?.date || "").slice(0, 10);
  return [fixture?.league?.country || "", fixture?.league?.name || "", date, home, away].join("|");
}
async function loadRecentESPNFixtures({ from, to, leagues = LEAGUES }) {
  const dates = [];
  for (let date = from; date <= to; date = dateOffset(date, 1)) dates.push(date);
  const tasks = dates.flatMap(date => leagues.map(league => ({ date, league })));
  const fixtures = [], failures = [];
  await forEachConcurrent(tasks, 5, async ({ date, league }) => {
    try { fixtures.push(...(await espn.getLeagueFixtures(date, league))); }
    catch (error) { failures.push({ date, league, reason: error.category || error.code || "fetch_failed" }); }
  });
  return { fixtures: fixtures.filter(f => f?.fixture?.status?.short === "FINISHED" &&
    Number.isInteger(f?.goals?.home) && Number.isInteger(f?.goals?.away) &&
    String(f.fixture.date).slice(0, 10) >= from && String(f.fixture.date).slice(0, 10) <= to), failures };
}
function mergeHistoricalFixtures(primary, supplemental) {
  const merged = [];
  const identities = new Set();
  for (const fixture of [...primary, ...supplemental]) {
    const identity = fixtureIdentity(fixture);
    if (identities.has(identity)) continue;
    identities.add(identity);
    merged.push(fixture);
  }
  return merged;
}
async function runRollingHistoricalBacktest({ now = new Date(), load = loadHistoricalFixtures, loadRecent = loadRecentESPNFixtures } = {}) {
  const asOf = isoDay(now);
  const fixtures = await load();
  if (!fixtures.fixtures.length) throw new Error("NO_HISTORICAL_FIXTURES_LOADED");
  const oneYearFrom = dateOffset(asOf, -365);
  const oneMonthFrom = dateOffset(asOf, -30);
  const recent = await loadRecent({ from: oneMonthFrom, to: dateOffset(asOf, -1) });
  const combinedFixtures = mergeHistoricalFixtures(fixtures.fixtures, recent.fixtures);
  const run = (from, to) => runChronologicalBenchmark(combinedFixtures, { from, to, now: Date.parse(asOf + "T23:59:59.999Z") });
  const yearly = run(oneYearFrom, dateOffset(asOf, -1));
  const monthly = run(oneMonthFrom, dateOffset(asOf, -1));
  const coverage = report => {
    const actualTo = report.evaluation?.actualTo ? isoDay(report.evaluation.actualTo) : null;
    const requestedTo = report.evaluation?.to || null;
    const stalenessDays = actualTo && requestedTo
      ? Math.round((Date.parse(requestedTo + "T00:00:00Z") - Date.parse(actualTo + "T00:00:00Z")) / DAY_MS)
      : null;
    return { requestedTo, actualTo, stalenessDays, freshWithinSevenDays: stalenessDays !== null && stalenessDays >= 0 && stalenessDays <= 7 };
  };
  const monthlyCoverage = coverage(monthly);
  const yearlyCoverage = coverage(yearly);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    asOf,
    provider: "openfootball+espn",
    sourcePolicy: "OpenFootball historical archive supplemented by ESPN completed fixtures in the last 30 days; only previous calendar days enter model history; same-day results excluded.",
    windows: {
      last30Days: {
        from: oneMonthFrom, to: dateOffset(asOf, -1),
        candidates: monthly.candidates, evaluated: monthly.evaluated, skipped: monthly.skipped,
        baselineModel: marketSummary(monthly, "baseline"), currentModel: marketSummary(monthly, "stats"), modelComparison: compareModelOutputs(monthly),
        evaluation: monthly.evaluation, coverage: monthlyCoverage, datasetHash: monthly.datasetHash, pairedSampleHash: monthly.pairedSampleHash,
      },
      last365Days: {
        from: oneYearFrom, to: dateOffset(asOf, -1),
        candidates: yearly.candidates, evaluated: yearly.evaluated, skipped: yearly.skipped,
        baselineModel: marketSummary(yearly, "baseline"), currentModel: marketSummary(yearly, "stats"), modelComparison: compareModelOutputs(yearly),
        evaluation: yearly.evaluation, coverage: yearlyCoverage, datasetHash: yearly.datasetHash, pairedSampleHash: yearly.pairedSampleHash,
      },
    },
    data: {
      loadedFixtures: fixtures.fixtures.length,
      supplementalESPNFixtures: recent.fixtures.length,
      supplementalESPNFailures: recent.failures,
      mergedFixturesUsed: combinedFixtures.length,
      sources: fixtures.sources,
      unavailable: fixtures.unavailable,
      uniqueProviders: [...new Set([...fixtures.sources.map(source => source.provider), ...(recent.fixtures.length ? ["espn"] : [])])],
      limitation: "OpenFootball supplies long-range history; ESPN supplements completed fixtures in the last 30 days. Matched results are independently cross-checked in the separate result-crosscheck report; unmatched rows remain source-specific.",
    },
  };
}

if (require.main === module) {
  runRollingHistoricalBacktest().then(report => {
    const output = process.env.ZEUS_BACKTEST_OUTPUT;
    if (output) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    }
    console.log(JSON.stringify(report, null, 2));
    const staleWindows = Object.entries(report.windows).filter(([, window]) => !window.coverage?.freshWithinSevenDays).map(([name]) => name);
    if (report.windows.last365Days.evaluated < 500 || staleWindows.length) {
      console.error(JSON.stringify({
        type: "ROLLING_HISTORICAL_BACKTEST_INCOMPLETE",
        insufficientAnnualSample: report.windows.last365Days.evaluated < 500,
        staleWindows,
        message: "Do not treat stale or incomplete source coverage as a current performance result."
      }));
      process.exitCode = 1;
    }
  }).catch(error => {
    console.error(JSON.stringify({ type: "ROLLING_HISTORICAL_BACKTEST_FAILED", message: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { LEAGUES, SEASONS, loadHistoricalFixtures, loadRecentESPNFixtures, mergeHistoricalFixtures, fixtureIdentity, marketSummary, compareModelOutputs, runRollingHistoricalBacktest };
