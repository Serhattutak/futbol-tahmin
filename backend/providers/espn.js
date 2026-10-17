const axios = require("axios");
const { createProviderError } = require("../services/apiFootballClient");
const { normalizeStatus, normalizeKickoff } = require("../services/fixtureNormalization");
const { forEachConcurrent } = require("../services/forEachConcurrent");
const BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const LEAGUES = {
  "Premier League": { code: "eng.1", country: "England" },
  "Championship": { code: "eng.2", country: "England" },
  "League One": { code: "eng.3", country: "England" },
  "League Two": { code: "eng.4", country: "England" },
  "La Liga": { code: "esp.1", country: "Spain" },
  "Segunda División": { code: "esp.2", country: "Spain" },
  Bundesliga: { code: "ger.1", country: "Germany" },
  "2. Bundesliga": { code: "ger.2", country: "Germany" },
  "Serie A": { code: "ita.1", country: "Italy" },
  "Serie B": { code: "ita.2", country: "Italy" },
  "Ligue 1": { code: "fra.1", country: "France" },
  "Ligue 2": { code: "fra.2", country: "France" },
  Eredivisie: { code: "ned.1", country: "Netherlands" },
  "Eerste Divisie": { code: "ned.2", country: "Netherlands" },
  "Primeira Liga": { code: "por.1", country: "Portugal" },
  "Scottish Premiership": { code: "sco.1", country: "Scotland" },
  "Süper Lig": { code: "tur.1", country: "Turkey" },
  "Pro League": { code: "bel.1", country: "Belgium" },
  "Super League": { code: "sui.1", country: "Switzerland" },
  "Austrian Bundesliga": { code: "aut.1", country: "Austria" },
  Superliga: { code: "den.1", country: "Denmark" },
  Allsvenskan: { code: "swe.1", country: "Sweden" },
  Eliteserien: { code: "nor.1", country: "Norway" },
  "Super League Greece": { code: "gre.1", country: "Greece" },
  Ekstraklasa: { code: "pol.1", country: "Poland" },
  "Czech First League": { code: "cze.1", country: "Czech Republic" },
  "Liga I": { code: "rou.1", country: "Romania" },
  "NB I": { code: "hun.1", country: "Hungary" },
  "Serbian SuperLiga": { code: "srb.1", country: "Serbia" },
  HNL: { code: "cro.1", country: "Croatia" },
  "First League": { code: "bul.1", country: "Bulgaria" },
  "Israeli Premier League": { code: "isr.1", country: "Israel" },
  "Campeonato Brasileiro Série A": { code: "bra.1", country: "Brazil" },
  "Primera División": { code: "arg.1", country: "Argentina" },
  "Liga MX": { code: "mex.1", country: "Mexico" },
  MLS: { code: "usa.1", country: "USA" },
  "J1 League": { code: "jpn.1", country: "Japan" },
  "K League 1": { code: "kor.1", country: "South Korea" },
  "Chinese Super League": { code: "chn.1", country: "China" },
  "Saudi Pro League": { code: "sau.1", country: "Saudi Arabia" },
  "Egyptian Premier League": { code: "egy.1", country: "Egypt" },
  "UAE Pro League": { code: "uae.1", country: "UAE" },
  "Qatar Stars League": { code: "qat.1", country: "Qatar" },
  "Indian Super League": { code: "ind.1", country: "India" },
  "A-League": { code: "aus.1", country: "Australia" },
  "League of Ireland Premier Division": { code: "ire.1", country: "Ireland" },
  "Cymru Premier": { code: "wal.1", country: "Wales" },
};
const cache = new Map();
const COUNTRY_LEAGUES = {};
for (const [name, meta] of Object.entries(LEAGUES)) (COUNTRY_LEAGUES[meta.country] ||= []).push(meta.code);
const STATUS_MAP = {
  STATUS_SCHEDULED: "SCHEDULED",
  STATUS_TBD: "SCHEDULED",
  STATUS_IN_PROGRESS: "LIVE",
  STATUS_HALFTIME: "LIVE",
  STATUS_FULL_TIME: "FINISHED",
  STATUS_FINAL: "FINISHED",
  STATUS_POSTPONED: "POSTPONED",
  STATUS_CANCELLED: "CANCELLED",
  STATUS_SUSPENDED: "LIVE",
  STATUS_DELAYED: "SCHEDULED",
};
function liveMinute(status, statusName) {
  if (statusName === "STATUS_HALFTIME") return "HT";
  if ((STATUS_MAP[statusName] || "") !== "LIVE") return null;
  const minute = Number.parseInt(String(status?.displayClock || ""), 10);
  return Number.isFinite(minute) && minute > 0 ? minute : null;
}
function toFixture(event, leagueName, meta) {
  const competition = event?.competitions?.[0];
  if (!competition) return null;
  const home = competition.competitors?.find((c) => c.homeAway === "home");
  const away = competition.competitors?.find((c) => c.homeAway === "away");
  if (!home?.team?.displayName || !away?.team?.displayName) return null;
  const statusName = competition.status?.type?.name || "STATUS_SCHEDULED";
  const score = (side) => { const raw = side?.score?.value ?? side?.score; if (raw == null || raw === "") return null; const v = Number(raw); return Number.isFinite(v) ? v : null; };
  return {
    provider: "espn",
    providers: ["espn"],
    fixture: { id: `espn-${event.id}`, date: normalizeKickoff(event.date), kickoffPrecision: "time", status: { short: STATUS_MAP[statusName] || normalizeStatus(statusName), elapsed: liveMinute(competition.status, statusName) } },
    league: { id: meta.code, name: leagueName, country: meta.country },
    teams: { home: { id: `espn-team-${home.team.id}`, name: home.team.displayName }, away: { id: `espn-team-${away.team.id}`, name: away.team.displayName } },
    goals: { home: score(home), away: score(away) },
  };
}
async function request(path, params) {
  const key = `${path}?${new URLSearchParams(params || {})}`;
  if (cache.get(key)?.expiresAt > Date.now()) return cache.get(key).value;
  const promise = axios.get(`${BASE_URL}/${path}`, { params, timeout: 12000, headers: { "User-Agent": "Mozilla/5.0 (compatible; ZEUS-ONE-BETTING/1.0)" } }).then((response) => response.data).catch((error) => { cache.delete(key); if (error.response?.status === 404) return { events: [] }; throw createProviderError(error); });
  cache.set(key, { value: promise, expiresAt: Date.now() + 5 * 60 * 1000 });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return promise;
}
async function getFixtures(date) {
  const day = date.replace(/-/g, "");
  const entries = Object.entries(LEAGUES);
  const results = new Array(entries.length);
  // ESPN is a public upstream. Avoid launching dozens of requests at once on a free instance.
  await forEachConcurrent(entries, 5, async ([leagueName, meta], index) => {
    try {
      const data = await request(`${meta.code}/scoreboard`, { dates: day });
      results[index] = (data.events || []).map((event) => toFixture(event, leagueName, meta)).filter(Boolean);
    } catch {
      results[index] = [];
    }
  });
  return results.flat();
}
async function getFixture(fixtureId) {
  const id = String(fixtureId).replace(/^espn-/, "");
  for (const [leagueName, meta] of Object.entries(LEAGUES)) {
    try {
      const data = await request(`${meta.code}/scoreboard`, { dates: new Date().toISOString().slice(0, 10).replace(/-/g, "") });
      const event = (data.events || []).find((e) => String(e.id) === id);
      if (event) return toFixture(event, leagueName, meta);
    } catch { /* Try next league. */ }
  }
  return null;
}
function normalizeNewsForTeams(payload, homeName, awayName, limit = 8) {
  const rows = Array.isArray(payload?.articles) ? payload.articles : Array.isArray(payload?.headlines) ? payload.headlines : Array.isArray(payload?.items) ? payload.items : [];
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const home = normalize(homeName); const away = normalize(awayName);
  if (!home && !away) return [];
  return rows.map(row => {
    const item = row?.data || row;
    const headline = item?.headline || item?.title || item?.story?.headline || "";
    const description = item?.description || item?.summary || item?.story?.description || "";
    const href = item?.links?.web?.href || item?.link || item?.url || null;
    const published = item?.published || item?.lastModified || item?.date || null;
    return { headline: String(headline).trim(), description: String(description).trim(), url: typeof href === "string" ? href : null, published: typeof published === "string" ? published : null };
  }).filter(item => { const text = normalize(item.headline + " " + item.description); return Boolean(item.headline && ((home && text.includes(home)) || (away && text.includes(away)))); })
    .slice(0, limit);
}
async function getNewsForFixture(fixture) {
  const leagueName = fixture?.league?.name;
  const meta = leagueName ? LEAGUES[leagueName] : null;
  if (!meta || !fixture?.teams?.home?.name || !fixture?.teams?.away?.name) {
    return { provider: "ESPN", available: false, reason: "unsupported_league", articles: [] };
  }
  try {
    const data = await request(`${meta.code}/news`, { limit: 15 });
    const articles = normalizeNewsForTeams(data, fixture.teams.home.name, fixture.teams.away.name, 8);
    return { provider: "ESPN", available: true, fetchedAt: new Date().toISOString(), articles };
  } catch (error) {
    return { provider: "ESPN", available: false, reason: error.category || "provider_unavailable", articles: [] };
  }
}

