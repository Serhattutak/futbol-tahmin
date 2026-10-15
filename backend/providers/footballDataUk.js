const axios = require("axios");
const { localKickoffToUtc } = require("../services/localKickoff");
const { createProviderError } = require("../services/apiFootballClient");
const { forEachConcurrent } = require("../services/forEachConcurrent");

const BASE_URL = "https://www.football-data.co.uk/mmz4281";
const LEAGUES = {
  "Premier League": { code: "E0", country: "England" },
  "Championship": { code: "E1", country: "England" },
  "League One": { code: "E2", country: "England" },
  "League Two": { code: "E3", country: "England" },
  "Scottish Premiership": { code: "SC0", country: "Scotland" },
  "Scottish Championship": { code: "SC1", country: "Scotland" },
  Bundesliga: { code: "D1", country: "Germany" },
  "2. Bundesliga": { code: "D2", country: "Germany" },
  "Serie A": { code: "I1", country: "Italy" },
  "Serie B": { code: "I2", country: "Italy" },
  "La Liga": { code: "SP1", country: "Spain" },
  "Segunda División": { code: "SP2", country: "Spain" },
  "Ligue 1": { code: "F1", country: "France" },
  "Ligue 2": { code: "F2", country: "France" },
  Eredivisie: { code: "N1", country: "Netherlands" },
  "Belgian Pro League": { code: "B1", country: "Belgium" },
  "Primeira Liga": { code: "P1", country: "Portugal" },
  "Süper Lig": { code: "T1", country: "Turkey" },
  "Super League Greece": { code: "G1", country: "Greece" },
};

