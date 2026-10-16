"use strict";

const OUTCOMES = {
  home_win: row => row.outcome === "H",
  draw: row => row.outcome === "D",
  away_win: row => row.outcome === "A",
  home_or_draw: row => row.outcome === "H" || row.outcome === "D",
  away_or_draw: row => row.outcome === "A" || row.outcome === "D",
  no_draw: row => row.outcome === "H" || row.outcome === "A",
  over_1_5: row => Number.isFinite(row.homeGoals) && Number.isFinite(row.awayGoals) && row.homeGoals + row.awayGoals >= 2,
  over_2_5: row => Number.isFinite(row.homeGoals) && Number.isFinite(row.awayGoals) && row.homeGoals + row.awayGoals >= 3,
  under_3_5: row => Number.isFinite(row.homeGoals) && Number.isFinite(row.awayGoals) && row.homeGoals + row.awayGoals <= 3,
  btts_yes: row => Number.isFinite(row.homeGoals) && Number.isFinite(row.awayGoals) && row.homeGoals > 0 && row.awayGoals > 0,
  btts_no: row => Number.isFinite(row.homeGoals) && Number.isFinite(row.awayGoals) && (row.homeGoals === 0 || row.awayGoals === 0)
};

function wilson(successes, n, z = 1.96) {
  if (!n) return { low: null, high: null };
  const p = successes / n;
  const denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) / n) + (z * z / (4 * n * n))) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function rate(rows, event) {
  const eligible = rows.filter(row => event(row) !== null);
  const successes = eligible.filter(event).length;
  return { n: eligible.length, successes, rate: eligible.length ? successes / eligible.length : null, ...wilson(successes, eligible.length) };
}

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 100);
}

function candidatesFromTraining(training, featureKeys) {
  const candidates = [];
  for (const key of featureKeys) {
    const values = training.map(row => row.features?.[key]).filter(v => v !== null && v !== undefined && (typeof v !== "number" || Number.isFinite(v)));
    if (values.length < 2) continue;
    if (values.every(v => typeof v === "number")) {
      const thresholds = [...new Set([0.25, 0.5, 0.75].map(q => quantile(values, q)).filter(Number.isFinite))];
      for (const threshold of thresholds) {
        candidates.push({ key, operator: "<=", value: threshold, id: safeName(key) + ":lte:" + threshold });
        candidates.push({ key, operator: ">", value: threshold, id: safeName(key) + ":gt:" + threshold });
      }
    } else {
      const categories = [...new Set(values.map(v => String(v)))].slice(0, 30);
      for (const value of categories) candidates.push({ key, operator: "=", value, id: safeName(key) + ":eq:" + safeName(value) });
    }
  }
  return candidates;
}

function matches(row, rule) {
  const value = row.features?.[rule.key];
  if (value === null || value === undefined) return false;
  if (rule.operator === "<=") return typeof value === "number" && value <= rule.value;
  if (rule.operator === ">") return typeof value === "number" && value > rule.value;
  return String(value) === String(rule.value);
}

function evaluateRule(rows, rule, event) {
  return rate(rows.filter(row => matches(row, rule)), event);
}

// Abramowitz-Stegun approximation to the normal CDF; sufficient for conservative
// one-sided two-proportion screening, with Bonferroni correction applied later.
function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

function oneSidedDifferenceP(subgroup, complement) {
  if (!subgroup.n || !complement.n || subgroup.rate === null || complement.rate === null) return 1;
  const pooled = (subgroup.successes + complement.successes) / (subgroup.n + complement.n);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / subgroup.n + 1 / complement.n));
  if (standardError === 0) return subgroup.rate > complement.rate ? 0 : 1;
  const z = (subgroup.rate - complement.rate) / standardError;
  return Math.max(0, Math.min(1, 1 - normalCdf(z)));
}

function splitAtCalendarDays(rows, trainFraction, validationFraction) {
  const firstIndex = Math.min(rows.length - 1, Math.floor(rows.length * trainFraction));
  const secondIndex = Math.min(rows.length - 1, Math.floor(rows.length * (trainFraction + validationFraction)));
  const trainBoundary = rows[firstIndex]?.date.slice(0, 10);
  const testBoundary = rows[secondIndex]?.date.slice(0, 10);
  const training = rows.filter(row => row.date.slice(0, 10) < trainBoundary);
  const validation = rows.filter(row => row.date.slice(0, 10) >= trainBoundary && row.date.slice(0, 10) < testBoundary);
  const testing = rows.filter(row => row.date.slice(0, 10) >= testBoundary);
  return { training, validation, testing, trainBoundary, testBoundary };
}

