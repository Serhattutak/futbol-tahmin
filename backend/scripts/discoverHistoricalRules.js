"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { discoverFeatureRules } = require("../services/featureDiscovery");

function parseArgs(argv) {
  const args = {
    input: path.join(__dirname, "../data/historical-feature-archive/rows.jsonl"),
    output: path.join(__dirname, "../data/historical-feature-archive/feature-discovery-report.json"),
    trainFraction: 0.7,
    minTrainSamples: 50,
    minHoldoutSamples: 30
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i], value = argv[i + 1];
    if (key === "--input") { args.input = path.resolve(value); i++; }
    else if (key === "--out") { args.output = path.resolve(value); i++; }
    else if (key === "--train-fraction") { args.trainFraction = Number(value); i++; }
    else if (key === "--min-train-samples") { args.minTrainSamples = Number(value); i++; }
    else if (key === "--min-holdout-samples") { args.minHoldoutSamples = Number(value); i++; }
    else if (key === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${key}`);
  }
  if (!(args.trainFraction > 0 && args.trainFraction < 1)) throw new RangeError("train-fraction must be between 0 and 1");
  for (const key of ["minTrainSamples", "minHoldoutSamples"]) {
    if (!Number.isInteger(args[key]) || args[key] < 1) throw new RangeError(`${key} must be a positive integer`);
  }
  return args;
}

function loadJsonl(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`Invalid JSONL at line ${index + 1}`); }
  });
}

function run({ input, output, trainFraction, minTrainSamples, minHoldoutSamples }) {
  const rows = loadJsonl(input);
  const report = discoverFeatureRules(rows, {
    trainFraction,
    minTrainSamples,
    minTestSamples: minHoldoutSamples
  });
  report.inputFile = path.basename(input);
  report.outputFile = path.basename(output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2), "utf8");
  fs.renameSync(temporary, output);
  return { output, dataset: report.dataset, summary: report.summary };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: node scripts/discoverHistoricalRules.js [--input rows.jsonl] [--out report.json] [--train-fraction 0.7] [--min-train-samples 50] [--min-holdout-samples 30]");
    return;
  }
  console.log(JSON.stringify(run(args), null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
}

module.exports = { parseArgs, loadJsonl, run };
