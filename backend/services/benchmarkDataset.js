const fs = require("node:fs");
const path = require("node:path");
const { hash } = require("./chronologicalBenchmark");
const DIRECTORY = path.join(__dirname, "../data/backtest");
const REPORT_FILE = path.join(DIRECTORY, "report.json");
const LEAGUES = ["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1"];
const SEASONS = ["2024-25", "2025-26"];
const FILES = { "Premier League": "en.1.json", "La Liga": "es.1.json", Bundesliga: "de.1.json", "Serie A": "it.1.json", "Ligue 1": "fr.1.json" };

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, file);
}

async function loadDataset({ directory = DIRECTORY, load = require("../providers/openFootball").getSeasonFixtures, offline = false } = {}) {
  const fixtures = []; const sources = []; let requests = 0;
  for (const league of LEAGUES) for (const season of SEASONS) {
    const file = path.join(directory, `${league.replace(/[^a-z0-9]/gi, "-")}-${season}.json`);
    let entry;
    if (fs.existsSync(file)) {
      entry = JSON.parse(fs.readFileSync(file, "utf8"));
      if (entry.provider !== "openfootball" || entry.league !== league || entry.season !== season || !Array.isArray(entry.fixtures) || !entry.fixtures.length || entry.hash !== hash(entry.fixtures)) throw Error(`Invalid dataset cache: ${file}`);
    } else {
      if (offline) throw Error(`Offline dataset missing: ${file}`);
      const matches = await load(league, season); requests++;
      if (!matches.length) throw Error(`No real provider results: ${league} ${season}`);
      entry = { provider: "openfootball", league, season, retrievedAt: new Date().toISOString(), hash: hash(matches), fixtures: matches };
      writeJson(file, entry);
    }
    fixtures.push(...entry.fixtures);
    sources.push({ provider: entry.provider, url: `https://raw.githubusercontent.com/openfootball/football.json/master/${season}/${FILES[league]}`, league, season, retrievedAt: entry.retrievedAt, hash: entry.hash, matches: entry.fixtures.length });
  }
  return { fixtures, sources, requests };
}
module.exports = { loadDataset, writeJson, REPORT_FILE, DIRECTORY, LEAGUES, SEASONS };
