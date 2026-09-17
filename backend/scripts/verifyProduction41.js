// Read-only verification of the production flow; never trains or changes artifacts.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { productionAnalysis, providerRegistry } = require("../server");
async function main() {
  const fixtureId = process.argv[2] || "1570384";
  const first = await productionAnalysis.analyze(fixtureId, { modelVersion: "MODEL_4_1" });
  assert.equal(first.modelVersion, "MODEL_4_1", first.model41FallbackReason);
  const before = { ...providerRegistry.historicalData.metrics };
  const collections = productionAnalysis.metrics.collections;
  const second = await productionAnalysis.analyze(fixtureId, { modelVersion: "MODEL_4_1" });
  assert.equal(productionAnalysis.metrics.collections, collections);
  assert.deepEqual(providerRegistry.historicalData.metrics, before);
  assert.equal(second.cache.inputHit, true);
  assert.equal(second.cache.model41Hit, true);
  assert.notDeepEqual(first.models.MODEL_4_0.probabilities, first.probabilities);
  assert.ok(Math.abs(first.probabilities.home + first.probabilities.draw + first.probabilities.away - 1) < 1e-10);
  const report = { fixture: first.fixture, models: Object.fromEntries(Object.entries(first.models).map(([key, value]) => [key, { probabilities: value.probabilities, rawProbabilities: value.model.rawProbabilities, confidence: value.model.confidence, statisticsQuality: value.statisticsQuality, historicalSampleSize: value.historicalSampleSize }])), secondCache: second.cache, historicalMetricsBefore: before, historicalMetricsAfter: providerRegistry.historicalData.metrics, productionMetrics: productionAnalysis.metrics };
  fs.writeFileSync(path.join(__dirname, "../../docs/model41-production-verification.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
