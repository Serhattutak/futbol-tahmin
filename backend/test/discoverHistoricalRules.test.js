"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseArgs, loadJsonl } = require("../scripts/discoverHistoricalRules");

test("discovery CLI parses configurable paths and holdout settings", () => {
  const args = parseArgs(["--input", "./rows.jsonl", "--out", "./report.json", "--train-fraction", "0.65", "--min-train-samples", "20", "--min-holdout-samples", "15"]);
  assert.ok(args.input.endsWith("rows.jsonl"));
  assert.ok(args.output.endsWith("report.json"));
  assert.equal(args.trainFraction, 0.65);
  assert.equal(args.minTrainSamples, 20);
  assert.equal(args.minHoldoutSamples, 15);
});

test("JSONL loader rejects corrupt rows with a line number", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zeus-archive-test-"));
  const file = path.join(directory, "rows.jsonl");
  fs.writeFileSync(file, '{"date":"2025-01-01"}\nnot-json\n');
  assert.throws(() => loadJsonl(file), /line 2/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("discovery CLI rejects invalid thresholds and unknown arguments", () => {
  assert.throws(() => parseArgs(["--train-fraction", "1"]), /between 0 and 1/);
  assert.throws(() => parseArgs(["--min-train-samples", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["--bad"]), /Unknown argument/);
});
