"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { discoverFeatureRules, wilson } = require("../services/featureDiscovery");

function makeRows(count = 200) {
  return Array.from({ length: count }, (_, i) => {
    const strong = i % 4 !== 0;
    const homeWin = strong ? i % 5 !== 0 : i % 5 === 0;
    return {
      date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString(),
      outcome: homeWin ? "H" : "A",
      homeGoals: homeWin ? 2 : 0,
      awayGoals: homeWin ? 0 : 1,
      features: { home_strength_flag: strong ? 1 : 0, league: i % 2 ? "A" : "B" }
    };
  });
}

test("Wilson interval is bounded and handles empty samples", () => {
  assert.deepEqual(wilson(0, 0), { low: null, high: null });
  const interval = wilson(8, 10);
  assert.ok(interval.low > 0 && interval.low < 0.8);
  assert.ok(interval.high > 0.8 && interval.high < 1);
});

test("feature discovery uses a chronological holdout and reports dataset provenance", () => {
  const report = discoverFeatureRules(makeRows(), { minTrainSamples: 10, minTestSamples: 10, minTrainLift: -1 });
  assert.equal(report.dataset.valid, 200);
  assert.equal(report.dataset.training, 140);
  assert.equal(report.dataset.holdout, 60);
  assert.equal(report.dataset.splitDate, makeRows()[140].date);
  assert.equal(report.methodology.split, "Chronological; earliest rows train, latest rows holdout");
  assert.ok(report.findings.every(row => Number.isFinite(row.training.rate)));
});

test("thresholds are derived from training data, not future holdout values", () => {
  const rows = makeRows(200).map((row, i) => i >= 140
    ? { ...row, features: { ...row.features, later_only_measure: 1000 + i } }
    : { ...row, features: { ...row.features, later_only_measure: i } });
  const report = discoverFeatureRules(rows, { featureKeys: ["later_only_measure"], minTrainSamples: 10, minTestSamples: 10, minTrainLift: -1 });
  const thresholds = report.findings.map(f => f.rule.value).filter(v => typeof v === "number");
  assert.ok(thresholds.length > 0);
  assert.ok(thresholds.every(value => value < 140));
});

test("invalid rows are excluded instead of silently counted", () => {
  const rows = [...makeRows(100), { date: "not-a-date", outcome: "H", homeGoals: 1, awayGoals: 0, features: { x: 1 } }];
  const report = discoverFeatureRules(rows, { minTrainSamples: 5, minTestSamples: 5, minTrainLift: -1 });
  assert.equal(report.dataset.supplied, 101);
  assert.equal(report.dataset.valid, 100);
});

test("inconsistent result labels are excluded to prevent mislabeled training rows", () => {
  const rows = [...makeRows(100), {
    date: "2026-01-01T12:00:00Z", outcome: "H", homeGoals: 0, awayGoals: 2, features: { x: 1 }
  }];
  const report = discoverFeatureRules(rows, { minTrainSamples: 5, minTestSamples: 5, minTrainLift: -1 });
  assert.equal(report.dataset.supplied, 101);
  assert.equal(report.dataset.valid, 100);
});

test("invalid configuration is rejected", () => {
  assert.throws(() => discoverFeatureRules({}, {}), /rows must be an array/);
  assert.throws(() => discoverFeatureRules([], { trainFraction: 1 }), /trainFraction/);
});