/**
 * Three-period feature research:
 * 1) thresholds and candidate directions are created on training only;
 * 2) validation selects candidate rules with positive disjoint-complement lift;
 * 3) the final chronological test is used once for inference, with Bonferroni
 *    correction across all validation-selected rule/market hypotheses.
 * Per-season test lifts are stability diagnostics, not another tuning step.
 */
function discoverWalkForwardRules(rows, {
  trainFraction = 0.6,
  validationFraction = 0.2,
  minTrainSamples = 100,
  minValidationSamples = 50,
  minTestSamples = 100,
  minTrainLift = 0.02,
  alpha = 0.05,
  minSeasonSamples = 100,
  featureKeys,
  markets = Object.keys(OUTCOMES)
} = {}) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  if (!(trainFraction > 0 && trainFraction < 1) || !(validationFraction > 0 && validationFraction < 1) || trainFraction + validationFraction >= 1) {
    throw new RangeError("trainFraction and validationFraction must be between 0 and 1 and sum to less than 1");
  }
  if (!(alpha > 0 && alpha < 1)) throw new RangeError("alpha must be between 0 and 1");
  for (const [key, value] of Object.entries({ minTrainSamples, minValidationSamples, minTestSamples, minSeasonSamples })) {
    if (!Number.isInteger(value) || value < 1) throw new RangeError(key + " must be a positive integer");
  }
  const clean = rows.filter(row => {
    if (!row || typeof row.date !== "string" || !Number.isFinite(Date.parse(row.date)) ||
      !row.features || typeof row.features !== "object" ||
      !["H", "D", "A"].includes(row.outcome) ||
      !Number.isInteger(row.homeGoals) || row.homeGoals < 0 ||
      !Number.isInteger(row.awayGoals) || row.awayGoals < 0) return false;
    const expected = row.homeGoals > row.awayGoals ? "H" : row.homeGoals < row.awayGoals ? "A" : "D";
    return row.outcome === expected;
  }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  if (clean.length < 100) throw new RangeError("At least 100 valid completed matches are required");
  const { training, validation, testing, trainBoundary, testBoundary } = splitAtCalendarDays(clean, trainFraction, validationFraction);
  if (!training.length || !validation.length || !testing.length) throw new RangeError("Chronological split produced an empty partition");
  const keys = featureKeys || [...new Set(training.flatMap(row => Object.keys(row.features || {})))].sort();
  const candidates = candidatesFromTraining(training, keys);
  const validationSelected = [];

  for (const market of markets) {
    const event = OUTCOMES[market];
    if (!event) continue;
    for (const candidate of candidates) {
      const train = evaluateRule(training, candidate, event);
      const trainComplement = rate(training.filter(row => !matches(row, candidate)), event);
      if (train.n < minTrainSamples || trainComplement.n < minTrainSamples || train.rate === null || trainComplement.rate === null) continue;
      if (train.rate - trainComplement.rate < minTrainLift) continue;
      const valid = evaluateRule(validation, candidate, event);
      const validComplement = rate(validation.filter(row => !matches(row, candidate)), event);
      if (valid.n < minValidationSamples || validComplement.n < minValidationSamples || valid.rate === null || validComplement.rate === null) continue;
      const validationLift = valid.rate - validComplement.rate;
      if (validationLift <= 0) continue;
      validationSelected.push({ market, candidate, training: train, trainingComplement: trainComplement, validation: valid, validationComplement: validComplement, validationLift });
    }
  }

  const familySize = validationSelected.length;
  const findings = validationSelected.map(item => {
    const event = OUTCOMES[item.market];
    const test = evaluateRule(testing, item.candidate, event);
    const testComplement = rate(testing.filter(row => !matches(row, item.candidate)), event);
    const lift = test.rate === null || testComplement.rate === null ? null : test.rate - testComplement.rate;
    const pValue = oneSidedDifferenceP(test, testComplement);
    const adjustedP = Math.min(1, pValue * Math.max(1, familySize));
    const seasonLifts = [];
    const seasons = [...new Set(testing.map(row => row.season).filter(Boolean))].sort();
    for (const season of seasons) {
      const seasonRows = testing.filter(row => row.season === season);
      const subgroup = evaluateRule(seasonRows, item.candidate, event);
      const complement = rate(seasonRows.filter(row => !matches(row, item.candidate)), event);
      if (subgroup.n >= minSeasonSamples && complement.n >= minSeasonSamples && subgroup.rate !== null && complement.rate !== null) {
        seasonLifts.push({ season, n: subgroup.n, complementN: complement.n, rate: subgroup.rate, complementRate: complement.rate, lift: subgroup.rate - complement.rate });
      }
    }
    const positiveSeasons = seasonLifts.filter(row => row.lift > 0).length;
    let status = "NOT_REPLICATED";
    if (test.n < minTestSamples || testComplement.n < minTestSamples || test.rate === null || testComplement.rate === null) status = "INSUFFICIENT_TEST";
    else if (lift > 0 && adjustedP <= alpha && positiveSeasons >= 2) status = "REPLICATED_TEST";
    else if (lift > 0 && adjustedP <= alpha) status = "TEST_SIGNAL_NOT_STABLE_BY_SEASON";
    return {
      market: item.market,
      rule: { feature: item.candidate.key, operator: item.candidate.operator, value: item.candidate.value },
      training: { ...item.training, comparisonRate: item.trainingComplement.rate, comparisonSampleSize: item.trainingComplement.n, lift: item.training.rate - item.trainingComplement.rate },
      validation: { ...item.validation, comparisonRate: item.validationComplement.rate, comparisonSampleSize: item.validationComplement.n, lift: item.validationLift },
      test: { ...test, comparisonRate: testComplement.rate, comparisonSampleSize: testComplement.n, lift, pValue, bonferroniAdjustedP: adjustedP, familySize, positiveSeasons, evaluatedSeasons: seasonLifts.length, seasonLifts },
      status
    };
  });

  findings.sort((a, b) => {
    const order = { REPLICATED_TEST: 0, TEST_SIGNAL_NOT_STABLE_BY_SEASON: 1, INSUFFICIENT_TEST: 2, NOT_REPLICATED: 3 };
    return order[a.status] - order[b.status] || (a.test.bonferroniAdjustedP - b.test.bonferroniAdjustedP) || ((b.test.lift ?? -Infinity) - (a.test.lift ?? -Infinity));
  });

  const baseline = {};
  for (const market of markets) {
    const event = OUTCOMES[market];
    if (!event) continue;
    baseline[market] = {
      training: rate(training, event),
      validation: rate(validation, event),
      test: rate(testing, event)
    };
  }

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    methodology: {
      split: "Chronological calendar-day boundaries; 60% training, 20% validation, 20% untouched final test by default",
      featureTiming: "Only pre-kickoff features from prior calendar days are permitted",
      selection: "Thresholds and candidate directions come from training; only positive training-lift rules with positive validation lift proceed to final test",
      multiplicity: "One-sided two-proportion z-test with Bonferroni family-wise correction across every validation-selected market/rule hypothesis tested on the final period",
      stability: "Final-test positive lift is also reported by season; REPLICATED_TEST requires corrected p <= alpha and positive lift in at least two adequately sampled test seasons",
      limitations: [
        "This is historical cross-validation, not prospective future performance",
        "Bonferroni correction is conservative; feature rules are correlated and do not prove causality",
        "Only candidates selected without the final test are evaluated there; do not tune after inspecting final-test outcomes",
        "The archive is incomplete for the requested 2006-07 to 2025-26 window; consult source coverage report"
      ]
    },
    dataset: {
      supplied: rows.length,
      valid: clean.length,
      training: training.length,
      validation: validation.length,
      test: testing.length,
      firstDate: clean[0]?.date ?? null,
      trainingLastDate: training.at(-1)?.date ?? null,
      validationFirstDate: validation[0]?.date ?? null,
      validationLastDate: validation.at(-1)?.date ?? null,
      testFirstDate: testing[0]?.date ?? null,
      lastDate: clean.at(-1)?.date ?? null,
      trainingBoundary: trainBoundary,
      testBoundary,
      featureKeys: keys
    },
    selection: { candidatesGenerated: candidates.length, validationSelectedHypotheses: familySize, alpha, correction: "Bonferroni" },
    baseline,
    summary: {
      hypothesesTested: familySize,
      replicatedTest: findings.filter(row => row.status === "REPLICATED_TEST").length,
      testSignalNotStableBySeason: findings.filter(row => row.status === "TEST_SIGNAL_NOT_STABLE_BY_SEASON").length,
      notReplicated: findings.filter(row => row.status === "NOT_REPLICATED").length,
      insufficientTest: findings.filter(row => row.status === "INSUFFICIENT_TEST").length
    },
    findings
  };
}

module.exports = { OUTCOMES, wilson, rate, matches, candidatesFromTraining, oneSidedDifferenceP, splitAtCalendarDays, discoverWalkForwardRules };
