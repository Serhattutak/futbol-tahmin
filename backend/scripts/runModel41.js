const fs = require("node:fs");
const path = require("node:path");
const { DIRECTORY, REPORT_FILE, loadDataset, writeJson } = require("../services/benchmarkDataset");
const E = require("../services/model41Experiment");
const file = name => path.join(DIRECTORY, name);
const read = name => JSON.parse(fs.readFileSync(file(name), "utf8"));

async function main() {
  const lockFile = file("baseline-lock.json");
  if (!fs.existsSync(lockFile)) writeJson(lockFile, { reportSha256: E.shaFile(REPORT_FILE), predictionsSha256: E.shaFile(file("predictions.json")), lockedAt: new Date().toISOString() });
  const reference = read("baseline-lock.json");
  if (reference.reportSha256 !== E.shaFile(REPORT_FILE) || reference.predictionsSha256 !== E.shaFile(file("predictions.json"))) throw Error("Reference benchmark changed");
  const records = read("predictions.json").records;
  const counts = Object.fromEntries(Object.keys(E.SPLITS).map(s => [s, records.filter(r => E.splitOf(r.date) === s).length]));
  const data = await loadDataset({ offline: true });
  if (process.argv.includes("--prepare")) {
    if (fs.existsSync(file("model41-artifact.json")) || fs.existsSync(file("model41-report.json"))) throw Error("Experiment already locked; use a new experiment for further optimization");
    const development = records.filter(r => ["train", "validation"].includes(E.splitOf(r.date)));
    // TEST labels/features never reach the optimizer. Only earlier fixtures
    // are available when constructing development histories.
    const historical = data.fixtures.filter(f => f.fixture.date.slice(0, 10) <= E.SPLITS.validation[1]);
    const rows = E.prepareRows(development, historical);
    writeJson(file("model41-development-rows.json"), rows);
    const trained = E.optimize(rows.filter(r => E.splitOf(r.date) === "train"), rows.filter(r => E.splitOf(r.date) === "validation"));
    trained.artifact.codeHash = E.codeHash(); trained.artifact.reference = reference;
    trained.artifact.lockedAt = new Date().toISOString();
    writeJson(file("model41-development.json"), { ...trained.development, splits: E.SPLITS, counts });
    writeJson(file("model41-artifact.json"), trained.artifact);
    console.log(JSON.stringify({ phase: "LOCKED_BEFORE_TEST", counts, goalChoice: trained.artifact.goalChoice, ridge: trained.artifact.classifier.ridge, baseScale: trained.artifact.classifier.baseScale, calibration: trained.development.calibration.choice, artifactSha256: E.shaFile(file("model41-artifact.json")) }, null, 2));
  } else if (process.argv.includes("--final")) {
    if (fs.existsSync(file("model41-report.json"))) throw Error("Final test already evaluated. Saved report is immutable; no retuning.");
    const artifact = read("model41-artifact.json");
    if (artifact.codeHash !== E.codeHash()) throw Error("Model code changed after lock; final test blocked");
    const rows = E.prepareRows(records.filter(r => E.splitOf(r.date) === "test"), data.fixtures);
    const result = E.evaluateTest(rows, artifact);
    const { records: predictions, ...finalTest } = result;
    writeJson(file("model41-test-predictions.json"), predictions);
    const diagnosis = Object.fromEntries(["home", "draw", "away"].map(key => {
      const deltas = records.map(r => Math.abs(r.stats.probabilities[key] - r.baseline.probabilities[key])).sort((a, b) => a - b);
      const middle = Math.floor(deltas.length / 2);
      return [key, { meanAbsoluteDelta: deltas.reduce((a, b) => a + b, 0) / deltas.length, medianAbsoluteDelta: deltas.length % 2 ? deltas[middle] : (deltas[middle - 1] + deltas[middle]) / 2, maxAbsoluteDelta: deltas.at(-1), changed: deltas.filter(v => v !== 0).length }];
    }));
    const predictedClass = p => [p.home, p.draw, p.away].indexOf(Math.max(p.home, p.draw, p.away));
    diagnosis.predictedClassChanges = records.filter(r => predictedClass(r.baseline.probabilities) !== predictedClass(r.stats.probabilities)).length;
    diagnosis.matches = records.length;
    writeJson(file("model41-report.json"), { generatedAt: new Date().toISOString(), reference, artifactSha256: E.shaFile(file("model41-artifact.json")), codeHash: artifact.codeHash, diagnosis, development: read("model41-development.json"), finalTest,
      limitations: ["This test period already appeared in the earlier Model 4.0 benchmark; it is held out from 4.1 optimization, not a never-observed external dataset.", "Single-season five-league result-only dataset; odds/xG/standings unavailable.", "Ablations are incremental on existing 4.0 signals, not causal feature importance.", "Validation selection uncertainty and repeated-team dependence remain; no test-based retuning."] });
    console.log(JSON.stringify({ phase: "FINAL_TEST_COMPLETE", count: result.count, models: Object.fromEntries(Object.entries(result.models).map(([k, v]) => [k, v.markets["1X2"]])), baselineUnchanged: E.shaFile(REPORT_FILE) === reference.reportSha256 }, null, 2));
  } else throw Error("Use --prepare or --final");
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
