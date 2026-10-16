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

function classifyProviderFailure({ status, code, configured = true, leagueSupported = true, fixtureMatched = true } = {}) {
  if (!configured) return "PROVIDER_NOT_CONFIGURED";
  if (!leagueSupported) return "LEAGUE_NOT_SUPPORTED";
  if (!fixtureMatched) return "FIXTURE_NOT_MATCHED";
  const numericStatus = Number(status);
  const normalizedCode = String(code || "").toUpperCase();
  if (numericStatus === 401 || numericStatus === 403 || /AUTH|API_KEY|UNAUTHORIZED|FORBIDDEN/.test(normalizedCode)) return "PROVIDER_AUTH_ERROR";
  if (numericStatus === 429 || /RATE_LIMIT|QUOTA|TOO_MANY_REQUESTS/.test(normalizedCode)) return "PROVIDER_RATE_LIMITED";
  if (numericStatus === 400 || /BAD_REQUEST|INVALID_REQUEST/.test(normalizedCode)) return "PROVIDER_BAD_REQUEST";
  if (numericStatus >= 500 && numericStatus <= 599) return "PROVIDER_SERVER_ERROR";
  if (numericStatus > 0) return "PROVIDER_HTTP_ERROR";
  if (normalizedCode) return "PROVIDER_REQUEST_FAILED";
  return "PROVIDER_RESULT_UNAVAILABLE";
}

function summarizeDataCoverage({ fixture = {}, historyCounts = {}, fieldStatus = {}, providerAttempts = [], now = Date.now(), maxAgeMs = 6 * 60 * 60 * 1000 } = {}) {
  const fields = {};
  const missingFields = [];
  for (const [field, status] of Object.entries(fieldStatus)) {
    const normalized = ["available", "empty", "unavailable", "error"].includes(status) ? status : "unavailable";
    fields[field] = normalized;
    if (normalized !== "available") missingFields.push(field);
  }
  const counts = {
    home: Number.isFinite(historyCounts.home) && historyCounts.home >= 0 ? historyCounts.home : null,
    away: Number.isFinite(historyCounts.away) && historyCounts.away >= 0 ? historyCounts.away : null,
    h2h: Number.isFinite(historyCounts.h2h) && historyCounts.h2h >= 0 ? historyCounts.h2h : null,
  };
  if (counts.home === null || counts.home < 5) missingFields.push("homeHistory");
  if (counts.away === null || counts.away < 5) missingFields.push("awayHistory");
  if (counts.h2h === null || counts.h2h < 1) missingFields.push("h2h");
  const kickoffMs = typeof fixture.kickoff === "string" ? Date.parse(fixture.kickoff) : NaN;
  const kickoffKnown = Number.isFinite(kickoffMs) && fixture.kickoffPrecision !== "date";
  const ageMs = Number.isFinite(fixture.dataUpdatedAt) ? Math.max(0, now - fixture.dataUpdatedAt)
    : typeof fixture.dataUpdatedAt === "string" ? Math.max(0, now - Date.parse(fixture.dataUpdatedAt)) : null;
  const stale = ageMs !== null && Number.isFinite(ageMs) && ageMs > maxAgeMs;
  const providerErrors = providerAttempts.map(attempt => ({
    provider: String(attempt?.provider || "unknown"),
    category: classifyProviderFailure(attempt || {}),
  }));
  const reasons = [];
  if (!kickoffKnown) reasons.push("UNKNOWN_KICKOFF");
  if (counts.home === null || counts.home < 5 || counts.away === null || counts.away < 5) reasons.push("INSUFFICIENT_HISTORY");
  if (stale) reasons.push("STALE_CRITICAL_DATA");
  if (providerErrors.some(item => item.category === "PROVIDER_AUTH_ERROR")) reasons.push("PROVIDER_AUTH_ERROR");
  if (providerErrors.some(item => item.category === "PROVIDER_RATE_LIMITED")) reasons.push("PROVIDER_RATE_LIMITED");
  if (providerErrors.some(item => item.category === "LEAGUE_NOT_SUPPORTED")) reasons.push("LEAGUE_NOT_SUPPORTED");
  if (providerErrors.some(item => item.category === "FIXTURE_NOT_MATCHED")) reasons.push("FIXTURE_NOT_MATCHED");
  return {
    eligibleForAnalysis: reasons.length === 0,
    reasons: [...new Set(reasons)],
    fixture: { id: fixture.id ?? null, kickoff: kickoffKnown ? new Date(kickoffMs).toISOString() : null, kickoffPrecision: fixture.kickoffPrecision || "unknown" },
    historyCounts: counts,
    fields,
    missingFields: [...new Set(missingFields)],
    dataAgeMs: ageMs !== null && Number.isFinite(ageMs) ? ageMs : null,
    providerErrors,
  };
}

function shouldNoBet(options = {}) {
  return !assessPredictionEligibility(options).eligible;
}

function oddsValue(probability, odds) { if (!Number.isFinite(probability) || !Number.isFinite(odds) || probability <= 0 || probability >= 1 || odds <= 1) return null; return { impliedProbability: 1 / odds, fairOdds: 1 / probability, value: probability * odds - 1 }; }

module.exports = { assessPredictionEligibility, bayesianSmoothedRate, binaryMetrics, calibrationSummary, classifyProviderFailure, dixonColesTau, oddsValue, shouldNoBet, summarizeDataCoverage, walkForwardSplit };