const axios = require("axios");
const { createProviderError } = require("../services/apiFootballClient");
const { normalizeStatus, normalizeKickoff } = require("../services/fixtureNormalization");
const API_KEY = process.env.THESPORTSDB_API_KEY || "123";
const BASE_URL = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;
const cache = new Map();
function normalized(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function toFixture(event) { if (!event?.idEvent || !event.strHomeTeam || !event.strAwayTeam) return null; const date = event.dateEvent || event.strTimestamp?.slice(0, 10); if (!date) return null; return { provider: "thesportsdb", providers: ["thesportsdb"], fixture: { id: `tsdb-${event.idEvent}`, date: event.strTimestamp ? normalizeKickoff(event.strTimestamp) : event.strTime ? normalizeKickoff(`${date}T${event.strTime}`) : date, kickoffPrecision: event.strTimestamp || event.strTime ? "time" : "date", status: { short: normalizeStatus(event.strStatus) } }, league: { id: event.idLeague || null, name: event.strLeague || null, country: event.strCountry || null }, teams: { home: { id: `tsdb-team-${normalized(event.strHomeTeam)}`, name: event.strHomeTeam }, away: { id: `tsdb-team-${normalized(event.strAwayTeam)}`, name: event.strAwayTeam } }, goals: { home: event.intHomeScore == null || event.intHomeScore === "" ? null : Number(event.intHomeScore), away: event.intAwayScore == null || event.intAwayScore === "" ? null : Number(event.intAwayScore) } }; }
async function request(path, params) { const key = `${path}?${new URLSearchParams(params || {})}`; if (cache.get(key)?.expiresAt > Date.now()) return cache.get(key).value; const promise = axios.get(`${BASE_URL}/${path}`, { params, timeout: 15000 }).then((response) => response.data).catch((error) => { cache.delete(key); if (error.response?.status === 404) return null; throw createProviderError(error); }); cache.set(key, { value: promise, expiresAt: Date.now() + 5 * 60 * 1000 }); if (cache.size > 200) cache.delete(cache.keys().next().value); return promise; }
async function getFixtures(date) { const data = await request("eventsday.php", { d: date, s: "Soccer" }); return (data?.events || []).map(toFixture).filter(Boolean); }
async function getFixture(fixtureId) { const id = String(fixtureId).replace(/^tsdb-/, ""); const data = await request("lookupevent.php", { id }); return toFixture(data?.events?.[0]); }
function selectTeamHistory(events, teamName, before = new Date().toISOString()) {
  const cutoff = Date.parse(before);
  const cutoffDay = String(before).slice(0, 10);
  const team = normalized(teamName);
  if (!team || !Number.isFinite(cutoff)) return [];
  return (events || []).map(toFixture).filter(fixture => {
    if (!fixture || fixture.fixture.status.short !== "FINISHED"
      || !Number.isFinite(fixture.goals.home) || !Number.isFinite(fixture.goals.away)) return false;
    if (normalized(fixture.teams.home.name) !== team && normalized(fixture.teams.away.name) !== team) return false;
    if (fixture.fixture.kickoffPrecision === "date") return fixture.fixture.date.slice(0, 10) < cutoffDay;
    const kickoff = Date.parse(fixture.fixture.date);
    return Number.isFinite(kickoff) && kickoff < cutoff;
  }).sort((a, b) => Date.parse(b.fixture.date) - Date.parse(a.fixture.date)).slice(0, 10);
}
async function getTeamForm(_teamId, before, context = {}) {
  const teamName = context.team?.name;
  if (!teamName) return [];
  const found = await request("searchteams.php", { t: teamName });
  const team = (found?.teams || []).find(row => normalized(row.strTeam) === normalized(teamName));
  if (!team?.idTeam) return [];
  if (team.idLeague) {
    const leagueEvents = await request("eventspastleague.php", { id: team.idLeague });
    const selected = selectTeamHistory(leagueEvents?.events, teamName, before);
    if (selected.length) return selected;
  }
  const teamEvents = await request("eventslast.php", { id: team.idTeam });
  return selectTeamHistory(teamEvents?.results || teamEvents?.events, teamName, before);
}
async function getH2H() { return null; }
async function getStandings() { return null; }
module.exports = { name: "thesportsdb", configured: true, enabled: true, capabilities: ["fixtures", "fixture", "result", "teamForm", "historicalResults"], getFixtures, getFixture, getTeamForm, getH2H, getStandings, toFixture, selectTeamHistory };
