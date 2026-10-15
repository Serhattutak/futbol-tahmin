const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { ForwardCapture, windowReason, fixtureShapeReason, discoveryDates } = require("../services/forwardCapture");
const { PredictionLedger, MODELS } = require("../services/predictionLedger");
const NOW = Date.parse("2026-09-20T10:00:00Z");
function fixture(id = "test", minutes = 120) {
  return { providerFixtureId: id, provider: "api-football", providerFixtureIds: { "api-football": id }, sources: ["api-football"], kickoff: new Date(NOW + minutes * 60000).toISOString(), kickoffPrecision: "time", status: "SCHEDULED", league: { name: "Test League" }, homeTeam: { name: "Test Home" }, awayTeam: { name: "Test Away" } };
}
function output(f, versions = MODELS) {
  return { requestedModelVersion: MODELS[1], model41Available: versions.includes(MODELS[1]), model41FallbackReason: versions.includes(MODELS[1]) ? null : "MODEL41_RUNTIME_ERROR", cache: { inputVersion: `input-${f.providerFixtureId}`, statisticsVersion: "stats", artifactVersion: "artifact" }, models: Object.fromEntries(MODELS.map(model => [model, versions.includes(model) ? {
    modelVersion: model, eligible: true, fixture: { id: f.providerFixtureId, league: f.league.name, home: f.homeTeam, away: f.awayTeam },
    probabilities: { home: .5, draw: .3, away: .2, over15: .8, over25: .6, over35: .3, bttsYes: .6 },
    model: { confidence: 75, rawProbabilities: model === MODELS[1] ? { home: .6, draw: .2, away: .2 } : undefined }, statisticsQuality: { score: 90 }, historicalSampleSize: { home: 10, away: 10 },
  } : null])) };
}
function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "capture-test-"));
  t.after(() => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true }); });
  let now = NOW; let calls = 0; const fixtures = options.fixtures || [fixture()];
  const ledger = new PredictionLedger({ directory: path.join(directory, "ledger"), now: () => now });
  const analysis = { analyze: async (id, args) => {
    calls++; assert.equal(args.persist, false); assert.equal(args.recordLedger, false);
    const f = fixtures.find(row => row.providerFixtureId === id);
    const response = output(f, options.versions);
    if (options.ineligible) for (const m of Object.values(response.models).filter(Boolean)) m.eligible = false;
    if (options.beforePublish) await options.beforePublish();
    if (options.error) throw options.error;
    return { ...response, capture: await args.onAnalyzed(response, { fixture: f, homeMatches: [], awayMatches: [], h2hMatches: [] }) };
  } };
  const args = { ledger, analysis, now: () => now, artifactFingerprint: () => "artifact", sleep: async () => {}, logger: () => {}, config: { directory: path.join(directory, "capture"), intervalMs: 10, ...options.config }, discover: options.discover || (async () => ({ fixtures })) };
  const capture = new ForwardCapture(args); t.after(() => capture.stopScheduler());
  return { ledger, capture, args, directory, calls: () => calls, time: v => { now = v; } };
}
test("Future eligible capture saves separate paired immutable snapshots through one analysis", async t => {
  const s = setup(t); const r = await s.capture.run();
  assert.equal(r.discoveredFixtures, 1); assert.equal(r.eligibleFixtures, 1); assert.equal(r.capturedFixtures, 1); assert.equal(r.capturedPredictions, 2); assert.equal(r.completePairs, 1); assert.equal(s.calls(), 1);
  const rows = s.ledger.entries(); assert.equal(rows.length, 2); assert.equal(rows[0].inputFingerprint, rows[1].inputFingerprint); assert.ok(rows.every(row => row.minutesBeforeKickoff === 120));
});
test("Second run and restart skip a durable complete pair without provider analysis", async t => {
  const s = setup(t); await s.capture.run(); const second = await s.capture.run();
  assert.equal(second.capturedPredictions, 0); assert.equal(second.duplicates, 2); assert.equal(s.calls(), 1);
  const restarted = new ForwardCapture(s.args); const third = await restarted.run();
  assert.equal(third.duplicates, 2); assert.equal(s.ledger.entries().length, 2); assert.equal(s.calls(), 1);
  assert.ok(restarted.status().lastSuccessfulRunAt);
});
test("Capture rejects kickoff reached, <30m, >24h and invalid kickoff before analysis", async t => {
  const invalid = fixture("invalid"); invalid.kickoff = "2026-09-20T12:00:00";
  const s = setup(t, { fixtures: [fixture("past", 0), fixture("late", 29), fixture("early", 1441), invalid] }); const r = await s.capture.run();
  assert.equal(r.skippedKickoffReached, 1); assert.equal(r.skippedOutsideWindow, 2); assert.equal(r.skippedInvalidFixture, 1); assert.equal(s.calls(), 0); assert.equal(s.ledger.entries().length, 0);
});
test("Exact window boundaries and timezone offsets use absolute instants", () => {
  assert.equal(windowReason(fixture("min", 30), NOW), null); assert.equal(windowReason(fixture("max", 1440), NOW), null);
  const f = fixture(); f.kickoff = "2026-09-20T15:00:00+03:00"; assert.equal(windowReason(f, NOW), null);
  assert.deepEqual(discoveryDates(Date.parse("2026-09-20T22:30:00Z")), ["2026-09-20", "2026-09-21", "2026-09-22"]);
  for (const kickoff of ["2026-02-30T12:00:00Z", "2026-09-20T24:00:00Z"]) assert.equal(windowReason({ ...fixture(), kickoff }, NOW), "INVALID_FIXTURE");
});
test("Invalid fixture diagnostics distinguish missing IDs, team names, precision and timestamps", () => {
  const base = fixture("diagnostic");
  assert.equal(fixtureShapeReason(base), null);
  assert.equal(fixtureShapeReason({ ...base, providerFixtureId: null }), "MISSING_PROVIDER_FIXTURE_ID");
  assert.equal(fixtureShapeReason({ ...base, homeTeam: { name: "" } }), "MISSING_TEAM_NAME");
  assert.equal(fixtureShapeReason({ ...base, kickoffPrecision: "date" }), "KICKOFF_PRECISION_NOT_TIME");
  assert.equal(fixtureShapeReason({ ...base, kickoff: "2026-09-20T12:00:00" }), "INVALID_KICKOFF_FORMAT");
  assert.equal(fixtureShapeReason({ ...base, kickoff: "2026-02-30T12:00:00Z" }), "INVALID_KICKOFF_DATE");
  assert.equal(fixtureShapeReason({ ...base, dataConflict: true }), "DATA_CONFLICT");
});

