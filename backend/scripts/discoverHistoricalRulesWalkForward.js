"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { discoverWalkForwardRules } = require("../services/walkForwardFeatureDiscovery");

function parseArgs(argv) {
  const args = {
    input: path.join(__dirname, "../data/historical-feature-archive/rows.jsonl"),
    output: path.join(__dirname, "../data/historical-feature-archive/walk-forward-feature-discovery-report.json"),
    trainFraction: 0.6,
    validationFraction: 0.2,
    minTrainSamples: 100,
    minValidationSamples: 50,
    minTestSamples: 100,
    minSeasonSamples: 100,
    alpha: 0.05
  };
  const numberArgs = {
    "--train-fraction": "trainFraction",
    "--validation-fraction": "validationFraction",
    "--min-train-samples": "minTrainSamples",
    "--min-validation-samples": "minValidationSamples",
    "--min-test-samples": "minTestSamples",
    "--min-season-samples": "minSeasonSamples",
    "--alpha": "alpha"
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i], value = argv[i + 1];
    if (key === "--input") { args.input = path.resolve(value); i++; }
    else if (key === "--out") { args.output = path.resolve(value); i++; }
    else if (numberArgs[key]) { args[numberArgs[key]] = Number(value); i++; }
    else if (key === "--help") args.help = true;
    else throw new Error("Unknown argument: " + key);
  }
  if (!(args.trainFraction > 0 && args.trainFraction < 1)) throw new RangeError("train-fraction must be between 0 and 1");
  if (!(args.validationFraction > 0 && args.validationFraction < 1) || args.trainFraction + args.validationFraction >= 1) {
    throw new RangeError("validation-fraction must be between 0 and 1 and train + validation must be less than 1");
  }
  if (!(args.alpha > 0 && args.alpha < 1)) throw new RangeError("alpha must be between 0 and 1");
  for (const key of ["minTrainSamples", "minValidationSamples", "minTestSamples", "minSeasonSamples"]) {
    if (!Number.isInteger(args[key]) || args[key] < 1) throw new RangeError(key + " must be a positive integer");
  }
  return args;
}

function loadJsonl(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error("Invalid JSONL at line " + (index + 1)); }
  });
}

function run({ input, output, trainFraction, validationFraction, minTrainSamples, minValidationSamples, minTestSamples, minSeasonSamples, alpha }) {
  const rows = loadJsonl(input);
  const report = discoverWalkForwardRules(rows, {
    trainFraction, validationFraction, minTrainSamples, minValidationSamples,
    minTestSamples, minSeasonSamples, alpha
  });
  report.inputFile = path.basename(input);
  report.outputFile = path.basename(output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = output + "." + process.pid + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2), "utf8");
  fs.renameSync(temporary, output);
  return { output, dataset: report.dataset, selection: report.selection, summary: report.summary };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: node scripts/discoverHistoricalRulesWalkForward.js [--input rows.jsonl] [--out report.json] [--train-fraction 0.6] [--validation-fraction 0.2] [--min-train-samples 100] [--min-validation-samples 50] [--min-test-samples 100] [--min-season-samples 100] [--alpha 0.05]");
    return;
  }
  console.log(JSON.stringify(run(args), null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
}

module.exports = { parseArgs, loadJsonl, run };
