const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function dixonColesTau(homeGoals, awayGoals, homeLambda, awayLambda, rho) {
  if (![homeGoals, awayGoals, homeLambda, awayLambda, rho].every(Number.isFinite)) return null;
  if (homeGoals === 0 && awayGoals === 0) return 1 - homeLambda * awayLambda * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + homeLambda * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + awayLambda * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

function bayesianSmoothedRate(total, games, baseline, priorGames = 5) {
  if (![total, games, baseline, priorGames].every(Number.isFinite) || games < 0 || priorGames <= 0) return null;
  return (total + baseline * priorGames) / (games + priorGames);
}

function walkForwardSplit(records, { trainingFraction = 0.6, validationFraction = 0.2 } = {}) {
  const sorted = [...(records || [])].sort((left, right) => new Date(left.kickoff || left.fixture?.date) - new Date(right.kickoff || right.fixture?.date));
  const trainingEnd = Math.floor(sorted.length * trainingFraction); const validationEnd = trainingEnd + Math.floor(sorted.length * validationFraction);
  return { training: sorted.slice(0, trainingEnd), validation: sorted.slice(trainingEnd, validationEnd), test: sorted.slice(validationEnd) };
}

function calibrationSummary(predictions, bucketWidth = 0.1) {
  const buckets = new Map();
  for (const item of predictions || []) {
    if (!Number.isFinite(item?.probability) || typeof item?.outcome !== "boolean") continue;
    const probability = clamp(item.probability, 0, 1); const lower = Math.min(Math.floor(probability / bucketWidth) * bucketWidth, 1 - bucketWidth); const key = `${Math.round(lower * 100)}-${Math.round((lower + bucketWidth) * 100)}`;
    const bucket = buckets.get(key) || { total: 0, probabilityTotal: 0, outcomeTotal: 0 }; bucket.total += 1; bucket.probabilityTotal += probability; bucket.outcomeTotal += Number(item.outcome); buckets.set(key, bucket);
  }
  let error = 0; const result = {};
  for (const [key, bucket] of buckets) { const probability = bucket.probabilityTotal / bucket.total; const outcomeRate = bucket.outcomeTotal / bucket.total; error += Math.abs(probability - outcomeRate) * bucket.total; result[key] = { total: bucket.total, averageProbability: Number(probability.toFixed(4)), outcomeRate: Number(outcomeRate.toFixed(4)) }; }
  const total = [...buckets.values()].reduce((sum, bucket) => sum + bucket.total, 0); return { buckets: result, calibrationError: total ? Number((error / total).toFixed(4)) : null };
}

function binaryMetrics(predictions) {
  let truePositive = 0; let falsePositive = 0; let trueNegative = 0; let falseNegative = 0; let brier = 0; let logLoss = 0; let noBet = 0;
  for (const item of predictions || []) {
    if (item?.noBet) { noBet += 1; continue; }
    if (!Number.isFinite(item?.probability) || typeof item?.outcome !== "boolean") continue;
    const probability = clamp(item.probability, 1e-15, 1 - 1e-15); const predicted = probability >= 0.5; const outcome = item.outcome;
    if (predicted && outcome) truePositive += 1; else if (predicted) falsePositive += 1; else if (outcome) falseNegative += 1; else trueNegative += 1;
    brier += (probability - Number(outcome)) ** 2; logLoss += -(outcome ? Math.log(probability) : Math.log(1 - probability));
  }
  const total = truePositive + falsePositive + trueNegative + falseNegative; const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null; const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : null;
  return { total, noBet, coverage: total + noBet ? Number((total / (total + noBet)).toFixed(4)) : null, accuracy: total ? Number(((truePositive + trueNegative) / total).toFixed(4)) : null, precision, recall, f1: precision && recall ? Number((2 * precision * recall / (precision + recall)).toFixed(4)) : null, brierScore: total ? Number((brier / total).toFixed(4)) : null, logLoss: total ? Number((logLoss / total).toFixed(4)) : null, confusionMatrix: { truePositive, falsePositive, trueNegative, falseNegative } };
}

function assessPredictionEligibility({ dataQuality, sampleSize, probabilities, calibrated = false, dataConflict = false, staleData = false, unknownKickoff = false, providerConflict = false, requiredFieldsMissing = [] } = {}) {
  const reasons = [];
  if (!Number.isFinite(dataQuality) || dataQuality < 60 || dataQuality > 100) reasons.push("LOW_OR_UNKNOWN_DATA_QUALITY");
  if (!Number.isFinite(sampleSize) || sampleSize < 10) reasons.push("INSUFFICIENT_HISTORY");
  if (calibrated !== true) reasons.push("UNCALIBRATED_PROBABILITIES");
  if (dataConflict) reasons.push("FIXTURE_DATA_CONFLICT");
  if (providerConflict) reasons.push("PROVIDER_CONFLICT");
  if (staleData) reasons.push("STALE_CRITICAL_DATA");
  if (unknownKickoff) reasons.push("UNKNOWN_KICKOFF");
  if (!Array.isArray(requiredFieldsMissing) || requiredFieldsMissing.length) reasons.push("MISSING_REQUIRED_FIELDS");
  const validProbabilities = Array.isArray(probabilities) && probabilities.length >= 2
    && probabilities.every(value => Number.isFinite(value) && value >= 0 && value <= 1);
  if (!validProbabilities) reasons.push("INVALID_OR_MISSING_PROBABILITIES");
  const sorted = validProbabilities ? [...probabilities].sort((left, right) => right - left) : [];
  if (validProbabilities && sorted[0] - sorted[1] < 0.06) reasons.push("LOW_PROBABILITY_SEPARATION");
  return { eligible: reasons.length === 0, reasons };
}

function shouldNoBet(options = {}) {
  return !assessPredictionEligibility(options).eligible;
}

function oddsValue(probability, odds) { if (!Number.isFinite(probability) || !Number.isFinite(odds) || probability <= 0 || probability >= 1 || odds <= 1) return null; return { impliedProbability: 1 / odds, fairOdds: 1 / probability, value: probability * odds - 1 }; }

module.exports = { assessPredictionEligibility, bayesianSmoothedRate, binaryMetrics, calibrationSummary, dixonColesTau, oddsValue, shouldNoBet, walkForwardSplit };