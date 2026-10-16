const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ProductionAnalysis, validateInputs, STATISTICS_VERSION, isCompletedBefore, sanitizeHistoryAsOf } = require("../services/productionAnalysis");
const { loadArtifact, createArtifactLoader, validateArtifact, MODEL_4_0, MODEL_4_1 } = require("../services/modelVersions");
const { loadDataset } = require("../services/benchmarkDataset");
const { replayInput } = require("../services/chronologicalBenchmark");
const { analyzeCollectedFixture } = require("../server");
const M = require("../services/model41");
const now = Date.parse("2026-09-17T00:00:00Z");
let source;
async function realInput() {
  if (!source) source = loadDataset({ offline: true }).then(({ fixtures }) => {
    const record = require("../data/backtest/model41-test-predictions.json")[0];
    const target = fixtures.find(f => f.fixture.id === record.id);
    return replayInput(fixtures, target).collected;
  });
  return structuredClone(await source);
}
async function service(options = {}) {
  const input = await realInput();
  return new ProductionAnalysis({ collect: async () => input, calculate: analyzeCollectedFixture, now: () => now, file: null, logger: () => {}, ...options });
}

test("As-of history filter excludes future, same-day date-only, and unfinished results", async () => {
  const completed = {
    fixture: { id: "past", date: "2026-09-16T20:00:00.000Z", status: { short: "FT" }, kickoffPrecision: "time" },
    goals: { home: 1, away: 0 },
  };
  const future = { ...structuredClone(completed), fixture: { ...completed.fixture, id: "future", date: "2026-09-17T01:00:00.000Z" } };
  const dateOnlySameDay = { ...structuredClone(completed), fixture: { ...completed.fixture, id: "date-only", date: "2026-09-17", kickoffPrecision: "date" } };
  const unfinished = { ...structuredClone(completed), fixture: { ...completed.fixture, id: "unfinished", date: "2026-09-16T21:00:00.000Z", status: { short: "NS" } } };
  assert.equal(isCompletedBefore(completed, now), true);
  assert.equal(isCompletedBefore(future, now), false);
  assert.equal(isCompletedBefore(dateOnlySameDay, now), false);
  assert.equal(isCompletedBefore({ ...dateOnlySameDay, fixture: { ...dateOnlySameDay.fixture, kickoffPrecision: "time" } }, now), false);
  assert.equal(isCompletedBefore(unfinished, now), false);
  const input = { fixture: {}, homeMatches: [completed, future, dateOnlySameDay, unfinished], awayMatches: [completed, future], h2hMatches: [future] };
  const safe = sanitizeHistoryAsOf(input, now);
  assert.deepEqual(safe.homeMatches.map(m => m.fixture.id), ["past"]);
  assert.deepEqual(safe.awayMatches.map(m => m.fixture.id), ["past"]);
  assert.deepEqual(safe.h2hMatches, []);
  assert.equal(input.homeMatches.length, 4, "sanitizing must not mutate cached provider data");
});

test("ProductionAnalysis passes only completed as-of histories into model calculation", async () => {
  const input = await realInput();
  const future = structuredClone(input.homeMatches[0]);
  future.fixture = { ...future.fixture, id: "future-after-as-of", date: new Date(now + 60 * 60_000).toISOString(), status: { short: "FT" }, kickoffPrecision: "time" };
  input.homeMatches = [...input.homeMatches, future];
  input.awayMatches = [...input.awayMatches, structuredClone(future)];
  input.h2hMatches = [...(input.h2hMatches || []), structuredClone(future)];
  const seen = [];
  const s = await service({ collect: async () => input, calculate: (collected, options) => {
    seen.push(collected);
    return analyzeCollectedFixture(collected, options);
  } });
  await s.analyze("as-of-filter");
  assert.ok(seen.length >= 1);
  for (const collected of seen) {
    for (const rows of [collected.homeMatches, collected.awayMatches, collected.h2hMatches]) {
      assert.ok(rows.every(row => isCompletedBefore(row, now)));
      assert.ok(rows.every(row => row.fixture.id !== "future-after-as-of"));
    }
  }
});

