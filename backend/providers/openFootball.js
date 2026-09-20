const axios = require("axios");
const { localKickoffToUtc } = require("../services/localKickoff");
const { createProviderError } = require("../services/apiFootballClient");

const { collectDivisionHistory } = require("../services/divisionHistory");
const BASE_URL = "https://raw.githubusercontent.com/openfootball/football.json/master";
const LEAGUES = {
  "Premier League": { file: "en.1.json", country: "England" },
  "La Liga": { file: "es.1.json", country: "Spain" },
  Bundesliga: { file: "de.1.json", country: "Germany" },
  "Serie A": { file: "it.1.json", country: "Italy" },
  "Ligue 1": { file: "fr.1.json", country: "France" },
  Eredivisie: { file: "nl.1.json", country: "Netherlands" },
  "Primeira Liga": { file: "pt.1.json", country: "Portugal" },
  "Scottish Premiership": { file: "sco.1.json", country: "Scotland" },
};
const cache = new Map();
const HISTORICAL_LEAGUES = { ...LEAGUES, "Segunda División": { file: "es.2.json", country: "Spain" } };
const TEAM_ALIASES = new Map();

function seasonKey(date) {
  const year = new Date(`${date}T00:00:00`).getFullYear();
  return `${year - (new Date(`${date}T00:00:00`).getMonth() < 7 ? 1 : 0)}-${String(year + (new Date(`${date}T00:00:00`).getMonth() < 7 ? 0 : 1)).slice(-2)}`;
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
  const season = seasonKey(date); const all = []; let lastError;
  for (const leagueName of league && LEAGUES[league] ? [league] : Object.keys(LEAGUES)) {
    try {
      const fixtures = await loadLeague(leagueName, season);
      all.push(...fixtures.filter((fixture) => fixture.fixture.date.slice(0, 10) === date));
    } catch (error) { lastError = error; }
  }
  if (!all.length && lastError) throw lastError;
  return all;
}
async function getFixture(fixtureId) { for (const leagueName of Object.keys(LEAGUES)) { const fixtures = await loadLeague(leagueName, seasonKey(String(fixtureId).match(/\d{4}-\d{2}-\d{2}/)?.[0] || new Date().toISOString().slice(0, 10))); const found = fixtures.find((fixture) => fixture.fixture.id === fixtureId); if (found) return found; } return null; }
async function getTeamForm(teamId, before = new Date().toISOString(), context = {}) {
  const team = context.team || { name: TEAM_ALIASES.get(teamId) };
  return collectDivisionHistory({ team, before, fixtureId: context.fixtureId, league: context.league, catalog: HISTORICAL_LEAGUES, load: loadLeague });
}
async function getH2H() { return null; }
// Bulk historical replay shares the existing provider normalization and cache.
async function getStandings() { return null; }
module.exports = { name: "openfootball", configured: true, enabled: true, capabilities: ["fixtures", "fixture", "teamForm", "result", "historicalResults"], getSeasonFixtures: loadLeague, getFixtures, getFixture, getTeamForm, getH2H, getStandings, historicalLeagues: HISTORICAL_LEAGUES, supportsHistoricalLeague: (league) => Boolean(HISTORICAL_LEAGUES[league?.name]) && (!league.country || HISTORICAL_LEAGUES[league.name].country === league.country), supportsLeague: (name) => Boolean(LEAGUES[name]) };
