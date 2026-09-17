const axios = require("axios");
const { ProviderError } = require("../services/apiFootballClient");

const { normalizeStatus, normalizeKickoff } = require("../services/fixtureNormalization");
const token = process.env.SPORTMONKS_API_TOKEN;
const client = axios.create({ baseURL: "https://api.sportmonks.com/v3/football", timeout: 10000 });

function providerError(error) {
  const status = error.response?.status;
  if (status === 401 || status === 403) return new ProviderError("authentication", "Sportmonks kimlik doğrulamasını reddetti.");
  if (status === 429) return new ProviderError("quota", "Sportmonks kotası aşıldı.");
  if (status >= 500) return new ProviderError("provider_unavailable", "Sportmonks geçici olarak kullanılamıyor.");
  if (!error.response) return new ProviderError("timeout_network", "Sportmonks zaman aşımına uğradı.");
  return new ProviderError("unexpected_provider_response", "Sportmonks beklenmeyen yanıt döndürdü.");
}

function participant(fixture, location) { return (fixture.participants || []).find((item) => item.meta?.location === location || item.meta?.position === location) || null; }
function finalScore(fixture) { const home = (fixture.scores || []).find((item) => item.description === "CURRENT" && item.score?.participant === "home")?.score?.goals; const away = (fixture.scores || []).find((item) => item.description === "CURRENT" && item.score?.participant === "away")?.score?.goals; return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null; }
function toFixture(fixture) { if (!fixture) return null; const kickoff = normalizeKickoff(fixture.starting_at); if (!kickoff) return null; const home = participant(fixture, "home"); const away = participant(fixture, "away"); const score = finalScore(fixture); if (!fixture?.id || !fixture?.starting_at || !home?.name || !away?.name) return null; return { provider: "sportmonks", fixture: { id: `sm-${fixture.id}`, date: kickoff, status: { short: normalizeStatus(fixture.state?.short_name || fixture.state?.developer_name || fixture.state?.name) } }, league: { id: fixture.league?.id ?? null, name: fixture.league?.name ?? null, country: fixture.league?.country?.name ?? null, season: fixture.season?.id ?? null }, teams: { home: { id: `sm-team-${home.id}`, name: home.name, logo: home.image_path || null }, away: { id: `sm-team-${away.id}`, name: away.name, logo: away.image_path || null } }, goals: { home: score?.home ?? null, away: score?.away ?? null } }; }
const includes = "participants;league;season;state;scores";
const cache = new Map();
async function request(path, include = includes) {
  if (!token) throw new ProviderError("authentication", "Sportmonks token unavailable.");
  const key = `${path}:${include}`; const cached = cache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.value;
  const value = client.get(path, { params: { api_token: token, include, per_page: 50, ...(path.startsWith("/fixtures/") ? { sortBy: "starting_at", order: "desc" } : {}) } }).then((response) => {
    const data = response.data?.data;
    return Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
  }).catch((error) => { cache.delete(key); if (error.response?.status === 404) return []; throw providerError(error); });
  cache.set(key, { value, expiresAt: Date.now() + 5 * 60 * 1000 });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}
const rawId = (id) => String(id).replace(/^sm-(team-)?/, "");
async function getFixtures(date) { return (await request(`/fixtures/date/${date}`)).map(toFixture).filter(Boolean); }
async function getFixture(id) { return toFixture((await request(`/fixtures/${rawId(id)}`))[0]); }
async function getTeamForm(id, before = new Date().toISOString()) {
  const end = new Date(Math.min(Date.parse(before), Date.now()));
  const start = new Date(end.getTime() - 180 * 86400000).toISOString().slice(0, 10);
  return (await request(`/fixtures/between/${start}/${end.toISOString().slice(0, 10)}/${rawId(id)}`)).map(toFixture).filter(Boolean);
}
async function getH2H(home, away) { return (await request(`/fixtures/head-to-head/${rawId(home)}/${rawId(away)}`)).map(toFixture).filter(Boolean); }
async function getStandings(league, season) {
  if (!season) return [];
  const rows = await request(`/standings/seasons/${season}`, "participant;details.type");
  return [{ league: { standings: [rows.map((row) => ({ team: { id: `sm-team-${row.participant_id}` }, rank: row.position, points: row.points, all: { played: row.details?.find((d) => d.type?.developer_name === "OVERALL_MATCHES_PLAYED")?.value ?? null } }))] } }];
}
async function getStatistics(id) {
  const fixture = (await request(`/fixtures/${rawId(id)}`, "statistics.type;xGFixture.type"))[0];
  const teams = new Map();
  const names = { "shots-total": "Total Shots", "shots-on-target": "Shots on Goal", "ball-possession": "Ball Possession", "expected-goals": "Expected Goals", "xg": "Expected Goals", "corners": "Corner Kicks", "yellowcards": "Yellow Cards", "redcards": "Red Cards" };
  for (const stat of [...(fixture?.statistics || []), ...(fixture?.xGFixture || [])]) {
    const key = String(stat.type?.code || stat.type?.developer_name || "").toLowerCase().replace(/_/g, "-");
    const type = names[key]; const raw = stat.data?.value;
    if (!type || raw == null || !Number.isFinite(Number(raw)) || !stat.participant_id) continue;
    const id = `sm-team-${stat.participant_id}`;
    if (!teams.has(id)) teams.set(id, { team: { id }, statistics: [] });
    teams.get(id).statistics.push({ type, value: Number(raw) });
  }
  return [...teams.values()];
}
async function getOdds(id) {
  const rows = await request(`/odds/pre-match/fixtures/${rawId(id)}`, "market;bookmaker");
  const bookmakers = new Map();
  for (const row of rows) {
    if (row.stopped || row.value == null || !row.market?.name) continue;
    const key = row.bookmaker_id;
    if (!bookmakers.has(key)) bookmakers.set(key, { name: row.bookmaker?.name || null, bets: [] });
    const name = row.market.name === "Fulltime Result" ? "Match Winner" : row.market.name;
    let value = ({ "1": "Home", "2": "Away", "X": "Draw" })[row.label] || row.label;
    if (/^(over|under)$/i.test(value || "") && row.total != null) value += ` ${row.total}`;
    bookmakers.get(key).bets.push({ name, values: [{ value, odd: row.value }] });
  }
  return [{ bookmakers: [...bookmakers.values()] }];
}
module.exports = { name: "sportmonks", configured: Boolean(token), enabled: Boolean(token), capabilities: ["fixtures", "fixture", "result", "teamForm", "h2h", "standings", "statistics", "odds"], getFixtures, getFixture, getTeamForm, getH2H, getStandings, getStatistics, getOdds, toFixture };
