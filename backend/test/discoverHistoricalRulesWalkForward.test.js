"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs } = require("../scripts/discoverHistoricalRulesWalkForward");

test("walk-forward CLI parses three-period settings", () => {
  const args = parseArgs([
    "--input", "./rows.jsonl", "--out", "./report.json",
    "--train-fraction", "0.6", "--validation-fraction", "0.2",
    "--min-train-samples", "80", "--min-validation-samples", "40",
    "--min-test-samples", "60", "--min-season-samples", "30", "--alpha", "0.01"
  ]);
  assert.ok(args.input.endsWith("rows.jsonl"));
  assert.ok(args.output.endsWith("report.json"));
  assert.equal(args.trainFraction, 0.6);
  assert.equal(args.validationFraction, 0.2);
  assert.equal(args.minTrainSamples, 80);
  assert.equal(args.minValidationSamples, 40);
  assert.equal(args.minTestSamples, 60);
  assert.equal(args.minSeasonSamples, 30);
  assert.equal(args.alpha, 0.01);
});

test("walk-forward CLI rejects invalid periods and thresholds", () => {
  assert.throws(() => parseArgs(["--train-fraction", "0.8", "--validation-fraction", "0.3"]), /less than 1/);
  assert.throws(() => parseArgs(["--alpha", "1"]), /between 0 and 1/);
  assert.throws(() => parseArgs(["--min-test-samples", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["--unexpected"]), /Unknown argument/);
});