const cache = new Map();
const statisticsByFixture = new Map();
const normalized = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
function turkeyDate(kickoff) {
  const date = new Date(kickoff);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function seasonFor(date) {
  const value = new Date(`${date}T00:00:00Z`);
  const year = value.getUTCFullYear();
  const start = value.getUTCMonth() < 7 ? year - 1 : year;
  return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
}
function seasonKeys(before, count = 5) {
  const current = seasonFor(String(before).slice(0, 10));
  const start = Number(current.slice(0, 2));
  return Array.from({ length: count }, (_, i) => {
    const year = (start - i + 100) % 100;
    return `${String(year).padStart(2, "0")}${String((year + 1) % 100).padStart(2, "0")}`;
  });
}
function parseCsvLine(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { fields.push(value.trim()); value = ""; }
    else value += char;
  }
  fields.push(value.trim());
  return fields;
}
function parseDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const month = Number(match[2]);
  const day = Number(match[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function toFixture(row, leagueName, meta, season) {
  const date = parseDate(row.Date);
  if (!date || !row.HomeTeam || !row.AwayTeam) return null;
  const homeGoals = row.FTHG !== "" && row.FTHG != null && Number.isFinite(Number(row.FTHG)) ? Number(row.FTHG) : null;
  const awayGoals = row.FTAG !== "" && row.FTAG != null && Number.isFinite(Number(row.FTAG)) ? Number(row.FTAG) : null;
  const finished = homeGoals !== null && awayGoals !== null;
  const time = /^\d{1,2}:\d{2}$/.test(row.Time || "") ? row.Time : null;
  const kickoff = time ? localKickoffToUtc(date, time, meta.country) : date;
  const id = `fdu-${meta.code.toLowerCase()}-${season}-${date}-${normalized(row.HomeTeam)}-${normalized(row.AwayTeam)}`;
  statisticsByFixture.set(id, { row, leagueName, meta, season, homeName: row.HomeTeam, awayName: row.AwayTeam });
  return {
    provider: "football-data-uk",
    providers: ["football-data-uk"],
    fixture: { id, date: kickoff, kickoffPrecision: time ? "time" : "date", status: { short: finished ? "FINISHED" : "SCHEDULED" } },
    league: { id: meta.code, name: leagueName, country: meta.country, season },
    teams: { home: { id: `fdu-team-${normalized(row.HomeTeam)}`, name: row.HomeTeam }, away: { id: `fdu-team-${normalized(row.AwayTeam)}`, name: row.AwayTeam } },
    goals: { home: homeGoals, away: awayGoals },
  };
}
async function loadLeague(leagueName, season) {
  const meta = LEAGUES[leagueName];
  if (!meta) return [];
  const key = `${meta.code}:${season}`;
  if (cache.get(key)?.expiresAt > Date.now()) return cache.get(key).value;
  const promise = axios.get(`${BASE_URL}/${season}/${meta.code}.csv`, { timeout: 15000, responseType: "text" })
    .then((response) => {
      const lines = String(response.data || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
      if (!lines.length) return [];
      const headers = parseCsvLine(lines[0]).map((value) => value.replace(/^"|"$/g, ""));
      return lines.slice(1).map((line) => {
        const cells = parseCsvLine(line);
        return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
      }).map((row) => toFixture(row, leagueName, meta, season)).filter(Boolean);
    })
    .catch((error) => {
      cache.delete(key);
      if (error.response?.status === 404) return [];
      throw createProviderError(error);
    });
  cache.set(key, { value: promise, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return promise;
}
async function getFixtures(date, league) {
  const names = league && LEAGUES[league] ? [league] : Object.keys(LEAGUES);
  const season = seasonFor(date);
  const results = new Array(names.length);
  await forEachConcurrent(names, 4, async (name, index) => {
    try { results[index] = (await loadLeague(name, season)).filter((fixture) => (fixture.fixture.kickoffPrecision === "date" ? fixture.fixture.date.slice(0, 10) : turkeyDate(fixture.fixture.date)) === date); }
    catch { results[index] = []; }
  });
  return results.flat();
}
async function getFixture(fixtureId) {
  const match = String(fixtureId).match(/^fdu-[a-z0-9]+-(\d{4})-(\d{4}-\d{2}-\d{2})-/);
  if (!match) return null;
  const season = match[1];
  const date = match[2];
  const leagueName = Object.keys(LEAGUES).find((name) => `fdu-${LEAGUES[name].code.toLowerCase()}-${season}-` === String(fixtureId).slice(0, `fdu-${LEAGUES[name].code.toLowerCase()}-${season}-`.length));
  if (!leagueName) return null;
  return (await loadLeague(leagueName, season)).find((fixture) => fixture.fixture.id === fixtureId) || null;
}

function numberField(row, field) {
  if (row?.[field] === "" || row?.[field] == null) return null;
  const value = Number(row[field]);
  return Number.isFinite(value) ? value : null;
}
function getStatistics(fixtureId) {
  const entry = statisticsByFixture.get(String(fixtureId));
  if (!entry) return [];
  const fields = [
    ["HS", "Total Shots"], ["HST", "Shots on Goal"], ["HC", "Corner Kicks"],
    ["HF", "Fouls"], ["HY", "Yellow Cards"], ["HR", "Red Cards"],
  ];
  const make = (side) => {
    const prefix = side === "home" ? "H" : "A";
    return {
      team: { id: `fdu-team-${normalized(side === "home" ? entry.homeName : entry.awayName)}` },
      statistics: fields.map(([field, type]) => ({ type, value: numberField(entry.row, side === "home" ? field : field.replace(/^H/, prefix) })).filter((stat) => stat.value !== null),
    };
  };
  return [make("home"), make("away")].filter((row) => row.statistics.length);
}
function beforeKickoff(match, before) {
  const date = String(match?.fixture?.date || "");
  if (!date || !before) return false;
  if (match.fixture?.kickoffPrecision === "date" || /^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return date.slice(0, 10) < String(before).slice(0, 10);
  return Number.isFinite(Date.parse(date)) && Date.parse(date) < Date.parse(before);
}
async function getH2H(homeId, awayId, context = {}) {
  const leagueName = context.league?.name;
  const before = context.before;
  const home = normalized(context.home?.name || String(homeId).replace(/^fdu-team-/, ""));
  const away = normalized(context.away?.name || String(awayId).replace(/^fdu-team-/, ""));
  if (!LEAGUES[leagueName] || !home || !away || !before) return [];
  const seasons = seasonKeys(before, 5);
  const results = [];
  for (const season of seasons) {
    try {
      const matches = await loadLeague(leagueName, season);
      results.push(...matches.filter((match) => {
        const a = normalized(match.teams.home.name); const b = normalized(match.teams.away.name);
        return ((a === home && b === away) || (a === away && b === home))
          && beforeKickoff(match, before) && match.fixture.status.short === "FINISHED"
          && Number.isFinite(match.goals.home) && Number.isFinite(match.goals.away);
      }));
    } catch { /* Keep collecting verified meetings from other seasons. */ }
  }
  return results.sort((a, b) => Date.parse(b.fixture.date) - Date.parse(a.fixture.date)).slice(0, 10);
}
async function getStandings(leagueId, season, context = {}) {
  const leagueName = Object.keys(LEAGUES).find((name) => LEAGUES[name].code === String(leagueId)) || context.league?.name;
  const before = context.before;
  if (!LEAGUES[leagueName] || !before) return [];
  let matches = [];
  try { matches = await loadLeague(leagueName, seasonFor(String(before).slice(0, 10))); } catch { return []; }
  const table = new Map();
  const ensure = (name) => {
    if (!table.has(name)) table.set(name, { team: { id: `fdu-team-${normalized(name)}`, name }, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 });
    return table.get(name);
  };
  for (const match of matches) {
    if (!beforeKickoff(match, before) || match.fixture.status.short !== "FINISHED" || !Number.isFinite(match.goals.home) || !Number.isFinite(match.goals.away)) continue;
    const home = ensure(match.teams.home.name); const away = ensure(match.teams.away.name);
    home.played++; away.played++; home.goalsFor += match.goals.home; home.goalsAgainst += match.goals.away; away.goalsFor += match.goals.away; away.goalsAgainst += match.goals.home;
    if (match.goals.home > match.goals.away) { home.won++; away.lost++; home.points += 3; }
    else if (match.goals.home < match.goals.away) { away.won++; home.lost++; away.points += 3; }
    else { home.drawn++; away.drawn++; home.points++; away.points++; }
  }
  const rows = [...table.values()].sort((a, b) => b.points - a.points || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor || a.team.name.localeCompare(b.team.name));
  rows.forEach((row, index) => { row.rank = index + 1; row.all = { played: row.played, win: row.won, draw: row.drawn, lose: row.lost, goals: { for: row.goalsFor, against: row.goalsAgainst } }; delete row.played; delete row.won; delete row.drawn; delete row.lost; delete row.goalsFor; delete row.goalsAgainst; });
  return rows.length ? [{ league: { standings: [rows] } }] : [];
}

async function getTeamForm(teamId, before = new Date().toISOString(), context = {}) {
  const leagueName = context.league?.name;
  if (!LEAGUES[leagueName]) return [];
  const team = context.team?.name || String(teamId).replace(/^fdu-team-/, "");
  const target = normalized(team);
  const seasons = seasonKeys(before, 5);
  const results = [];
  for (const season of seasons) {
    try {
      const fixtures = await loadLeague(leagueName, season);
      results.push(...fixtures.filter((fixture) => {
        const date = fixture.fixture.date;
        return normalized(fixture.teams.home.name) === target || normalized(fixture.teams.away.name) === target
          ? fixture.fixture.kickoffPrecision === "date" ? date.slice(0, 10) < String(before).slice(0, 10) : Date.parse(date) < Date.parse(before)
          : false;
      }));
    } catch { /* Continue with other real historical seasons. */ }
  }
  return results.filter((fixture) => fixture.fixture.status.short === "FINISHED" && Number.isFinite(fixture.goals.home) && Number.isFinite(fixture.goals.away))
    .sort((a, b) => Date.parse(b.fixture.date) - Date.parse(a.fixture.date)).slice(0, 10);
}
module.exports = {
  name: "football-data-uk", configured: true, enabled: true,
  capabilities: ["fixtures", "fixture", "result", "teamForm", "historicalResults", "form", "h2h", "standings", "statistics"],
  getFixtures, getFixture, getTeamForm, getH2H, getStandings, getStatistics, supportsLeague: (name) => Boolean(LEAGUES[name]),
  supportsHistoricalLeague: (league) => Boolean(LEAGUES[league?.name]),
  LEAGUES, seasonFor, seasonKeys, parseCsvLine, parseDate, toFixture, turkeyDate,
};
