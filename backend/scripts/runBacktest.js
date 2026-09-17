const fs = require("node:fs");
const path = require("node:path");
const { loadDataset, writeJson, REPORT_FILE, DIRECTORY } = require("../services/benchmarkDataset");
const { runChronologicalBenchmark, hash } = require("../services/chronologicalBenchmark");

async function main() {
  if (fs.existsSync(path.join(DIRECTORY, "baseline-lock.json"))) throw Error("Reference benchmark is locked; report.json and predictions.json cannot be overwritten.");
  const data = await loadDataset({ offline: process.argv.includes("--offline") });
  const report = runChronologicalBenchmark(data.fixtures);
  const { records, ...summary } = report;
  summary.sources = data.sources;
  summary.providerRequests = data.requests;
  summary.codeHash = hash(["server.js", "services/predictionModel.js", "services/teamStatistics.js", "services/historicalForm.js", "services/chronologicalBenchmark.js", "services/benchmarkMetrics.js"].map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")));
  writeJson(path.join(DIRECTORY, "predictions.json"), { datasetHash: report.datasetHash, pairedSampleHash: report.pairedSampleHash, records });
  writeJson(REPORT_FILE, summary);
  console.log(JSON.stringify({ file: REPORT_FILE, evaluated: report.evaluated, candidates: report.candidates, skipped: report.skipped, requests: data.requests, baseline: report.baseline.markets["1X2"], stats: report.stats.markets["1X2"] }, null, 2));
  if (report.evaluated < 500) { console.error("Real eligible sample below the 500-match target."); process.exitCode = 1; }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
