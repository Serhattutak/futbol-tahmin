const axios = require("axios");
const { localKickoffToUtc } = require("../services/localKickoff");
const { createProviderError } = require("../services/apiFootballClient");

const { collectDivisionHistory } = require("../services/divisionHistory");
const BASE_URL = "https://raw.githubusercontent.com/openfootball/football.json/master";
const LEAGUES = {
  "Premier League": { file: "en.1.json", country: "England" },
  "Championship": { file: "en.2.json", country: "England" },
  "La Liga": { file: "es.1.json", country: "Spain" },
  Bundesliga: { file: "de.1.json", country: "Germany" },
  "Serie A": { file: "it.1.json", country: "Italy" },
  "Ligue 1": { file: "fr.1.json", country: "France" },
  Eredivisie: { file: "nl.1.json", country: "Netherlands" },
  "Primeira Liga": { file: "pt.1.json", country: "Portugal" },
  "Scottish Premiership": { file: "sco.1.json", country: "Scotland" },
  "Campeonato Brasileiro Série A": { file: "br.1.json", country: "Brazil", calendarYear: true },
};
const cache = new Map();
const HISTORICAL_LEAGUES = { ...LEAGUES, "Segunda División": { file: "es.2.json", country: "Spain" } };
const TEAM_ALIASES = new Map();

function seasonKey(date) {
  const year = new Date(`${date}T00:00:00`).getFullYear();
  return `${year - (new Date(`${date}T00:00:00`).getMonth() < 7 ? 1 : 0)}-${String(year + (new Date(`${date}T00:00:00`).getMonth() < 7 ? 0 : 1)).slice(-2)}`;
}
function seasonKeyFor(meta, date) {
  if (meta.calendarYear) return String(new Date(`${date}T00:00:00`).getFullYear());
  return seasonKey(date);
}
function normalizeName(value) { return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }
function deterministicId(match, league) { return `of-${normalizeName(league)}-${match.date}-${normalizeName(match.team1)}-${normalizeName(match.team2)}`; }
function scoreOf(score) { if (Array.isArray(score)) return score; if (Array.isArray(score?.ft)) return score.ft; return null; }
function toFixture(match, leagueName, meta, season) {
  const score = scoreOf(match.score);
  const id = deterministicId(match, leagueName);
  const homeId = `of-team-${normalizeName(match.team1)}`;
  const awayId = `of-team-${normalizeName(match.team2)}`;
  TEAM_ALIASES.set(homeId, match.team1); TEAM_ALIASES.set(awayId, match.team2);
  return { provider: "openfootball", providers: ["openfootball"], fixture: { id, date: match.time ? localKickoffToUtc(match.date, match.time, meta.country) : match.date, kickoffPrecision: match.time ? "time" : "date", status: { short: score ? "FINISHED" : "SCHEDULED" } }, league: { id: `of-league-${normalizeName(leagueName)}`, name: leagueName, country: meta.country, season }, teams: { home: { id: homeId, name: match.team1 }, away: { id: awayId, name: match.team2 } }, score: { halftime: Array.isArray(match.score?.ht) ? { home: match.score.ht[0], away: match.score.ht[1] } : { home: null, away: null } }, goals: { home: score ? score[0] : null, away: score ? score[1] : null } };
}
async function loadLeague(leagueName, season) {
  const meta = HISTORICAL_LEAGUES[leagueName]; if (!meta) return [];
  const key = `${leagueName}:${season}`; if (cache.get(key)?.expiresAt > Date.now()) return cache.get(key).value;
  const promise = axios.get(`${BASE_URL}/${season}/${meta.file}`, { timeout: 15000 }).then((response) => (response.data.matches || []).map((match) => toFixture(match, leagueName, meta, season))).catch((error) => { cache.delete(key); if (error.response?.status === 404) return []; throw createProviderError(error); });
  cache.set(key, { value: promise, expiresAt: Date.now() + 5 * 60 * 1000 }); return promise;
}
async function getFixtures(date, league) {
  const all = []; let lastError;
  for (const leagueName of league && LEAGUES[league] ? [league] : Object.keys(LEAGUES)) {
    try {
      const meta = LEAGUES[leagueName];
      const fixtures = await loadLeague(leagueName, seasonKeyFor(meta, date));
      all.push(...fixtures.filter((fixture) => fixture.fixture.date.slice(0, 10) === date));
    } catch (error) { lastError = error; }
  }
  if (!all.length && lastError) throw lastError;
  return all;
}
async function getFixture(fixtureId) { for (const leagueName of Object.keys(LEAGUES)) { const meta = LEAGUES[leagueName]; const date = String(fixtureId).match(/\d{4}-\d{2}-\d{2}/)?.[0] || new Date().toISOString().slice(0, 10); const fixtures = await loadLeague(leagueName, seasonKeyFor(meta, date)); const found = fixtures.find((fixture) => fixture.fixture.id === fixtureId); if (found) return found; } return null; }
async function getTeamForm(teamId, before = new Date().toISOString(), context = {}) {
  const team = context.team || { name: TEAM_ALIASES.get(teamId) };
  return collectDivisionHistory({ team, before, fixtureId: context.fixtureId, league: context.league, catalog: HISTORICAL_LEAGUES, load: loadLeague });
}
function matchBeforeFixture(match, before) {
  const matchDate = String(match?.fixture?.date || "").slice(0, 10);
  const beforeDate = String(before || "").slice(0, 10);
  if (!matchDate || !beforeDate) return false;
  const dateOnly = match.fixture?.kickoffPrecision === "date" || /^\d{4}-\d{2}-\d{2}$/.test(match.fixture?.date || "");
  // A date-only result cannot prove it finished before another match on the same day.
  if (dateOnly) return matchDate < beforeDate;
  return Number.isFinite(Date.parse(match.fixture.date)) && Date.parse(match.fixture.date) < Date.parse(before);
}

