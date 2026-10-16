const fs = require("node:fs");
const path = require("node:path");
const openFootball = require("../providers/openFootball");
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

async function runRollingHistoricalBacktest({ now = new Date(), load = loadHistoricalFixtures } = {}) {
  const asOf = isoDay(now);
  const fixtures = await load();
  if (!fixtures.fixtures.length) throw new Error("NO_HISTORICAL_FIXTURES_LOADED");
  const oneYearFrom = dateOffset(asOf, -365);
  const oneMonthFrom = dateOffset(asOf, -30);
  const run = (from, to) => runChronologicalBenchmark(fixtures.fixtures, { from, to, now: Date.parse(asOf + "T23:59:59.999Z") });
  const yearly = run(oneYearFrom, dateOffset(asOf, -1));
  const monthly = run(oneMonthFrom, dateOffset(asOf, -1));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    asOf,
    provider: "openfootball",
    sourcePolicy: "Public historical results archive; only previous calendar days enter model history; same-day results excluded.",
    windows: {
      last30Days: {
        from: oneMonthFrom, to: dateOffset(asOf, -1),
        candidates: monthly.candidates, evaluated: monthly.evaluated, skipped: monthly.skipped,
        baselineModel: marketSummary(monthly, "baseline"), currentModel: marketSummary(monthly, "stats"),
        evaluation: monthly.evaluation, datasetHash: monthly.datasetHash, pairedSampleHash: monthly.pairedSampleHash,
      },
      last365Days: {
        from: oneYearFrom, to: dateOffset(asOf, -1),
        candidates: yearly.candidates, evaluated: yearly.evaluated, skipped: yearly.skipped,
        baselineModel: marketSummary(yearly, "baseline"), currentModel: marketSummary(yearly, "stats"),
        evaluation: yearly.evaluation, datasetHash: yearly.datasetHash, pairedSampleHash: yearly.pairedSampleHash,
      },
    },
    data: {
      loadedFixtures: fixtures.fixtures.length,
      sources: fixtures.sources,
      unavailable: fixtures.unavailable,
      uniqueProviders: [...new Set(fixtures.sources.map(source => source.provider))],
      limitation: "Historical prediction inputs come from the cited archive; independent source result agreement is not inferred from this report. Conflicting or unavailable external results must be reconciled separately before being labelled verified.",
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
    if (report.windows.last365Days.evaluated < 500) {
      console.error("Historical eligible sample is below 500; report is incomplete.");
      process.exitCode = 1;
    }
  }).catch(error => {
    console.error(JSON.stringify({ type: "ROLLING_HISTORICAL_BACKTEST_FAILED", message: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { LEAGUES, SEASONS, loadHistoricalFixtures, marketSummary, runRollingHistoricalBacktest };
