const axios = require("axios");
const { collectDivisionHistory } = require("../services/divisionHistory");
const { createProviderError } = require("../services/apiFootballClient");
const { forEachConcurrent } = require("../services/forEachConcurrent");

const EUROPE = "https://raw.githubusercontent.com/openfootball/europe/master";
const WORLD = "https://raw.githubusercontent.com/openfootball/world/master";
const SOUTH_AMERICA = "https://raw.githubusercontent.com/openfootball/south-america/master";
const CATALOG = {
  "Süper Lig": { country: "Turkey", root: EUROPE, path: "turkey", file: "{season}_tr1.txt", seasons: ["2026-27", "2025-26", "2024-25", "2023-24", "2020-21"] },
  "1. Lig": { country: "Turkey", root: EUROPE, path: "turkey", file: "{season}_tr2.txt", seasons: ["2019-20"] },
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
  "Ligue 1": { country: "France", root: EUROPE, path: "france", file: "{season}_fr1.txt", seasons: ["2026-27", "2025-26", "2024-25"] },
  "Ligue 2": { country: "France", root: EUROPE, path: "france", file: "{season}_fr2.txt", seasons: ["2025-26", "2024-25"] },
  Eredivisie: { country: "Netherlands", root: EUROPE, path: "netherlands", file: "{season}_nl1.txt", seasons: ["2026-27", "2025-26", "2024-25"] },
  "Eerste Divisie": { country: "Netherlands", root: EUROPE, path: "netherlands", file: "{season}_nl2.txt", seasons: ["2024-25"] },
  "Primeira Liga": { country: "Portugal", root: EUROPE, path: "portugal", file: "{season}_pt1.txt", seasons: ["2026-27", "2025-26", "2024-25"] },
  "Liga Portugal 2": { country: "Portugal", root: EUROPE, path: "portugal", file: "{season}_pt2.txt", seasons: ["2024-25"] },
  "Albanian Superliga": { country: "Albania", root: EUROPE, path: "albania", file: "{season}_al1.txt", seasons: ["2024-25"] },
  "Andorran Primera Divisió": { country: "Andorra", root: EUROPE, path: "andorra", file: "{season}_ad1.txt", seasons: ["2024-25"] },
  "Armenian Premier League": { country: "Armenia", root: EUROPE, path: "armenia", file: "{season}_am1.txt", seasons: ["2024-25"] },
  "Azerbaijan Premier League": { country: "Azerbaijan", root: EUROPE, path: "azerbaijan", file: "{season}_az1.txt", seasons: ["2024-25"] },
  "Belarusian Premier League": { country: "Belarus", root: EUROPE, path: "belarus", file: "{season}_by1.txt", calendarYear: true, seasons: ["2025", "2024", "2023"] },
  "Bosnian Premier League": { country: "Bosnia and Herzegovina", root: EUROPE, path: "bosnia-herzegovina", file: "{season}_ba1.txt", seasons: ["2024-25"] },
  "Bulgarian First League": { country: "Bulgaria", root: EUROPE, path: "bulgaria", file: "{season}_bg1.txt", seasons: ["2024-25"] },
  "Croatian First Football League": { country: "Croatia", root: EUROPE, path: "croatia", file: "{season}_hr1.txt", seasons: ["2024-25"] },
  "Cypriot First Division": { country: "Cyprus", root: EUROPE, path: "cyprus", file: "{season}_cy1.txt", seasons: ["2024-25"] },
  "Estonian Premium Liiga": { country: "Estonia", root: EUROPE, path: "estonia", file: "{season}_ee1.txt", calendarYear: true, seasons: ["2025", "2024", "2023"] },
  "Faroe Islands Premier League": { country: "Faroe Islands", root: EUROPE, path: "faroe-islands", file: "{season}_fo1.txt", calendarYear: true, seasons: ["2025", "2024", "2023"] },
  "Georgian Erovnuli Liga": { country: "Georgia", root: EUROPE, path: "georgia", file: "{season}_ge1.txt", calendarYear: true, seasons: ["2025"] },
  "Gibraltar Football League": { country: "Gibraltar", root: EUROPE, path: "gibraltar", file: "{season}_gi1.txt", seasons: ["2024-25"] },
  "Super League Greece": { country: "Greece", root: EUROPE, path: "greece", file: "{season}_gr1.txt", seasons: ["2026-27", "2025-26", "2024-25"] },
  "Kosovo Superleague": { country: "Kosovo", root: EUROPE, path: "kosovo", file: "{season}_kos1.txt", seasons: ["2024-25"] },
  "Latvian Higher League": { country: "Latvia", root: EUROPE, path: "latvia", file: "{season}_lv1.txt", calendarYear: true, seasons: ["2025", "2024", "2023"] },
  "Lithuanian A Lyga": { country: "Lithuania", root: EUROPE, path: "lithuania", file: "{season}_lt1.txt", calendarYear: true, seasons: ["2025", "2024", "2023"] },
  "Luxembourg National Division": { country: "Luxembourg", root: EUROPE, path: "luxembourg", file: "{season}_lu1.txt", seasons: ["2024-25"] },
  "Maltese Premier League": { country: "Malta", root: EUROPE, path: "malta", file: "{season}_mt1.txt", seasons: ["2024-25"] },
  "Moldovan Super Liga": { country: "Moldova", root: EUROPE, path: "moldova", file: "{season}_md1.txt", seasons: ["2024-25"] },
  "Montenegrin First League": { country: "Montenegro", root: EUROPE, path: "montenegro", file: "{season}_me1.txt", seasons: ["2024-25"] },
  "Macedonian First League": { country: "North Macedonia", root: EUROPE, path: "north-macedonia", file: "{season}_mk1.txt", seasons: ["2024-25"] },
  "Northern Ireland Premiership": { country: "Northern Ireland", root: EUROPE, path: "northern-ireland", file: "{season}_nir1.txt", seasons: ["2024-25"] },
  "Russian Premier League": { country: "Russia", root: EUROPE, path: "russia", file: "{season}_ru1.txt", seasons: ["2024-25"] },
  "Scottish Premiership": { country: "Scotland", root: EUROPE, path: "scotland", file: "{season}_sco1.txt", seasons: ["2026-27", "2025-26", "2024-25"] },
  "Serbian SuperLiga": { country: "Serbia", root: EUROPE, path: "serbia", file: "{season}_rs1.txt", seasons: ["2024-25"] },
  "Slovak First Football League": { country: "Slovakia", root: EUROPE, path: "slovakia", file: "{season}_sk1.txt", seasons: ["2024-25"] },
  "Slovenian PrvaLiga": { country: "Slovenia", root: EUROPE, path: "slovenia", file: "{season}_si1.txt", seasons: ["2024-25"] },
  "Ukrainian Premier League": { country: "Ukraine", root: EUROPE, path: "ukraine", file: "{season}_ua1.txt", seasons: ["2024-25"] },
  "Welsh Cymru Premier": { country: "Wales", root: EUROPE, path: "wales", file: "{season}_wal1.txt", seasons: ["2024-25"] },
  "Malawi Super League": { country: "Malawi", root: WORLD, path: "africa/malawi", file: "{season}_mw1.txt", calendarYear: true, seasons: ["2025", "2024", "2023"] },
  "Zimbabwe Premier Soccer League": { country: "Zimbabwe", root: WORLD, path: "africa/zimbabwe", file: "{season}_zw1.txt", calendarYear: true, seasons: ["2025"] },
  "Kazakhstan Premier League": { country: "Kazakhstan", root: WORLD, path: "asia/kazakhstan", file: "{season}_kz1.txt", calendarYear: true, seasons: ["2025"] },
  "Brazilian Serie A": { country: "Brazil", root: SOUTH_AMERICA, path: "brazil", file: "{season}_br1.txt", calendarYear: true, seasons: ["2026", "2025", "2024", "2023"] },
  "Brazilian Serie B": { country: "Brazil", root: SOUTH_AMERICA, path: "brazil", file: "{season}_br2.txt", calendarYear: true, seasons: ["2025", "2024", "2023"] },
  "Ecuadorian Serie A": { country: "Ecuador", root: SOUTH_AMERICA, path: "ecuador", file: "{season}_ec1.txt", calendarYear: true, seasons: ["2025"] },
  "Paraguayan Primera División": { country: "Paraguay", root: SOUTH_AMERICA, path: "paraguay", file: "{season}_py1.txt", calendarYear: true, seasons: ["2025"] },
};
const MONTHS = new Map("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ").map((m, i) => [m, i]));
const cache = new Map();
const normalizeName = value => String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

