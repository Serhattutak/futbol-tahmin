const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { hash, replayInput } = require("./chronologicalBenchmark");
const { buildMatchStatistics } = require("./teamStatistics");
const { observations, summarize, modelReport, binaryObservation } = require("./benchmarkMetrics");
const { calculateConfidence } = require("./predictionModel");
const M = require("./model41");
const SPLITS = { train: ["2025-08-15", "2025-12-31"], validation: ["2026-01-01", "2026-02-28"], test: ["2026-03-01", "2026-05-24"] };
const CANDIDATES = { ridge: [.03, .1, .3], baseScale: [.75, 1, 1.25], iterations: 400, goalIterations: 300 };
const shaFile = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const codeHash = () => hash(["model41.js", "model41Experiment.js", "teamStatistics.js", "historicalForm.js", "chronologicalBenchmark.js", "predictionModel.js", "benchmarkMetrics.js", "../scripts/runModel41.js"].map(f => fs.readFileSync(path.join(__dirname, f), "utf8")));
function splitOf(date) { const day = date.slice(0, 10); return Object.keys(SPLITS).find(key => day >= SPLITS[key][0] && day <= SPLITS[key][1]) || null; }
function assertDevelopment(train, validation) {
  if (!train.length || !validation.length || train.some(r => splitOf(r.date) !== "train") || validation.some(r => splitOf(r.date) !== "validation")) throw Error("Optimizer cannot access TEST or out-of-range records");
  const rows = [...train, ...validation];
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw Error("Duplicate development fixture");
  if (rows.some(r => r.audit?.latestHistoryDay >= r.date.slice(0, 10))) throw Error("Nonhistorical feature rejected");
}
function prepareRows(records, fixtures) {
  const targets = new Map(fixtures.map(f => [String(f.fixture.id), f]));
  return records.map(record => {
    const target = targets.get(String(record.id));
    if (!target) throw Error(`Missing original target ${record.id}`);
    const input = replayInput(fixtures, target);
    const profile = buildMatchStatistics(input.collected.fixture, { ...input.collected, now: input.now });
    if (input.audit.latestHistoryDay >= record.date.slice(0, 10)) throw Error("Future feature rejected");
    return { id: record.id, date: record.date, league: record.league, goals: record.goals, base: record.stats.probabilities,
      quality: record.stats.quality, confidence: record.stats.confidence, samples: { home: profile.home.sampleSize, away: profile.away.sampleSize }, features: M.features(profile), audit: input.audit };
  });
}
function scores(rows, probabilities) {
  const items = rows.map((r, i) => observations(probabilities[i], r.goals));
  return Object.fromEntries(Object.keys(items[0] || {}).map(key => [key, summarize(items.map(r => r[key]))]));
}
const classObjective = metrics => metrics["1X2"].brier + metrics["1X2"].logLoss;
const goalObjective = metrics => ["Over 1.5", "Over 2.5", "Over 3.5", "BTTS Yes"].reduce((sum, k) => sum + metrics[k].brier + metrics[k].logLoss, 0) / 4;
const compact = metrics => ({ accuracy: metrics["1X2"].hitRate, brier: metrics["1X2"].brier, logLoss: metrics["1X2"].logLoss, over25Brier: metrics["Over 2.5"].brier, bttsBrier: metrics["BTTS Yes"].brier });
function predictWithClass(model, row) { const [home, draw, away] = M.predictClass(model, row); return { ...row.base, home, draw, away }; }

