const test = require("node:test");
const assert = require("node:assert/strict");
const { loadHistoricalFixtures, marketSummary, LEAGUES, SEASONS } = require("../scripts/runRollingHistoricalBacktest");

test("rolling backtest covers a recent season plus prior-season history and a broad league set", () => {
  assert.ok(LEAGUES.includes("Süper Lig"));
  assert.ok(LEAGUES.length >= 15);
  assert.deepEqual(SEASONS, ["2024-25", "2025-26", "2026-27"]);
});

test("historical loader records source provenance and unavailable archives without inventing matches", async () => {
  const result = await loadHistoricalFixtures({
    leagues: ["League A", "League B"],
    seasons: ["2025-26"],
    loadSeason: async (league) => {
      if (league === "League A") return [{ fixture: { id: "a" }, provider: "openfootball" }];
      throw Object.assign(new Error("offline"), { code: "ENETUNREACH" });
    },
  });
  assert.equal(result.fixtures.length, 1);
  assert.equal(result.sources[0].provider, "openfootball");
  assert.equal(result.unavailable.length, 1);
  assert.equal(result.unavailable[0].reason, "ENETUNREACH");
});

test("market summary reports an explicit empty sample instead of fabricating accuracy", () => {
  assert.deepEqual(marketSummary({}, "stats"), {
    sampleSize: 0, correct: 0, incorrect: 0, accuracy: null, brier: null, logLoss: null,
  });
  assert.deepEqual(marketSummary({ stats: { markets: { "1X2": { sampleSize: 10, correct: 5, incorrect: 5, hitRate: 0.5, brier: 0.6, logLoss: 1.1 } } } }, "stats"), {
    sampleSize: 10, correct: 5, incorrect: 5, accuracy: 50, brier: 0.6, logLoss: 1.1,
  });
});
