const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PredictionLedger, MODELS } = require("../services/predictionLedger");
const { report, mountLedgerRoutes } = require("../services/forwardPerformance");
const BEFORE = Date.parse("2026-09-20T10:00:00Z");
const AFTER = Date.parse("2026-09-20T15:00:00Z");
// Synthetic fixtures are confined to isolated temporary test directories.
function input(id = "test-1") {
  const probabilities = { home: .6, draw: .25, away: .15, over15: .8, over25: .6, over35: .3, bttsYes: .7 };
  const fixture = { id, date: "2026-09-20T12:00:00Z", league: "Test League", home: { name: "Test Home" }, away: { name: "Test Away" } };
  const models = Object.fromEntries(MODELS.map(m => [m, { eligible: true, fixture, modelVersion: m, probabilities: { ...probabilities }, model: { confidence: 75, rawProbabilities: m === MODELS[1] ? { home: .65, draw: .2, away: .15 } : undefined }, historicalSampleSize: { home: 10, away: 10 }, statisticsQuality: { score: 90 } }]));
  return { response: { models, requestedModelVersion: MODELS[1], model41Available: true, cache: { artifactVersion: "locked", statisticsVersion: "stats-v1", inputVersion: "input-1" } }, collected: { fixture: { kickoff: fixture.date, kickoffPrecision: "time", status: "SCHEDULED", providerFixtureIds: { provider: id } }, homeMatches: [], awayMatches: [], h2hMatches: [] } };
}
function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-test-"));
  t.after(() => { assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true }); });
  let now = BEFORE;
  return { directory, ledger: new PredictionLedger({ directory, now: () => now }), time: value => { now = value; } };
}
function save(ledger, value = input()) { return ledger.recordResponse(value.response, value.collected); }
function final(home = 2, away = 1, id = "test-1", provider = "provider") {
  return [{ provider, providerFixtureId: id, status: "FINISHED", result: { status: "FINISHED", homeGoals: home, awayGoals: away } }];
}
test("Ledger saves both models pre-match with null results and calibrated/raw metadata", t => {
  const { ledger } = setup(t); assert.ok(save(ledger).every(r => r.saved));
  const rows = ledger.entries(); assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.resultStatus === null && r.settledAt === null && r.minutesBeforeKickoff === 120));
  const advanced = rows.find(r => r.usedModel === MODELS[1]);
  assert.equal(advanced.homeProbability, .6); assert.equal(advanced.rawHomeProbability, .65); assert.equal(advanced.calibratedHomeProbability, .6);
  assert.equal(advanced.historicalSampleHome, 10); assert.equal(advanced.statisticsQuality.score, 90);
});
test("Ledger rejects at and after kickoff, including timezone equivalents", t => {
  const { ledger, time } = setup(t); const value = input(); value.collected.fixture.kickoff = "2026-09-20T15:00:00+03:00";
  for (const instant of [Date.parse("2026-09-20T12:00:00Z"), AFTER]) { time(instant); assert.ok(save(ledger, value).every(r => r.reason === "KICKOFF_REACHED")); }
  assert.equal(ledger.entries().length, 0);
});
test("Ledger rejects ambiguous kickoff, live/finished status and future history", t => {
  const { ledger } = setup(t);
  for (const kickoff of ["2026-09-20", "2026-09-20T12:00:00", "invalid"]) { const v = input(); v.collected.fixture.kickoff = kickoff; assert.equal(save(ledger, v)[0].reason, "UNKNOWN_KICKOFF"); }
  for (const status of ["LIVE", "FINISHED", "POSTPONED", "CANCELLED"]) { const v = input(); v.collected.fixture.status = status; assert.equal(save(ledger, v)[0].reason, "NOT_PRE_MATCH"); }
  const v = input(); v.collected.homeMatches = [{ fixture: { date: "2026-09-20T11:00:00Z" } }];
  assert.equal(save(ledger, v)[0].reason, "HISTORY_AFTER_PREDICTION");
});
test("Ledger deduplicates repeats and persists across instances", t => {
  const { ledger, directory } = setup(t); save(ledger);
  for (let i = 0; i < 20; i++) assert.ok(save(ledger).every(r => r.reason === "DUPLICATE"));
  const reopened = new PredictionLedger({ directory, now: () => BEFORE });
  assert.ok(save(reopened).every(r => r.reason === "DUPLICATE")); assert.equal(reopened.entries().length, 2);
});

