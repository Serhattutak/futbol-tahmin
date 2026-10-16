const { buildMatchStatistics, calculateTeamStatistics } = require("./services/teamStatistics");
const { apiHistory } = require("./services/historicalForm");
const { forEachConcurrent } = require("./services/forEachConcurrent");
﻿const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
dotenv.config({ path: path.join(__dirname, ".env"), quiet: true });
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { ApiFootballClient, ProviderError } = require("./services/apiFootballClient");
const { getBookmakerOddsDetails } = require("./services/bookmakerOdds");
const { HOME_ADVANTAGE, MODEL_VERSION, buildReasons, calculateConfidence, rankMarket, blendHistoricalMarkets, weightedStrength } = require("./services/predictionModel");
const { DEFAULT_PATH: historicalArchivePath, readArchive, reconciledSettlement, saveSnapshot, settlePending, summarizeArchive } = require("./services/historicalArchive");
const openFootball = require("./providers/openFootball");
const openFootballText = require("./providers/openFootballText");
const theSportsDb = require("./providers/theSportsDb");
const sportmonks = require("./providers/sportmonks");
const footballData = require("./providers/footballData");
const espn = require("./providers/espn");
const { normalizeStatus } = require("./services/fixtureNormalization");
const { MultiProviderRegistry, createLegacyAdapter, toFrontendFixture } = require("./services/multiProviderRegistry");
const { getLocalDayFixtures, todayKey: localTodayKey } = require("./services/localDayFixtures");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 3001;
const API_URL = "https://v3.football.api-sports.io";
const defaultAllowedOrigins = ["http://localhost:5173", "http://127.0.0.1:5173", "https://zeus-one-betting.onrender.com"];
const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...(process.env.CORS_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean)])];

app.disable("x-powered-by");
// Render terminates TLS and forwards one trusted proxy hop. Configure Express accordingly
// so express-rate-limit uses the client IP instead of rejecting X-Forwarded-For.
if (isProduction) app.set("trust proxy", 1);
else if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] } }, referrerPolicy: { policy: "strict-origin-when-cross-origin" } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === "null") return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS origin denied"));
  },
  credentials: false,
}));
app.use(express.json({ limit: "16kb" }));

const requestStartedAt = new WeakMap();
app.use((req, res, next) => {
  requestStartedAt.set(req, Date.now());
  res.on("finish", () => console.log(JSON.stringify({ timestamp: new Date().toISOString(), endpoint: req.originalUrl, method: req.method, status: res.statusCode, durationMs: Date.now() - requestStartedAt.get(req) })));
  next();
});

const generalApiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false, message: { success: false, error: "Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin." } });
const analyzeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 150, standardHeaders: "draft-7", legacyHeaders: false, message: { success: false, error: "Analiz istek limiti aşıldı. Lütfen daha sonra tekrar deneyin." } });
const heavyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false, message: { success: false, error: "Ağır işlem limiti aşıldı. Lütfen daha sonra tekrar deneyin." } });
const { createConcurrencyGuard } = require("./services/concurrencyGuard");
const concurrencyGuard = createConcurrencyGuard();
app.use("/api", generalApiLimiter);

const api = axios.create({ baseURL: API_URL, timeout: 10000, headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } });
// Ücretli api-football sağlayıcısı tamamen devre dışı bırakıldı (disabled: true).
// Yalnızca ücretsiz kaynaklar (OpenFootball, football-data.org ücretsiz tier, TheSportsDB) kullanılır.
const upstream = new ApiFootballClient({ client: api, apiKey: process.env.API_FOOTBALL_KEY, dailyBudget: process.env.API_FOOTBALL_DAILY_BUDGET || 100, cacheLimit: process.env.API_FOOTBALL_CACHE_LIMIT || 500, disabled: true });
const predictionStorePath = process.env.ZEUS_PREDICTION_STORE || path.join(__dirname, "data", "predictions.json");

function readPredictionStore() {
  try {
    return JSON.parse(fs.readFileSync(predictionStorePath, "utf8"));
  } catch {
    return [];
  }
}

