"use strict";

// Independent, read-only cross-check of the locked hybrid test set.
// Predictions are frozen; outcomes are scored only when OpenFootball and football-data.co.uk agree.
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const { loadDataset } = require("../services/benchmarkDataset");
const { replayInput } = require("../services/chronologicalBenchmark");
const { buildMatchStatistics } = require("../services/teamStatistics");
const { buildHybridRecommendation } = require("../services/hybridPredictionRobot");
const { splitOf } = require("../services/model41Experiment");

const DATA = path.join(__dirname, "../data/backtest");
const CODES = {
  "Premier League": "E0",
  "La Liga": "SP1",
  "Bundesliga": "D1",
  "Serie A": "I1",
  "Ligue 1": "F1",
};
const ALIASES = {
  manutd: "manchesterunited", manchesterutd: "manchesterunited",
  mancity: "manchestercity", manchestercity: "manchestercity",
  spurs: "tottenhamhotspur", tottenham: "tottenhamhotspur",
  wolves: "wolverhamptonwanderers", wolverhampton: "wolverhamptonwanderers",
  westham: "westhamunited", westhamunited: "westhamunited",
  newcastle: "newcastleunited", brighton: "brightonandhovealbion",
  brightonhovealbion: "brightonandhovealbion", leeds: "leedsunited",
  leicester: "leicestercity", nottinghamforest: "nottinghamforest",
  realbetisbalompie: "realbetis", realbetis: "realbetis",
  athleticclub: "athleticbilbao", athleticbilbao: "athleticbilbao",
  atleticomadrid: "atleticomadrid", atletico: "atleticomadrid",
  inter: "intermilan", internazionale: "intermilan", intermilan: "intermilan",
  acmilan: "acmilan", milan: "acmilan", asroma: "asroma", roma: "asroma",
  bayern: "bayernmunich", bayernmunich: "bayernmunich",
  leipzig: "rbleipzig", rbleipzig: "rbleipzig",
  freiburg: "scfreiburg", scfreiburg: "scfreiburg",
  stuttgart: "vfbstuttgart", vfbstuttgart: "vfbstuttgart",
  wolfsburg: "vflwolfsburg", vflwolfsburg: "vflwolfsburg",
  unionberlin: "unionberlin", eintrachtfrankfurt: "eintrachtfrankfurt",
  psg: "parissaintgermain", parissaintgermain: "parissaintgermain",
  marseille: "olympiquedemarseille", olympiquemarseille: "olympiquedemarseille",
  lyon: "olympiquelyonnais", olympiquelyonnais: "olympiquelyonnais",
  auxerre: "ajauxerre", ajauxerre: "ajauxerre",
  nice: "ogcnice", ogcnice: "ogcnice",
};
function normalizeTeam(value) {
  const key = String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  return ALIASES[key] || key;
}
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") {
      row.push(field); field = "";
      if (row.some(cell => String(cell).trim() !== "")) rows.push(row);
      row = [];
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(h => String(h).trim());
  return rows.map(cells => Object.fromEntries(headers.map((header, index) => [header, String(cells[index] ?? "").trim()])));
}
function parseDate(value) {
  const parts = String(value || "").trim().split(/[/.\\-]/);
  if (parts.length !== 3) return null;
  let day, month, year;
  if (parts[0].length === 4) [year, month, day] = parts;
  else [day, month, year] = parts;
  if (String(year).length === 2) year = Number(year) >= 90 ? "19" + year : "20" + year;
  const result = String(year) + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  return Number.isFinite(Date.parse(result + "T00:00:00Z")) ? result : null;
}
function number(value) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
async function fetchResults(league, code) {
  const url = "https://www.football-data.co.uk/mmz4281/2526/" + code + ".csv";
  const response = await axios.get(url, { timeout: 20000, responseType: "text" });
  const rows = parseCsv(response.data).map(row => ({
    date: parseDate(row.Date),
    home: normalizeTeam(row.HomeTeam),
    away: normalizeTeam(row.AwayTeam),
    homeGoals: Number(row.FTHG),
    awayGoals: Number(row.FTAG),
    avgH: number(row.AvgH),
    avgD: number(row.AvgD),
    avgA: number(row.AvgA),
    sourceUrl: url,
  })).filter(row => row.date && row.home && row.away
    && Number.isInteger(row.homeGoals) && row.homeGoals >= 0
    && Number.isInteger(row.awayGoals) && row.awayGoals >= 0);
  return { league, code, url, rows };
}
function findIndependentResult(target, source) {
  const home = normalizeTeam(target.teams.home.name);
  const away = normalizeTeam(target.teams.away.name);
  const targetDay = String(target.fixture.date || "").slice(0, 10);
  const candidates = source.rows.filter(row => row.home === home && row.away === away
    && Math.abs(Date.parse(row.date + "T00:00:00Z") - Date.parse(targetDay + "T00:00:00Z")) <= 86400000);
  if (candidates.length !== 1) return null;
  return candidates[0];
}
function topClass(probabilities) {
  const values = [probabilities.home, probabilities.draw, probabilities.away];
  return ["home", "draw", "away"][values.indexOf(Math.max(...values))];
}
function actualWinner(home, away) { return home > away ? "home" : home === away ? "draw" : "away"; }
function actualMarket(market, home, away) {
  const total = home + away;
  return ({
    "1": home > away, X: home === away, "2": away > home,
    "1X": home >= away, X2: away >= home, "12": home !== away,
    OVER_1_5: total > 1, UNDER_1_5: total < 2,
    OVER_2_5: total > 2, UNDER_2_5: total < 3,
    OVER_3_5: total > 3, UNDER_3_5: total < 4,
    BTTS_YES: home > 0 && away > 0, BTTS_NO: home === 0 || away === 0,
  })[market];
}
function accumulator() {
  return { n: 0, correct: 0, brierSum: 0, logLossSum: 0 };
}
function addProbabilities(acc, probabilities, winner) {
  const p = [probabilities.home, probabilities.draw, probabilities.away];
  const actual = ["home", "draw", "away"].map(key => Number(key === winner));
  acc.n++;
  if (topClass(probabilities) === winner) acc.correct++;
  acc.brierSum += p.reduce((sum, value, i) => sum + (value - actual[i]) ** 2, 0);
  acc.logLossSum += -Math.log(Math.max(1e-15, probabilities[winner]));
}
function summarize(acc) {
  return { sampleSize: acc.n, correct: acc.correct, hitRate: acc.n ? acc.correct / acc.n : null,
    multiclassBrier: acc.n ? acc.brierSum / acc.n : null, logLoss: acc.n ? acc.logLossSum / acc.n : null };
}
function wilson(successes, n) {
  if (!n) return null;
  const z = 1.959963984540054, p = successes / n, d = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / d;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / d;
  return { lower95: center - margin, upper95: center + margin };
}
function marketProbabilities(row) {
  if (![row.avgH, row.avgD, row.avgA].every(Number.isFinite)) return null;
  const inverse = [1 / row.avgH, 1 / row.avgD, 1 / row.avgA];
  const total = inverse.reduce((a, b) => a + b, 0);
  return { home: inverse[0] / total, draw: inverse[1] / total, away: inverse[2] / total };
}
async function main() {
  const testRows = JSON.parse(fs.readFileSync(path.join(DATA, "model41-test-predictions.json"), "utf8"))
    .filter(row => splitOf(row.date) === "test");
  const { fixtures, sources } = await loadDataset({ offline: true });
  const targets = new Map(fixtures.map(fixture => [String(fixture.fixture.id), fixture]));
  const leagueSources = {};
  await Promise.all(Object.entries(CODES).map(async ([league, code]) => { leagueSources[league] = await fetchResults(league, code); }));
  const models = { model40: accumulator(), model41: accumulator(), market: accumulator() };
  const markets = {};
  let exactNameDateMatch = 0, independentlyVerified = 0, scoreConflicts = 0, unmatched = 0;
  let hybridSelected = 0, hybridCorrect = 0, hybridWrong = 0;
  let marketOddsAvailable = 0;
  const crossCheckedExamples = [];
  for (const row of testRows) {
    const target = targets.get(String(row.id));
    const source = leagueSources[row.league];
    if (!target || !source) { unmatched++; continue; }
    const external = findIndependentResult(target, source);
    if (!external) { unmatched++; continue; }
    exactNameDateMatch++;
    if (external.homeGoals !== row.goals.home || external.awayGoals !== row.goals.away) {
      scoreConflicts++;
      continue;
    }
    independentlyVerified++;
    const winner = actualWinner(external.homeGoals, external.awayGoals);
    addProbabilities(models.model40, row.model40.probabilities, winner);
    addProbabilities(models.model41, row.calibrated.probabilities, winner);
    const market = marketProbabilities(external);
    if (market) { marketOddsAvailable++; addProbabilities(models.market, market, winner); }

    const input = replayInput(fixtures, target);
    const profile = buildMatchStatistics(input.collected.fixture, { ...input.collected, now: input.now });
    const recommendation = buildHybridRecommendation(row.model40.probabilities, row.calibrated.probabilities,
      profile.dataQuality?.score, { home: profile.home.sampleSize, away: profile.away.sampleSize });
    if (recommendation.status === "RECOMMEND" && recommendation.recommendation) {
      const pick = recommendation.recommendation;
      const hit = actualMarket(pick.market, external.homeGoals, external.awayGoals);
      hybridSelected++;
      if (hit) hybridCorrect++; else hybridWrong++;
      if (!markets[pick.market]) markets[pick.market] = { selected: 0, correct: 0 };
      markets[pick.market].selected++;
      if (hit) markets[pick.market].correct++;
    }
    if (crossCheckedExamples.length < 10) crossCheckedExamples.push({
      date: row.date, league: row.league, home: target.teams.home.name, away: target.teams.away.name,
      score: external.homeGoals + "-" + external.awayGoals,
      model40: topClass(row.model40.probabilities), model41: topClass(row.calibrated.probabilities),
      hybrid: recommendation.status === "RECOMMEND" ? recommendation.recommendation.market : "NO_BET",
      independentOdds: Boolean(market),
    });
  }
  const report = {
    evaluator: "independent-football-data-crosscheck-v1",
    generatedAt: new Date().toISOString(),
    methodology: "Frozen Model 4.0/4.1 predictions; external scores from football-data.co.uk; score conflicts excluded; no fitting or threshold tuning; bookmaker average odds are a comparator only.",
    predictionDataset: { provider: "OpenFootball", lockedTestRows: testRows.length, sources },
    outcomeSource: { provider: "football-data.co.uk", season: "2025/26", leagueFiles: Object.values(leagueSources).map(s => ({ league: s.league, url: s.url, rows: s.rows.length })) },
    reconciliation: { exactNameDateMatch, independentlyVerified, scoreConflicts, unmatched, verifiedShareOfTest: independentlyVerified / Math.max(1, testRows.length) },
    model1X2: { model40: summarize(models.model40), model41: summarize(models.model41), bookmakerAverageOdds: summarize(models.market), oddsSampleSize: marketOddsAvailable },
    hybridSelective: { selected: hybridSelected, correct: hybridCorrect, incorrect: hybridWrong,
      coverageOfVerified: hybridSelected / Math.max(1, independentlyVerified),
      hitRate: hybridSelected ? hybridCorrect / hybridSelected : null,
      wilson95: wilson(hybridCorrect, hybridSelected) },
    markets: Object.fromEntries(Object.entries(markets).map(([key, value]) => [key, {
      ...value, hitRate: value.correct / value.selected,
    }])),
    examples: crossCheckedExamples,
    limitations: [
      "The locked test predictions cover five leagues and are not an all-league model validation.",
      "football-data.co.uk team-name matching is conservative; unmatched rows are not scored.",
      "This independently cross-checks final scores; it does not prove future performance or profitability.",
      "The bookmaker consensus is used as a comparator, not as a model input in this report.",
    ],
  };
  console.log(JSON.stringify(report, null, 2));
  if (independentlyVerified < 250) {
    console.error("Too few independently verified matches to treat this as a useful cross-check.");
    process.exitCode = 2;
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
