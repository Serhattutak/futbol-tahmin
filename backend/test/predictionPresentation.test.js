const assert = require("node:assert/strict");
const test = require("node:test");

test("Market heading follows the selected actual model, including 4.0 fallback", async () => {
  const { MODEL40, MODEL41, modelLabel, selectModelAnalysis } = await import("../../src/modelSelection.js");
  const response = { modelVersion: MODEL40, model41Available: true, models: {
    [MODEL40]: { modelVersion: MODEL40, probabilities: { home: 0.6264 } },
    [MODEL41]: { modelVersion: MODEL41, probabilities: { home: 0.5133 } },
  } };
  const original = structuredClone(response);
  assert.equal(modelLabel(selectModelAnalysis(response, MODEL40)), "ZEUS AI");
  assert.equal(modelLabel(selectModelAnalysis(response, MODEL41)), "ZEUS AI");
  assert.equal(modelLabel(selectModelAnalysis({ ...response, model41Available: false }, MODEL41)), "ZEUS AI");
  assert.equal(modelLabel({}), "ZEUS AI");
  assert.equal(selectModelAnalysis(response).modelVersion, MODEL40, "detail view stays aligned with the production list model");
  assert.equal(selectModelAnalysis(response, MODEL41).modelVersion, MODEL41, "internal model comparison remains available when explicitly requested");
  assert.equal(selectModelAnalysis({ ...response, model41Available: false }).modelVersion, MODEL40, "baseline safely handles unavailable advanced model");
  assert.deepEqual(response, original);
  const app = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../src/App.jsx"), "utf8");
  const marketSection = app.slice(app.indexOf("function ModelMarkets("), app.indexOf("const MARKET_SECTIONS"));
  assert.match(marketSection, /eyebrow=\{modelLabel\(analysis\)\}/);
});

test("match cards show only valid 1X2 probabilities that sum to 100%", async () => {
  const { oneXTwoSummary } = await import("../../src/predictionPresentation.js");
  assert.deepEqual(oneXTwoSummary({ homeWin: 48.2, draw: 27.4, awayWin: 24.4 }), { home: 48.2, draw: 27.4, away: 24.4 });
  assert.equal(oneXTwoSummary({ homeWin: 50, draw: 25, awayWin: 20 }), null);
  assert.equal(oneXTwoSummary({ homeWin: null, draw: 30, awayWin: 70 }), null);
});

test("frontend market sunumu oran, adil oran, implied probability ve value hesaplar", async () => {
  const { marketMetrics } = await import("../../src/predictionPresentation.js");
  assert.deepEqual(marketMetrics(50, 2.2), { fairOdds: 2, impliedProbability: 45.45, value: 10 });
  assert.deepEqual(marketMetrics(50, null), { fairOdds: 2, impliedProbability: null, value: null });
});

test("frontend filtreleri sadece analiz edilmis ve uygun marketleri kabul eder", async () => {
  const { matchesMarketFilter } = await import("../../src/predictionPresentation.js");
  const analysis = { markets: { "1": { bookmakerOffers: [] }, "Üst 2.5": { bookmakerOffers: [{ odd: 2 }], value: 5 } } };
  assert.equal(matchesMarketFilter(analysis, "1x2"), true);
  assert.equal(matchesMarketFilter(analysis, "goals"), true);
  assert.equal(matchesMarketFilter(analysis, "btts"), false);
  assert.equal(matchesMarketFilter(analysis, "value"), true);
});

test("frontend eksik veri nedenlerini guvenli etiketlerle gosterir", async () => {
  const { dataQualityReasons, dataQualityText } = await import("../../src/predictionPresentation.js");
  assert.deepEqual(dataQualityReasons({ missing: ["H2H", "Bookmaker odds", "API xG"] }), ["H2H verisi eksik", "Bookmaker odds verisi eksik", "xG verisi eksik"]);
  assert.equal(dataQualityText(35), "Yetersiz veri");
  // The frontend contract uses "İyi veri" at 60..74; the old assertion
  // copied the separate backend label. Preserve production presentation.
  assert.equal(dataQualityText(59), "Sınırlı veri");
  assert.equal(dataQualityText(60), "İyi veri");
  assert.equal(dataQualityText(74), "İyi veri");
  assert.equal(dataQualityText(75), "Güçlü veri");
  assert.equal(dataQualityText(80), "Güçlü veri");
});