function writePredictionStore(records) {
  fs.mkdirSync(path.dirname(predictionStorePath), { recursive: true });
  const temporaryPath = `${predictionStorePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(records, null, 2), "utf8");
  fs.renameSync(temporaryPath, predictionStorePath);
}

function savePredictionRecord(record) {
  const records = readPredictionStore();
  if (records.some((item) => item.fixtureId === record.fixtureId && item.market === record.market && (item.modelVersion || MODEL_VERSION) === record.modelVersion)) return;
  records.push(record);
  writePredictionStore(records);
}

function getCacheTtl(pathname, params = {}) {
  if (pathname === "/fixtures/statistics") return 2 * 60 * 60 * 1000;
  if (pathname === "/fixtures/headtohead") return 6 * 60 * 60 * 1000;
  if (pathname === "/standings") return 6 * 60 * 60 * 1000;
  if (pathname === "/odds") return 5 * 60 * 1000;
  if (pathname === "/fixtures" && params.id) return 60 * 60 * 1000;
  if (pathname === "/fixtures" && params.team) return 30 * 60 * 1000;
  return 5 * 60 * 1000;
}

function cachedApiGet(pathname, params) {
  return upstream.get(pathname, params, { ttlMs: getCacheTtl(pathname, params) });
}

// Yalnızca ücretsiz sağlayıcılar kayıtlıdır. Ücretli api-football sağlayıcısı kaldırıldı.
// - openfootball: tamamen ücretsiz (GitHub JSON), anahtar gerektirmez
// - football-data.org: ücretsiz tier (FOOTBALL_DATA_API_TOKEN ile, ücretsiz kayıt)
// - thesportsdb: ücretsiz tier (anahtar gerektirmez, varsayılan "123")
// - sportmonks: yalnızca token tanımlıysa etkinleşir (varsayılan kapalı)
const providerRegistry = new MultiProviderRegistry([
  createLegacyAdapter(sportmonks),
  createLegacyAdapter(footballData),
  createLegacyAdapter(openFootball),
  createLegacyAdapter(openFootballText),
  createLegacyAdapter(theSportsDb),
  createLegacyAdapter(espn),
], { fixtureCacheFile: path.join(__dirname, "data", "fixture-cache.json"), historicalCacheFile: path.join(__dirname, "data", "historical-cache.json"), fixtureTtlMs: 90_000 });

async function optionalApiGet(pathname, params) {
  try {
    return await cachedApiGet(pathname, params);
  } catch (error) {
    console.warn(JSON.stringify({ type: "OPTIONAL_PROVIDER_DATA_UNAVAILABLE", endpoint: pathname, category: error.category || "unexpected_provider_response" }));
    return [];
  }
}

function getPublicErrorMessage(error, fallback) {
  if (!(error instanceof ProviderError)) return fallback;
  return {
    quota: "Veri sağlayıcısı kotası şu an yetersiz. Lütfen daha sonra tekrar deneyin.",
    authentication: "Veri sağlayıcısı yapılandırması kullanılamıyor.",
    timeout_network: "Veri sağlayıcısına şu an ulaşılamıyor. Lütfen daha sonra tekrar deneyin.",
    provider_unavailable: "Veri sağlayıcısı geçici olarak kullanılamıyor.",
    no_data: "İstenen maç veya istatistik için veri bulunamadı.",
    unexpected_provider_response: "Veri sağlayıcısından doğrulanabilir veri alınamadı.",
  }[error.category] || fallback;
}

function getProviderErrorStatus(error, fallback = 500) {
  if (error.category === "quota") return 429;
  if (error.category === "authentication") return 503;
  if (error.category === "no_data") return 404;
  if (error.category === "timeout_network" || error.category === "provider_unavailable") return 503;
  return fallback;
}

// --------------------------------------------------
// ANA SAYFA
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    message: "Futbol Analiz AI Backend çalışıyor.",
    status: "active",
  });
});

// --------------------------------------------------
// API TEST
// --------------------------------------------------

app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message: "API bağlantısı hazır.",
  });
});

app.get("/api/health", (req, res) => {
  const archive = summarizeArchive(readArchive(historicalArchivePath));
  res.json({ status: "ok", server: "zeus-one-betting-backend", version: MODEL_VERSION, cache: "active", upstreamBudget: upstream.getBudgetStatus(), archive: { totalPredictions: archive.totalPredictions, completed: archive.completed, verified: archive.verified, conflict: archive.conflict, pending: archive.pending, unavailable: archive.unavailable }, readiness: { readyForBeta: false, performanceDataNotYetAvailable: archive.verified === 0 }, providers: providerRegistry.getStatus() });
});

// --------------------------------------------------
// TARİH OLUŞTURMA
// --------------------------------------------------

function getDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && getDateString(date) === value;
}

function getRequestedDate(value) {
  if (typeof value === "string" && isValidDateKey(value)) return value;
  // "Today" is the product's local day (Europe/Istanbul), not the server's UTC day.
  return localTodayKey();
}

// --------------------------------------------------
// BUGÜN + 7 GÜN MAÇLARI
// --------------------------------------------------

app.get("/api/football-test", async (req, res) => {
  try {
    if (req.query.date !== undefined && !isValidDateKey(req.query.date)) {
      return res.status(400).json({ success: false, error: "Geçersiz tarih formatı. YYYY-MM-DD bekleniyor." });
    }
    const dateString = getRequestedDate(req.query.date);
    console.log(`Maçlar çekiliyor: ${dateString}`);
    const discovery = await getLocalDayFixtures(providerRegistry, dateString, toFrontendFixture);
    const matches = discovery.matches;

    res.json({
      success: true,
      date: dateString,
      results: matches.length,
      source: discovery.source,
      cached: discovery.cached,
      stale: discovery.stale,
      providerError: discovery.providerError,
      matches,
      timeZone: discovery.timeZone,
      dailyResults: [{ date: dateString, results: matches.length }],
    });
  } catch (error) {
    console.error("MAÇ API HATASI:");

    if (error.response) {
      console.error(error.category || "provider_unavailable");
    } else {
      console.error(error.message);
    }

    res.status(getProviderErrorStatus(error)).json({
      success: false,
      error: getPublicErrorMessage(error, "Maç verileri alınamadı."),
    });
  }
});

// --------------------------------------------------
// TAKIM SON 10 MAÇ
// --------------------------------------------------

app.get("/api/team/:teamId/form", async (req, res) => {
  try {
    const teamId = req.params.teamId;
    if (!/^\d{1,12}$/.test(teamId)) return res.status(400).json({ success: false, error: "Geçersiz takım kimliği." });

    const before = req.query.before || new Date().toISOString();
    if (typeof before !== "string" || !Number.isFinite(Date.parse(before))) return res.status(400).json({ success: false, error: "Geçersiz geçmiş maç tarihi." });
    const matches = await apiHistory(cachedApiGet, teamId, before);
    const team = matches.flatMap(match => [match.teams?.home, match.teams?.away]).find(candidate => candidate && String(candidate.id) === teamId);

    res.json({
      success: true,
      teamId,
      before,
      statistics: team ? calculateTeamStatistics(matches.map(match => ({ ...match, provider: "api-football" })), team, before) : null,
      results: matches.length,
      matches,
    });
  } catch (error) {
    console.error("TAKIM FORM HATASI:", error.category || "provider_unavailable");

    res.status(getProviderErrorStatus(error)).json({
      success: false,
      error: getPublicErrorMessage(error, "Takım form verileri alınamadı."),
    });
  }
});

// --------------------------------------------------
// H2H
// --------------------------------------------------

app.get("/api/h2h/:homeId/:awayId", async (req, res) => {
  try {
    const homeId = req.params.homeId;
    const awayId = req.params.awayId;
    if (!/^\d{1,12}$/.test(homeId) || !/^\d{1,12}$/.test(awayId)) return res.status(400).json({ success: false, error: "Geçersiz takım kimliği." });

    const matches = await cachedApiGet("/fixtures/headtohead", { h2h: `${homeId}-${awayId}`, last: 10 });

    res.json({
      success: true,
      results: matches.length,
      matches,
    });
  } catch (error) {
    console.error("H2H HATASI:", error.category || "provider_unavailable");

    res.status(getProviderErrorStatus(error)).json({
      success: false,
      error: getPublicErrorMessage(error, "H2H verileri alınamadı."),
    });
  }
});

// --------------------------------------------------
// FORM HESAPLAMA
// --------------------------------------------------

function calculateForm(matches, teamId, venue = "all") {
  let wins = 0;
  let draws = 0;
  let losses = 0;

  let goalsFor = 0;
  let goalsAgainst = 0;
  let bttsGames = 0;
  let over15Games = 0;
  let over25Games = 0;
  let over35Games = 0;
  let cleanSheets = 0;
  let failedToScore = 0;

  const form = [];

  for (const match of matches) {
    const homeId = match.teams?.home?.id;
    const awayId = match.teams?.away?.id;

    const homeGoals = match.goals?.home;
    const awayGoals = match.goals?.away;

    if (
      homeGoals === null ||
      homeGoals === undefined ||
      awayGoals === null ||
      awayGoals === undefined
    ) {
      continue;
    }

    let result;

    if (String(homeId) === String(teamId) && venue !== "away") {
      goalsFor += homeGoals;
      goalsAgainst += awayGoals;

      if (homeGoals > awayGoals) {
        wins++;
        result = "W";
      } else if (homeGoals === awayGoals) {
        draws++;
        result = "D";
      } else {
        losses++;
        result = "L";
      }
    } else if (String(awayId) === String(teamId) && venue !== "home") {
      goalsFor += awayGoals;
      goalsAgainst += homeGoals;

      if (awayGoals > homeGoals) {
        wins++;
        result = "W";
      } else if (awayGoals === homeGoals) {
        draws++;
        result = "D";
      } else {
        losses++;
        result = "L";
      }
    }

    if (result) {
      form.push(result);
      const totalGoals = homeGoals + awayGoals;
      const scored = String(homeId) === String(teamId) ? homeGoals : awayGoals;
      const conceded = String(homeId) === String(teamId) ? awayGoals : homeGoals;

      if (scored > 0 && conceded > 0) bttsGames++;
      if (totalGoals > 1) over15Games++;
      if (totalGoals > 2) over25Games++;
      if (totalGoals > 3) over35Games++;
      if (conceded === 0) cleanSheets++;
      if (scored === 0) failedToScore++;
    }
  }

  const games = wins + draws + losses;

  return {
    games,
    matchesPlayed: games,
    cleanSheets,
    failedToScore,
    recentForm: form,
    avgGoalsFor: games ? goalsFor / games : null,
    avgGoalsAgainst: games ? goalsAgainst / games : null,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    averageGoalsFor: games ? goalsFor / games : 0,
    averageGoalsAgainst: games ? goalsAgainst / games : 0,
    pointsPerGame: games ? (wins * 3 + draws) / games : 0,
    form,
    bttsRate: games ? (bttsGames / games) * 100 : null,
    over15Rate: games ? (over15Games / games) * 100 : null,
    over25Rate: games ? (over25Games / games) * 100 : null,
    over35Rate: games ? (over35Games / games) * 100 : null,
    cleanSheetRate: games ? (cleanSheets / games) * 100 : null,
  };
}

// --------------------------------------------------
// POISSON OLASILIK
// --------------------------------------------------

function poissonProbability(lambda, k) {
  let factorial = 1;

  for (let i = 1; i <= k; i++) {
    factorial *= i;
  }

  return (
    (Math.exp(-lambda) * Math.pow(lambda, k)) /
    factorial
  );
}

function normalizeProbability(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.min(Math.max(value / total, 0), 1);
}

function toPercentagesThatSumTo100(values) {
  const total = values.reduce((sum, value) => sum + value, 0);

  if (!Number.isFinite(total) || total <= 0) {
    return values.map(() => 0);
  }

  const percentages = values.map((value) =>
    Number((Math.min(Math.max(value / total, 0), 1) * 100).toFixed(2))
  );
  const roundedTotal = percentages.reduce((sum, value) => sum + value, 0);
  const adjustment = Number((100 - roundedTotal).toFixed(2));
  const largestIndex = percentages.indexOf(Math.max(...percentages));

  percentages[largestIndex] = Number(
    (percentages[largestIndex] + adjustment).toFixed(2)
  );

  return percentages;
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function statNumber(value) {
  const number = Number.parseFloat(String(value ?? "").replace("%", ""));
  return Number.isFinite(number) ? number : null;
}

function getMatchStats(statistics, teamId) {
  const entry = statistics.find((item) => String(item.team?.id) === String(teamId));
  const values = Object.fromEntries(
    (entry?.statistics || []).map((item) => [item.type, statNumber(item.value)])
  );
  return {
    shots: values["Total Shots"] ?? values["Goal Attempts"],
    shotsOnTarget: values["Shots on Goal"],
    expectedGoals: values["Expected Goals"] ?? values["expected_goals"],
    possession: values["Ball Possession"],
    corners: values["Corner Kicks"],
    yellowCards: values["Yellow Cards"],
    redCards: values["Red Cards"],
  };
}

function averageStats(items) {
  const result = {};
  for (const key of ["shots", "shotsOnTarget", "expectedGoals", "possession", "corners", "yellowCards", "redCards"]) {
    const available = items.map((item) => item[key]).filter(Number.isFinite);
    result[key] = available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
  }
  return result;
}

function averageNullable(values) {
  const available = values.filter(Number.isFinite);
  return available.length
    ? available.reduce((sum, value) => sum + value, 0) / available.length
    : null;
}

function mergeRecentForm(homeForm, awayForm) {
  return {
    sampleSize: homeForm.games + awayForm.games,
    home: homeForm,
    away: awayForm,
  };
}

function getOddsKey(market) {
  return {
    "Üst 1.5": "over15",
    "Alt 1.5": "under15",
    "Üst 2.5": "over25",
    "Alt 2.5": "under25",
    "Üst 3.5": "over35",
    "Alt 3.5": "under35",
    "KG Var": "bttsYes",
    "KG Yok": "bttsNo",
  }[market] || market;
}

function calculateDataQuality({ fixtureAvailable, teamsAvailable, leagueAvailable, homeForm10, awayForm10, homeForm5, awayForm5, homeVenueForm, awayVenueForm, h2h, standings, stats, bookmakerOdds }) {
  const signals = [
    ["Fixture", fixtureAvailable, 10],
    ["Takım bilgileri", teamsAvailable, 10],
    ["Lig bilgisi", leagueAvailable, 5],
    ["Ev sahibi son 10", homeForm10.games > 0, 15],
    ["Deplasman son 10", awayForm10.games > 0, 15],
    ["Son 5 formu", homeForm5.games > 0 && awayForm5.games > 0, 10],
    ["Ev/deplasman formu", homeVenueForm.games > 0 && awayVenueForm.games > 0, 10],
    ["H2H", h2h.count > 0, 5],
    ["Standings", Boolean(standings.home || standings.away), 5],
    ["Takım istatistikleri", Number.isFinite(stats.home.shots) || Number.isFinite(stats.away.shots), 5],
    ["API xG", Number.isFinite(stats.home.expectedGoals) || Number.isFinite(stats.away.expectedGoals), 5],
    ["Bookmaker odds", Object.keys(bookmakerOdds).length > 0, 5],
  ];
  const score = signals.reduce((total, [, available, weight]) => total + (available ? weight : 0), 0);
  return {
    score,
    level: score >= 75 ? "high" : score >= 45 ? "medium" : "low",
    availableSignals: signals.filter(([, available]) => available).length,
    totalSignals: signals.length,
    missing: signals.filter(([, available]) => !available).map(([label]) => label),
  };
}

function calculateMarketConfidence({ dataQuality, homeForm5, awayForm5, homeForm10, awayForm10, h2h, standings, odds }) {
  const formAvailable = homeForm10.games > 0 && awayForm10.games > 0;
  const formAgreement = formAvailable
    ? 1 - Math.min(1, Math.abs(homeForm5.pointsPerGame - homeForm10.pointsPerGame) / 3 + Math.abs(awayForm5.pointsPerGame - awayForm10.pointsPerGame) / 3)
    : 0;
  const sourceAgreement = Object.keys(odds).length ? 0.75 : 0.5;
  const h2hWeight = Math.min(h2h.count / 8, 1);
  const standingsSignal = standings.home && standings.away ? 1 : 0;
  return Math.round(clamp(20 + dataQuality.score * 0.55 + (formAvailable ? 12 : 0) + formAgreement * 14 + sourceAgreement * 8 + h2hWeight * 6 + standingsSignal * 5, 0, 100));
}

function getPredictionScore(analysis) {
  const dataQuality = Number(analysis.dataQuality?.score || 0);
  const confidence = Number(analysis.model?.confidence || 0);
  const sourceAgreement = analysis.sourceAgreement?.status === "high" ? 100 : analysis.sourceAgreement?.status === "medium" ? 60 : 20;
  const hasOdds = Object.keys(analysis.bookmakerOdds || {}).length > 0;
  const hasValue = Number.isFinite(analysis.recommendation?.value) && analysis.recommendation.value > 0;
  const statisticalSupport = [
    analysis.dataAvailability?.teamForm?.home && analysis.dataAvailability?.teamForm?.away,
    analysis.dataAvailability?.h2h,
    analysis.dataAvailability?.xg,
    analysis.dataAvailability?.standings,
    analysis.dataAvailability?.statistics,
  ].filter(Boolean).length * 20;

  return Number(clamp(
    dataQuality * 0.42 + confidence * 0.28 + sourceAgreement * 0.12 + (hasOdds ? 8 : 0) + (hasValue ? 6 : 0) + statisticalSupport * 0.12,
    0,
    100
  ).toFixed(2));
}

function evaluatePredictionMarket(record, fixture) {
  const homeGoals = fixture.goals?.home;
  const awayGoals = fixture.goals?.away;
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;

  const totalGoals = homeGoals + awayGoals;
  const bothScored = homeGoals > 0 && awayGoals > 0;
  switch (record.market) {
    case "1": return homeGoals > awayGoals;
    case "X": return homeGoals === awayGoals;
    case "2": return awayGoals > homeGoals;
    case "1X": return homeGoals >= awayGoals;
    case "X2": return awayGoals >= homeGoals;
    case "12": return homeGoals !== awayGoals;
    case "Üst 1.5": return totalGoals > 1;
    case "Alt 1.5": return totalGoals < 2;
    case "Üst 2.5": return totalGoals > 2;
    case "Alt 2.5": return totalGoals < 3;
    case "Üst 3.5": return totalGoals > 3;
    case "Alt 3.5": return totalGoals < 4;
    case "KG Var": return bothScored;
    case "KG Yok": return !bothScored;
    case "Tahmini skor": return homeGoals === record.predictedScoreHome && awayGoals === record.predictedScoreAway;
    default: return null;
  }
}

function isFinishedFixture(fixture) {
  return normalizeStatus(fixture.fixture?.status?.short) === "FINISHED";
}

const SETTLEMENT_GIVE_UP_MS = 3 * 24 * 60 * 60 * 1000;

// Fallback when the provider that issued the fixture id cannot be queried any more
// (e.g. the removed api-football feed): find the same match in the merged daily
// fixture list (same teams, kickoff within 20 minutes) and use its final score
// only if it is FINISHED and the providers do not disagree on the score.
async function findFinishedByTeams(record) {
  const kickoff = Date.parse(record.date);
  if (!Number.isFinite(kickoff)) return null;
  const { localDateKey, similarTeam } = require("./services/localDayFixtures");
  const day = localDateKey(record.date);
  const { matches } = await getLocalDayFixtures(providerRegistry, day, toFrontendFixture);
  return matches.find(match => isFinishedFixture(match) && !match.dataConflict
    && Number.isInteger(match.goals?.home) && Number.isInteger(match.goals?.away)
    && Math.abs(Date.parse(match.fixture?.date) - kickoff) <= 20 * 60 * 1000
    && similarTeam(match.teams?.home?.name, record.homeTeam || record.home)
    && similarTeam(match.teams?.away?.name, record.awayTeam || record.away)) || null;
}

function settleRecord(record, fixture, source) {
  const successful = evaluatePredictionMarket(record, fixture);
  record.resultVerificationStatus = "verified";
  record.resultSource = source;
  record.status = successful === null ? "no_data" : successful ? "won" : "lost";
  record.result = `${fixture.goals?.home ?? "—"}-${fixture.goals?.away ?? "—"}`;
  record.resultStatus = fixture.fixture?.status?.short;
  record.completedAt = new Date().toISOString();
}

async function checkPendingPredictions(limit = 10) {
  const records = readPredictionStore();
  const pending = records.filter((record) => record.status === "pending").slice(0, limit);
  let changed = false;

  for (const record of pending) {
    let failure = null;
    try {
      const fixtures = await providerRegistry.getResults(record.providerFixtureIds || { "api-football": String(record.fixtureId) });
      const settlement = reconciledSettlement(fixtures);
      const fixture = settlement?.resultVerificationStatus === "verified" ? toFrontendFixture(fixtures[0]) : null;
      if (fixture && isFinishedFixture(fixture)) { settleRecord(record, fixture, "provider-fixture-id"); changed = true; continue; }
    } catch (error) {
      failure = error.category || "provider_unavailable";
    }
    if (Date.parse(record.date) > Date.now() - 2 * 60 * 60 * 1000) continue; // not over yet
    try {
      const match = await findFinishedByTeams(record);
      if (match) { settleRecord(record, match, `fixture-list:${(match.providers || [match.provider]).join("+")}`); changed = true; continue; }
    } catch (error) { failure ||= error.category || "provider_unavailable"; }
    if (Date.parse(record.date) < Date.now() - SETTLEMENT_GIVE_UP_MS) {
      // Never guess a result: after three days without a verifiable score the record is
      // closed as unverifiable and excluded from success-rate statistics.
      record.status = "unverifiable";
      record.resultVerificationStatus = "unverifiable";
      record.unverifiableReason = failure || "result_not_found";
      record.completedAt = new Date().toISOString();
      changed = true;
      console.warn(JSON.stringify({ type: "SETTLEMENT_UNVERIFIABLE", fixtureId: record.fixtureId, reason: record.unverifiableReason }));
    } else if (failure) {
      console.warn(JSON.stringify({ type: "SETTLEMENT_RETRY", fixtureId: record.fixtureId, reason: failure }));
    }
  }

  if (changed) writePredictionStore(records);
  return records;
}

function ratio(successful, total) {
  return total ? Number(((successful / total) * 100).toFixed(2)) : null;
}

function summarizePerformance(records) {
  const completed = records.filter((record) => ["won", "lost"].includes(record.status) && record.resultVerificationStatus === "verified");
  const successful = completed.filter((record) => record.status === "won");
  const marketGroups = {};
  const confidenceGroups = { "90-100": [], "80-89": [], "70-79": [], "60-69": [], "0-59": [] };

  for (const record of completed) {
    const group = record.market === "1" || record.market === "X" || record.market === "2"
      ? "1X2"
      : ["1X", "X2", "12"].includes(record.market)
        ? "Çifte Şans"
        : record.market.startsWith("Üst") || record.market.startsWith("Alt")
          ? "Üst/Alt"
          : record.market.startsWith("KG")
            ? "KG"
            : "Tahmini Skor";
    marketGroups[group] = marketGroups[group] || { total: 0, successful: 0 };
    marketGroups[group].total++;
    if (record.status === "won") marketGroups[group].successful++;

    const confidence = Number(record.confidence || 0);
    const confidenceGroup = confidence >= 90 ? "90-100" : confidence >= 80 ? "80-89" : confidence >= 70 ? "70-79" : confidence >= 60 ? "60-69" : "0-59";
    confidenceGroups[confidenceGroup].push(record);
  }

  const confidencePerformance = Object.fromEntries(Object.entries(confidenceGroups).map(([group, items]) => {
    const wins = items.filter((record) => record.status === "won").length;
    return [group, { total: items.length, successful: wins, failed: items.length - wins, successRate: ratio(wins, items.length) }];
  }));
  const valueRecords = completed.filter((record) => Number.isFinite(record.bookmakerOdds) && Number(record.value) > 0);
  const valueSuccessful = valueRecords.filter((record) => record.status === "won").length;
  const daily = {};
  for (const record of completed) {
    const day = String(record.date || "").slice(0, 10);
    daily[day] = daily[day] || { total: 0, successful: 0 };
    daily[day].total++;
    if (record.status === "won") daily[day].successful++;
  }

  return {
    totalPredictions: records.length,
    pending: records.filter((record) => record.status === "pending").length,
    noData: records.filter((record) => record.status === "no_data").length,
    completed: completed.length,
    successful: successful.length,
    failed: completed.length - successful.length,
    successRate: ratio(successful.length, completed.length),
    marketPerformance: Object.fromEntries(Object.entries(marketGroups).map(([group, stats]) => [group, { ...stats, failed: stats.total - stats.successful, successRate: ratio(stats.successful, stats.total) }])),
    confidencePerformance,
    valuePerformance: { total: valueRecords.length, successful: valueSuccessful, failed: valueRecords.length - valueSuccessful, successRate: ratio(valueSuccessful, valueRecords.length) },
    dailyPerformance: Object.fromEntries(Object.entries(daily).map(([day, stats]) => [day, { ...stats, successRate: ratio(stats.successful, stats.total) }])),
    recent: {
      10: summarizeRecent(completed, 10),
      50: summarizeRecent(completed, 50),
      100: summarizeRecent(completed, 100),
    },
    history: [...records].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)).slice(0, 100),
    modelVersions: [...new Set(records.map((record) => record.modelVersion).filter(Boolean))],
  };
}

function summarizeRecent(records, limit) {
  const recent = records.slice(-limit);
  const successful = recent.filter((record) => record.status === "won").length;
  return { total: recent.length, successful, failed: recent.length - successful, successRate: ratio(successful, recent.length) };
}

function findStanding(response, teamId) {
  const rows = response.flatMap((group) => group.league?.standings?.flat() || []);
  const row = rows.find((item) => String(item.team?.id) === String(teamId));
  return row ? { rank: row.rank, points: row.points, played: row.all?.played } : null;
}

function summarizeH2H(matches, homeId, awayId) {
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let goals = 0;
  let finished = 0;

  for (const match of matches) {
    const homeGoals = match.goals?.home;
    const awayGoals = match.goals?.away;
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
    finished += 1;
    goals += homeGoals + awayGoals;
    const currentHomeIsHome = String(match.teams?.home?.id) === String(homeId);
    if (homeGoals === awayGoals) draws += 1;
    else if ((homeGoals > awayGoals) === currentHomeIsHome) homeWins += 1;
    else awayWins += 1;
  }

  return { count: finished, homeWins, awayWins, draws, averageGoals: finished ? goals / finished : 0 };
}

// --------------------------------------------------
// MAÇ ANALİZİ
// --------------------------------------------------

function insufficientAnalysis(fixture, sourceMetadata = {}, statisticsProfile = null, version = MODEL_VERSION) {
  return { success: true, status: "INSUFFICIENT_DATA", eligible: false, predictionEligible: false, prediction: "NO_BET", statisticsProfile, strongestPrediction: null,
    fixture: { id: fixture.providerFixtureId, canonicalFixtureId: fixture.canonicalFixtureId, providerFixtureIds: fixture.providerFixtureIds, date: fixture.kickoff, home: fixture.homeTeam, away: fixture.awayTeam, league: fixture.league.name },
    model: { version, confidence: null }, dataQuality: { ...(statisticsProfile?.dataQuality || { score: 0 }), missing: ["INSUFFICIENT_DATA"] },
    dataAvailability: { fixture: true, teamForm: { home: false, away: false } }, sourceMetadata,
    recommendation: { eligible: false, main: "NO_BET", reason: "INSUFFICIENT_DATA" }, markets: {},
  };
}

async function analyzeFixture(fixtureId, { includeMatchStatistics = true, modelVersion, shadow = false } = {}) {
  if (shadow) return productionAnalysis.analyze(fixtureId, { modelVersion });
  const versions = require("./services/modelVersions");
  const selected = versions.selectedModel(modelVersion);
  const model41Artifact = selected === versions.MODEL_4_1 ? versions.loadModel41() : null;
  const canonical = (await providerRegistry.getFixture(fixtureId))[0];
  if (!canonical) throw new ProviderError("no_data", "Fixture unavailable.");
  return analyzeCollectedFixture(await providerRegistry.collectAnalysis(canonical, { includeMatchStatistics: model41Artifact ? false : includeMatchStatistics }), { persist: true, model41Artifact });
}

// Shared calculation: offline replay never fetches providers or writes the archive.
function analyzeCollectedFixture(collected, { variant = "stats", now = Date.now(), persist = false, model41Artifact = null } = {}) {
  try {
    const analysisVersion = model41Artifact ? "4.1" : MODEL_VERSION;
    if (model41Artifact) {
      const day = collected.fixture.kickoff.slice(0, 10);
      if (day <= model41Artifact.training.selectedThrough) throw Error("Model 4.1 cannot replay dates used for model selection");
      const before = rows => rows.filter(m => m.fixture.date.slice(0, 10) < day);
      collected = { ...collected, homeMatches: before(collected.homeMatches), awayMatches: before(collected.awayMatches), h2hMatches: before(collected.h2hMatches), standingsResponse: [], oddsResponse: [], recentStats: [] };
    }
    const canonicalFixture = collected.fixture;
    const fixture = toFrontendFixture(canonicalFixture);
    const homeTeam = fixture.teams.home;
    const awayTeam = fixture.teams.away;
    const { homeMatches, awayMatches, h2hMatches, standingsResponse, oddsResponse, recentStats, sourceMetadata } = collected;
    const statisticsProfile = buildMatchStatistics(canonicalFixture, { homeMatches, awayMatches, h2hMatches, now });
    if (statisticsProfile.home.sampleSize < 5 || statisticsProfile.away.sampleSize < 5 || canonicalFixture.dataConflict || canonicalFixture.kickoffPrecision === "date") return insufficientAnalysis(canonicalFixture, sourceMetadata, statisticsProfile, analysisVersion);

    const homeForm = calculateForm(homeMatches, homeTeam.id);
    const awayForm = calculateForm(awayMatches, awayTeam.id);
    const homeForm5 = calculateForm(homeMatches.slice(0, 5), homeTeam.id);
    const awayForm5 = calculateForm(awayMatches.slice(0, 5), awayTeam.id);
    const homeVenueForm = calculateForm(homeMatches, homeTeam.id, "home");
    const awayVenueForm = calculateForm(awayMatches, awayTeam.id, "away");
    const strength = stats => ({ games: stats.sampleSize, averageGoalsFor: stats.goalsForPerMatch, averageGoalsAgainst: stats.goalsAgainstPerMatch, pointsPerGame: stats.pointsPerGame });
    const homeRecent = variant === "baseline" ? weightedStrength(homeMatches, homeTeam.id) : strength(statisticsProfile.home.weighted);
    const awayRecent = variant === "baseline" ? weightedStrength(awayMatches, awayTeam.id) : strength(statisticsProfile.away.weighted);
    const homeVenueRecent = variant === "baseline" ? weightedStrength(homeMatches, homeTeam.id, "home") : strength(statisticsProfile.home.weighted.home);
    const awayVenueRecent = variant === "baseline" ? weightedStrength(awayMatches, awayTeam.id, "away") : strength(statisticsProfile.away.weighted.away);
    const h2h = variant === "baseline" ? summarizeH2H(h2hMatches, homeTeam.id, awayTeam.id) : statisticsProfile.h2h ? { ...statisticsProfile.h2h, count: statisticsProfile.h2h.sampleSize, averageGoals: statisticsProfile.h2h.goalsPerMatch } : { count: 0, homeWins: 0, awayWins: 0, draws: 0, averageGoals: null };
    const standings = { home: findStanding(standingsResponse, homeTeam.id), away: findStanding(standingsResponse, awayTeam.id) };
    const bookmakerOddsDetails = getBookmakerOddsDetails(oddsResponse);
    const bookmakerOdds = bookmakerOddsDetails.averageOdds;
    const homeStats = averageStats(recentStats.map((stats) => getMatchStats(stats, homeTeam.id)));
    const awayStats = averageStats(recentStats.map((stats) => getMatchStats(stats, awayTeam.id)));

    // ------------------------------------------------
    // BEKLENEN GOL
    // ------------------------------------------------

    const homeAttack = homeVenueRecent.averageGoalsFor ?? homeRecent.averageGoalsFor;
    const homeDefense = homeVenueRecent.averageGoalsAgainst ?? homeRecent.averageGoalsAgainst;
    const awayAttack = awayVenueRecent.averageGoalsFor ?? awayRecent.averageGoalsFor;
    const awayDefense = awayVenueRecent.averageGoalsAgainst ?? awayRecent.averageGoalsAgainst;
    let expectedHomeGoals = (homeAttack + awayDefense) / 2;
    let expectedAwayGoals = (awayAttack + homeDefense) / 2;

    if (!Number.isFinite(expectedHomeGoals) || !Number.isFinite(expectedAwayGoals) || expectedHomeGoals <= 0 || expectedAwayGoals <= 0) {
      return insufficientAnalysis(canonicalFixture, sourceMetadata, statisticsProfile, analysisVersion);
    }

    if (Number.isFinite(homeStats.expectedGoals)) {
      expectedHomeGoals = expectedHomeGoals * 0.7 + homeStats.expectedGoals * 0.3;
    }

    if (Number.isFinite(awayStats.expectedGoals)) {
      expectedAwayGoals = expectedAwayGoals * 0.7 + awayStats.expectedGoals * 0.3;
    }

    const formEdge = (homeRecent.pointsPerGame - awayRecent.pointsPerGame) / 3;
    const h2hWeight = Math.min(h2h.count / 8, 1);
    const h2hEdge = h2h.count ? ((h2h.homeWins - h2h.awayWins) / h2h.count) * h2hWeight : 0;
    const standingEdge = standings.home && standings.away
      ? clamp((standings.away.rank - standings.home.rank) / 20, -1, 1)
      : 0;
    const shotEdge = Number.isFinite(homeStats.shotsOnTarget) && Number.isFinite(awayStats.shotsOnTarget)
      ? (homeStats.shotsOnTarget - awayStats.shotsOnTarget) / 10 : 0;
    const possessionEdge = Number.isFinite(homeStats.possession) && Number.isFinite(awayStats.possession)
      ? (homeStats.possession - awayStats.possession) / 100 : 0;
    const weightedEdge = clamp(formEdge * 0.18 + h2hEdge * 0.06 + shotEdge * 0.08 + possessionEdge * 0.04 + standingEdge * 0.05, -0.22, 0.22);
    expectedHomeGoals *= HOME_ADVANTAGE * (1 + weightedEdge);
    expectedAwayGoals *= 1 - weightedEdge;

    // Aşırı değerleri sınırla
    expectedHomeGoals = Math.min(
      Math.max(expectedHomeGoals, 0.2),
      4
    );

    expectedAwayGoals = Math.min(
      Math.max(expectedAwayGoals, 0.2),
      4
    );

    // ------------------------------------------------
    // MAÇ SKOR OLASILIKLARI
    // ------------------------------------------------

    let homeWin = 0;
    let draw = 0;
    let awayWin = 0;

   
let over25 = 0;
    let over15 = 0;
    let over35 = 0;
    let bttsYes = 0;
    let totalProbability = 0;
    let mostLikelyScore = { home: 0, away: 0, probability: 0 };

    for (let homeGoals = 0; homeGoals <= 8; homeGoals++) {
      for (let awayGoals = 0; awayGoals <= 8; awayGoals++) {
        const probability =
          poissonProbability(expectedHomeGoals, homeGoals) *
          poissonProbability(expectedAwayGoals, awayGoals);

        totalProbability += probability;
        if (probability > mostLikelyScore.probability) {
          mostLikelyScore = { home: homeGoals, away: awayGoals, probability };
        }

        if (homeGoals > awayGoals) {
          homeWin += probability;
        } else if (homeGoals === awayGoals) {
          draw += probability;
        } else {
          awayWin += probability;
        }

        if (homeGoals + awayGoals > 2) {
          over25 += probability;
        }
        if (homeGoals + awayGoals > 1) over15 += probability;
        if (homeGoals + awayGoals > 3) over35 += probability;

        if (homeGoals > 0 && awayGoals > 0) {
          bttsYes += probability;
        }
      }
    }

    // The finite score grid excludes a very small high-score tail. Normalize
    // its total mass so mutually exclusive outcomes remain mathematically
    // consistent and each displayed probability stays within 0â€“100%.
    homeWin = normalizeProbability(homeWin, totalProbability);
    draw = normalizeProbability(draw, totalProbability);
    awayWin = normalizeProbability(awayWin, totalProbability);
    over25 = normalizeProbability(over25, totalProbability);
    over15 = normalizeProbability(over15, totalProbability);
    over35 = normalizeProbability(over35, totalProbability);
    bttsYes = normalizeProbability(bttsYes, totalProbability);

    if (variant !== "baseline") ({ over15, over25, over35, bttsYes } = blendHistoricalMarkets({ over15, over25, over35, bttsYes }, statisticsProfile));
    let model41Output = null;
    if (model41Artifact) {
      const model41 = require("./services/model41");
      model41Output = model41.predictRaw(model41Artifact, { features: model41.features(statisticsProfile), base: { home: homeWin, draw, away: awayWin, over15, over25, over35, bttsYes } });
      const calibrated = model41.calibrate(model41Output.probabilities, model41Artifact.calibration);
      ({ home: homeWin, draw, away: awayWin, over15, over25, over35, bttsYes } = calibrated);
      if (model41Output.expectedGoals) {
        expectedHomeGoals = model41Output.expectedGoals.home; expectedAwayGoals = model41Output.expectedGoals.away;
        mostLikelyScore = { home: Math.floor(expectedHomeGoals), away: Math.floor(expectedAwayGoals), probability: poissonProbability(expectedHomeGoals, Math.floor(expectedHomeGoals)) * poissonProbability(expectedAwayGoals, Math.floor(expectedAwayGoals)) };
        totalProbability = 1;
      }
    }
    const under25 = 1 - over25;
    const under15 = 1 - over15;
    const under35 = 1 - over35;
    const bttsNo = 1 - bttsYes;

    // ------------------------------------------------
    // ÇİFTE ŞANS
    // ------------------------------------------------

    const doubleChance1X = homeWin + draw;
    const doubleChanceX2 = draw + awayWin;
    const doubleChance12 = homeWin + awayWin;

    // ------------------------------------------------
    // TAHMİN
    // ------------------------------------------------

    let prediction = "X";

    if (homeWin >= draw && homeWin >= awayWin) {
      prediction = "1";
    } else if (awayWin >= homeWin && awayWin >= draw) {
      prediction = "2";
    }

    const [homeWinPercent, drawPercent, awayWinPercent] =
      toPercentagesThatSumTo100([homeWin, draw, awayWin]);
    const [over25Percent, under25Percent] =
      toPercentagesThatSumTo100([over25, under25]);
    const [over15Percent, under15Percent] =
      toPercentagesThatSumTo100([over15, under15]);
    const [over35Percent, under35Percent] =
      toPercentagesThatSumTo100([over35, under35]);
    const [bttsYesPercent, bttsNoPercent] =
      toPercentagesThatSumTo100([bttsYes, bttsNo]);

    const marketProbabilities = {
      "1": homeWinPercent,
      X: drawPercent,
      "2": awayWinPercent,
      "1X": Number((doubleChance1X * 100).toFixed(2)),
      X2: Number((doubleChanceX2 * 100).toFixed(2)),
      "12": Number((doubleChance12 * 100).toFixed(2)),
      "Üst 1.5": over15Percent,
      "Alt 1.5": under15Percent,
      "Üst 2.5": over25Percent,
      "Alt 2.5": under25Percent,
      "Üst 3.5": over35Percent,
      "Alt 3.5": under35Percent,
      "KG Var": bttsYesPercent,
      "KG Yok": bttsNoPercent,
    };
    const fairOddsByMarket = Object.fromEntries(
      Object.entries(marketProbabilities).map(([market, probability]) => [
        market,
        probability > 0 ? Number((100 / probability).toFixed(3)) : null,
      ])
    );
    const valueByMarket = Object.fromEntries(
      Object.entries(marketProbabilities).map(([market, probability]) => {
        const bookmakerOdd = bookmakerOdds[getOddsKey(market)];
        return [market, Number.isFinite(bookmakerOdd) ? Number((bookmakerOdd * (probability / 100) * 100 - 100).toFixed(2)) : null];
      })
    );
    const dataQuality = calculateDataQuality({
      fixtureAvailable: Boolean(fixture?.fixture?.id),
      teamsAvailable: Boolean(homeTeam?.id && awayTeam?.id),
      leagueAvailable: Boolean(fixture?.league?.id && fixture?.league?.name),
      homeForm10: homeForm,
      awayForm10: awayForm,
      homeForm5,
      awayForm5,
      homeVenueForm,
      awayVenueForm,
      h2h,
      standings,
      stats: { home: homeStats, away: awayStats },
      bookmakerOdds,
    });
    if (variant !== "baseline") dataQuality.score = Math.min(dataQuality.score, statisticsProfile.dataQuality.score);
    Object.assign(dataQuality, { homeSample: statisticsProfile.home.sampleSize, awaySample: statisticsProfile.away.sampleSize, missingFields: statisticsProfile.dataQuality.missingFields, sources: statisticsProfile.dataQuality.sources });
    const oddsAgreement = Object.entries(bookmakerOdds).reduce((scores, [market, odd]) => {
      const probability = marketProbabilities[market] || marketProbabilities[{ over15: "Üst 1.5", under15: "Alt 1.5", over25: "Üst 2.5", under25: "Alt 2.5", over35: "Üst 3.5", under35: "Alt 3.5", bttsYes: "KG Var", bttsNo: "KG Yok" }[market]];
      if (!probability) return scores;
      scores.push(Math.abs((1 / odd) - (probability / 100)));
      return scores;
    }, []);
    const sourceDisagreement = oddsAgreement.length ? averageNullable(oddsAgreement) : 0;
    const bestMarket = Object.entries(marketProbabilities)
      .map(([market, probability]) => ({
        market,
        probability,
        confidence: calculateConfidence({ dataQuality: dataQuality.score, homeGames: homeRecent.games, awayGames: awayRecent.games, probabilities: [homeWinPercent, drawPercent, awayWinPercent], value: valueByMarket[market] }),
        fairOdds: fairOddsByMarket[market],
        bookmakerOdds: bookmakerOdds[getOddsKey(market)] ?? null,
        value: valueByMarket[market],
      }))
      .sort((left, right) => rankMarket({ ...right, dataQuality: dataQuality.score, hasOdds: Number.isFinite(right.bookmakerOdds) }) - rankMarket({ ...left, dataQuality: dataQuality.score, hasOdds: Number.isFinite(left.bookmakerOdds) }))[0];
    const confidence = bestMarket.confidence;
    const predictionEligible = dataQuality.score >= 40;
    const predictionScore = rankMarket({ probability: bestMarket.probability, confidence, dataQuality: dataQuality.score, value: bestMarket.value, hasOdds: Number.isFinite(bestMarket.bookmakerOdds) });

    // ------------------------------------------------
    // SONUÇ
    // ------------------------------------------------

    const isPreKickoff = new Date(fixture.fixture.date).getTime() > now && normalizeStatus(fixture.fixture?.status?.short) === "SCHEDULED";
    if (persist && predictionEligible && bestMarket && isPreKickoff) {
      savePredictionRecord({
        fixtureId: fixture.fixture.id,
        providerFixtureIds: canonicalFixture.providerFixtureIds,
        canonicalFixtureId: canonicalFixture.canonicalFixtureId,
        date: fixture.fixture.date,
        league: fixture.league.name,
        homeTeam: homeTeam.name,
        awayTeam: awayTeam.name,
        home: homeTeam.name,
        away: awayTeam.name,
        market: bestMarket.market,
        prediction: bestMarket.market,
        probability: bestMarket.probability,
        modelProbability: bestMarket.probability,
        confidence: Number(confidence.toFixed(0)),
        dataQuality: dataQuality.score,
        predictionScore,
        bookmakerOdds: bookmakerOdds[getOddsKey(bestMarket.market)] ?? null,
        fairOdds: fairOddsByMarket[bestMarket.market],
        value: valueByMarket[bestMarket.market],
        modelVersion: analysisVersion,
        predictedScoreHome: mostLikelyScore.home,
        predictedScoreAway: mostLikelyScore.away,
        status: "pending",
        result: null,
        createdAt: new Date().toISOString(),
      });
      
      saveSnapshot({ predictionEligible, fixture: { id: fixture.fixture.id, canonicalFixtureId: canonicalFixture?.canonicalFixtureId || null, providerFixtureIds: canonicalFixture.providerFixtureIds, sourceProviders: sourceMetadata.providers, date: fixture.fixture.date, home: homeTeam, away: awayTeam, league: fixture.league.name, country: fixture.league.country }, model: { version: analysisVersion, confidence: Number(confidence.toFixed(0)) }, recommendation: { bestMarket }, markets: Object.fromEntries(Object.entries(marketProbabilities).map(([market, probability]) => [market, { probability, fairOdds: fairOddsByMarket[market], value: valueByMarket[market], bookmakerOffers: bookmakerOddsDetails.offers[getOddsKey(market)] || [] }])), dataQuality, homeForm, awayForm, homeVenueForm, awayVenueForm, h2h, standings, statistics: { home: homeStats, away: awayStats }, expectedGoals: { home: Number(expectedHomeGoals.toFixed(2)), away: Number(expectedAwayGoals.toFixed(2)) }, bookmakerOffers: bookmakerOddsDetails.offers, sourceAgreement: { bookmakerModelProbabilityGap: Number((sourceDisagreement * 100).toFixed(2)), status: !oddsAgreement.length ? "unavailable" : sourceDisagreement > 0.15 ? "low" : sourceDisagreement > 0.08 ? "medium" : "high" }, sourceMetadata }, { filePath: historicalArchivePath });
    }

    return {
      success: true,

      sourceMetadata,
      statisticsProfile,
      eligible: predictionEligible,
      strongestPrediction: predictionEligible ? { market: ({ "1": "HOME", X: "DRAW", "2": "AWAY", "1X": "1X", X2: "X2", "12": "12", "\u00dcst 1.5": "OVER_1_5", "Alt 1.5": "UNDER_1_5", "\u00dcst 2.5": "OVER_2_5", "Alt 2.5": "UNDER_2_5", "\u00dcst 3.5": "OVER_3_5", "Alt 3.5": "UNDER_3_5", "KG Var": "BTTS_YES", "KG Yok": "BTTS_NO" })[bestMarket.market], label: bestMarket.market, probability: bestMarket.probability / 100, confidence: confidence / 100, dataQuality: dataQuality.score } : null,
      probabilities: { home: homeWin, draw, away: awayWin, over15, over25, over35, bttsYes },
      ...(model41Output ? { teamGoalProbabilities: Object.fromEntries(["homeOver05", "homeOver15", "awayOver05", "awayOver15"].map(key => [key, model41Output.probabilities[key] ?? null])) } : {}),
      fixture: {
        canonicalFixtureId: canonicalFixture.canonicalFixtureId,
        providerFixtureIds: canonicalFixture.providerFixtureIds,
        sourceProviders: sourceMetadata.providers,
        id: fixture.fixture.id,
        date: fixture.fixture.date,
        league: fixture.league.name,
        country: fixture.league.country,

        home: {
          id: homeTeam.id,
          name: homeTeam.name,
          logo: homeTeam.logo,
        },

        away: {
          id: awayTeam.id,
          name: awayTeam.name,
          logo: awayTeam.logo,
        },
      },

      model: {
        name: "İstatistiksel Poisson + Güncel Form",
        version: analysisVersion,
        ...(model41Output ? { id: "MODEL_4_1", calibration: model41Artifact.calibration.method, goalModel: model41Artifact.goalChoice, rawProbabilities: model41Output.probabilities } : {}),
        confidence: Number(confidence.toFixed(0)),
      },

      historicalSampleSize: { home: homeMatches.length, away: awayMatches.length },
      homePerformance: homeVenueForm,
      awayPerformance: awayVenueForm,
      homeForm,
      awayForm,
      homeForm5,
      awayForm5,
      homeVenueForm,
      awayVenueForm,
      statistics: { home: homeStats, away: awayStats },

      dataQuality,
      dataQualityLabel: dataQuality.score >= 90 ? "Çok güçlü veri" : dataQuality.score >= 75 ? "Güçlü veri" : dataQuality.score >= 60 ? "Orta veri" : dataQuality.score >= 40 ? "Zayıf veri" : "Yetersiz veri",
      predictionEligible,
      predictionScore,
      standings,
      bookmakerOdds,
      bookmakerOffers: bookmakerOddsDetails.offers,
      sourceAgreement: {
        bookmakerModelProbabilityGap: Number((sourceDisagreement * 100).toFixed(2)),
        status: !oddsAgreement.length ? "unavailable" : sourceDisagreement > 0.15 ? "low" : sourceDisagreement > 0.08 ? "medium" : "high",
      },
      dataAvailability: {
        fixture: Boolean(fixture?.fixture?.id),
        teams: Boolean(homeTeam?.id && awayTeam?.id),
        teamForm: { home: homeMatches.length > 0, away: awayMatches.length > 0 },
        formSamples: { home: homeForm.games, away: awayForm.games },
        homeVenueForm: homeVenueForm.games > 0,
        awayVenueForm: awayVenueForm.games > 0,
        h2h: h2h.count > 0,
        statistics: recentStats.some((stats) => Array.isArray(stats) && stats.length > 0),
        xg: Number.isFinite(homeStats.expectedGoals) || Number.isFinite(awayStats.expectedGoals),
        apiXg: Number.isFinite(homeStats.expectedGoals) || Number.isFinite(awayStats.expectedGoals),
        standings: Boolean(standings.home || standings.away),
        odds: Object.keys(bookmakerOdds).length > 0,
        injuries: false,
        lineups: false,
      },

      h2h,

      expectedGoals: {
        home: Number(expectedHomeGoals.toFixed(2)),
        away: Number(expectedAwayGoals.toFixed(2)),
      },
      expectedGoalsSource: "model",

      dnb: { home: homeWin + awayWin > 0 ? Number((homeWin / (homeWin + awayWin) * 100).toFixed(2)) : null, away: homeWin + awayWin > 0 ? Number((awayWin / (homeWin + awayWin) * 100).toFixed(2)) : null, push: drawPercent },
      predictions: {
        homeWin: homeWinPercent,
        draw: drawPercent,
        awayWin: awayWinPercent,

        doubleChance1X: Number(
          (doubleChance1X * 100).toFixed(2)
        ),

        doubleChanceX2: Number(
          (doubleChanceX2 * 100).toFixed(2)
        ),

        doubleChance12: Number(
          (doubleChance12 * 100).toFixed(2)
        ),

        over25: over25Percent,
        under25: under25Percent,
        over15: over15Percent,
        under15: under15Percent,
        over35: over35Percent,
        under35: under35Percent,

        bttsYes: bttsYesPercent,
        bttsNo: bttsNoPercent,
      },

      markets: Object.fromEntries(
        Object.entries(marketProbabilities).map(([market, probability]) => [market, {
          probability,
          confidence: Number(confidence.toFixed(0)),
          dataQuality: dataQuality.score,
          fairOdds: fairOddsByMarket[market],
          bookmakerOdds: bookmakerOdds[getOddsKey(market)] ?? null,
          bookmakerOffers: bookmakerOddsDetails.offers[getOddsKey(market)] || [],
          value: valueByMarket[market],
        }])
      ),

      prediction,
      estimatedScore: {
        home: mostLikelyScore.home,
        away: mostLikelyScore.away,
        probability: Number((normalizeProbability(mostLikelyScore.probability, totalProbability) * 100).toFixed(2)),
      },
      recommendation: predictionEligible ? {
        eligible: true,
        main: prediction,
        alternative: homeWin >= awayWin ? "1X" : "X2",
        bestMarket,
        probability: bestMarket.probability,
        confidence: Number(confidence.toFixed(0)),
        bookmakerOdds: bookmakerOdds[getOddsKey(bestMarket.market)] ?? null,
        fairOdds: fairOddsByMarket[bestMarket.market],
        value: valueByMarket[bestMarket.market],
        reasons: [
          ...buildReasons({ homeRecent, awayRecent, homeVenue: homeVenueRecent, h2h, standings, dataQuality, hasXg: Number.isFinite(homeStats.expectedGoals) || Number.isFinite(awayStats.expectedGoals) }),
        ],
      } : {
        eligible: false,
        main: "NO_BET",
        reason: "Yetersiz veri",
        message: "Bu maç için güvenilir istatistiksel tahmin oluşturmak için yeterli veri bulunamadı.",
        confidence: Number(confidence.toFixed(0)),
      },

      note:
        "Bu sonuçlar istatistiksel model çıktısıdır. Kesin maç sonucu veya bahis garantisi değildir.",
    };
  } catch (error) {
    throw error;
  }
}

const { ProductionAnalysis } = require("./services/productionAnalysis");
const { PredictionLedger } = require("./services/predictionLedger");
const { mountLedgerRoutes } = require("./services/forwardPerformance");
const predictionLedger = new PredictionLedger();
const productionAnalysis = new ProductionAnalysis({
  ledger: predictionLedger,
  collect: async fixtureId => {
    const canonical = (await providerRegistry.getFixture(fixtureId))[0];
    if (!canonical) throw new ProviderError("no_data", "Fixture unavailable.");
    return providerRegistry.collectAnalysis(canonical, { includeMatchStatistics: true });
  },
  calculate: analyzeCollectedFixture,
});
const { ForwardCapture } = require("./services/forwardCapture");
const forwardCapture = new ForwardCapture({
  ledger: predictionLedger,
  analysis: productionAnalysis,
  historicalCoverage: fixture => providerRegistry.providers.some(provider => provider.enabled && provider.supportsHistoricalLeague?.(fixture.league)),
  discover: async date => {
    const list = await providerRegistry.getFixturesByDate(date);
    return list.stale ? providerRegistry.fixtureDiscovery.refresh(date) : list;
  },
});

app.get("/api/analyze/:fixtureId", analyzeLimiter, concurrencyGuard(2), async (req, res) => {
  const fixtureId = req.params.fixtureId;
  if (!fixtureId || fixtureId.length > 500 || /[\x00-\x1f]/.test(fixtureId)) return res.status(400).json({ success: false, error: { message: "Geçerli bir maç kimliği gönderilmedi." } });
  if (req.query.model !== undefined && !["MODEL_4_0", "MODEL_4_1"].includes(req.query.model)) return res.status(400).json({ success: false, error: { message: "Geçersiz model seçimi." } });
  try {
    return res.json(await analyzeFixture(fixtureId, { shadow: true, modelVersion: req.query.model }));
  } catch (error) {
    console.error(JSON.stringify({ type: "ANALYSIS_FAILED", fixtureId, category: error.category || "internal", message: error.message }));
    const status = error.status || getProviderErrorStatus(error);
    return res.status(status).json({ success: false, error: { message: getPublicErrorMessage(error, "Analiz verileri alınamadı. Lütfen daha sonra tekrar deneyin.") } });
  }
});

app.get("/api/match-context/:fixtureId", analyzeLimiter, concurrencyGuard(2), async (req, res) => {
  const fixtureId = req.params.fixtureId;
  if (!fixtureId || fixtureId.length > 500 || /[\x00-\x1f]/.test(fixtureId)) return res.status(400).json({ success: false, error: "Geçerli bir maç kimliği gönderilmedi." });
  try {
    const fixtures = await providerRegistry.getFixture(fixtureId);
    const fixture = fixtures?.[0];
    if (!fixture) return res.status(404).json({ success: false, error: "Maç veri sağlayıcılarında bulunamadı." });
    const newsFixture = { league: fixture.league, teams: { home: fixture.homeTeam, away: fixture.awayTeam } };
    const context = await espn.getNewsForFixture(newsFixture);
    return res.json({ success: true, fixture: { id: fixture.fixtureId || fixture.canonicalFixtureId, league: fixture.league?.name, home: fixture.homeTeam?.name, away: fixture.awayTeam?.name }, context });
  } catch (error) {
    console.warn(JSON.stringify({ type: "MATCH_CONTEXT_UNAVAILABLE", fixtureId, category: error.category || "provider_unavailable" }));
    return res.json({ success: true, context: { provider: "ESPN", available: false, reason: error.category || "provider_unavailable", articles: [] } });
  }
});

// --------------------------------------------------
// SERVER
// --------------------------------------------------

const bestPredictionsCache = new Map();
const BEST_PREDICTIONS_TTL_MS = 5 * 60 * 1000;
const BEST_PREDICTIONS_LIMIT = 200;
const BEST_PREDICTIONS_MIN_QUALITY = 45;
const BEST_PREDICTIONS_MIN_CONFIDENCE = 50;
const BEST_PREDICTIONS_MIN_PROBABILITY = 50;

app.get("/api/best-predictions", heavyLimiter, concurrencyGuard(3), async (req, res) => {
  if (req.query.date !== undefined && !isValidDateKey(req.query.date)) {
    return res.status(400).json({ success: false, error: "Geçersiz tarih formatı. YYYY-MM-DD bekleniyor." });
  }
  const requestedDate = getRequestedDate(req.query.date);
  const cacheKey = `${requestedDate}:MODEL_4_0:historical-v1`;
  const cached = bestPredictionsCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < BEST_PREDICTIONS_TTL_MS) {
    return res.json(cached.value);
  }

  try {
    const pool = (await getLocalDayFixtures(providerRegistry, requestedDate, toFrontendFixture)).matches;

    const candidates = [...new Map(
      pool
        .sort((a, b) => {
          const active = match => ["SCHEDULED", "LIVE"].includes(normalizeStatus(match.fixture?.status?.short)) ? 1 : 0;
          return active(b) - active(a) || Number(openFootball.supportsHistoricalLeague(b.league)) - Number(openFootball.supportsHistoricalLeague(a.league));
        })
        .map((match) => [match.fixture?.id, match])
    ).values()].slice(0, BEST_PREDICTIONS_LIMIT);
    const candidateById = new Map(candidates.map(match => [String(match.fixture?.id), match]));
    const evaluated = [];
    const diagnosticAnalyses = [];
    // Bound upstream work: the endpoint can see hundreds of fixtures, but must not
    // fan out an unbounded number of provider requests or wait for 200 sequential analyses.
    const ANALYSIS_CONCURRENCY = 4;
    await forEachConcurrent(candidates, ANALYSIS_CONCURRENCY, async (match) => {
      try {
        const analysis = await analyzeFixture(String(match.fixture.id), { includeMatchStatistics: false, modelVersion: "MODEL_4_0" });
        diagnosticAnalyses.push(analysis);
        const availability = analysis.dataAvailability || {};
        console.log(JSON.stringify({
          type: "DATA_DIAGNOSTIC",
          date: requestedDate,
          fixtureId: match.fixture.id,
          FIXTURE_DATA_OK: Boolean(availability.fixture),
          FORM_DATA_OK: Boolean(availability.teamForm?.home && availability.teamForm?.away),
          H2H_DATA_OK: Boolean(availability.h2h),
          ODDS_DATA_OK: Boolean(availability.odds),
          STANDINGS_DATA_OK: Boolean(availability.standings),
          XG_DATA_OK: Boolean(availability.apiXg),
        }));
        // Finished fixtures still receive a historical assessment, but never enter the live recommendation list.
        if (normalizeStatus(match.fixture?.status?.short) === "FINISHED") return;
        const bestMarket = analysis.recommendation?.bestMarket;
        if (!analysis.predictionEligible || !bestMarket || Number(analysis.dataQuality?.score) < BEST_PREDICTIONS_MIN_QUALITY || Number(analysis.model?.confidence) < BEST_PREDICTIONS_MIN_CONFIDENCE || Number(bestMarket.probability) < BEST_PREDICTIONS_MIN_PROBABILITY || ["NO_BET", "NO BET"].includes(bestMarket.market)) return;
        evaluated.push({
          fixture: analysis.fixture,
          modelVersion: "MODEL_4_0", model41Available: false, model41FallbackReason: "LAZY_DETAIL_ONLY",
          statisticsQuality: analysis.statisticsProfile?.dataQuality || analysis.dataQuality,
          historicalSampleSize: analysis.historicalSampleSize,
          dataQuality: analysis.dataQuality,
          dataQualityLabel: analysis.dataQualityLabel,
          confidence: analysis.model?.confidence ?? 0,
          predictionScore: analysis.predictionScore ?? 0,
          predictions: analysis.predictions,
          expectedGoals: analysis.expectedGoals,
          prediction: bestMarket,
          bookmakerOdds: analysis.recommendation?.bookmakerOdds ?? null,
          fairOdds: analysis.recommendation?.fairOdds ?? null,
          value: analysis.recommendation?.value ?? null,
          eligible: Boolean(analysis.predictionEligible),
          availability: analysis.dataAvailability,
        });
      } catch (error) {
        // A secondary provider lookup must not turn one failed match into a failed response.
        let fallback = null;
        try { fallback = (await providerRegistry.getFixture(String(match.fixture.id)))[0] || null; } catch { /* provider remains unavailable */ }
        if (fallback) diagnosticAnalyses.push(insufficientAnalysis(fallback, { errorCategory: error.category || "provider_unavailable" }));
        else diagnosticAnalyses.push({
          success: false,
          predictionEligible: false,
          model: { confidence: 0 },
          dataQuality: { score: 0, missing: ["PROVIDER_UNAVAILABLE"] },
          dataAvailability: { fixture: false, teamForm: { home: false, away: false }, h2h: false, odds: false, standings: false, apiXg: false },
          fixture: { id: match.fixture?.id, date: match.fixture?.date, league: match.league?.name, home: match.teams?.home?.name, away: match.teams?.away?.name },
        });
        console.warn(`Best prediction analiz edilemedi: ${match.fixture?.id}`);
      }
    });

    evaluated.sort((left, right) => right.predictionScore - left.predictionScore);
    const diagnostics = {
      fixtureCount: pool.length,
      analyzedCount: diagnosticAnalyses.length,
      eligibleCount: evaluated.length,
      fixtureDataCount: diagnosticAnalyses.filter((analysis) => analysis.dataAvailability?.fixture).length,
      formAvailableCount: diagnosticAnalyses.filter((analysis) => analysis.dataAvailability?.teamForm?.home && analysis.dataAvailability?.teamForm?.away).length,
      h2hAvailableCount: diagnosticAnalyses.filter((analysis) => analysis.dataAvailability?.h2h).length,
      standingsAvailableCount: diagnosticAnalyses.filter((analysis) => analysis.dataAvailability?.standings).length,
      oddsAvailableCount: diagnosticAnalyses.filter((analysis) => analysis.dataAvailability?.odds).length,
      xgAvailableCount: diagnosticAnalyses.filter((analysis) => analysis.dataAvailability?.apiXg).length,
      averageDataQuality: diagnosticAnalyses.length ? Number((diagnosticAnalyses.reduce((sum, analysis) => sum + Number(analysis.dataQuality?.score || 0), 0) / diagnosticAnalyses.length).toFixed(2)) : 0,
    };
    const value = {
      success: true,
      date: requestedDate,
      evaluated: candidates.length,
      eligible: evaluated.length,
      poolSize: pool.length,
      results: evaluated,
      assessments: diagnosticAnalyses.map((analysis) => {
        const match = candidateById.get(String(analysis.fixture?.id));
        const fixtureStatus = normalizeStatus(match?.fixture?.status?.short);
        const historical = fixtureStatus === "FINISHED";
        const eligible = !historical && analysis.predictionEligible === true;
        return {
          fixture: analysis.fixture,
          status: historical ? "HISTORICAL_ANALYSIS" : eligible ? "PREDICTION" : "INSUFFICIENT_DATA",
          fixtureStatus,
          actualScore: historical ? { home: match?.goals?.home ?? null, away: match?.goals?.away ?? null } : null,
          note: historical ? "Retrospektif analiz; maç öncesi yayımlanmış tahmin kaydı değildir." : null,
          dataQuality: analysis.dataQuality,
          confidence: historical ? null : analysis.model?.confidence ?? 0,
          availability: analysis.dataAvailability || {},
          recommendation: eligible ? analysis.recommendation : { eligible: false, main: "NO_BET", reason: historical ? "HISTORICAL_FIXTURE" : "INSUFFICIENT_DATA" }
        };
      }),
      diagnostics,
      note: "Yetersiz veri etiketi taşıyan maçlar en iyi tahmin listesinde öneri olarak gösterilmez.",
    };
    bestPredictionsCache.set(cacheKey, { createdAt: Date.now(), value });
    return res.json(value);
  } catch (error) {
    console.error("BEST PREDICTIONS HATASI:", error.message);
    return res.status(getProviderErrorStatus(error)).json({ success: false, error: getPublicErrorMessage(error, "En iyi tahminler alınamadı.") });
  }
});

app.get("/api/data-diagnostics", heavyLimiter, concurrencyGuard(3), async (req, res) => {
  if (isProduction) return res.status(404).json({ success: false, error: "Endpoint bulunamadı." });
  if (req.query.date !== undefined && !isValidDateKey(req.query.date)) {
    return res.status(400).json({ success: false, error: "Geçersiz tarih formatı. YYYY-MM-DD bekleniyor." });
  }
  const requestedDate = getRequestedDate(req.query.date);
  const cached = bestPredictionsCache.get(requestedDate);
  if (cached?.value?.diagnostics) return res.json({ success: true, date: requestedDate, ...cached.value.diagnostics });
  try {
    const fixtures = await providerRegistry.getFixtures(requestedDate);
    return res.json({ success: true, date: requestedDate, fixtureCount: fixtures.length, analyzedCount: 0, eligibleCount: 0, fixtureDataCount: fixtures.length, formAvailableCount: 0, h2hAvailableCount: 0, standingsAvailableCount: 0, oddsAvailableCount: 0, xgAvailableCount: 0, averageDataQuality: 0 });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Data diagnostics alınamadı." });
  }
});

app.get("/api/performance", heavyLimiter, concurrencyGuard(3), async (req, res) => {
  try {
    const records = await checkPendingPredictions(10);
    const archive = await settlePending({ getResults: (providerFixtureIds) => providerRegistry.getResults(providerFixtureIds), filePath: historicalArchivePath, limit: 10 });
    return res.json({ success: true, ...summarizePerformance(records), archive: summarizeArchive(archive.records), archiveSettlement: { checked: archive.checked, quotaStopped: archive.quotaStopped } });
  } catch (error) {
    console.error("PERFORMANS HATASI:", error.message);
    return res.status(500).json({ success: false, error: "Performans verileri alınamadı." });
  }
});

app.get("/api/archive/status", heavyLimiter, concurrencyGuard(3), (req, res) => {
  const summary = summarizeArchive(readArchive(historicalArchivePath));
  return res.json({ success: true, totalPredictions: summary.totalPredictions, completed: summary.completed, verified: summary.verified, unverified: summary.unverified, conflict: summary.conflict, pending: summary.pending, unavailable: summary.unavailable, noBet: summary.noBet, coverage: summary.coverage, modelVersions: summary.modelVersions });
});

app.get("/api/archive/performance", heavyLimiter, concurrencyGuard(3), (req, res) => {
  return res.json({ success: true, ...summarizeArchive(readArchive(historicalArchivePath)) });
});

app.get("/api/providers/status", (req, res) => {
  return res.json({ success: true, providers: providerRegistry.getStatus() });
});

app.get("/api/backtest", (req, res) => {
  const { REPORT_FILE } = require("./services/benchmarkDataset");
  if (!fs.existsSync(REPORT_FILE)) return res.status(404).json({ success: false, error: "Backtest report not generated yet." });
  try { return res.json({ success: true, report: JSON.parse(fs.readFileSync(REPORT_FILE, "utf8")) }); }
  catch { return res.status(500).json({ success: false, error: "Backtest report could not be read." }); }
});

app.get("/api/backtest/model41", (req, res) => {
  const reportFile = path.join(__dirname, "data/backtest/model41-report.json");
  if (!fs.existsSync(reportFile)) return res.status(404).json({ success: false, error: "Model 4.1 final report is not available yet." });
  try { return res.json({ success: true, report: JSON.parse(fs.readFileSync(reportFile, "utf8")) }); }
  catch { return res.status(500).json({ success: false, error: "Model 4.1 report could not be read." }); }
});

mountLedgerRoutes(app, predictionLedger);
app.get("/api/capture/status", (req, res) => {
  try { return res.json({ success: true, ...forwardCapture.status() }); }
  catch { return res.status(503).json({ success: false, error: "Forward capture status unavailable." }); }
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: "Endpoint bulunamadı." });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), endpoint: req.originalUrl, errorType: error.type || error.name || "UnknownError", message: error.message }));
  const status = error.type === "entity.too.large" ? 413 : error.message === "CORS origin denied" ? 403 : 500;
  return res.status(status).json({ success: false, error: status === 413 ? "İstek gövdesi çok büyük." : status === 403 ? "Origin izinli değil." : "Sunucu hatası." });
});

if (require.main === module) {
  // CI's local server must not start scheduled provider requests or mutate runtime ledgers.
  if (process.env.ZEUS_DISABLE_CAPTURE_SCHEDULER !== "1") {
    forwardCapture.startScheduler();
    const resultCheckTimer = setInterval(() => {
      predictionLedger.settleFromProviders(ids => providerRegistry.getResults(ids))
        .catch(error => console.warn(JSON.stringify({ type: "LEDGER_SETTLEMENT_FAILED", error: error.message })));
      checkPendingPredictions(10).catch((error) => console.warn("Otomatik sonuç kontrolü başarısız:", error.message));
      settlePending({ getResults: (providerFixtureIds) => providerRegistry.getResults(providerFixtureIds), filePath: historicalArchivePath, limit: 10 })
        .then((result) => { if (result.quotaStopped) console.warn("Archive sonuç kontrolü kota nedeniyle durduruldu."); })
        .catch((error) => console.warn("Archive otomatik sonuç kontrolü başarısız:", error.message));
    }, 15 * 60 * 1000);
    resultCheckTimer.unref();
  }

  app.listen(PORT, () => {
    console.log(
      `Futbol Analiz AI backend çalışıyor: http://localhost:${PORT}`
    );
  });
}
// Vercel serverless (@vercel/node), modülün dışa aktardığı isteği karşılayan bir
// handler fonksiyonu bekler. Express uygulaması (`app`) böyle bir fonksiyondur; bu
// nedenle modülü doğrudan `app` olarak dışa aktarıyoruz. Mevcut adlandırılmış
// dışa aktarımlar (testlerin ve diğer modüllerin kullandığı) fonksiyona özellik
// olarak eklenerek korunur; hiçbir mevcut import kırılmaz.
module.exports = app;
Object.assign(module.exports, { app, checkPendingPredictions, analyzeFixture, analyzeCollectedFixture, providerRegistry, upstream, productionAnalysis, forwardCapture, predictionLedger });


