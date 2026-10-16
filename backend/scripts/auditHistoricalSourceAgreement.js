const fs = require("node:fs");
const path = require("node:path");
const openFootball = require("../providers/openFootball");
const espn = require("../providers/espn");
const { forEachConcurrent } = require("../services/forEachConcurrent");

const DAY_MS = 86400000;
const day = value => new Date(value).toISOString().slice(0, 10);
const shiftDay = (value, amount) => day(Date.parse(value + "T00:00:00Z") + amount * DAY_MS);
const normalize = value => String(value || "").normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const result = fixture => {
  const h = fixture?.goals?.home, a = fixture?.goals?.away;
  return Number.isInteger(h) && Number.isInteger(a) && h >= 0 && a >= 0 ? `${h}-${a}` : null;
};
const fixtureDay = fixture => String(fixture?.fixture?.date || "").slice(0, 10);
const key = fixture => [fixtureDay(fixture), normalize(fixture?.teams?.home?.name), normalize(fixture?.teams?.away?.name)].join("|");

async function auditHistoricalSourceAgreement({ now = new Date(), lookbackDays = 30, loadOpenFootball = openFootball.getSeasonFixtures, loadEspn = espn.getFixtures } = {}) {
  const asOf = day(now);
  const from = shiftDay(asOf, -lookbackDays);
  const to = shiftDay(asOf, -1);
  const leagues = ["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1", "Championship", "Segunda División", "League One", "League Two", "2. Bundesliga", "Serie B", "Ligue 2", "Eredivisie", "Primeira Liga", "Scottish Premiership", "Süper Lig", "Pro League"];
  const seasonNames = ["2025-26", "2026-27"];
  const archive = [];
  const unavailableArchive = [];
  for (const league of leagues) {
    for (const season of seasonNames) {
      try {
        const rows = await loadOpenFootball(league, season);
        archive.push(...rows.filter(f => fixtureDay(f) >= from && fixtureDay(f) <= to && result(f) !== null));
        if (!rows.length) unavailableArchive.push({ league, season, reason: "no_rows_or_not_published" });
      } catch (error) {
        unavailableArchive.push({ league, season, reason: error.category || error.code || "fetch_failed" });
      }
    }
  }
  const dates = Array.from({ length: lookbackDays }, (_, i) => shiftDay(from, i));
  const espnRows = [];
  const unavailableEspn = [];
  await forEachConcurrent(dates, 3, async date => {
    try {
      const rows = await loadEspn(date);
      espnRows.push(...rows.filter(f => fixtureDay(f) === date && result(f) !== null));
    } catch (error) {
      unavailableEspn.push({ date, reason: error.category || error.code || "fetch_failed" });
    }
  });
  const archiveByKey = new Map(archive.map(f => [key(f), f]));
  const espnByKey = new Map(espnRows.map(f => [key(f), f]));
  const overlaps = [];
  const conflicts = [];
  for (const [fixtureKey, sourceA] of archiveByKey) {
    const sourceB = espnByKey.get(fixtureKey);
    if (!sourceB) continue;
    const a = result(sourceA), b = result(sourceB);
    const row = { date: fixtureDay(sourceA), league: sourceA.league?.name, home: sourceA.teams?.home?.name, away: sourceA.teams?.away?.name, openFootball: a, espn: b };
    overlaps.push(row);
    if (a !== b) conflicts.push(row);
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    requestedWindow: { from, to, lookbackDays },
    providers: ["openfootball", "espn"],
    counts: {
      openFootballFinished: archive.length,
      espnFinished: espnRows.length,
      exactFixtureOverlaps: overlaps.length,
      agreement: overlaps.length - conflicts.length,
      conflicts: conflicts.length,
      openFootballOnly: [...archiveByKey.keys()].filter(k => !espnByKey.has(k)).length,
      espnOnly: [...espnByKey.keys()].filter(k => !archiveByKey.has(k)).length,
      espnDatesWithNoFixtures: dates.length - new Set(espnRows.map(fixtureDay)).size,
    },
    conflicts,
    unavailable: { openFootball: unavailableArchive, espn: unavailableEspn },
    limitation: "Only exact normalized date/home/away matches are compared. Missing matches and unmatched team aliases are not counted as agreement; provider coverage is not assumed complete.",
  };
  const output = process.env.ZEUS_SOURCE_AUDIT_OUTPUT;
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\\n");
  }
  console.log(JSON.stringify(report, null, 2));
  return report;
}
if (require.main === module) auditHistoricalSourceAgreement().catch(error => { console.error(JSON.stringify({ type: "SOURCE_AUDIT_FAILED", message: error.message })); process.exitCode = 1; });
module.exports = { auditHistoricalSourceAgreement, normalize, key, result };