async function getTeamForm(teamId, before, context = {}) {
  const rawId = String(teamId).replace(/^espn-team-/, "");
  const leagueName = context.league?.name;
  const meta = leagueName ? LEAGUES[leagueName] : null;
  if (!meta) return [];
  const year = new Date(before).getUTCFullYear();
  const codes = [meta.code, ...(COUNTRY_LEAGUES[meta.country] || []).filter((code) => code !== meta.code)];
  const results = [];
  for (const season of [year, year - 1]) {
    for (const code of codes) {
      if (results.length >= 20) break;
      try {
        const data = await request(`${code}/teams/${rawId}/schedule`, { season });
        for (const event of data.events || []) {
          const league = Object.entries(LEAGUES).find(([, m]) => m.code === code)?.[0] || leagueName;
          const fixture = toFixture(event, league, meta);
          if (fixture) results.push(fixture);
        }
      } catch { /* Try next league/season. */ }
    }
  }
  return results;
}
async function getH2H() { return null; }
async function getStandings() { return null; }
module.exports = { name: "espn", configured: true, enabled: true, capabilities: ["fixtures", "fixture", "result", "teamForm", "historicalResults", "form", "news"], getFixtures, getFixture, getTeamForm, getH2H, getStandings, getNewsForFixture, normalizeNewsForTeams, toFixture, supportsLeague: (name) => Boolean(LEAGUES[name]) };
