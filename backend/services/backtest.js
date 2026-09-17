const { HOME_ADVANTAGE, MODEL_VERSION, calculateConfidence, poissonProbability, weightedStrength } = require("./predictionModel");
const { normalizeStatus } = require("./fixtureNormalization");
// Legacy compatibility report. The baseline/stats benchmark uses
// chronologicalBenchmark and the shared production calculation instead.

const MARKET_NAMES = ["1", "X", "2", "1X", "X2", "12", "Üst 1.5", "Alt 1.5", "Üst 2.5", "Alt 2.5", "Üst 3.5", "Alt 3.5", "KG Var", "KG Yok"];
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function isCompleted(fixture) {
  return Number.isFinite(fixture?.goals?.home) && Number.isFinite(fixture?.goals?.away) && normalizeStatus(fixture?.fixture?.status?.short) === "FINISHED";
}

function toPercentages(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  const result = values.map((value) => Number((value / total * 100).toFixed(2)));
  result[result.indexOf(Math.max(...result))] = Number((100 - result.reduce((sum, value) => sum + value, 0) + Math.max(...result)).toFixed(2));
  return result;
}

function calculatePreMatchPrediction(history, fixture) {
  const homeId = fixture.teams?.home?.id;
  const awayId = fixture.teams?.away?.id;
  const day = fixture.fixture?.date?.slice(0, 10);
  const kickoff = Date.parse(`${day}T00:00:00Z`);
  const preMatchHistory = history.filter((match) => isCompleted(match) && match.fixture.date.slice(0, 10) < day && Date.parse(match.fixture.date) < kickoff);
  const homeHistory = preMatchHistory.filter((match) => match.teams?.home?.id === homeId || match.teams?.away?.id === homeId);
  const awayHistory = preMatchHistory.filter((match) => match.teams?.home?.id === awayId || match.teams?.away?.id === awayId);
  const home = weightedStrength(homeHistory, homeId);
  const away = weightedStrength(awayHistory, awayId);
  const homeVenue = weightedStrength(homeHistory, homeId, "home");
  const awayVenue = weightedStrength(awayHistory, awayId, "away");
  const homeAttack = homeVenue.averageGoalsFor ?? home.averageGoalsFor;
  const homeDefense = homeVenue.averageGoalsAgainst ?? home.averageGoalsAgainst;
  const awayAttack = awayVenue.averageGoalsFor ?? away.averageGoalsFor;
  const awayDefense = awayVenue.averageGoalsAgainst ?? away.averageGoalsAgainst;
  if (![homeAttack, homeDefense, awayAttack, awayDefense].every(Number.isFinite)) return null;

  const expectedHome = clamp((homeAttack + awayDefense) / 2 * HOME_ADVANTAGE, 0.2, 4);
  const expectedAway = clamp((awayAttack + homeDefense) / 2, 0.2, 4);
  let homeWin = 0; let draw = 0; let awayWin = 0; let over15 = 0; let over25 = 0; let over35 = 0; let bttsYes = 0; let total = 0;
  for (let homeGoals = 0; homeGoals <= 8; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 8; awayGoals += 1) {
      const probability = poissonProbability(expectedHome, homeGoals) * poissonProbability(expectedAway, awayGoals);
      total += probability;
      if (homeGoals > awayGoals) homeWin += probability;
      else if (homeGoals === awayGoals) draw += probability;
      else awayWin += probability;
      if (homeGoals + awayGoals > 1) over15 += probability;
      if (homeGoals + awayGoals > 2) over25 += probability;
      if (homeGoals + awayGoals > 3) over35 += probability;
      if (homeGoals > 0 && awayGoals > 0) bttsYes += probability;
    }
  }
  const [homeWinPercent, drawPercent, awayWinPercent] = toPercentages([homeWin / total, draw / total, awayWin / total]);
  const probabilities = {
    "1": homeWinPercent, X: drawPercent, "2": awayWinPercent, "1X": Number(((homeWin + draw) / total * 100).toFixed(2)), X2: Number(((draw + awayWin) / total * 100).toFixed(2)), "12": Number(((homeWin + awayWin) / total * 100).toFixed(2)),
    "Üst 1.5": Number((over15 / total * 100).toFixed(2)), "Alt 1.5": Number(((1 - over15 / total) * 100).toFixed(2)), "Üst 2.5": Number((over25 / total * 100).toFixed(2)), "Alt 2.5": Number(((1 - over25 / total) * 100).toFixed(2)), "Üst 3.5": Number((over35 / total * 100).toFixed(2)), "Alt 3.5": Number(((1 - over35 / total) * 100).toFixed(2)), "KG Var": Number((bttsYes / total * 100).toFixed(2)), "KG Yok": Number(((1 - bttsYes / total) * 100).toFixed(2)),
  };
  const dataQuality = Math.round((Math.min(home.games, 10) + Math.min(away.games, 10)) / 20 * 70);
  const confidence = calculateConfidence({ dataQuality, homeGames: home.games, awayGames: away.games, probabilities: [homeWinPercent, drawPercent, awayWinPercent], value: null });
  return { probabilities, confidence, dataQuality, expectedGoals: { home: expectedHome, away: expectedAway } };
}

