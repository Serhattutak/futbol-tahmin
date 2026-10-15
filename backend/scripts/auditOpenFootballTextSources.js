const fs = require("node:fs");
const path = require("node:path");
const provider = require("../providers/openFootballText");

const root = path.resolve(__dirname, "../..");
const reportPath = path.join(root, "docs", "openfootball-text-source-audit.json");

function sourceUrl(meta, season) {
  const directory = meta.path.replace("{season}", String(season));
  const file = meta.file.replace("{season}", String(season));
  return meta.root + "/" + directory + "/" + file;
}

async function worker(queue, results) {
  while (queue.length) {
    const item = queue.shift();
    const { league, meta, season } = item;
    const row = {
      league,
      country: meta.country,
      season,
      sourceUrl: sourceUrl(meta, season),
      checkedAt: new Date().toISOString(),
      fixtureCount: 0,
      finishedCount: 0,
      scheduledCount: 0,
      latestFixtureDate: null,
      latestFinishedDate: null,
      status: "unknown",
    };
    try {
      const fixtures = await provider.getSeasonFixtures(league, season);
      const dates = fixtures.map(match => match.fixture?.sourceLocalDate || match.fixture?.date?.slice(0, 10)).filter(Boolean).sort();
      const finished = fixtures.filter(match => match.fixture?.status?.short === "FINISHED");
      const finishedDates = finished.map(match => match.fixture?.sourceLocalDate || match.fixture?.date?.slice(0, 10)).filter(Boolean).sort();
      row.fixtureCount = fixtures.length;
      row.finishedCount = finished.length;
      row.scheduledCount = fixtures.filter(match => match.fixture?.status?.short === "SCHEDULED").length;
      row.latestFixtureDate = dates.at(-1) || null;
      row.latestFinishedDate = finishedDates.at(-1) || null;
      row.status = fixtures.length ? "ok" : "empty_or_missing";
    } catch (error) {
      row.status = "error";
      row.errorCategory = String(error?.category || error?.code || "source_error").replace(/[^a-z0-9_-]/gi, "").slice(0, 60);
      if (Number.isInteger(error?.httpStatus)) row.httpStatus = error.httpStatus;
    }
    results.push(row);
  }
}

async function main() {
  const queue = Object.entries(provider.historicalLeagues).map(([league, meta]) => ({
    league,
    meta,
    season: String(meta.seasons[0]),
  }));
  const results = [];
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, () => worker(queue, results)));
  results.sort((a, b) => a.country.localeCompare(b.country) || a.league.localeCompare(b.league));
  const empty = results.filter(row => row.status === "empty_or_missing");
  const errors = results.filter(row => row.status === "error");
  const report = {
    generatedAt: new Date().toISOString(),
    source: "OpenFootball Football.TXT",
    mode: "read-only source availability audit; no fixture cache, analysis, prediction or ledger writes",
    summary: {
      catalogEntries: results.length,
      sourcesWithParsedFixtures: results.length - empty.length - errors.length,
      emptyOrMissing: empty.length,
      errors: errors.length,
      fixturesParsed: results.reduce((sum, row) => sum + row.fixtureCount, 0),
      completedResultsParsed: results.reduce((sum, row) => sum + row.finishedCount, 0),
      scheduledFixturesParsed: results.reduce((sum, row) => sum + row.scheduledCount, 0),
    },
    sources: results,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.summary));
  if (empty.length) console.warn("Empty or missing source files:", empty.map(row => ({ league: row.league, season: row.season, url: row.sourceUrl })));
  if (errors.length) console.warn("Source request errors:", errors.map(row => ({ league: row.league, category: row.errorCategory, httpStatus: row.httpStatus })));
  // Tolerate a few upstream gaps; fail the scheduled check if coverage broadly degrades.
  if (errors.length > 0 || empty.length > Math.max(3, Math.ceil(results.length * 0.1))) process.exitCode = 1;
}

main().catch(error => {
  console.error("OpenFootball source audit failed:", String(error?.message || "unknown error").slice(0, 160));
  process.exitCode = 1;
});
