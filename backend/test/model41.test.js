const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const M = require("../services/model41");
const E = require("../services/model41Experiment");
const { loadDataset, REPORT_FILE } = require("../services/benchmarkDataset");
const { replayInput } = require("../services/chronologicalBenchmark");
const { selectedModel, MODEL_4_0, MODEL_4_1 } = require("../services/modelVersions");
const records = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/backtest/predictions.json"), "utf8")).records;
let prepared;
async function development() {
  if (!prepared) prepared = loadDataset({ offline: true }).then(({ fixtures }) => {
    const train = records.filter(r => E.splitOf(r.date) === "train").slice(0, 16);
    const validation = [...records.filter(r => r.date.startsWith("2026-01")).slice(0, 6), ...records.filter(r => r.date.startsWith("2026-02")).slice(0, 6)];
    const rows = E.prepareRows([...train, ...validation], fixtures.filter(f => f.fixture.date.slice(0, 10) < "2026-03-01"));
    return { fixtures, train: rows.slice(0, 16), validation: rows.slice(16) };
  });
  return prepared;
}

test("Model 4.0 reference benchmark is byte-for-byte preserved", () => {
  assert.equal(E.shaFile(REPORT_FILE), "50529e7011d345353a27f8304cb13ba49d9fd1f07d77196c5fdd68e7847770f2");
  const report = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
  assert.equal(report.evaluated, 1686); assert.equal(report.stats.markets["1X2"].correct, 819);
});

test("Train/validation/test dates are disjoint, chronological, and exhaustive", () => {
  assert.deepEqual(Object.fromEntries(Object.keys(E.SPLITS).map(s => [s, records.filter(r => E.splitOf(r.date) === s).length])), { train: 737, validation: 416, test: 533 });
  assert.equal(E.splitOf("2025-12-31T23:59:00Z"), "train");
  assert.equal(E.splitOf("2026-01-01T00:00:00Z"), "validation");
  assert.equal(E.splitOf("2026-03-01T00:00:00Z"), "test");
});

test("Optimizer rejects test records BEFORE accessing their outcomes", async () => {
  const { train, validation } = await development();
  const forbidden = { date: "2026-03-01", get goals() { throw Error("TEST label accessed"); } };
  assert.throws(() => E.optimize([...train, forbidden], validation), /cannot access TEST/);
  assert.throws(() => E.optimize(train, [...validation, forbidden]), /cannot access TEST/);
  assert.throws(() => M.fitNormalizer([forbidden]), /Forbidden train/);
  assert.throws(() => M.fitCalibration([forbidden], {}), /Forbidden calibration/);
});

test("Normalization is train-only, bounded, and neutral for missing features", async () => {
  const { train, validation } = await development(); const normalizer = M.fitNormalizer(train);
  const expected = train.reduce((n, r) => n + r.features[0].value, 0) / train.length;
  assert.equal(normalizer[0].mean, expected);
  const missing = structuredClone(validation[0].features); missing[0].value = null;
  const normalized = M.normalize(missing, normalizer);
  assert.equal(normalized[1], 0); assert.ok(normalized.every(Number.isFinite));
  assert.ok(normalized.slice(1).every(v => Math.abs(v) <= 3));
  assert.equal(missing[0].value, null);
});

test("Small sample shrinkage dampens 3-match rates more than 30-match rates", () => {
  assert.equal(M.shrinkage(0), 0);
  assert.equal(M.shrinkage(10), .5);
  assert.ok(M.shrinkage(3) < M.shrinkage(30));
});

test("Simplex and binary clipping never emit zero or one", () => {
  const values = M.simplex([10000, 0, -10000]);
  assert.ok(values.every(p => p > 0 && p < 1));
  assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.equal(M.clip(0), M.EPS); assert.equal(M.clip(1), 1 - M.EPS);
});

test("Poisson goal markets match closed-form probabilities and remain ordered", () => {
  const p = M.poissonMarkets(1, 1);
  assert.ok(Math.abs(p.over15 - (1 - 3 * Math.exp(-2))) < 1e-12);
  assert.ok(Math.abs(p.bttsYes - (1 - Math.exp(-1)) ** 2) < 1e-12);
  assert.ok(p.over15 >= p.over25 && p.over25 >= p.over35);
  assert.throws(() => M.poissonMarkets(null, 1));
});

test("Missing GF/GA cannot silently become a low Poisson intensity", async () => {
  const { train } = await development(); const model = M.fitGoalModel(train, { iterations: 3 });
  const missing = structuredClone(train[0]); missing.features.find(f => f.name === "homeGF").value = null;
  assert.throws(() => M.predictGoals(model, missing), /Insufficient observed/);
});

