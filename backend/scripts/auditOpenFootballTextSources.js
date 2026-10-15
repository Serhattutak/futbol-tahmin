const axios = require("axios");
const fs = require("node:fs");
const path = require("node:path");
const provider = require("../providers/openFootballText");

const root = path.resolve(__dirname, "../..");
const reportPath = path.join(root, "docs", "openfootball-text-source-audit.json");
const GITHUB_API = "https://api.github.com";

function sourceUrl(meta, season) {
  const directory = meta.path.replace("{season}", String(season));
  const file = meta.file.replace("{season}", String(season));
  return meta.root + "/" + directory + "/" + file;
}

function repositoryFromRoot(rootUrl) {
  const match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/master\/?$/.exec(String(rootUrl || ""));
  return match?.[1] || null;
}

function isSeasonDataPath(filePath) {
  const segments = String(filePath || "").split("/");
  if (!String(filePath || "").endsWith(".txt") || segments.length > 3) return false;
  const seasonDirectory = /^(?:20\d{2}-\d{2}|20\d{2})$/.test(segments[0]);
  if (seasonDirectory && segments.length > 2) return false; // Avoid deep regional sub-leagues such as provincial divisions.
  const seasonInFilename = /(?:^|\/)(?:20\d{2}-\d{2}|20\d{2})_[a-z0-9][^/]*\.txt$/i.test(filePath);
  const seasonInDirectory = /(?:^|\/)(?:20\d{2}-\d{2}|20\d{2})\/[^/]+\.txt$/i.test(filePath);
  return seasonInFilename || seasonInDirectory;
}

function seasonFromPath(filePath) {
  return String(filePath || "").match(/(?:20\d{2}-\d{2}|20\d{2})/)?.[0] || null;
}

function buildDiscoveryCandidates(catalog, trees) {
  const known = new Map();
  for (const meta of Object.values(catalog || {})) {
    const repository = repositoryFromRoot(meta.root);
    if (!repository) continue;
    if (!known.has(repository)) known.set(repository, new Set());
    for (const season of meta.seasons || []) {
      const sourcePath = meta.path.replace("{season}", String(season)) + "/" + meta.file.replace("{season}", String(season));
      known.get(repository).add(sourcePath);
    }
  }

  const candidates = [];
  for (const [repository, paths] of trees instanceof Map ? trees : Object.entries(trees || {})) {
    const mapped = known.get(repository) || new Set();
    for (const filePath of paths || []) {
      if (mapped.has(filePath) || !isSeasonDataPath(filePath)) continue;
      candidates.push({ repository, path: filePath, season: seasonFromPath(filePath) });
    }
  }
  return candidates.sort((a, b) => a.repository.localeCompare(b.repository) || a.path.localeCompare(b.path));
}

async function discoverUnmappedSources(catalog) {
  const repositories = [...new Set(Object.values(catalog).map(meta => repositoryFromRoot(meta.root)).filter(Boolean))].sort();
  const trees = new Map();
  const errors = [];
  const truncatedRepositories = [];
  await Promise.all(repositories.map(async repository => {
    try {
      const response = await axios.get(`${GITHUB_API}/repos/${repository}/git/trees/master?recursive=1`, {
        timeout: 12000,
        headers: { Accept: "application/vnd.github+json", "User-Agent": "futbol-tahmin-openfootball-source-audit" },
      });
      trees.set(repository, (response.data.tree || []).filter(entry => entry.type === "blob").map(entry => entry.path));
      if (response.data.truncated) truncatedRepositories.push(repository);
    } catch (error) {
      errors.push({
        repository,
        errorCategory: String(error?.code || error?.category || "source_discovery_error").replace(/[^a-z0-9_-]/gi, "").slice(0, 60),
        ...(Number.isInteger(error?.response?.status) ? { httpStatus: error.response.status } : {}),
      });
    }
  }));
  return {
    repositoriesScanned: trees.size,
    repositoriesExpected: repositories.length,
    errors,
    truncatedRepositories,
    candidates: buildDiscoveryCandidates(catalog, trees),
  };
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
  const catalog = provider.historicalLeagues;
  const queue = Object.entries(catalog).map(([league, meta]) => ({
    league,
    meta,
    season: String(meta.seasons[0]),
  }));
  const results = [];
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, () => worker(queue, results)));
  results.sort((a, b) => a.country.localeCompare(b.country) || a.league.localeCompare(b.league));
  const empty = results.filter(row => row.status === "empty_or_missing");
  const errors = results.filter(row => row.status === "error");
  const discovery = await discoverUnmappedSources(catalog);
  const report = {
    generatedAt: new Date().toISOString(),
    source: "OpenFootball Football.TXT",
    mode: "read-only source availability and unmapped-season discovery; no fixture cache, analysis, prediction or ledger writes",
    summary: {
      catalogEntries: results.length,
      sourcesWithParsedFixtures: results.length - empty.length - errors.length,
      emptyOrMissing: empty.length,
      errors: errors.length,
      fixturesParsed: results.reduce((sum, row) => sum + row.fixtureCount, 0),
      completedResultsParsed: results.reduce((sum, row) => sum + row.finishedCount, 0),
      scheduledFixturesParsed: results.reduce((sum, row) => sum + row.scheduledCount, 0),
      repositoriesScanned: discovery.repositoriesScanned,
      unmappedSeasonFiles: discovery.candidates.length,
      discoveryErrors: discovery.errors.length,
    },
    sources: results,
    discovery: {
      repositoriesExpected: discovery.repositoriesExpected,
      repositoriesScanned: discovery.repositoriesScanned,
      errors: discovery.errors,
      truncatedRepositories: discovery.truncatedRepositories,
      candidateCount: discovery.candidates.length,
      candidates: discovery.candidates.slice(0, 250),
      candidatesTruncated: discovery.candidates.length > 250,
    },
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.summary));
  if (empty.length) console.warn("Empty or missing source files:", empty.map(row => ({ league: row.league, season: row.season, url: row.sourceUrl })));
  if (errors.length) console.warn("Source request errors:", errors.map(row => ({ league: row.league, category: row.errorCategory, httpStatus: row.httpStatus })));
  if (discovery.errors.length) console.warn("Unmapped-source discovery errors:", discovery.errors);
  if (discovery.candidates.length) console.warn("Unmapped season files to review:", discovery.candidates.slice(0, 40));
  // Tolerate a few upstream gaps; fail the scheduled check if known-source coverage broadly degrades.
  if (errors.length > 0 || empty.length > Math.max(3, Math.ceil(results.length * 0.1))) process.exitCode = 1;
}

module.exports = { sourceUrl, repositoryFromRoot, isSeasonDataPath, seasonFromPath, buildDiscoveryCandidates, discoverUnmappedSources };

if (require.main === module) {
  main().catch(error => {
    console.error("OpenFootball source audit failed:", String(error?.message || "unknown error").slice(0, 160));
    process.exitCode = 1;
  });
}
