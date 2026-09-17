const { poissonProbability } = require("./predictionModel");
const EPS = 1e-6;
const GROUPS = ["A", "B", "C", "D", "E"];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clip = p => clamp(p, EPS, 1 - EPS);
const shrinkage = (n, prior = 10) => n > 0 ? n / (n + prior) : 0;
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
function assertFitDates(rows, kind = "train") {
  const from = kind === "train" ? "2025-08-15" : "2026-01-01";
  const to = kind === "train" ? "2025-12-31" : "2026-01-31";
  if (!rows.length || rows.some(r => !r.date || r.date.slice(0, 10) < from || r.date.slice(0, 10) > to)) throw Error(`Forbidden ${kind} fitting dates: TEST and later validation cannot be fitted`);
}
function simplex(values) {
  const max = Math.max(...values); const exps = values.map(v => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(v => EPS + (1 - 3 * EPS) * v / sum);
}
const form = list => list?.length ? list.reduce((n, v) => n + (v === "W" ? 3 : v === "D" ? 1 : 0), 0) / list.length : null;

// Missing observations remain null. A missing centered feature is a neutral
// zero at inference, never a fabricated team statistic.
function features(profile) {
  const h = profile.home; const a = profile.away; const hw = h.weighted; const aw = a.weighted;
  const n = Math.min(h.sampleSize, a.sampleSize); const vn = Math.min(hw.home.sampleSize, aw.away.sampleSize);
  const rows = [];
  const add = (group, name, value, count = n) => rows.push({ group, name, value: Number.isFinite(value) ? value : null, reliability: shrinkage(count) });
  const diff = (x, y) => Number.isFinite(x) && Number.isFinite(y) ? x - y : null;
  add("A", "ppgDifference", diff(hw.pointsPerGame, aw.pointsPerGame));
  add("A", "last5Difference", diff(form(h.last5), form(a.last5)), Math.min(h.last5.length, a.last5.length));
  add("A", "last10Difference", diff(form(h.last10), form(a.last10)));
  add("A", "winDifference", diff(hw.winRate, aw.winRate));
  add("A", "drawTendency", Number.isFinite(hw.drawRate) && Number.isFinite(aw.drawRate) ? (hw.drawRate + aw.drawRate) / 2 : null);
  add("A", "lossDifference", diff(hw.lossRate, aw.lossRate));
  for (const [key, value] of Object.entries({ homeGF: hw.goalsForPerMatch, homeGA: hw.goalsAgainstPerMatch, awayGF: aw.goalsForPerMatch, awayGA: aw.goalsAgainstPerMatch })) add("B", key, value);
  for (const [key, value] of Object.entries({ venueHomeGF: hw.home.goalsForPerMatch, venueHomeGA: hw.home.goalsAgainstPerMatch, venueAwayGF: aw.away.goalsForPerMatch, venueAwayGA: aw.away.goalsAgainstPerMatch, venuePPGDifference: diff(hw.home.pointsPerGame, aw.away.pointsPerGame) })) add("C", key, value, vn);
  for (const key of ["combinedOver15Rate", "combinedOver25Rate", "combinedOver35Rate"]) add("D", key, profile.matchup[key]);
  add("E", "combinedBTTS", profile.matchup.combinedBTTSRate);
  for (const [prefix, stats] of [["home", hw], ["away", aw]]) for (const key of ["cleanSheetRate", "failedToScoreRate"]) add("E", `${prefix}${key}`, stats[key]);
  return rows;
}

function fitNormalizer(rows) {
  assertFitDates(rows);
  return rows[0].features.map((f, i) => {
    const values = rows.map(r => r.features[i].value).filter(Number.isFinite);
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const scale = values.length ? Math.sqrt(values.reduce((n, v) => n + (v - mean) ** 2, 0) / values.length) : 1;
    return { name: f.name, group: f.group, mean, scale: scale > 1e-8 ? scale : 1, observed: values.length };
  });
}
function normalize(values, normalizer, groups = GROUPS) {
  if (values.length !== normalizer.length) throw Error("Model 4.1 feature schema mismatch");
  return [1, ...values.map((f, i) => {
    const norm = normalizer[i];
    if (f.name !== norm.name) throw Error("Model 4.1 feature order mismatch");
    return groups.includes(f.group) && Number.isFinite(f.value) ? clamp((f.value - norm.mean) / norm.scale, -3, 3) * f.reliability : 0;
  })];
}
const classOf = goals => goals.home > goals.away ? 0 : goals.home === goals.away ? 1 : 2;
const baseVector = p => [p.home, p.draw, p.away];

function fitClassifier(rows, { ridge = .1, baseScale = 1, groups = GROUPS, iterations = 400 } = {}) {
  const normalizer = fitNormalizer(rows); const x = rows.map(r => normalize(r.features, normalizer, groups));
  const weights = Array.from({ length: 3 }, () => Array(x[0].length).fill(0));
  for (let step = 0; step < iterations; step++) {
    const gradient = weights.map(w => w.map(() => 0));
    for (let i = 0; i < rows.length; i++) {
      const p = simplex(weights.map((w, k) => baseScale * Math.log(clip(baseVector(rows[i].base)[k])) + dot(w, x[i])));
      const errors = p.map((v, k) => v - Number(k === classOf(rows[i].goals)));
      const weightedError = dot(p, errors);
      for (let k = 0; k < 3; k++) {
        const derivative = errors[k] + 2 * p[k] * (errors[k] - weightedError); // CE + multiclass Brier
        for (let j = 0; j < x[i].length; j++) gradient[k][j] += derivative * x[i][j] / rows.length;
      }
    }
    for (let k = 0; k < 3; k++) for (let j = 0; j < x[0].length; j++) weights[k][j] -= .08 * (gradient[k][j] + ridge * (j === 0 ? .1 : 1) * weights[k][j]);
  }
  return { normalizer, weights, ridge, baseScale, groups, iterations };
}
function predictClass(model, row) {
  const x = normalize(row.features, model.normalizer, model.groups);
  return simplex(model.weights.map((w, k) => model.baseScale * Math.log(clip(baseVector(row.base)[k])) + dot(w, x)));
}

function goalOffset(row, side) {
  const get = name => row.features.find(f => f.name === name)?.value;
  const values = side === 0 ? [get("homeGF"), get("awayGA")] : [get("awayGF"), get("homeGA")];
  if (!values.every(Number.isFinite)) throw Error("Insufficient observed GF/GA for Model 4.1 Poisson");
  return clamp((values[0] + values[1]) / 2, .15, 4);
}
function fitGoalModel(rows, { ridge = .1, groups = GROUPS, iterations = 300 } = {}) {
  const normalizer = fitNormalizer(rows); const x = rows.map(r => normalize(r.features, normalizer, groups));
  const weights = Array.from({ length: 2 }, () => Array(x[0].length).fill(0));
  for (let step = 0; step < iterations; step++) {
    const gradient = weights.map(w => w.map(() => 0));
    for (let i = 0; i < rows.length; i++) for (let side = 0; side < 2; side++) {
      const lambda = Math.exp(clamp(Math.log(goalOffset(rows[i], side)) + dot(weights[side], x[i]), Math.log(.1), Math.log(5)));
      const error = lambda - rows[i].goals[side === 0 ? "home" : "away"];
      for (let j = 0; j < x[i].length; j++) gradient[side][j] += error * x[i][j] / rows.length;
    }
    for (let side = 0; side < 2; side++) for (let j = 0; j < x[0].length; j++) weights[side][j] -= .025 * (gradient[side][j] + ridge * (j === 0 ? .1 : 1) * weights[side][j]);
  }
  return { normalizer, weights, ridge, groups, iterations };
}
function poissonMarkets(homeLambda, awayLambda) {
  if (![homeLambda, awayLambda].every(v => Number.isFinite(v) && v > 0)) throw Error("Invalid Poisson intensity");
  const lambda = homeLambda + awayLambda;
  const over = threshold => clip(1 - Array.from({ length: threshold + 1 }, (_, k) => poissonProbability(lambda, k)).reduce((a, b) => a + b, 0));
  return { over15: over(1), over25: over(2), over35: over(3), bttsYes: clip((1 - Math.exp(-homeLambda)) * (1 - Math.exp(-awayLambda))),
    homeOver05: clip(1 - Math.exp(-homeLambda)), homeOver15: clip(1 - Math.exp(-homeLambda) * (1 + homeLambda)),
    awayOver05: clip(1 - Math.exp(-awayLambda)), awayOver15: clip(1 - Math.exp(-awayLambda) * (1 + awayLambda)) };
}
function predictGoals(model, row) {
  const x = normalize(row.features, model.normalizer, model.groups);
  const expectedGoals = model.weights.map((w, side) => Math.exp(clamp(Math.log(goalOffset(row, side)) + dot(w, x), Math.log(.1), Math.log(5))));
  return { probabilities: poissonMarkets(...expectedGoals), expectedGoals: { home: expectedGoals[0], away: expectedGoals[1] } };
}
function predictRaw(artifact, row) {
  const [home, draw, away] = predictClass(artifact.classifier, row);
  const goals = predictGoals(artifact.goalModel, row);
  return { probabilities: { ...row.base, ...(artifact.goalChoice === "poisson" ? goals.probabilities : {}), home, draw, away },
    expectedGoals: artifact.goalChoice === "poisson" ? goals.expectedGoals : null,
    candidatePoisson: goals };
}

const sigmoid = x => clip(1 / (1 + Math.exp(-clamp(x, -30, 30))));
const logit = p => Math.log(clip(p) / (1 - clip(p)));
const GOAL_KEYS = ["over15", "over25", "over35", "bttsYes"];
const goalOutcome = (key, goals) => key === "bttsYes" ? Number(goals.home > 0 && goals.away > 0) : Number(goals.home + goals.away > ({ over15: 1, over25: 2, over35: 3 })[key]);

function fitCalibration(rows, artifact) {
  assertFitDates(rows, "calibration");
  const probabilities = rows.map(r => predictRaw(artifact, r).probabilities);
  let temperature = 1;
  const binary = Object.fromEntries(GOAL_KEYS.map(k => [k, { slope: 1, intercept: 0 }]));
  for (let step = 0; step < 300; step++) {
    let dt = 0;
    const gradients = Object.fromEntries(GOAL_KEYS.map(k => [k, { slope: 0, intercept: 0 }]));
    for (let i = 0; i < rows.length; i++) {
      const logits = baseVector(probabilities[i]).map(p => Math.log(clip(p)));
      const p = simplex(logits.map(v => v / temperature));
      dt += p.reduce((n, v, k) => n - (v - Number(k === classOf(rows[i].goals))) * logits[k] / temperature ** 2, 0) / rows.length;
      for (const key of GOAL_KEYS) {
        const x = logit(probabilities[i][key]); const error = sigmoid(binary[key].slope * x + binary[key].intercept) - goalOutcome(key, rows[i].goals);
        gradients[key].slope += error * x / rows.length; gradients[key].intercept += error / rows.length;
      }
    }
    temperature = clamp(temperature - .05 * (dt + .02 * (temperature - 1)), .5, 3);
    for (const key of GOAL_KEYS) {
      binary[key].slope = clamp(binary[key].slope - .05 * (gradients[key].slope + .02 * (binary[key].slope - 1)), .2, 3);
      binary[key].intercept = clamp(binary[key].intercept - .05 * (gradients[key].intercept + .02 * binary[key].intercept), -2, 2);
    }
  }
  return { method: "logistic", temperature, binary, fittedThrough: rows.at(-1).date, fitIds: rows.map(r => r.id) };
}
function calibrate(probabilities, model) {
  if (!model || model.method === "none") return { ...probabilities };
  const p = { ...probabilities };
  if (model.useClass !== false) [p.home, p.draw, p.away] = simplex(baseVector(p).map(v => Math.log(clip(v)) / model.temperature));
  if (model.useGoals !== false) {
    for (const key of GOAL_KEYS) p[key] = sigmoid(model.binary[key].slope * logit(p[key]) + model.binary[key].intercept);
    // Fixed projection onto ordered over probabilities; same in validation/test/live.
    [p.over15, p.over25, p.over35] = [p.over15, p.over25, p.over35].sort((a, b) => b - a);
  }
  return p;
}

module.exports = { EPS, GROUPS, GOAL_KEYS, features, fitNormalizer, normalize, shrinkage, clip, simplex, classOf, fitClassifier, predictClass, fitGoalModel, predictGoals, poissonMarkets, predictRaw, fitCalibration, calibrate };