test("Production loads and freezes the authentic locked artifact", () => {
  const a = loadArtifact(); const b = loadArtifact();
  assert.equal(a, b); assert.equal(a.fingerprint, require("../data/backtest/model41-report.json").artifactSha256);
  assert.ok(Object.isFrozen(a.artifact.classifier.weights[0]));
});

test("Artifact schema rejects nonfinite weights and invalid feature order", () => {
  const a = structuredClone(loadArtifact().artifact); a.classifier.weights[0][0] = NaN;
  assert.throws(() => validateArtifact(a), { code: "ARTIFACT_SCHEMA_INVALID" });
  const b = structuredClone(loadArtifact().artifact); b.goalModel.normalizer.reverse();
  assert.throws(() => validateArtifact(b), { code: "ARTIFACT_SCHEMA_INVALID" });
});

test("Artifact content change invalidates a previously cached successful load", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "model41-artifact-"));
  const file = path.join(directory, "artifact.json");
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(directory); });
  const original = path.join(__dirname, "../data/backtest/model41-artifact.json"); fs.copyFileSync(original, file);
  const loader = createArtifactLoader({ file }); loader();
  fs.appendFileSync(file, " ");
  assert.throws(loader, { code: "ARTIFACT_INTEGRITY_MISMATCH" });
});

test("Feature schema mismatch prevents Model 4.1 readiness", async () => {
  const artifact = structuredClone(loadArtifact().artifact); artifact.classifier.normalizer[0].name = "wrong";
  assert.equal(validateInputs(await realInput(), artifact, now).reason, "FEATURE_SCHEMA_MISMATCH");
});

test("Shadow uses real inputs, calibrated probabilities, and preserves Model 4.0", async () => {
  const s = await service(); const result = await s.analyze("real-fixture");
  const original = analyzeCollectedFixture(sanitizeHistoryAsOf(await realInput(), now), { now, persist: false });
  assert.equal(result.modelVersion, MODEL_4_0); assert.equal(result.MODEL_4_1_READY, true);
  assert.equal(result.hybridRobot.version, "HYBRID_SELECTIVE_1.0");
  assert.ok(["RECOMMEND", "NO_BET"].includes(result.hybridRobot.status));
  if (result.hybridRobot.status === "RECOMMEND") {
    assert.ok(result.hybridRobot.recommendation.probability >= 0.75);
    assert.ok(result.hybridRobot.recommendation.disagreement <= 0.10);
  } else assert.ok(result.hybridRobot.reason);
  assert.deepEqual(result.probabilities, original.probabilities);
  const advanced = result.models[MODEL_4_1];
  const calibrated = M.calibrate(advanced.model.rawProbabilities, loadArtifact().artifact.calibration);
  for (const key of ["home", "draw", "away"]) assert.equal(advanced.probabilities[key], calibrated[key]);
  assert.ok(Math.abs(advanced.probabilities.home + advanced.probabilities.draw + advanced.probabilities.away - 1) < 1e-12);
  assert.notEqual(advanced.probabilities.home, advanced.model.rawProbabilities.home);
  assert.equal(result.model41FallbackReason, null); assert.equal(result.historicalSampleSize.home, 10);
  const stored = [...s.records.values()][0];
  assert.deepEqual(stored.model41.rawProbabilities, advanced.model.rawProbabilities);
  assert.deepEqual(stored.model40.probabilities, original.probabilities);
});

test("Missing historical data safely falls back to 4.0 without invented statistics", async () => {
  const input = await realInput(); input.homeMatches = []; input.awayMatches = []; input.h2hMatches = [];
  const s = await service({ collect: async () => input }); const r = await s.analyze("missing", { modelVersion: MODEL_4_1 });
  assert.equal(r.modelVersion, MODEL_4_0); assert.equal(r.model41Available, false);
  assert.equal(r.model41FallbackReason, "INSUFFICIENT_HISTORY"); assert.equal(r.historicalSampleSize.home, 0);
  assert.equal(r.statisticsProfile.home.weighted.goalsForPerMatch, null); assert.equal(r.models[MODEL_4_1], null);
});