test("ESPN ISO kickoff timestamps are trusted for scheduled fixtures without results", () => {
  const base = fixture();
  const espn = { ...base, provider: "espn", providerFixtureId: "espn-401880798", providerFixtureIds: { espn: "espn-401880798" }, sources: ["espn"] };
  assert.equal(windowReason(espn, NOW), null);
  assert.equal(windowReason({ ...espn, dataConflict: true }, NOW), "INVALID_FIXTURE");
});

test("Unknown precision, conflicting and OpenFootball-only kickoff are rejected", () => {
  for (const changes of [{ kickoffPrecision: "date" }, { dataConflict: true }, { status: "LIVE" }, { result: { homeGoals: 0 } }]) assert.equal(windowReason({ ...fixture(), ...changes }, NOW), "INVALID_FIXTURE");
  assert.equal(windowReason({ ...fixture(), sources: ["openfootball"] }, NOW), "UNVERIFIED_KICKOFF_SOURCE");
});
test("Window is rechecked after slow analysis before any ledger write", async t => {
  let s; s = setup(t, { beforePublish: () => s.time(NOW + 100 * 60000) }); const r = await s.capture.run();
  assert.equal(r.skippedOutsideWindow, 1); assert.equal(r.capturedPredictions, 0); assert.equal(s.ledger.entries().length, 0);
});
test("Insufficient production data produces skips, not predictions", async t => {
  const s = setup(t, { ineligible: true }); const r = await s.capture.run();
  assert.equal(r.skippedInsufficientData, 1); assert.equal(r.eligibleFixtures, 0); assert.equal(s.ledger.entries().length, 0);
});
test("Provider failure cannot invent fallback data and errors are safe", async t => {
  const s = setup(t, { error: Object.assign(Error("private credential diagnostic"), { category: "quota" }) }); const r = await s.capture.run();
  assert.equal(r.errors, 1); assert.equal(s.ledger.entries().length, 0); assert.equal(r.fixtures[0].reason, "quota"); assert.ok(!JSON.stringify(s.capture.status()).includes("private credential"));
});
test("Stale or unavailable discovery never becomes capture input", async t => {
  const s = setup(t, { discover: async () => ({ fixtures: [fixture()], stale: true }) }); const r = await s.capture.run();
  assert.ok(r.errors > 0); assert.equal(s.calls(), 0); assert.equal(s.ledger.entries().length, 0);
});
test("Dry-run performs eligibility and pairing but leaves ledger bytes unchanged", async t => {
  const s = setup(t); const first = await s.capture.run({ dryRun: true });
  assert.equal(first.wouldCapturePredictions, 2); assert.equal(first.completePairs, 1); assert.equal(first.capturedPredictions, 0); assert.equal(s.ledger.entries().length, 0);
  await s.capture.run(); const before = s.ledger.events(); await s.capture.run({ dryRun: true }); assert.deepEqual(s.ledger.events(), before);
});
test("Model 4.0 failure preserves valid 4.1-only snapshot", async t => {
  const s = setup(t, { versions: [MODELS[1]] }); const r = await s.capture.run(); assert.equal(r.model41Only, 1); assert.equal(r.completePairs, 0); assert.equal(r.capturedPredictions, 1); assert.equal(s.ledger.entries()[0].usedModel, MODELS[1]);
});
test("Model 4.1 failure preserves 4.0 fallback snapshot", async t => {
  const s = setup(t, { versions: [MODELS[0]] }); const r = await s.capture.run(); assert.equal(r.model40Only, 1); assert.equal(r.completePairs, 0); assert.equal(r.capturedPredictions, 1); assert.equal(s.ledger.entries()[0].fallbackUsed, true);
  const second = await s.capture.run(); assert.equal(second.duplicates, 1); assert.equal(s.ledger.entries().length, 1);
});
test("In-process and independent service overlap are both refused", async t => {
  let release; const block = new Promise(resolve => { release = resolve; });
  const s = setup(t, { discover: async () => { await block; return { fixtures: [fixture()] }; } });
  const first = s.capture.run(); assert.equal((await s.capture.run()).reason, "ALREADY_RUNNING");
  assert.equal((await new ForwardCapture(s.args).run()).reason, "ALREADY_RUNNING");
  release(); await first; assert.equal(s.ledger.entries().length, 2);
});
test("Scheduler catches run rejection and stays alive without overlap", async t => {
  const s = setup(t); let calls = 0; s.capture.run = async () => { calls++; throw Error("private scheduler failure"); };
  s.capture.startScheduler(); s.capture.startScheduler();
  await new Promise(resolve => setTimeout(resolve, 45)); s.capture.stopScheduler();
  assert.ok(calls > 0); assert.equal(s.capture.state.lastError, "SCHEDULER_ERROR"); assert.equal(s.capture.status().schedulerActive, false);
});
test("Scheduler catches up immediately after cold start when no recent run exists", async t => {
  const s = setup(t, { config: { intervalMs: 60_000 } });
  let calls = 0;
  s.capture.run = async () => { calls++; return { capturedPredictions: 0 }; };
  s.capture.startScheduler();
  assert.equal(calls, 1);
  assert.equal(s.capture.status().schedulerActive, true);
  s.capture.stopScheduler();
});

