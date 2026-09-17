const assert = require("node:assert/strict");
const test = require("node:test");
const { calculatePreMatchPrediction, runBacktest } = require("../services/backtest");

function fixture(date, homeId, awayId, home, away) { return { fixture: { date, status: { short: "FT" } }, teams: { home: { id: homeId }, away: { id: awayId } }, goals: { home, away } }; }
const history = [fixture("2026-01-01T12:00:00Z", 1, 2, 2, 0), fixture("2026-01-02T12:00:00Z", 3, 4, 1, 0), fixture("2026-01-03T12:00:00Z", 1, 3, 1, 1), fixture("2026-01-04T12:00:00Z", 2, 4, 0, 1)];

test("backtest 1X2 olasiliklarini yuz olarak 100e normalize eder", () => { const prediction = calculatePreMatchPrediction(history, fixture("2026-01-05T12:00:00Z", 1, 4, 0, 0)); assert.equal(prediction.probabilities["1"] + prediction.probabilities.X + prediction.probabilities["2"], 100); });

test("legacy backtest also excludes same-day known and unknown kickoffs", () => {
  const target = fixture("2026-01-05T20:00:00Z", 1, 4, 0, 0);
  assert.deepEqual(calculatePreMatchPrediction([...history, fixture("2026-01-05T12:00:00Z", 1, 4, 2, 0), fixture("2026-01-05", 1, 4, 1, 0)], target), calculatePreMatchPrediction(history, target));
});
test("backtest gelecek sonuclari girdi olarak kullanmaz", () => { const fixtureToPredict = fixture("2026-01-05T12:00:00Z", 1, 4, 0, 0); const baseline = calculatePreMatchPrediction(history, fixtureToPredict); const withFuture = calculatePreMatchPrediction([...history, fixture("2026-02-01T12:00:00Z", 1, 4, 9, 0)], fixtureToPredict); assert.deepEqual(baseline, withFuture); });
test("sonuc yok veya yetersiz gecmis kaydi performans olusturmaz", () => { const incomplete = { fixture: { date: "2026-01-01T12:00:00Z", status: { short: "NS" } }, teams: { home: { id: 1 }, away: { id: 2 } }, goals: { home: null, away: null } }; const report = runBacktest([incomplete, fixture("2026-01-02T12:00:00Z", 1, 2, 1, 0)]); assert.equal(report.fixturesSupplied, 1); assert.equal(report.fixturesEvaluated, 0); });
test("backtest odds uretmez ve eksik fixture verisini guvenle atlar", () => { const report = runBacktest([{}, ...history]); assert.equal(report.fixturesSupplied, history.length); assert.equal(Object.hasOwn(report, "odds"), false); });