function selectHeadToHead(fixtures, homeName, awayName, before) {
  const home = normalizeName(homeName);
  const away = normalizeName(awayName);
  if (!home || !away) return [];
  return (fixtures || []).filter((match) => {
    const a = normalizeName(match.teams?.home?.name);
    const b = normalizeName(match.teams?.away?.name);
    return (a === home && b === away || a === away && b === home)
      && matchBeforeFixture(match, before)
      && match.fixture?.status?.short === "FINISHED"
      && Number.isFinite(match.goals?.home) && Number.isFinite(match.goals?.away)
      && match.goals.home >= 0 && match.goals.away >= 0;
  }).sort((a, b) => Date.parse(b.fixture.date) - Date.parse(a.fixture.date)).slice(0, 10);
}

function calculateStandingsRows(fixtures, before) {
  const table = new Map();
  const ensure = (team) => {
    const key = normalizeName(team?.name);
    if (!key) return null;
    if (!table.has(key)) table.set(key, { team: { id: team.id, name: team.name }, rank: 0, points: 0, all: { played: 0, win: 0, draw: 0, lose: 0, goals: { for: 0, against: 0, diff: 0 } } });
    return table.get(key);
  };
  for (const match of fixtures || []) {
    if (!matchBeforeFixture(match, before) || match.fixture?.status?.short !== "FINISHED"
      || !Number.isFinite(match.goals?.home) || !Number.isFinite(match.goals?.away)
      || match.goals.home < 0 || match.goals.away < 0) continue;
    const home = ensure(match.teams?.home);
    const away = ensure(match.teams?.away);
    if (!home || !away) continue;
    const hg = match.goals.home;
    const ag = match.goals.away;
    home.all.played++; away.all.played++;
    home.all.goals.for += hg; home.all.goals.against += ag;
    away.all.goals.for += ag; away.all.goals.against += hg;
    if (hg > ag) { home.points += 3; home.all.win++; away.all.lose++; }
    else if (hg < ag) { away.points += 3; away.all.win++; home.all.lose++; }
    else { home.points++; away.points++; home.all.draw++; away.all.draw++; }
  }
  const rows = [...table.values()];
  for (const row of rows) row.all.goals.diff = row.all.goals.for - row.all.goals.against;
  rows.sort((a, b) => b.points - a.points || b.all.goals.diff - a.all.goals.diff || b.all.goals.for - a.all.goals.for || a.team.name.localeCompare(b.team.name));
  rows.forEach((row, index) => { row.rank = index + 1; });
  return rows;
}

function previousSeasonKey(meta, date) {
  const current = seasonKeyFor(meta, date);
  if (meta.calendarYear) return String(Number(current) - 1);
  const start = Number(current.slice(0, 4)) - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

async function getH2H(homeId, awayId, context = {}) {
  const leagueName = context.league?.name;
  const meta = HISTORICAL_LEAGUES[leagueName];
  const homeName = context.home?.name || TEAM_ALIASES.get(String(homeId));
  const awayName = context.away?.name || TEAM_ALIASES.get(String(awayId));
  const before = context.before;
  if (!meta || !homeName || !awayName || !before) return [];
  const date = String(before).slice(0, 10);
  const seasons = [...new Set([seasonKeyFor(meta, date), previousSeasonKey(meta, date)])];
  const fixtures = [];
  for (const season of seasons) {
    try { fixtures.push(...await loadLeague(leagueName, season)); } catch { /* Preserve results from any available season. */ }
  }
  return selectHeadToHead(fixtures, homeName, awayName, before);
}

async function getStandings(leagueId, season, context = {}) {
  const leagueName = context.league?.name || Object.keys(HISTORICAL_LEAGUES).find((name) => `of-league-${normalizeName(name)}` === String(leagueId));
  const meta = HISTORICAL_LEAGUES[leagueName];
  const before = context.before;
  if (!meta || !before) return [];
  const seasonKeyValue = season || seasonKeyFor(meta, String(before).slice(0, 10));
  let fixtures;
  try { fixtures = await loadLeague(leagueName, seasonKeyValue); } catch { return []; }
  const rows = calculateStandingsRows(fixtures, before);
  return rows.length ? [{ league: { id: leagueId, name: leagueName, standings: [rows] } }] : [];
}

// Bulk historical replay shares the existing provider normalization and cache.
module.exports = { name: "openfootball", configured: true, enabled: true, capabilities: ["fixtures", "fixture", "teamForm", "h2h", "standings", "result", "historicalResults"], getSeasonFixtures: loadLeague, getFixtures, getFixture, getTeamForm, getH2H, getStandings, selectHeadToHead, calculateStandingsRows, historicalLeagues: HISTORICAL_LEAGUES, supportsHistoricalLeague: (league) => Boolean(HISTORICAL_LEAGUES[league?.name]) && (!league.country || HISTORICAL_LEAGUES[league.name].country === league.country), supportsLeague: (name) => Boolean(LEAGUES[name]) };