test("A recent attempt does not mask an old or missing successful run", async t => {
  const s = setup(t);
  fs.mkdirSync(s.args.config.directory, { recursive: true });
  fs.writeFileSync(path.join(s.args.config.directory, "status.json"), JSON.stringify({
    lastRunAt: new Date(NOW).toISOString(),
    lastSuccessfulRunAt: "2026-09-17T00:00:00.000Z",
    lastAttempts: {},
  }));
  const status = s.capture.status();
  assert.equal(status.captureHealth, "stale");
  assert.ok(status.lastRunAgeMs < s.args.config.intervalMs);
  assert.ok(status.lastSuccessfulRunAgeMs > s.args.config.intervalMs * 2);
});

test("Capture status explicitly marks missing and stale runs", async t => {
  const s = setup(t);
  assert.equal(s.capture.status().captureHealth, "never_succeeded");
  fs.mkdirSync(s.args.config.directory, { recursive: true });
  fs.writeFileSync(path.join(s.args.config.directory, "status.json"), JSON.stringify({ lastRunAt: "2026-09-17T00:00:00.000Z", lastSuccessfulRunAt: "2026-09-17T00:00:00.000Z", lastAttempts: {} }));
  assert.equal(s.capture.status().captureHealth, "stale");
  assert.ok(s.capture.status().lastRunAgeMs > s.args.config.intervalMs * 2);
});