test("Real historical features have strictly earlier-day provenance", async () => {
  const { train, validation } = await development();
  for (const row of [...train, ...validation]) assert.ok(row.audit.latestHistoryDay < row.date.slice(0, 10));
});

test("Optimization and calibration are deterministic and never use test IDs", async () => {
  const { train, validation } = await development();
  const a = E.optimize(train, validation); const b = E.optimize(train, validation);
  assert.deepEqual(a, b);
  assert.equal(a.artifact.training.testAccess, false);
  assert.ok(a.artifact.calibration.fitIds.every(id => validation.filter(r => r.date.startsWith("2026-01")).some(r => r.id === id)));
  assert.equal(a.development.search.classifierFits, 9); assert.equal(a.development.search.goalFits, 3);
  const p = M.predictRaw(a.artifact, validation[0]).probabilities;
  const calibrated = M.calibrate(p, a.artifact.calibration);
  assert.ok(Math.abs(calibrated.home + calibrated.draw + calibrated.away - 1) < 1e-12);
  assert.ok(Object.values(calibrated).every(v => Number.isFinite(v) && v > 0 && v < 1));
});

test("Model 4.0 shared live calculation matches an original real baseline prediction", async () => {
  const { fixtures } = await development(); const record = records.find(r => E.splitOf(r.date) === "train");
  const target = fixtures.find(f => f.fixture.id === record.id); const input = replayInput(fixtures, target);
  const actual = require("../server").analyzeCollectedFixture(input.collected, { now: input.now });
  assert.deepEqual(actual.probabilities, record.stats.probabilities); assert.equal(actual.model.version, "4.0");
});

test("Model version selection is explicit and rejects unknown versions", () => {
  assert.equal(selectedModel(MODEL_4_0), MODEL_4_0); assert.equal(selectedModel(MODEL_4_1), MODEL_4_1);
  assert.throws(() => selectedModel("unknown"));
});

test("Paired bootstrap is deterministic and zero for identical predictions", async () => {
  const { train } = await development(); const p = train.map(r => r.base);
  const a = E.bootstrapDifferences(train, p, p, { samples: 1000 }); const b = E.bootstrapDifferences(train, p, p, { samples: 1000 });
  assert.deepEqual(a, b);
  for (const market of Object.values(a.metrics)) for (const metric of Object.values(market)) assert.deepEqual(metric, { meanDifference: 0, lower95: 0, upper95: 0 });
});

test("Locked Model 4.1 artifact and final sample retain code and pairing integrity", () => {
  const report = require("../data/backtest/model41-report.json");
  const artifact = require("../services/modelVersions").loadModel41();
  assert.equal(artifact.codeHash, E.codeHash());
  assert.equal(E.shaFile(path.join(__dirname, "../data/backtest/model41-artifact.json")), report.artifactSha256);
  assert.equal(report.finalTest.count, 533);
  for (const model of Object.values(report.finalTest.models)) assert.equal(model.markets["1X2"].sampleSize, 533);
  assert.ok(new Date(artifact.lockedAt) < new Date(report.generatedAt));
  assert.equal(report.finalTest.models.calibrated.markets["1X2"].correct, 252);
  assert.ok(Math.abs(report.finalTest.models.calibrated.markets["1X2"].brier - .6220982723120381) < 1e-12);
});

test("Model 4.1 shared server prediction matches the locked real test record", async () => {
  const saved = require("../data/backtest/model41-test-predictions.json")[0];
  const artifact = require("../services/modelVersions").loadModel41();
  const { fixtures } = await development();
  const target = fixtures.find(f => f.fixture.id === saved.id); const input = replayInput(fixtures, target);
  const result = require("../server").analyzeCollectedFixture(input.collected, { now: input.now, persist: false, model41Artifact: artifact });
  assert.equal(result.model.version, "4.1");
  for (const key of ["home", "draw", "away", "over15", "over25", "over35", "bttsYes"]) assert.ok(Math.abs(result.probabilities[key] - saved.calibrated.probabilities[key]) < 1e-12, key);
  assert.equal(result.model.confidence, saved.calibrated.confidence);
  assert.ok(Object.values(result.teamGoalProbabilities).every(p => p > 0 && p < 1));
});

test("Model 4.1 report endpoint serves the frozen final results", async t => {
  const server = require("../server").app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/backtest/model41`);
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.report.finalTest.count, 533);
  assert.equal(data.report.reference.reportSha256, E.shaFile(REPORT_FILE));
});
