const axios = require("axios");
const { ProviderError } = require("../services/apiFootballClient");

const { normalizeStatus, normalizeKickoff } = require("../services/fixtureNormalization");
const token = process.env.FOOTBALL_DATA_API_TOKEN;
const client = axios.create({ baseURL: "https://api.football-data.org/v4", timeout: 10000, headers: token ? { "X-Auth-Token": token } : {} });
function providerError(error) { const status = error.response?.status; if (status === 401 || status === 403) return new ProviderError("authentication", "football-data.org kimlik doğrulamasını reddetti."); if (status === 429) return new ProviderError("quota", "football-data.org kotası aşıldı."); if (status >= 500) return new ProviderError("provider_unavailable", "football-data.org geçici olarak kullanılamıyor."); if (!error.response) return new ProviderError("timeout_network", "football-data.org zaman aşımına uğradı."); return new ProviderError("unexpected_provider_response", "football-data.org beklenmeyen yanıt döndürdü."); }
function toFixture(match) { if (!match?.id || !match?.utcDate || !match?.homeTeam?.name || !match?.awayTeam?.name) return null; const score = match.score?.fullTime || {}; return { provider: "football-data", fixture: { id: `fd-${match.id}`, date: normalizeKickoff(match.utcDate), status: { short: normalizeStatus(match.status) } }, league: { id: match.competition?.id ?? null, name: match.competition?.name ?? null, country: match.area?.name ?? null, season: match.season?.id ?? null }, teams: { home: { id: `fd-team-${match.homeTeam.id}`, name: match.homeTeam.name, logo: match.homeTeam.crest || null }, away: { id: `fd-team-${match.awayTeam.id}`, name: match.awayTeam.name, logo: match.awayTeam.crest || null } }, goals: { home: Number.isFinite(score.home) ? score.home : null, away: Number.isFinite(score.away) ? score.away : null } }; }
const cache = new Map();
async function request(path, params) {
  if (!token) throw new ProviderError("authentication", "football-data token unavailable.");
  const key = `${path}:${JSON.stringify(params || {})}`;
  if (cache.get(key)?.expiresAt > Date.now()) return cache.get(key).value;
  const value = client.get(path, { params }).then((response) => response.data).catch((error) => { cache.delete(key); if (error.response?.status === 404) return {}; throw providerError(error); });
  cache.set(key, { value, expiresAt: Date.now() + 5 * 60 * 1000 });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}
async function getFixtures(date) { const data = await request("/matches", { dateFrom: date, dateTo: date }); return (data.matches || []).map(toFixture).filter(Boolean); }
async function getFixture(fixtureId) { const id = String(fixtureId).replace(/^fd-/, ""); return toFixture(await request(`/matches/${id}`)); }

async function getTeamForm(id, before = new Date().toISOString()) {
  const dateTo = new Date(Math.min(Date.parse(before), Date.now())).toISOString().slice(0, 10);
  const data = await request(`/teams/${String(id).replace(/^fd-team-/, "")}/matches`, { status: "FINISHED", limit: 10, dateTo });
  return (data.matches || []).map(toFixture).filter(Boolean);
}
async function getStandings(league) {
  if (!league) return [];
  const data = await request(`/competitions/${league}/standings`);
  return [{ league: { standings: (data.standings || []).filter((group) => group.type === "TOTAL").map((group) => (group.table || []).map((row) => ({ team: { id: `fd-team-${row.team.id}` }, rank: row.position, points: row.points, all: { played: row.playedGames } }))) } }];
}
module.exports = { name: "football-data", configured: Boolean(token), enabled: Boolean(token), capabilities: ["fixtures", "fixture", "result", "teamForm", "standings"], getFixtures, getFixture, getTeamForm, getStandings, toFixture };