test("Per-run quota defers work and subsequent runs rotate past insufficient fixtures", async t => {
  const s = setup(t, { fixtures: [fixture("a"), fixture("b")], ineligible: true, config: { maxAnalysesPerRun: 1 } });
  const first = await s.capture.run(); assert.equal(first.deferredFixtures, 1);
  const second = await s.capture.run(); assert.equal(second.fixtures.find(f => f.reason === "INSUFFICIENT_PRODUCTION_DATA").fixtureId, "b");
});
test("Capture metadata does not expose internal attempt map", async t => {
  const s = setup(t); await s.capture.run(); const status = s.capture.status(); assert.equal(status.recordedPredictions, 2); assert.equal(status.recordedFixtures, 1); assert.equal(status.lastAttempts, undefined); assert.equal(status.isRunning, false);
});

test("Unknown history coverage uses only a bounded rotating probe budget", async t => {
  const s = setup(t, { fixtures: [fixture("a"), fixture("b"), fixture("c")], ineligible: true });
  const first = await s.capture.run();
  assert.equal(first.analysedFixtures, 2); assert.equal(s.calls(), 2);
  assert.equal(first.fixtures.find(f => f.fixtureId === "c").reason, "HISTORY_COVERAGE_PROBE_LIMIT");
  const second = await s.capture.run();
  assert.equal(second.fixtures.find(f => f.reason === "INSUFFICIENT_PRODUCTION_DATA").fixtureId, "c");
});

test("Declared historical coverage precedes unsupported fixtures on subsequent runs", async t => {
  const s = setup(t, { fixtures: [fixture("unsupported", 60), fixture("covered", 240)], ineligible: true, config: { maxAnalysesPerRun: 1 } });
  s.capture.historicalCoverage = f => f.providerFixtureId === "covered";
  const first = await s.capture.run(); assert.equal(first.fixtures.find(f => f.reason === "INSUFFICIENT_PRODUCTION_DATA").fixtureId, "covered");
  const second = await s.capture.run(); assert.equal(second.fixtures.find(f => f.reason === "INSUFFICIENT_PRODUCTION_DATA").fixtureId, "covered");
  assert.equal(second.analysedFixtures, 1);
});

test("Publication-time window guard prevents writes if clock crosses 30m after preview", async t => {
  const s = setup(t); const original = s.ledger.recordResponse.bind(s.ledger);
  s.ledger.recordResponse = (...args) => { s.time(NOW + 91 * 60000); return original(...args); };
  const result = await s.capture.run(); assert.equal(result.skippedOutsideWindow, 1); assert.equal(s.ledger.entries().length, 0);
});

test("Restart recovers a dead owner lock but never removes a live or malformed lock", async t => {
  const s = setup(t); const dir = s.args.config.directory; fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, "run.lock"); fs.writeFileSync(lock, JSON.stringify({ pid: 2147483647 }));
  const result = await s.capture.run(); assert.equal(result.capturedPredictions, 2);
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid })); assert.equal((await s.capture.run()).reason, "ALREADY_RUNNING");
  fs.writeFileSync(lock, "{"); assert.equal((await s.capture.run()).reason, "ALREADY_RUNNING");
});
