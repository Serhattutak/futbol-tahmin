const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { forwardCapture, predictionLedger, productionAnalysis, app } = require("../server");
const docs = path.join(__dirname, "../../docs");
const hashes = () => Object.fromEntries(fs.readdirSync(predictionLedger.directory).sort().map(name => [name, crypto.createHash("sha256").update(fs.readFileSync(path.join(predictionLedger.directory, name))).digest("hex")]));
const save = (name, value) => fs.writeFileSync(path.join(docs, name), JSON.stringify(value, null, 2));
async function main() {
  const before = hashes();
  const dry = await forwardCapture.run({ dryRun: true });
  const after = hashes();
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  save("forward-capture-resumed-dry-run.json", { ...dry, ledgerUnchanged: unchanged });
  save("forward-capture-hash-proof.json", { before, after, unchanged });
  console.log(JSON.stringify({ stage: "dry-run", ...dry, fixtures: dry.fixtures.filter(f => f.records?.some(r => r.wouldSave)), discovery: undefined }));
  if (!unchanged || dry.errors || dry.skipped) throw Error("Dry-run not clean; production capture withheld");
  const production = await forwardCapture.run();
  save("forward-capture-production.json", production);
  const rows = predictionLedger.entries();
  const groups = new Map();
  for (const r of rows) { const key = [r.fixtureId, r.kickoffTime, r.inputFingerprint, r.statisticsVersion].join(":"); groups.set(key, [...(groups.get(key) || []), r]); }
  forwardCapture.startScheduler();
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  let status;
  try { status = await (await fetch(`http://127.0.0.1:${server.address().port}/api/capture/status`)).json(); }
  finally { server.close(); forwardCapture.stopScheduler(); }
  const totals = { predictions: rows.length, uniqueFixtures: new Set(rows.map(r => r.fixtureId)).size, completePairs: [...groups.values()].filter(g => g.some(r => r.usedModel === "MODEL_4_0") && g.some(r => r.usedModel === "MODEL_4_1")).length, pending: rows.filter(r => !r.resultStatus).length, settled: rows.filter(r => r.resultStatus).length, conflict: rows.filter(r => r.conflicts.length).length };
  save("forward-capture-verification.json", { totals, status, metrics: productionAnalysis.metrics, rows });
  console.log(JSON.stringify({ stage: "production", ...production, fixtures: production.fixtures.filter(f => f.records?.some(r => r.saved)), discovery: undefined, totals, metrics: productionAnalysis.metrics }));
  if (production.errors) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
