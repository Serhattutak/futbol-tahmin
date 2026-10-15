const fs = require("node:fs");
const path = require("node:path");
const { selectHistory, historicalTeamKey: key } = require("./historicalForm");
const VERSION = "cross-division-v2";
const PRIORITY = ["openfootball", "sportmonks", "football-data", "api-football", "thesportsdb"];
// Explicit provider spelling transition observed in the two Spanish datasets.
// Keep the identity local to OpenFootball; do not rewrite other provider IDs.
const OPENFOOTBALL_IDS = { "of-team-realvalladolid": "of-team-realvalladolidcf" };

// Provider IDs are checked within each provider before merging. Never fuzzy-match.
// An ambiguous same-day meeting (time or score disagreement) is quarantined.
function mergeHistory(rows, options) {
  const buckets = new Map();
  const ordered = [...rows].sort((a, b) => {
    const rank = m => { const i = PRIORITY.indexOf(m.provider); return i < 0 ? 99 : i; };
    return rank(a) - rank(b);
  });
  for (const m of ordered) {
    const identity = [m.league?.country, key(m.league?.name), m.fixture.date.slice(0, 10), key(m.teams.home.name), key(m.teams.away.name)].join(":");
    const group = buckets.get(identity) || [];
    const prior = group.find(b => b.match.provider !== m.provider || String(b.match.fixture.id) === String(m.fixture.id));
    if (!prior) { group.push({ match: m, conflict: false }); buckets.set(identity, group); }
    else {
      const a = prior.match;
      const timeConflict = a.fixture.kickoffPrecision !== "date" && m.fixture.kickoffPrecision !== "date" && Date.parse(a.fixture.date) !== Date.parse(m.fixture.date);
      if (timeConflict || a.goals.home !== m.goals.home || a.goals.away !== m.goals.away) prior.conflict = true;
    }
  }
  return selectHistory([...buckets.values()].flat().filter(b => !b.conflict).map(b => b.match), options);
}

function seasonOf(before) {
  const date = new Date(before), year = date.getUTCFullYear() - (date.getUTCMonth() < 7 ? 1 : 0);
  return `${year}-${String(year + 1).slice(-2)}`;
}
let local;
function localDatasets() {
  if (local) return local;
  const data = path.resolve(__dirname, "../data");
  local = [];
  try { local.push(...JSON.parse(fs.readFileSync(path.join(data, "historical-sources.json"), "utf8")).datasets); } catch { /* Optional local source. */ }
  for (const league of ["Premier-League", "La-Liga", "Bundesliga", "Serie-A", "Ligue-1"]) for (const season of ["2024-25", "2025-26"]) {
    try { const s = JSON.parse(fs.readFileSync(path.join(data, "backtest", `${league}-${season}.json`), "utf8")); local.push({ league: s.league, season: s.season, matches: s.fixtures }); } catch { /* Not installed. */ }
  }
  return local;
}

async function collectDivisionHistory({ team, before, fixtureId, league, catalog, load, datasets = localDatasets(), now = Date.now() }) {
  if (!team?.name || !league?.country) return [];
  const divisions = Object.keys(catalog).filter(name => catalog[name].country === league.country).sort((a, b) => Number(b === league.name) - Number(a === league.name) || a.localeCompare(b));
  if (!divisions.length) return [];
  const currentSeasonYear = Number(seasonOf(before).slice(0, 4));
  const currentCalendarYear = Number(String(before).slice(0, 4));
  const options = { team, before, fixtureId, now };
  let rows = [];
  // Exhaust installed evidence before any remote request. This is especially
  // important for promoted teams whose previous division is already on disk.
  for (const remote of [false, true]) {
  if (remote && !load) break;
  rows = [];
  for (let offset = 0; offset < 3; offset++) {
    for (const division of divisions) {
      const meta = catalog[division] || {};
      const targetYear = meta.calendarYear ? currentCalendarYear : currentSeasonYear;
      // Text-source catalogs intentionally list only verified season files, and
      // some leagues have gaps. Select the nearest available seasons instead of
      // asking for nonexistent year-offset files and silently losing history.
      const available = Array.isArray(meta.seasons)
        ? meta.seasons.map(String)
          .filter(season => Number(season.match(/^\\d{4}/)?.[0]) <= targetYear)
          .sort((a, b) => Number(b.slice(0, 4)) - Number(a.slice(0, 4)) || b.localeCompare(a))
        : null;
      const year = targetYear - offset;
      const season = available
        ? available[offset]
        : meta.calendarYear ? String(year) : `${year}-${String(year + 1).slice(-2)}`;
      if (!season) continue;
      // Completed prior seasons are reusable; current snapshots have a bounded age.
      const installed = datasets.find(s => s.league === division && s.season === season);
      let incoming = installed?.matches || [];
      const currentSeason = catalog[division]?.calendarYear ? String(new Date(now).getUTCFullYear()) : seasonOf(new Date(now).toISOString());
      if (remote && (!installed || (season === currentSeason && now - Date.parse(installed.retrievedAt || 0) > 6 * 3600_000))) {
        try { const fresh = await load(division, season); if (fresh.length) incoming = fresh; } catch { /* Keep real cached evidence on outage. */ }
      }
      incoming = incoming.filter(m => m.league?.country === league.country).map(m => ({ ...m, teams: Object.fromEntries(Object.entries(m.teams).map(([side, team]) => [side, { ...team, id: m.provider === "openfootball" ? OPENFOOTBALL_IDS[team.id] || team.id : team.id }])) }));
      rows.push(...incoming);
      const enough = mergeHistory(rows, options);
      if (enough.length >= 10) return enough;
    }
    const selected = mergeHistory(rows, options);
    if (selected.length >= 10) return selected;
  }
  }
  return mergeHistory(rows, options);
}

function provenance(home, away) {
  const dates = [...home, ...away].map(m => m.fixture.date).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { historyStrategyVersion: VERSION, homeHistoryCount: home.length, awayHistoryCount: away.length,
    homeHistoryLeagues: [...new Set(home.map(m => m.league.name))], awayHistoryLeagues: [...new Set(away.map(m => m.league.name))],
    homeHistorySources: [...new Set(home.map(m => m.provider))], awayHistorySources: [...new Set(away.map(m => m.provider))],
    oldestHistoryDate: dates[0] || null, newestHistoryDate: dates.at(-1) || null };
}
module.exports = { VERSION, mergeHistory, collectDivisionHistory, localDatasets, provenance };