function outcomeForMarket(market, fixture) {
  const home = fixture.goals.home; const away = fixture.goals.away; const total = home + away;
  return { "1": home > away, X: home === away, "2": away > home, "1X": home >= away, X2: away >= home, "12": home !== away, "Üst 1.5": total > 1, "Alt 1.5": total < 2, "Üst 2.5": total > 2, "Alt 2.5": total < 3, "Üst 3.5": total > 3, "Alt 3.5": total < 4, "KG Var": home > 0 && away > 0, "KG Yok": home === 0 || away === 0 }[market];
}

function emptyMarketMetric() { return { total: 0, won: 0, lost: 0, probabilityTotal: 0, confidenceTotal: 0, qualityTotal: 0, brierTotal: 0, logLossTotal: 0, confusion: { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 } }; }

function finalizeMetric(metric) {
  if (!metric.total) return { total: 0, won: 0, lost: 0, accuracy: null, hitRate: null, brierScore: null, logLoss: null, averageDataQuality: null, averageConfidence: null, confusionMatrix: metric.confusion };
  return { total: metric.total, won: metric.won, lost: metric.lost, accuracy: Number((metric.won / metric.total * 100).toFixed(2)), hitRate: Number((metric.won / metric.total * 100).toFixed(2)), brierScore: Number((metric.brierTotal / metric.total).toFixed(4)), logLoss: Number((metric.logLossTotal / metric.total).toFixed(4)), averageDataQuality: Number((metric.qualityTotal / metric.total).toFixed(2)), averageConfidence: Number((metric.confidenceTotal / metric.total).toFixed(2)), confusionMatrix: metric.confusion };
}

function runBacktest(fixtures) {
  const completed = (Array.isArray(fixtures) ? fixtures : []).filter(isCompleted).sort((left, right) => new Date(left.fixture.date) - new Date(right.fixture.date));
  const history = []; const metrics = Object.fromEntries(MARKET_NAMES.map((market) => [market, emptyMarketMetric()]));
  const confidenceBuckets = Object.fromEntries(["50-59", "60-69", "70-79", "80-89", "90-100"].map((bucket) => [bucket, { total: 0, won: 0 }]));
  let skippedInsufficientHistory = 0;
  for (const fixture of completed) {
    const prediction = calculatePreMatchPrediction(history, fixture);
    if (!prediction) { skippedInsufficientHistory += 1; history.push(fixture); continue; }
    for (const market of MARKET_NAMES) {
      const probability = prediction.probabilities[market] / 100; const outcome = outcomeForMarket(market, fixture); const predicted = probability >= 0.5; const metric = metrics[market];
      metric.total += 1; metric.probabilityTotal += probability; metric.confidenceTotal += prediction.confidence; metric.qualityTotal += prediction.dataQuality; metric.brierTotal += (probability - Number(outcome)) ** 2; metric.logLossTotal += -(outcome ? Math.log(clamp(probability, 1e-15, 1 - 1e-15)) : Math.log(clamp(1 - probability, 1e-15, 1 - 1e-15)));
      if (predicted === outcome) metric.won += 1; else metric.lost += 1;
      if (predicted && outcome) metric.confusion.truePositive += 1; else if (predicted) metric.confusion.falsePositive += 1; else if (outcome) metric.confusion.falseNegative += 1; else metric.confusion.trueNegative += 1;
    }
    const main = [["1", prediction.probabilities["1"]], ["X", prediction.probabilities.X], ["2", prediction.probabilities["2"]]].sort((left, right) => right[1] - left[1])[0][0];
    const bucket = prediction.confidence >= 90 ? "90-100" : prediction.confidence >= 80 ? "80-89" : prediction.confidence >= 70 ? "70-79" : prediction.confidence >= 60 ? "60-69" : "50-59";
    confidenceBuckets[bucket].total += 1; if (outcomeForMarket(main, fixture)) confidenceBuckets[bucket].won += 1;
    history.push(fixture);
  }
  const marketMetrics = Object.fromEntries(Object.entries(metrics).map(([market, metric]) => [market, finalizeMetric(metric)]));
  return { modelVersion: MODEL_VERSION, fixturesSupplied: completed.length, fixturesEvaluated: marketMetrics["1"].total, skippedInsufficientHistory, marketMetrics, confidenceCalibration: Object.fromEntries(Object.entries(confidenceBuckets).map(([bucket, metric]) => [bucket, { total: metric.total, successRate: metric.total ? Number((metric.won / metric.total * 100).toFixed(2)) : null }])) };
}

module.exports = { calculatePreMatchPrediction, runBacktest };
