const axios = require("axios");
const { collectDivisionHistory } = require("../services/divisionHistory");
const { createProviderError } = require("../services/apiFootballClient");

const EUROPE = "https://raw.githubusercontent.com/openfootball/europe/master";
const WORLD = "https://raw.githubusercontent.com/openfootball/world/master";
const SOUTH_AMERICA = "https://raw.githubusercontent.com/openfootball/south-america/master";
const CATALOG = {
  "Süper Lig": { country: "Turkey", root: EUROPE, path: "turkey", file: "{season}_tr1.txt", seasons: ["2026-27", "2025-26", "2024-25", "2023-24", "2020-21"] },
  "1. Lig": { country: "Turkey", root: EUROPE, path: "turkey", file: "{season}_tr2.txt", seasons: ["2020-21", "2019-20"] },
  "Swiss Super League": { country: "Switzerland", root: EUROPE, path: "switzerland", file: "{season}_ch1.txt", seasons: ["2026-27", "2024-25", "2023-24", "2020-21", "2019-20", "2018-19", "2014-15"] },
  "Swiss Challenge League": { country: "Switzerland", root: EUROPE, path: "switzerland", file: "{season}_ch2.txt", seasons: ["2024-25", "2023-24", "2020-21", "2019-20"] },
  "Hungarian NB I": { country: "Hungary", root: EUROPE, path: "hungary", file: "{season}_hu1.txt", seasons: ["2024-25", "2023-24", "2020-21", "2018-19"] },
  "Czech First League": { country: "Czech Republic", root: EUROPE, path: "czech-republic", file: "{season}_cz1.txt", seasons: ["2026-27", "2024-25", "2023-24", "2020-21", "2018-19"] },
  "Czech National Football League": { country: "Czech Republic", root: EUROPE, path: "czech-republic", file: "{season}_cz2.txt", seasons: ["2024-25"] },
  Veikkausliiga: { country: "Finland", root: EUROPE, path: "finland", file: "{season}_fi1.txt", calendarYear: true, seasons: ["2025", "2024", "2023"] },
  "Úrvalsdeild": { country: "Iceland", root: EUROPE, path: "iceland", file: "{season}_is1.txt", calendarYear: true, seasons: ["2025", "2024", "2023"] },
  "League of Ireland Premier Division": { country: "Ireland", root: EUROPE, path: "ireland", file: "{season}_ie1.txt", calendarYear: true, seasons: ["2025", "2024", "2023"] },
  "Primera División Argentina": { country: "Argentina", root: SOUTH_AMERICA, path: "argentina", file: "{season}_ar1.txt", calendarYear: true, seasons: ["2025", "2024", "2023", "2022", "2021", "2020"] },
  "Categoría Primera A": { country: "Colombia", root: SOUTH_AMERICA, path: "colombia", file: "{season}_co1.txt", calendarYear: true, seasons: ["2025", "2024", "2023"] },
  "J1 League": { country: "Japan", root: WORLD, path: "asia/japan", file: "{season}_jp1.txt", calendarYear: true, seasons: ["2025", "2024", "2023", "2022", "2021", "2020", "2019"] },
  "Chinese Super League": { country: "China", root: WORLD, path: "asia/china", file: "{season}_cn1.txt", calendarYear: true, seasons: ["2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018"] },
  "Liga MX": { country: "Mexico", root: WORLD, path: "north-america/mexico", file: "{season}_mx1.txt", seasons: ["2024-25", "2023-24", "2022-23", "2021-22", "2020-21", "2019-20", "2018-19", "2017-18", "2016-17", "2015-16", "2014-15", "2013-14", "2012-13", "2011-12", "2010-11"] },
  Eliteserien: { country: "Norway", root: EUROPE, path: "norway", file: "{season}_no1.txt", calendarYear: true, seasons: ["2025", "2024", "2023"] },
  "OBOS-ligaen": { country: "Norway", root: EUROPE, path: "norway", file: "{season}_no2.txt", calendarYear: true, seasons: ["2025"] },
  Allsvenskan: { country: "Sweden", root: EUROPE, path: "sweden", file: "{season}_se1.txt", calendarYear: true, seasons: ["2025", "2024", "2023"] },
  Superettan: { country: "Sweden", root: EUROPE, path: "sweden", file: "{season}_se2.txt", calendarYear: true, seasons: ["2025"] },
  "Danish Superliga": { country: "Denmark", root: EUROPE, path: "denmark", file: "{season}_dk1.txt", seasons: ["2024-25", "2023-24"] },
  Ekstraklasa: { country: "Poland", root: EUROPE, path: "poland", file: "{season}_pl1.txt", seasons: ["2024-25", "2023-24"] },
  "I Liga": { country: "Poland", root: EUROPE, path: "poland", file: "{season}_pl2.txt", seasons: ["2024-25"] },
  "Liga I": { country: "Romania", root: EUROPE, path: "romania", file: "{season}_ro1.txt", seasons: ["2024-25", "2023-24"] },
  "Major League Soccer": { country: "USA", root: WORLD, path: "north-america/major-league-soccer", file: "{season}_mls.txt", calendarYear: true, seasons: ["2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016", "2015", "2014", "2013", "2012", "2011", "2010"] },
};
const MONTHS = new Map("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ").map((m, i) => [m, i]));
const cache = new Map();
const normalizeName = value => String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

