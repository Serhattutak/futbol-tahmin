const test = require("node:test");
const assert = require("node:assert/strict");

test("ZEUS AI explains missing data without inventing a prediction", async () => {
  const { buildZeusInsight } = await import("../../src/zeusInsight.js");
  const result = buildZeusInsight({ predictionEligible: false });
  assert.match(result.headline, /veri bekleniyor/i);
  assert.match(result.availability, /doğrulanmış bir kaynaktan alınamadı/i);
});

test("ZEUS AI derives form and goal commentary only from supplied values", async () => {
  const { buildZeusInsight } = await import("../../src/zeusInsight.js");
  const result = buildZeusInsight({
    predictionEligible: true,
    fixture: { home: { name: "Home FC" }, away: { name: "Away FC" } },
    homeForm5: { pointsPerGame: 2.2 },
    awayForm5: { pointsPerGame: 1.1 },
    expectedGoals: { home: 1.65, away: 0.95 },
    h2h: { count: 4, homeWins: 2, awayWins: 1 },
    dataQuality: { score: 80 },
    dataAvailability: { injuries: false, lineups: false },
    sourceAgreement: { status: "unavailable" }
  });
  assert.match(result.headline, /Home FC – Away FC/);
  assert.ok(result.signals.some(s => /Home FC.*puan ortalamasında önde/.test(s)));
  assert.ok(result.signals.some(s => /1.65.*0.95/.test(s)));
  assert.match(result.availability, /Sakatlık: doğrulanmış veri yok/);
  assert.doesNotMatch(result.summary, /oyuncu sakat/i);
});
