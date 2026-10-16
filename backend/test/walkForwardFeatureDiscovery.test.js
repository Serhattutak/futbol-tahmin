"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { discoverWalkForwardRules, oneSidedDifferenceP, rate } = require("../services/walkForwardFeatureDiscovery");

function makeRows() {
  return Array.from({ length: 1800 }, (_, i) => {
    const seasonIndex = Math.floor(i / 300);
    const strong = i % 2 === 0;
    const event = strong ? i % 10 < 8 : i % 10 < 2;
    return {
      date: new Date(Date.UTC(2018, 0, 1 + i)).toISOString(),
      season: ["2018-19", "2019-20", "2020-21", "2021-22", "2022-23", "2023-24"][seasonIndex],
      outcome: event ? "H" : "A",
      homeGoals: event ? 2 : 0,
      awayGoals: event ? 0 : 1,
      features: { strength: strong ? 1 : 0 }
    };
  });
}

test("walk-forward split is chronological, disjoint, and calendar-day safe", () => {
  const report = discoverWalkForwardRules(makeRows(), {
    featureKeys: ["strength"], markets: ["home_win"],
    minTrainSamples: 20, minValidationSamples: 20, minTestSamples: 20, minSeasonSamples: 20,
    minTrainLift: 0.1
  });
  assert.equal(report.dataset.training + report.dataset.validation + report.dataset.test, report.dataset.valid);
  assert.ok(report.dataset.trainingLastDate < report.dataset.validationFirstDate);
  assert.ok(report.dataset.validationLastDate < report.dataset.testFirstDate);
  assert.equal(report.methodology.split.includes("untouched final test"), true);
});

test("thresholds and candidate directions are generated from training only", () => {
  const rows = makeRows().map((row, index) => index >= 1080
    ? { ...row, features: { strength: row.features.strength, futureOnly: 10000 + index } }
    : { ...row, features: { strength: row.features.strength, futureOnly: index } });
  const report = discoverWalkForwardRules(rows, {
    featureKeys: ["futureOnly"], markets: ["home_win"],
    minTrainSamples: 20, minValidationSamples: 20, minTestSamples: 20, minSeasonSamples: 20,
    minTrainLift: -1
  });
  assert.ok(report.findings.every(row => row.rule.feature === "futureOnly" && row.rule.value < 1080));
});

test("a training and validation signal must replicate on the final test and across seasons", () => {
  const report = discoverWalkForwardRules(makeRows(), {
    featureKeys: ["strength"], markets: ["home_win"],
    minTrainSamples: 20, minValidationSamples: 20, minTestSamples: 20, minSeasonSamples: 20,
    minTrainLift: 0.1
  });
  const replicated = report.findings.find(row => row.rule.feature === "strength" && row.rule.operator === ">");
  assert.ok(replicated);
  assert.equal(replicated.status, "REPLICATED_TEST");
  assert.ok(replicated.test.bonferroniAdjustedP <= 0.05);
  assert.ok(replicated.test.positiveSeasons >= 2);
  assert.ok(replicated.test.lift > 0);
});

test("Bonferroni adjustment uses the complete validation-selected test family", () => {
  const report = discoverWalkForwardRules(makeRows(), {
    featureKeys: ["strength"], markets: ["home_win", "away_win"],
    minTrainSamples: 20, minValidationSamples: 20, minTestSamples: 20, minSeasonSamples: 20,
    minTrainLift: -1
  });
  for (const finding of report.findings) {
    assert.equal(finding.test.familySize, report.selection.validationSelectedHypotheses);
    assert.ok(finding.test.bonferroniAdjustedP >= finding.test.pValue);
  }
});

test("one-sided test probability distinguishes positive from negative lift", () => {
  const rows = [
    ...Array.from({ length: 800 }, (_, i) => ({ outcome: i % 5 === 0 ? "A" : "H" })),
    ...Array.from({ length: 800 }, (_, i) => ({ outcome: i % 5 === 0 ? "H" : "A" }))
  ];
  const event = row => row.outcome === "H";
  const first = rate(rows.slice(0, 800), event);
  const second = rate(rows.slice(800), event);
  assert.ok(oneSidedDifferenceP(first, second) < 0.001);
  assert.ok(oneSidedDifferenceP(second, first) > 0.99);
});

test("invalid labels are excluded and invalid split settings rejected", () => {
  const rows = makeRows();
  rows.push({ date: "2025-01-01", outcome: "H", homeGoals: 0, awayGoals: 1, features: { strength: 1 } });
  const report = discoverWalkForwardRules(rows, {
    featureKeys: ["strength"], markets: ["home_win"],
    minTrainSamples: 20, minValidationSamples: 20, minTestSamples: 20, minSeasonSamples: 20,
    minTrainLift: 0.1
  });
  assert.equal(report.dataset.valid, 1800);
  assert.throws(() => discoverWalkForwardRules(rows, { trainFraction: 0.8, validationFraction: 0.3 }), /sum to less than 1/);
});
