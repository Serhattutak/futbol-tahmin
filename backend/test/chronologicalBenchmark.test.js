const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { binaryObservation, calibration, observations, summarize, THRESHOLDS } = require("../services/benchmarkMetrics");
const { loadDataset, DIRECTORY, REPORT_FILE } = require("../services/benchmarkDataset");
const { replayInput, runChronologicalBenchmark } = require("../services/chronologicalBenchmark");
const { analyzeCollectedFixture, providerRegistry, upstream, app } = require("../server");
const { buildMatchStatistics } = require("../services/teamStatistics");

test("Brier uses exact endpoints; log loss safely handles 0 and 1", () => {
  assert.equal(binaryObservation(0, false).brier, 0);
  assert.equal(binaryObservation(1, false).brier, 1);
  assert.ok(Number.isFinite(binaryObservation(0, true).logLoss));
  assert.ok(Number.isFinite(binaryObservation(1, false).logLoss));
  const metric = summarize([binaryObservation(.8, true), binaryObservation(.2, false)]);
  assert.ok(Math.abs(metric.brier - .04) < 1e-12);
  assert.equal(metric.correct, 2);
  assert.throws(() => binaryObservation(null, true));
});

test("ECE includes low probabilities and correct 60% / 100% boundaries", () => {
  const summary = calibration([binaryObservation(.6, true), binaryObservation(.6, false), binaryObservation(.1, false), binaryObservation(1, true)]);
  assert.ok(Math.abs(summary.ece - .075) < 1e-12);
  assert.equal(summary.buckets[6].count, 2);
  assert.equal(summary.buckets[9].count, 1);
  assert.equal(summary.buckets[5].averageProbability, null);
  assert.equal(calibration([]).ece, null);
  assert.deepEqual(THRESHOLDS, [60, 70, 75, 80, 85, 90]);
});

test("Multiclass 1X2 Brier sums three errors and scores actual-class log loss", () => {
  const metrics = observations({ home: .5, draw: .3, away: .2, over15: .8, over25: .6, over35: .3, bttsYes: .6 }, { home: 1, away: 1 });
  assert.ok(Math.abs(metrics["1X2"].brier - .78) < 1e-12);
  assert.ok(Math.abs(metrics["1X2"].logLoss + Math.log(.3)) < 1e-12);
  assert.equal(metrics["1X2"].correct, false);
});

test("Real immutable dataset cache replays offline with zero provider calls", async () => {
  const data = await loadDataset({ offline: true, load: () => { throw Error("Unexpected provider call"); } });
  assert.equal(data.requests, 0); assert.equal(data.sources.length, 10);
  assert.ok(data.fixtures.length > 1000);
  assert.ok(data.fixtures.every(f => f.provider === "openfootball" && f.teams.home.name && f.teams.away.name));
});

test("Replay excludes ALL same-day, unknown-time and future results; target result stripped", async () => {
  const { fixtures } = await loadDataset({ offline: true });
  const target = fixtures.find(f => f.fixture.date.startsWith("2026-03") && f.league.name === "Premier League");
  assert.ok(target);
  const input = replayInput(fixtures, target);
  const priorOnly = fixtures.filter(f => f.fixture.date.slice(0, 10) < target.fixture.date.slice(0, 10));
  assert.deepEqual(input, replayInput(priorOnly, target));
  const unknownTime = { ...target, fixture: { ...target.fixture, id: `${target.fixture.id}-unknown-time`, date: target.fixture.date.slice(0, 10), kickoffPrecision: "date" } };
  assert.deepEqual(input, replayInput([...fixtures, unknownTime], target));
  assert.equal(input.collected.fixture.result, null);
  assert.ok(input.audit.latestHistoryDay < target.fixture.date.slice(0, 10));
  assert.equal(input.collected.homeMatches.length, 10);
  const analysis = analyzeCollectedFixture(input.collected, { now: input.now });
  assert.equal(analysis.eligible, true);
  assert.equal(analysis.statistics.home.expectedGoals, null);
  assert.deepEqual(analysis.bookmakerOdds, {});
});

test("Missing history and null statistics yield NO_BET, never invented features", async () => {
  const { fixtures } = await loadDataset({ offline: true });
  const target = fixtures.find(f => f.fixture.date.startsWith("2026-03"));
  const input = replayInput([], target);
  assert.equal(buildMatchStatistics(input.collected.fixture).home.weighted.goalsForPerMatch, null);
  for (const variant of ["baseline", "stats"]) {
    const result = analyzeCollectedFixture(input.collected, { variant, now: input.now });
    assert.equal(result.eligible, false); assert.equal(result.prediction, "NO_BET");
    assert.equal(result.statisticsProfile.h2h, null);
  }
});

test("Both model variants receive identical histories and IDs; no provider/archive side effects", async t => {
  const { fixtures } = await loadDataset({ offline: true });
  const archiveFiles = ["predictions.json", "historicalPredictions.json"].map(f => path.join(__dirname, "../data", f)).filter(fs.existsSync);
  const before = archiveFiles.map(f => fs.readFileSync(f, "utf8"));
  const get = providerRegistry.getFixture;
  providerRegistry.getFixture = () => { throw Error("Replay must not fetch fixtures"); };
  t.after(() => { providerRegistry.getFixture = get; });
  const budget = JSON.stringify(upstream.getBudgetStatus());
  const calls = [];
  const report = runChronologicalBenchmark(fixtures, { from: "2026-03-01", to: "2026-03-03", predict: (input, options) => {
    calls.push({ input: structuredClone(input), options });
    return analyzeCollectedFixture(input, options);
  } });
  assert.ok(report.evaluated > 0);
  assert.equal(calls.length % 2, 0);
  for (let i = 0; i < calls.length; i += 2) {
    assert.deepEqual(calls[i].input, calls[i + 1].input);
    assert.equal(calls[i].options.persist, false);
    assert.equal(calls[i].options.now, calls[i + 1].options.now);
  }
  assert.equal(report.baseline.markets["1X2"].sampleSize, report.stats.markets["1X2"].sampleSize);
  assert.deepEqual(archiveFiles.map(f => fs.readFileSync(f, "utf8")), before);
  assert.equal(JSON.stringify(upstream.getBudgetStatus()), budget);
  assert.ok(Object.values(report.stats.leagues).every(l => l.sufficientSample === false));
});

test("Saved real benchmark meets sample target and audit contains no same-day history", () => {
  const report = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
  const audit = JSON.parse(fs.readFileSync(path.join(DIRECTORY, "predictions.json"), "utf8"));
  assert.ok(report.evaluated >= 1000);
  assert.equal(audit.records.length, report.evaluated);
  assert.equal(audit.pairedSampleHash, report.pairedSampleHash);
  assert.ok(audit.records.every(r => r.audit.latestHistoryDay < r.date.slice(0, 10)));
});

test("Backtest API serves the saved report without running providers", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/backtest`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.success, true); assert.ok(data.report.evaluated >= 1000);
});