test("Concurrent independent writers publish exactly one snapshot per key", async t => {
  const { directory, ledger } = setup(t);
  const { Worker } = require("node:worker_threads");
  const workers = Array.from({ length: 4 }, () => new Worker(`
    const { workerData } = require('node:worker_threads');
    const { PredictionLedger } = require(workerData.module);
    const ledger = new PredictionLedger({ directory: workerData.directory, now: () => workerData.now });
    ledger.recordResponse(workerData.input.response, workerData.input.collected);
  `, { eval: true, workerData: { directory, now: BEFORE, input: input(), module: require.resolve("../services/predictionLedger") } }));
  await Promise.all(workers.map(worker => new Promise((resolve, reject) => { worker.once("error", reject); worker.once("exit", code => code ? reject(Error(`worker exit ${code}`)) : resolve()); })));
  assert.equal(ledger.entries().length, 2); assert.equal(fs.readdirSync(directory).length, 2);
});
test("Changed inputs/artifacts create separate snapshots; 4.0 ignores 4.1 artifact changes", t => {
  const { ledger } = setup(t); save(ledger); const value = input();
  value.response.cache.artifactVersion = "new-artifact"; save(ledger, value); assert.equal(ledger.entries().length, 3);
  value.response.cache.inputVersion = "new-input"; save(ledger, value); assert.equal(ledger.entries().length, 5);
});
test("Prediction bytes remain immutable after caller mutation and settlement", t => {
  const { ledger, directory, time } = setup(t); const v = input(); save(ledger, v);
  const files = fs.readdirSync(directory); const bytes = files.map(f => fs.readFileSync(path.join(directory, f), "utf8"));
  v.response.models[MODELS[0]].probabilities.home = .99;
  time(AFTER); for (const r of ledger.entries()) ledger.settle(r.ledgerId, final());
  assert.deepEqual(files.map(f => fs.readFileSync(path.join(directory, f), "utf8")), bytes);
  assert.equal(ledger.entries()[0].homeProbability, .6);
});
test("Settlement evaluates 1X2, total goals, BTTS, Brier and log loss exactly", t => {
  const { ledger, time } = setup(t); save(ledger); time(AFTER); const id = ledger.entries()[0].ledgerId;
  ledger.settle(id, final()); const r = ledger.entries().find(r => r.ledgerId === id);
  assert.equal(r.actual1X2, "home"); assert.equal(r.predictionCorrect1X2, true);
  assert.ok(Math.abs(r.brier1X2 - (.4 ** 2 + .25 ** 2 + .15 ** 2)) < 1e-12);
  assert.equal(r.logLoss1X2, -Math.log(.6));
  assert.equal(r.actualOver15, true); assert.equal(r.actualOver25, true); assert.equal(r.actualOver35, false); assert.equal(r.actualBTTS, true);
  for (const k of ["Over15", "Over25", "Over35", "BTTS"]) assert.equal(r[`predictionCorrect${k}`], true);
  assert.ok(Math.abs(r.brierBTTS - .09) < 1e-12);
});
test("0-0 settlement yields draw, all unders, and BTTS no", t => {
  const { ledger, time } = setup(t); save(ledger); time(AFTER); const id = ledger.entries()[0].ledgerId; ledger.settle(id, final(0, 0));
  const r = ledger.entries().find(r => r.ledgerId === id); assert.equal(r.actual1X2, "draw");
  for (const k of ["actualOver15", "actualOver25", "actualOver35", "actualBTTS"]) assert.equal(r[k], false);
});
test("Zero probability log loss is finite", t => {
  const { ledger, time } = setup(t); const v = input(); v.response.models[MODELS[0]].probabilities = { ...v.response.models[MODELS[0]].probabilities, home: 0, draw: 1, away: 0 };
  save(ledger, v); time(AFTER); const id = ledger.entries().find(r => r.usedModel === MODELS[0]).ledgerId; ledger.settle(id, final());
  assert.equal(ledger.entries().find(r => r.ledgerId === id).logLoss1X2, -Math.log(1e-15));
});
test("Settlement is idempotent; changed result appends conflict without overwriting score", t => {
  const { ledger, time } = setup(t); save(ledger); time(AFTER); const id = ledger.entries()[0].ledgerId;
  assert.equal(ledger.settle(id, final()).saved, true); const count = ledger.events().length;
  assert.equal(ledger.settle(id, final()).reason, "ALREADY_SETTLED"); assert.equal(ledger.events().length, count);
  assert.equal(ledger.settle(id, final(0, 3)).reason, "RESULT_CONFLICT"); ledger.settle(id, final(0, 3));
  const r = ledger.entries().find(r => r.ledgerId === id); assert.equal(r.actualHomeGoals, 2); assert.equal(r.conflicts.length, 1);
  assert.equal(report(ledger.entries()).models[r.usedModel].sampleSize, 0);
});
test("Settlement refuses nonfinal, mismatched, invalid and pre-kickoff results", t => {
  const { ledger, time } = setup(t); save(ledger); const id = ledger.entries()[0].ledgerId;
  assert.equal(ledger.settle(id, final()).reason, "NOT_STARTED"); time(AFTER);
  for (const fixtures of [final(2, 1, "wrong"), final(-1, 0), final(1.2, 0), [{ ...final()[0], status: "LIVE" }], [{ ...final()[0], provider: "unknown", providerFixtureId: undefined }]]) assert.equal(ledger.settle(id, fixtures).reason, "NO_FINAL_RESULT");
});
test("Disagreeing providers create a conflict before any score is accepted", t => {
  const { ledger, time } = setup(t); const v = input(); v.collected.fixture.providerFixtureIds.second = "test-1"; save(ledger, v); time(AFTER);
  const id = ledger.entries()[0].ledgerId; assert.equal(ledger.settle(id, [...final(), ...final(0, 0, "test-1", "second")]).reason, "RESULT_CONFLICT");
  assert.equal(ledger.entries().find(r => r.ledgerId === id).resultStatus, null);
});
test("Invalid probabilities/metadata and ineligible predictions do not enter storage", t => {
  const { ledger } = setup(t);
  for (const bad of [null, NaN, Infinity, -.1, 1.1, undefined]) { const v = input(); for (const m of MODELS) v.response.models[m].probabilities.home = bad; assert.ok(save(ledger, v).every(r => r.reason === "INVALID_PROBABILITIES")); }
  const v = input(); v.response.cache.inputVersion = null; assert.equal(save(ledger, v)[0].reason, "MISSING_METADATA");
  const noBet = input(); for (const m of MODELS) noBet.response.models[m].eligible = false; assert.ok(save(ledger, noBet).every(r => r.reason === "INELIGIBLE"));
  assert.equal(ledger.entries().length, 0);
});
test("Fallback keeps requested 4.1 and actual 4.0 with reason", t => {
  const { ledger } = setup(t); const v = input(); v.response.models[MODELS[1]] = null; v.response.model41Available = false; v.response.model41FallbackReason = "ARTIFACT_UNAVAILABLE";
  save(ledger, v); const r = ledger.entries()[0]; assert.equal(r.requestedModel, MODELS[1]); assert.equal(r.usedModel, MODELS[0]); assert.equal(r.fallbackUsed, true); assert.equal(r.fallbackReason, "ARTIFACT_UNAVAILABLE");
});
test("Forward counts snapshots but scores only settled earliest fixture/model records", t => {
  const { ledger, time } = setup(t); save(ledger); save(ledger, input("pending")); const newer = input(); newer.response.cache.inputVersion = "revision"; time(BEFORE + 60000); save(ledger, newer); time(AFTER);
  for (const r of ledger.entries().filter(r => r.fixtureId === "test-1")) ledger.settle(r.ledgerId, final());
  const data = report(ledger.entries()); for (const m of MODELS) { assert.equal(data.models[m].totalPredictions, 3); assert.equal(data.models[m].settledPredictions, 2); assert.equal(data.models[m].pendingPredictions, 1); assert.equal(data.models[m].sampleSize, 1); assert.equal(data.models[m].leagues["Test League"].sampleSize, 1); }
  assert.equal(data.comparison.sampleSize, 1);
});
test("Paired comparison excludes unmatched inputs, unsettled and conflicting fixtures", t => {
  const { ledger, time } = setup(t); const v = input(); v.response.models[MODELS[1]] = null; save(ledger, v);
  const other = input(); other.response.models[MODELS[0]] = null; other.response.cache.inputVersion = "different"; save(ledger, other); save(ledger, input("pending")); time(AFTER);
  for (const r of ledger.entries().filter(r => r.fixtureId === "test-1")) ledger.settle(r.ledgerId, final());
  assert.equal(report(ledger.entries()).comparison.sampleSize, 0);
});