function optimize(train, validation) {
  assertDevelopment(train, validation);
  const selection = validation.filter(r => r.date.slice(0, 10) <= "2026-01-31");
  const calibrationCheck = validation.filter(r => r.date.slice(0, 10) >= "2026-02-01");
  if (!selection.length || !calibrationCheck.length) throw Error("Both chronological validation partitions required");
  const classSearch = []; let classifier; let bestClass = Infinity;
  for (const ridge of CANDIDATES.ridge) for (const baseScale of CANDIDATES.baseScale) {
    const model = M.fitClassifier(train, { ridge, baseScale, iterations: CANDIDATES.iterations });
    const metrics = scores(selection, selection.map(r => predictWithClass(model, r))); const objective = classObjective(metrics);
    classSearch.push({ ridge, baseScale, objective, metrics: compact(metrics) });
    if (objective < bestClass) { bestClass = objective; classifier = model; }
  }
  const goalSearch = []; let goalModel; let bestGoal = Infinity;
  for (const ridge of CANDIDATES.ridge) {
    const model = M.fitGoalModel(train, { ridge, iterations: CANDIDATES.goalIterations });
    const metrics = scores(selection, selection.map(r => ({ ...r.base, ...M.predictGoals(model, r).probabilities }))); const objective = goalObjective(metrics);
    goalSearch.push({ ridge, objective, metrics: compact(metrics) });
    if (objective < bestGoal) { bestGoal = objective; goalModel = model; }
  }
  const incumbentGoals = goalObjective(scores(selection, selection.map(r => r.base)));
  const artifact = { version: "MODEL_4_1", classifier, goalModel, goalChoice: bestGoal < incumbentGoals ? "poisson" : "model40", calibration: { method: "none" } };
  const calibration = M.fitCalibration(selection, artifact);
  const raw = calibrationCheck.map(r => M.predictRaw(artifact, r).probabilities);
  const logistic = raw.map(p => M.calibrate(p, calibration));
  const rawMetrics = scores(calibrationCheck, raw); const logisticMetrics = scores(calibrationCheck, logistic);
  calibration.useClass = classObjective(logisticMetrics) < classObjective(rawMetrics);
  calibration.useGoals = goalObjective(logisticMetrics) < goalObjective(rawMetrics);
  artifact.calibration = calibration.useClass || calibration.useGoals ? calibration : { ...calibration, method: "none" };
  artifact.training = { trainIds: train.map(r => r.id), selectionIds: selection.map(r => r.id), calibrationCheckIds: calibrationCheck.map(r => r.id), trainThrough: SPLITS.train[1], selectedThrough: SPLITS.validation[1], testAccess: false };

  // Incremental ablation: the fixed Model 4.0 offset is always retained.
  // No group is selected based on these diagnostics; all five remain in 4.1.
  const ablation = [];
  const groupSets = [["offset-only", []], ["all", M.GROUPS], ...M.GROUPS.flatMap(g => [[`only-${g}`, [g]], [`without-${g}`, M.GROUPS.filter(v => v !== g)]])];
  for (const [name, groups] of groupSets) {
    const cls = M.fitClassifier(train, { ridge: classifier.ridge, baseScale: classifier.baseScale, groups, iterations: CANDIDATES.iterations });
    const goal = M.fitGoalModel(train, { ridge: goalModel.ridge, groups, iterations: CANDIDATES.goalIterations });
    const predictions = selection.map(r => ({ ...predictWithClass(cls, r), ...M.predictGoals(goal, r).probabilities }));
    ablation.push({ name, groups, ...compact(scores(selection, predictions)) });
  }
  return { artifact, development: { counts: { train: train.length, validation: validation.length, selection: selection.length, calibrationCheck: calibrationCheck.length },
    search: { space: CANDIDATES, classifierFits: classSearch.length, goalFits: goalSearch.length, ablationFits: groupSets.length * 2, classSearch, goalSearch, incumbentGoalObjective: incumbentGoals, criterion: "1X2: LogLoss+Brier; goals: mean(LogLoss+Brier) across four markets; accuracy never selected" },
    calibration: { fit: "January validation", selection: "February validation", raw: rawMetrics, logistic: logisticMetrics, choice: { class: calibration.useClass ? "temperature scaling" : "none", goals: calibration.useGoals ? "Platt/logistic" : "none" }, isotonic: "Not attempted: only one month for fitting; insufficient data for stable independent market step functions" },
    ablation: { evaluatedOn: "January validation only; incremental on fixed Model 4.0 signals; no test access", rows: ablation },
  } };
}

