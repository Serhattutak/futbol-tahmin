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

function safeFeatureName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 100);
}

function candidatesFromTraining(training, featureKeys) {
  const candidates = [];
  for (const key of featureKeys) {
    const values = training.map(row => row.features?.[key]).filter(v => v !== null && v !== undefined && (typeof v === "number" ? Number.isFinite(v) : true));
    if (values.length < 2) continue;
    if (values.every(v => typeof v === "number")) {
      const thresholds = [...new Set([0.25, 0.5, 0.75].map(q => quantile(values, q)).filter(Number.isFinite))];
      for (const threshold of thresholds) {
        candidates.push({ key, operator: "<=", value: threshold, id: `${safeFeatureName(key)}:lte:${threshold}` });
        candidates.push({ key, operator: ">", value: threshold, id: `${safeFeatureName(key)}:gt:${threshold}` });
      }
    } else {
      const categories = [...new Set(values.map(v => String(v)))].slice(0, 30);
      for (const value of categories) candidates.push({ key, operator: "=", value, id: `${safeFeatureName(key)}:eq:${safeFeatureName(value)}` });
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

/**
 * Research-only feature mining. Each row must carry pre-kickoff features and a
 * verified final score. Thresholds are learned from the earlier chronological
 * training slice, never from the holdout.
 */
function discoverFeatureRules(rows, {
  trainFraction = 0.7,
  minTrainSamples = 50,
  minTestSamples = 30,
  minTrainLift = 0.03,
  featureKeys,
  markets = Object.keys(OUTCOMES)
} = {}) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  if (!(trainFraction > 0 && trainFraction < 1)) throw new RangeError("trainFraction must be between 0 and 1");
  const clean = rows.filter(row => {
    if (!row || typeof row.date !== "string" || !Number.isFinite(Date.parse(row.date)) ||
      !row.features || typeof row.features !== "object" ||
      !["H", "D", "A"].includes(row.outcome) ||
      !Number.isInteger(row.homeGoals) || row.homeGoals < 0 ||
      !Number.isInteger(row.awayGoals) || row.awayGoals < 0) return false;
    const expected = row.homeGoals > row.awayGoals ? "H" : row.homeGoals < row.awayGoals ? "A" : "D";
    return row.outcome === expected;
  }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const splitIndex = Math.floor(clean.length * trainFraction);
  const training = clean.slice(0, splitIndex);
  const testing = clean.slice(splitIndex);
  const keys = featureKeys || [...new Set(training.flatMap(row => Object.keys(row.features || {})))].sort();
  const findings = [];

  for (const market of markets) {
    const event = OUTCOMES[market];
    if (!event) continue;
    const trainBaseline = rate(training, event);
    const testBaseline = rate(testing, event);
    for (const candidate of candidatesFromTraining(training, keys)) {
      const train = evaluateRule(training, candidate, event);
      const trainComplement = rate(training.filter(row => !matches(row, candidate)), event);
      if (train.n < minTrainSamples || trainComplement.n < minTrainSamples || train.rate === null || trainComplement.rate === null) continue;
      // Compare the rule subgroup to its disjoint complement; comparing a subgroup
      // with a baseline that contains the subgroup exaggerates apparent lift.
      const trainLift = train.rate - trainComplement.rate;
      if (trainLift < minTrainLift) continue;
      const test = evaluateRule(testing, candidate, event);
      const testComplement = rate(testing.filter(row => !matches(row, candidate)), event);
      const testLift = test.rate === null || testComplement.rate === null ? null : test.rate - testComplement.rate;
      const sufficientHoldout = test.n >= minTestSamples && testComplement.n >= minTestSamples;
      const status = !sufficientHoldout ? "INSUFFICIENT_HOLDOUT"
        : testLift > 0 && test.low > testComplement.high ? "PROMISING_HOLDOUT"
        : testLift > 0 ? "POSITIVE_BUT_UNCERTAIN" : "NOT_REPLICATED";
      findings.push({
        market,
        rule: { feature: candidate.key, operator: candidate.operator, value: candidate.value },
        training: { ...train, baselineRate: trainBaseline.rate, comparisonRate: trainComplement.rate, lift: trainLift, comparisonSampleSize: trainComplement.n },
        holdout: { ...test, baselineRate: testBaseline.rate, comparisonRate: testComplement.rate, lift: testLift, comparisonSampleSize: testComplement.n },
        status
      });
    }
  }

  findings.sort((a, b) => {
    const statusOrder = { PROMISING_HOLDOUT: 0, POSITIVE_BUT_UNCERTAIN: 1, INSUFFICIENT_HOLDOUT: 2, NOT_REPLICATED: 3 };
    return statusOrder[a.status] - statusOrder[b.status] || (b.holdout.lift ?? -Infinity) - (a.holdout.lift ?? -Infinity) || b.training.n - a.training.n;
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    methodology: {
      split: "Chronological; earliest rows train, latest rows holdout",
      featureTiming: "Caller must supply only features available before kickoff",
      thresholds: "Numeric quantiles and category levels derived from training rows only",
      confidenceInterval: "95% Wilson intervals; promising status requires the rule subgroup's lower bound to exceed the disjoint complement's upper bound; exploratory and not multiple-testing adjusted",
      limitations: ["Feature mining is hypothesis generation, not proof of causality", "Promising status is a conservative interval-separation screen, not a multiple-testing-adjusted significance claim", "Promising holdout rules require another untouched forward period", "Do not tune on the holdout and then report that same holdout as independent"]
    },
    dataset: { supplied: rows.length, valid: clean.length, training: training.length, holdout: testing.length, firstDate: clean[0]?.date ?? null, splitDate: testing[0]?.date ?? null, lastDate: clean.at(-1)?.date ?? null, featureKeys: keys },
    baseline: Object.fromEntries(markets.filter(m => OUTCOMES[m]).map(m => [m, { training: rate(training, OUTCOMES[m]), holdout: rate(testing, OUTCOMES[m]) }])),
    summary: { rulesEvaluated: findings.length, promisingHoldout: findings.filter(f => f.status === "PROMISING_HOLDOUT").length, positiveButUncertain: findings.filter(f => f.status === "POSITIVE_BUT_UNCERTAIN").length, notReplicated: findings.filter(f => f.status === "NOT_REPLICATED").length },
    findings
  };
}

module.exports = { OUTCOMES, wilson, discoverFeatureRules };