test("A single settled side cannot enter paired metrics and revisions cannot hide conflicts", t => {
  const { ledger, time } = setup(t); save(ledger); const newer = input(); newer.response.cache.inputVersion = "revision"; time(BEFORE + 1000); save(ledger, newer); time(AFTER);
  const rows = ledger.entries(); const first = rows.find(r => r.usedModel === MODELS[0]); ledger.settle(first.ledgerId, final());
  assert.equal(report(ledger.entries()).comparison.sampleSize, 0);
  for (const row of rows) ledger.settle(row.ledgerId, final());
  assert.equal(report(ledger.entries()).comparison.sampleSize, 1);
  ledger.settle(first.ledgerId, final(1, 1));
  const data = report(ledger.entries()); assert.equal(data.comparison.sampleSize, 0); assert.equal(data.models[MODELS[0]].sampleSize, 0);
});
test("Empty forward performance exposes null metrics, not invented results", () => {
  const data = report([]); assert.equal(data.comparison.sampleSize, 0); assert.equal(data.models[MODELS[0]]["1X2"].accuracy, null); assert.equal(data.models[MODELS[1]].smallSample, true);
});
test("Atomic publication failure leaves existing JSON intact and no partial event", t => {
  const { ledger, directory } = setup(t); save(ledger); const before = ledger.events();
  const io = Object.create(fs); io.linkSync = () => { throw Error("simulated disk error"); };
  const broken = new PredictionLedger({ directory, now: () => BEFORE, io });
  assert.throws(() => save(broken, input("new")), /simulated disk/);
  assert.deepEqual(ledger.events(), before); assert.ok(fs.readdirSync(directory).every(f => f.endsWith(".json")));
});
test("Partial temporary files are ignored; malformed committed JSON fails closed", t => {
  const { ledger, directory } = setup(t); save(ledger); fs.writeFileSync(path.join(directory, "interrupted.tmp"), "{"); assert.equal(ledger.entries().length, 2);
  fs.writeFileSync(path.join(directory, "broken.json"), "{"); assert.throws(() => ledger.entries());
});
test("Provider settlement coalesces requests, rechecks settled scores and retains failures", async t => {
  const { ledger, time } = setup(t); save(ledger); time(AFTER); let calls = 0;
  const fetchResults = async () => { calls++; return final(); };
  await Promise.all([ledger.settleFromProviders(fetchResults), ledger.settleFromProviders(fetchResults)]); assert.equal(calls, 1); assert.ok(ledger.entries().every(r => r.resultStatus === "settled"));
  await ledger.settleFromProviders(async () => final(0, 0)); assert.ok(ledger.entries().every(r => r.conflicts.length === 1));
  const results = await ledger.settleFromProviders(async () => { throw Object.assign(Error("quota"), { category: "quota" }); }); assert.equal(results[0].reason, "quota");
});
test("Read-only ledger API exposes paginated entries, counts and forward reports", async t => {
  const { ledger, time } = setup(t); save(ledger); time(AFTER); ledger.settle(ledger.entries()[0].ledgerId, final());
  const app = require("express")(); mountLedgerRoutes(app, ledger); const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/ledger`;
  for (const endpoint of ["status", "entries", "pending", "settled", "performance", "comparison"]) { const res = await fetch(`${base}/${endpoint}`); assert.equal(res.status, 200); assert.equal((await res.json()).success, true); }
  const status = await (await fetch(base + "/status")).json(); assert.equal(status.pending, 1); assert.equal(status.settled, 1);
  const page = await (await fetch(base + "/entries?limit=1&offset=1")).json(); assert.equal(page.entries.length, 1); assert.equal(page.total, 2);
  assert.equal((await fetch(base + "/settle", { method: "POST" })).status, 404);
});