test("Insufficient-history fallback logs include sample counts and provider coverage reasons", async () => {
  const input = await realInput();
  input.homeMatches = [];
  input.awayMatches = [];
  input.sourceMetadata = { fields: { fixture: "openfootball" }, unavailable: { homeMatches: "insufficient_history", awayMatches: "insufficient_history", h2hMatches: "unavailable" }, historyAttempts: [{ provider: "espn", side: "home", outcome: "history_not_supported" }] };
  const logs = [];
  const s = await service({ collect: async () => input, logger: entry => logs.push(entry) });
  const result = await s.analyze("coverage-diagnostics", { modelVersion: MODEL_4_1 });
  const fallback = logs.find(entry => entry.type === "MODEL41_FALLBACK" && entry.fallbackReason === "INSUFFICIENT_HISTORY");
  assert.equal(result.modelVersion, MODEL_4_0);
  assert.deepEqual(fallback.historicalSampleSize, { home: 0, away: 0 });
  assert.ok(fallback.statisticsQuality);
  assert.deepEqual(fallback.sourceMetadata.unavailable, { homeMatches: "insufficient_history", awayMatches: "insufficient_history", h2hMatches: "unavailable" });
  assert.deepEqual(fallback.sourceMetadata.historyAttempts, [{ provider: "espn", side: "home", outcome: "history_not_supported" }]);
});

test("Runtime errors fall back with safe reason metadata and server-only error logs", async () => {
  const logs = []; const s = await service({ logger: row => logs.push(row), calculate: (input, options) => {
    if (options.model41Artifact) throw Error("private runtime diagnostic"); return analyzeCollectedFixture(input, options);
  } });
  const r = await s.analyze("runtime", { modelVersion: MODEL_4_1 });
  assert.equal(r.modelVersion, MODEL_4_0); assert.equal(r.model41FallbackReason, "MODEL41_RUNTIME_ERROR");
  assert.equal(logs[0].modelVersion, MODEL_4_1); assert.equal(logs[0].fixture, "runtime");
  assert.equal(logs[0].requestedModelVersion, MODEL_4_1); assert.equal(logs[0].actualModelVersion, MODEL_4_0);
  assert.equal(JSON.stringify(r).includes("private runtime diagnostic"), false);
});

test("Unavailable artifact cannot break the existing 4.0 prediction", async () => {
  const s = await service({ artifactLoader: () => { throw Object.assign(Error("missing"), { code: "ARTIFACT_UNAVAILABLE" }); } });
  const r = await s.analyze("artifact", { modelVersion: MODEL_4_1 });
  assert.equal(r.modelVersion, MODEL_4_0); assert.equal(r.model41FallbackReason, "ARTIFACT_UNAVAILABLE");
  assert.ok(r.probabilities.home > 0);
});

test("Artifact schema failure returns 4.0 and records requested and actual models", async () => {
  const logs = [];
  const s = await service({ logger: row => logs.push(row), artifactLoader: () => {
    const artifact = structuredClone(loadArtifact().artifact);
    artifact.classifier.normalizer.reverse();
    validateArtifact(artifact);
  } });
  const result = await s.analyze("schema", { modelVersion: MODEL_4_1 });
  assert.equal(result.modelVersion, MODEL_4_0);
  assert.equal(result.model41FallbackReason, "ARTIFACT_SCHEMA_INVALID");
  assert.equal(logs[0].requestedModelVersion, MODEL_4_1);
  assert.equal(logs[0].actualModelVersion, MODEL_4_0);
});

test("Invalid runtime probability simplex safely falls back", async () => {
  const s = await service({ calculate: (input, options) => {
    const result = analyzeCollectedFixture(input, options);
    if (options.model41Artifact) result.probabilities.home = 0.99;
    return result;
  } });
  const result = await s.analyze("simplex", { modelVersion: MODEL_4_1 });
  assert.equal(result.modelVersion, MODEL_4_0);
  assert.equal(result.model41FallbackReason, "INVALID_MODEL41_PROBABILITIES");
});