function parseDateHeader(line, currentYear) {
  const value = line.trim();
  const match = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:\s+(\d{4}))?$/.exec(value);
  if (!match) return null;
  const year = Number(match[3] || currentYear);
  return { date: new Date(Date.UTC(year, MONTHS.get(match[1]), Number(match[2]))).toISOString().slice(0, 10), year, month: MONTHS.get(match[1]), explicitYear: Boolean(match[3]) };
}

function parseResultLine(line, leagueName, meta, season, date) {
  let value = line.trim().replace(/^\d{1,2}:\d{2}\s+/, "");
  if (!date || !value || /^[#▪(=]/.test(value)) return null;
  const scoreMatch = /(\d{1,2})\s*-\s*(\d{1,2})/.exec(value);
  let home = "", away = "", goalsHome = null, goalsAway = null;
  if (scoreMatch) {
    const prefix = value.slice(0, scoreMatch.index).trim();
    away = value.slice(scoreMatch.index + scoreMatch[0].length).trim();
    away = away.replace(/^\(\d{1,2}\s*-\s*\d{1,2}\)\s*/, "").replace(/\s+@\s+.*$/, "").trim();
    home = prefix;
    const versus = /\s+v(?:s)?\.?\s+/i.exec(prefix);
    if (versus) {
      home = prefix.slice(0, versus.index).trim();
      away = prefix.slice(versus.index + versus[0].length).trim();
    }
    goalsHome = Number(scoreMatch[1]);
    goalsAway = Number(scoreMatch[2]);
  } else {
    const versus = /\s+v(?:s)?\.?\s+/i.exec(value);
    if (!versus) return null;
    home = value.slice(0, versus.index).trim();
    away = value.slice(versus.index + versus[0].length).trim();
  }
  home = home.replace(/^\(\w+\)\s*/, "").replace(/\s+@\s+.*$/, "").trim();
  away = away.replace(/^\(\w+\)\s*/, "").replace(/\s+@\s+.*$/, "").trim();
  if (!home || !away || normalizeName(home) === normalizeName(away)) return null;
  const id = "oftxt-" + normalizeName(leagueName) + "-" + date + "-" + normalizeName(home) + "-" + normalizeName(away);
  const finished = Number.isFinite(goalsHome) && Number.isFinite(goalsAway);
  return {
    provider: "openfootball-text",
    providers: ["openfootball-text"],
    fixture: { id, date, kickoffPrecision: "date", status: { short: finished ? "FINISHED" : "SCHEDULED" } },
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
  let previousMonth = null;
  const results = [];
  for (const line of String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const header = parseDateHeader(line, year);
    if (header) {
      if (!header.explicitYear && previousMonth !== null && previousMonth - header.month > 6) year++;
      if (header.explicitYear) year = header.year;
      date = new Date(Date.UTC(year, header.month, Number(header.date.slice(8, 10)))).toISOString().slice(0, 10);
      previousMonth = header.month;
      continue;
    }
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

const LEAGUE_ALIASES = { "Super League": ["Switzerland"], "NB I": ["Hungary"], "Primera División": ["Argentina"], "Liga Profesional": ["Argentina"], "Liga Profesional Argentina": ["Argentina"], Superliga: ["Denmark"], MLS: ["USA"] };

module.exports = {
  name: "openfootball-text",
  configured: true,
  enabled: true,
  capabilities: ["historicalResults", "teamForm"],
  historicalLeagues: CATALOG,
  getSeasonFixtures: loadLeague,
  getTeamForm,
  parseTextResults,
  supportsHistoricalLeague: league => Boolean(league?.country && Object.values(CATALOG).some(meta => meta.country === league.country)) || Boolean(LEAGUE_ALIASES[league?.name]?.includes(league.country)),
};