function parseDateHeader(line, currentYear) {
  const value = line.trim();
  const match = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:\s+(\d{4}))?$/.exec(value);
  if (!match) return null;
  const year = Number(match[3] || currentYear);
  return { date: new Date(Date.UTC(year, MONTHS.get(match[1]), Number(match[2]))).toISOString().slice(0, 10), year };
}

function parseResultLine(line, leagueName, meta, season, date) {
  let value = line.trim().replace(/^\d{1,2}:\d{2}\s+/, "");
  if (!date || !value || /^[#▪(=]/.test(value)) return null;
  const scoreMatch = /(\d{1,2})\s*-\s*(\d{1,2})/.exec(value);
  if (!scoreMatch) return null;
  const prefix = value.slice(0, scoreMatch.index).trim();
  let away = value.slice(scoreMatch.index + scoreMatch[0].length).trim();
  away = away.replace(/^\(\d{1,2}\s*-\s*\d{1,2}\)\s*/, "").replace(/\s+@\s+.*$/, "").trim();
  let home = prefix;
  const versus = /\s+v(?:s)?\.?\s+/i.exec(prefix);
  if (versus) {
    home = prefix.slice(0, versus.index).trim();
    away = prefix.slice(versus.index + versus[0].length).trim();
  }
  home = home.replace(/^\(\w+\)\s*/, "").replace(/\s+@\s+.*$/, "").trim();
  away = away.replace(/^\(\w+\)\s*/, "").replace(/\s+@\s+.*$/, "").trim();
  if (!home || !away || normalizeName(home) === normalizeName(away)) return null;
  const goalsHome = Number(scoreMatch[1]), goalsAway = Number(scoreMatch[2]);
  const id = "oftxt-" + normalizeName(leagueName) + "-" + date + "-" + normalizeName(home) + "-" + normalizeName(away);
  return {
    provider: "openfootball-text",
    providers: ["openfootball-text"],
    fixture: { id, date, kickoffPrecision: "date", status: { short: "FINISHED" } },
    league: { id: "oftxt-league-" + normalizeName(leagueName), name: leagueName, country: meta.country, season },
    teams: { home: { id: "oftxt-team-" + normalizeName(home), name: home }, away: { id: "oftxt-team-" + normalizeName(away), name: away } },
    goals: { home: goalsHome, away: goalsAway },
  };
}

function parseTextResults(text, leagueName, season) {
  const meta = CATALOG[leagueName];
  if (!meta) return [];
  let year = Number(String(season).slice(0, 4));
  let date = null;
  const results = [];
  for (const line of String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const header = parseDateHeader(line, year);
    if (header) { date = header.date; year = header.year; continue; }
    const result = parseResultLine(line, leagueName, meta, season, date);
    if (result) results.push(result);
  }
  return results;
}

async function loadLeague(leagueName, season) {
  const meta = CATALOG[leagueName];
  if (!meta || !meta.seasons.includes(String(season))) return [];
  const key = leagueName + ":" + season;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const url = meta.root + "/" + meta.path + "/" + meta.file.replace("{season}", String(season));
  const promise = axios.get(url, { timeout: 15000, responseType: "text" })
    .then(response => parseTextResults(response.data, leagueName, String(season)))
    .catch(error => {
      cache.delete(key);
      if (error.response?.status === 404) { cache.set(key, { value: [], expiresAt: Date.now() + 6 * 60 * 60 * 1000 }); return []; }
      throw createProviderError(error);
    });
  cache.set(key, { value: promise, expiresAt: Date.now() + 5 * 60 * 1000 });
  return promise;
}

async function getTeamForm(_teamId, before, context = {}) {
  return collectDivisionHistory({
    team: context.team,
    before,
    fixtureId: context.fixtureId,
    league: context.league,
    catalog: CATALOG,
    load: loadLeague,
  });
}

const LEAGUE_ALIASES = { "Super League": ["Switzerland"], "NB I": ["Hungary"], "Primera División": ["Argentina"], Superliga: ["Denmark"], MLS: ["USA"] };

module.exports = {
  name: "openfootball-text",
  configured: true,
  enabled: true,
  capabilities: ["historicalResults", "teamForm"],
  historicalLeagues: CATALOG,
  getSeasonFixtures: loadLeague,
  getTeamForm,
  parseTextResults,
  supportsHistoricalLeague: league => (Boolean(CATALOG[league?.name]) && (!league.country || CATALOG[league.name].country === league.country)) || Boolean(LEAGUE_ALIASES[league?.name]?.includes(league.country)),
};