test("Model caches isolate versions; second analysis performs no collection or calculation", async () => {
  const s = await service(); const a = await s.analyze("cached", { modelVersion: MODEL_4_0 });
  const b = await s.analyze("cached", { modelVersion: MODEL_4_1 });
  assert.equal(b.modelVersion, MODEL_4_1); assert.equal(b.cache.inputHit, true); assert.equal(b.cache.model41Hit, true);
  assert.deepEqual(b.probabilities, a.models[MODEL_4_1].probabilities);
  assert.equal(s.metrics.collections, 1); assert.equal(s.metrics.model40Runs, 1); assert.equal(s.metrics.model41Runs, 1);
  assert.ok([...s.models.keys()].some(k => k.includes(`:${MODEL_4_0}:${STATISTICS_VERSION}:`)));
  assert.ok([...s.models.keys()].some(k => k.includes(`:${MODEL_4_1}:${STATISTICS_VERSION}:${loadArtifact().fingerprint}:`)));
});

test("An invalidated artifact cannot reuse cached Model 4.1 results", async () => {
  let valid = true; const s = await service({ artifactLoader: () => { if (valid) return loadArtifact(); throw Object.assign(Error("changed"), { code: "ARTIFACT_INTEGRITY_MISMATCH" }); } });
  assert.equal((await s.analyze("change")).model41Available, true); valid = false;
  const r = await s.analyze("change", { modelVersion: MODEL_4_1 });
  assert.equal(r.modelVersion, MODEL_4_0); assert.equal(r.models[MODEL_4_1], null);
  assert.equal(r.model41FallbackReason, "ARTIFACT_INTEGRITY_MISMATCH");
});

test("Concurrent detail requests coalesce both history and model work", async () => {
  const s = await service(); await Promise.all([s.analyze("parallel"), s.analyze("parallel", { modelVersion: MODEL_4_1 })]);
  assert.equal(s.metrics.collections, 1); assert.equal(s.metrics.model40Runs, 1); assert.equal(s.metrics.model41Runs, 1);
});

test("Frontend model switch uses calibrated analysis and isolated cache keys", async () => {
  const { selectModelAnalysis, modelCacheKey } = await import("../../src/modelSelection.js");
  const s = await service(); const r = await s.analyze("ui");
  assert.deepEqual(selectModelAnalysis(r, MODEL_4_1).probabilities, r.models[MODEL_4_1].probabilities);
  assert.deepEqual(selectModelAnalysis(r, MODEL_4_0).probabilities, r.models[MODEL_4_0].probabilities);
  assert.notEqual(modelCacheKey("ui", MODEL_4_0, r.cache), modelCacheKey("ui", MODEL_4_1, r.cache));
  assert.notEqual(modelCacheKey("ui", MODEL_4_1, r.cache), modelCacheKey("ui", MODEL_4_1, { ...r.cache, artifactVersion: "new" }));
  const unavailable = { ...r, model41Available: false, models: { ...r.models, [MODEL_4_1]: null } };
  assert.equal(selectModelAnalysis(unavailable, MODEL_4_1).modelVersion, MODEL_4_0);
});

test("Runtime production does not change locked mathematics or benchmark artifacts", () => {
  const E = require("../services/model41Experiment"); const a = loadArtifact(); const report = require("../data/backtest/model41-report.json");
  assert.equal(a.artifact.codeHash, E.codeHash()); assert.equal(a.fingerprint, report.artifactSha256);
  assert.equal(E.shaFile(path.join(__dirname, "../data/backtest/report.json")), report.reference.reportSha256);
});