function random(seed) { let state = seed >>> 0; return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; }; }
function bootstrapDifferences(rows, reference, candidate, { samples = 2000, seed = 4100 } = {}) {
  if (samples < 1000) throw Error("At least 1000 bootstrap samples required");
  const differences = rows.map((r, i) => {
    const a = observations(reference[i], r.goals); const b = observations(candidate[i], r.goals);
    return Object.fromEntries(["1X2", "Over 1.5", "Over 2.5", "Over 3.5", "BTTS Yes"].map(k => [k, { brier: b[k].brier - a[k].brier, logLoss: b[k].logLoss - a[k].logLoss }]));
  });
  const groups = [...new Set(rows.map(r => r.date.slice(0, 10)))].map(day => rows.map((r, i) => r.date.slice(0, 10) === day ? i : -1).filter(i => i >= 0));
  const rand = random(seed); const output = {};
  for (const market of Object.keys(differences[0])) {
    output[market] = {};
    for (const metric of ["brier", "logLoss"]) {
      const estimates = [];
      for (let iteration = 0; iteration < samples; iteration++) {
        let total = 0; let n = 0;
        for (let block = 0; block < groups.length; block++) for (const index of groups[Math.floor(rand() * groups.length)]) { total += differences[index][market][metric]; n++; }
        estimates.push(total / n);
      }
      estimates.sort((a, b) => a - b);
      output[market][metric] = { meanDifference: differences.reduce((sum, d) => sum + d[market][metric], 0) / rows.length, lower95: estimates[Math.floor(samples * .025)], upper95: estimates[Math.floor(samples * .975)] };
    }
  }
  return { samples, seed, method: "Paired calendar-day cluster bootstrap; percentile 95% CI; negative favors 4.1; repeated-team/season dependence not fully captured", metrics: output };
}

function evaluateTest(rows, artifact) {
  if (!rows.length || rows.some(r => splitOf(r.date) !== "test")) throw Error("Final evaluator accepts only locked TEST dates");
  if (artifact.training.testAccess || artifact.training.selectedThrough >= SPLITS.test[0]) throw Error("Artifact trained on test period");
  const fitted = new Set([...artifact.training.trainIds, ...artifact.training.selectionIds, ...artifact.training.calibrationCheckIds]);
  if (rows.some(r => fitted.has(r.id))) throw Error("TEST fixture appeared in optimization");
  const raw = rows.map(r => M.predictRaw(artifact, r));
  const calibrated = raw.map(r => M.calibrate(r.probabilities, artifact.calibration));
  const confidence = (row, p) => calculateConfidence({ dataQuality: row.quality, homeGames: row.samples.home, awayGames: row.samples.away, probabilities: [p.home, p.draw, p.away].map(v => v * 100), value: null });
  const records = rows.map((r, i) => ({ id: r.id, date: r.date, league: r.league, goals: r.goals, audit: r.audit,
    model40: { probabilities: r.base, confidence: r.confidence, quality: r.quality },
    raw: { probabilities: raw[i].probabilities, confidence: confidence(r, raw[i].probabilities), quality: r.quality },
    calibrated: { probabilities: calibrated[i], confidence: confidence(r, calibrated[i]), quality: r.quality } }));
  const models = Object.fromEntries(["model40", "raw", "calibrated"].map(k => [k, modelReport(records, k)]));
  for (const [key, model] of Object.entries(models)) {
    model.confidenceBuckets = Object.fromEntries([[0, 49], [50, 59], [60, 69], [70, 79], [80, 89], [90, 100]].map(([lo, hi]) => {
      const selected = records.filter(r => r[key].confidence >= lo && r[key].confidence <= hi);
      return [`${lo}-${hi}`, selected.length ? scores(selected, selected.map(r => r[key].probabilities)) : null];
    }));
  }
  const teamGoals = {};
  for (const [key, side, threshold] of [["homeOver05", "home", .5], ["homeOver15", "home", 1.5], ["awayOver05", "away", .5], ["awayOver15", "away", 1.5]]) {
    teamGoals[key] = artifact.goalChoice === "poisson" ? summarize(rows.map((r, i) => binaryObservation(raw[i].probabilities[key], r.goals[side] > threshold))) : null;
  }
  return { count: rows.length, pairedSampleHash: hash(rows.map(r => r.id)), models, teamGoals,
    uncertainty: { raw: bootstrapDifferences(rows, rows.map(r => r.base), raw.map(r => r.probabilities)), calibrated: bootstrapDifferences(rows, rows.map(r => r.base), calibrated) }, records };
}

module.exports = { SPLITS, CANDIDATES, shaFile, codeHash, splitOf, assertDevelopment, prepareRows, optimize, scores, bootstrapDifferences, evaluateTest };
