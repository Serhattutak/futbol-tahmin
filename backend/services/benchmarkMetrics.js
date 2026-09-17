const THRESHOLDS = [60, 70, 75, 80, 85, 90];
const MARKETS = ["1X2", "Home", "Draw", "Away", "Over 1.5", "Over 2.5", "Over 3.5", "BTTS Yes", "BTTS No", "1X", "X2", "12"];
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const safeLog = p => Math.log(Math.min(1 - 1e-15, Math.max(1e-15, p)));

function calibration(rows) {
  const buckets = Array.from({ length: 10 }, (_, i) => ({ bucket: `${i * 10}-${i === 9 ? 100 : i * 10 + 9}`, rows: [] }));
  for (const row of rows) buckets[Math.min(9, Math.floor(row.probability * 10))].rows.push(row);
  const result = buckets.map(({ bucket, rows: items }) => {
    const probability = mean(items.map(r => r.probability));
    const actual = mean(items.map(r => Number(r.outcome)));
    return { bucket, count: items.length, averageProbability: probability, actualSuccessRate: actual, error: items.length ? Math.abs(probability - actual) : null };
  });
  return { buckets: result, ece: rows.length ? result.reduce((sum, r) => sum + r.count * (r.error || 0), 0) / rows.length : null };
}

function summarize(rows) {
  const correct = rows.filter(r => r.correct).length;
  return { sampleSize: rows.length, correct, incorrect: rows.length - correct, hitRate: rows.length ? correct / rows.length : null,
    predictedProbabilityAverage: mean(rows.map(r => r.probability)), brier: mean(rows.map(r => r.brier)), logLoss: mean(rows.map(r => r.logLoss)), ...calibration(rows) };
}

function binaryObservation(probability, outcome) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1 || typeof outcome !== "boolean") throw Error("Invalid probability/outcome");
  return { probability, outcome, correct: (probability >= .5) === outcome, brier: (probability - Number(outcome)) ** 2, logLoss: -safeLog(outcome ? probability : 1 - probability) };
}

function observations(probabilities, goals) {
  const p = probabilities; const home = goals.home; const away = goals.away;
  const values = [p.home, p.draw, p.away]; const actual = home > away ? 0 : home === away ? 1 : 2;
  const predicted = values.indexOf(Math.max(...values));
  const result = { "1X2": { probability: values[predicted], outcome: predicted === actual, correct: predicted === actual,
    brier: values.reduce((sum, value, i) => sum + (value - Number(i === actual)) ** 2, 0), logLoss: -safeLog(values[actual]) } };
  for (const [market, probability, outcome] of [
    ["Home", p.home, home > away], ["Draw", p.draw, home === away], ["Away", p.away, home < away],
    ["Over 1.5", p.over15, home + away > 1], ["Over 2.5", p.over25, home + away > 2], ["Over 3.5", p.over35, home + away > 3],
    ["BTTS Yes", p.bttsYes, home > 0 && away > 0], ["BTTS No", 1 - p.bttsYes, home === 0 || away === 0],
    ["1X", Math.min(1, p.home + p.draw), home >= away], ["X2", Math.min(1, p.draw + p.away), home <= away], ["12", Math.min(1, p.home + p.away), home !== away],
  ]) result[market] = binaryObservation(probability, outcome);
  return result;
}

function modelReport(records, variant) {
  const rows = records.map(r => ({ ...r[variant], league: r.league, metrics: observations(r[variant].probabilities, r.goals) }));
  const metrics = items => Object.fromEntries(MARKETS.map(m => [m, summarize(items.map(r => r.metrics[m]))]));
  return { markets: metrics(rows),
    confidence: Object.fromEntries(THRESHOLDS.map(t => [t, metrics(rows.filter(r => r.confidence >= t))])),
    quality: Object.fromEntries([["80+", q => q >= 80], ["60-79", q => q >= 60 && q < 80], ["<60", q => q < 60]].map(([key, include]) => [key, metrics(rows.filter(r => include(r.quality)))])),
    leagues: Object.fromEntries([...new Set(rows.map(r => r.league))].sort().map(league => {
      const group = rows.filter(r => r.league === league);
      return [league, { sampleSize: group.length, sufficientSample: group.length >= 50, markets: metrics(group) }];
    })),
  };
}
module.exports = { THRESHOLDS, MARKETS, calibration, summarize, binaryObservation, observations, modelReport };