test("Production ledger receives the existing dual-model response without recalculation", async () => {
  const seen = [];
  const s = await service({ ledger: { recordResponse: (response, collected) => {
    seen.push({ response, collected }); return [{ saved: false, reason: "KICKOFF_REACHED" }];
  } } });
  const result = await s.analyze("ledger", { modelVersion: MODEL_4_1 });
  await s.analyze("ledger", { modelVersion: MODEL_4_1 });
  assert.equal(seen.length, 2);
  assert.ok(seen[0].response.models[MODEL_4_0]); assert.ok(seen[0].response.models[MODEL_4_1]);
  assert.deepEqual(seen[0].collected, await realInput());
  assert.equal(result.ledger[0].reason, "KICKOFF_REACHED");
  assert.equal(s.metrics.collections, 1); assert.equal(s.metrics.model41Runs, 1);
});

test("Ledger disk failure cannot break production predictions or expose diagnostics", async () => {
  const logs = [];
  const s = await service({ logger: entry => logs.push(entry), ledger: { recordResponse: () => { throw Error("private disk path"); } } });
  const result = await s.analyze("disk", { modelVersion: MODEL_4_1 });
  assert.equal(result.modelVersion, MODEL_4_1);
  assert.equal(result.ledger[0].reason, "LEDGER_STORAGE_ERROR");
  assert.equal(logs[0].type, "LEDGER_WRITE_FAILED");
  assert.equal(JSON.stringify(result).includes("private disk path"), false);
});

test("Isolated pre-kickoff clock exercises real inference through durable ledger and cache", async t => {
  const { PredictionLedger } = require("../services/predictionLedger");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "production-ledger-test-"));
  t.after(() => { for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory); });
  const input = await realInput();
  // Replay exists only in this isolated test directory, never in production ledger.
  let clock = Date.parse(input.fixture.kickoff) - 3600000;
  const ledger = new PredictionLedger({ directory, now: () => clock });
  const s = new ProductionAnalysis({ ledger, file: null, now: () => clock, collect: async () => input,
    calculate: (collected, options) => analyzeCollectedFixture(collected, { ...options, persist: false }), logger: () => {} });
  const first = await s.analyze(input.fixture.providerFixtureId, { modelVersion: MODEL_4_1 });
  assert.ok(first.ledger.every(r => r.saved)); assert.equal(ledger.entries().length, 2);
  const stored = ledger.entries().find(r => r.usedModel === MODEL_4_1);
  assert.equal(stored.homeProbability, first.models[MODEL_4_1].probabilities.home);
  assert.equal(stored.rawHomeProbability, first.models[MODEL_4_1].model.rawProbabilities.home);
  const second = await s.analyze(input.fixture.providerFixtureId, { modelVersion: MODEL_4_0 });
  assert.ok(second.ledger.every(r => r.reason === "DUPLICATE")); assert.equal(s.metrics.collections, 1);
  clock = Date.parse(input.fixture.kickoff);
  const late = await s.analyze(input.fixture.providerFixtureId);
  assert.ok(late.ledger.every(r => r.reason === "KICKOFF_REACHED")); assert.equal(ledger.entries().length, 2);
});

test("Read-only capture mode runs actual inference without ledger or shadow persistence", async () => {
  let writes = 0; const optionsSeen = [];
  const s = await service({ ledger: { recordResponse: () => { writes++; } }, calculate: (input, options) => { optionsSeen.push(options); return analyzeCollectedFixture(input, options); } });
  const result = await s.analyze("dry-run", { persist: false, recordLedger: false, allowPartial: true });
  assert.ok(result.models[MODEL_4_0]); assert.ok(result.models[MODEL_4_1]);
  assert.equal(writes, 0); assert.equal(s.records.size, 0); assert.ok(optionsSeen.every(options => options.persist === false));
});

test("Capture mode can retain actual 4.1 inference when the standalone 4.0 path fails", async () => {
  const s = await service({ calculate: (input, options) => { if (!options.model41Artifact) throw Error("standalone model 4.0 failed"); return analyzeCollectedFixture(input, options); } });
  const result = await s.analyze("partial", { persist: false, recordLedger: false, allowPartial: true });
  assert.equal(result.models[MODEL_4_0], null); assert.equal(result.modelVersion, MODEL_4_1); assert.ok(result.probabilities.home > 0);
  await assert.rejects(() => s.analyze("normal"), /standalone model 4.0 failed/);
});
