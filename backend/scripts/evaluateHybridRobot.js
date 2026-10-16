"use strict";

// Read-only evaluation of the fixed hybrid gates on the already locked Model 4.1 TEST set.
// Does not fit weights, choose thresholds, write benchmark files, or contact paid providers.
const fs = require("node:fs");
const path = require("node:path");
const { loadDataset } = require("../services/benchmarkDataset");
const { replayInput } = require("../services/chronologicalBenchmark");
const { buildMatchStatistics } = require("../services/teamStatistics");
const { buildHybridRecommendation } = require("../services/hybridPredictionRobot");

const DATA = path.join(__dirname, "../data/backtest");
const testRows = JSON.parse(fs.readFileSync(path.join(DATA, "model41-test-predictions.json"), "utf8"));
const baseRecords = JSON.parse(fs.readFileSync(path.join(DATA, "predictions.json"), "utf8")).records;
const { splitOf } = require("../services/model41Experiment");

function actualMarket(market, goals) {
  const h = goals.home; const a = goals.away; const total = h + a;
  return ({
    "1": h > a, X: h === a, "2": a > h,
    "1X": h >= a, X2: a >= h, "12": h !== a,
    OVER_1_5: total > 1, UNDER_1_5: total < 2,
    OVER_2_5: total > 2, UNDER_2_5: total < 3,
    OVER_3_5: total > 3, UNDER_3_5: total < 4,
    BTTS_YES: h > 0 && a > 0, BTTS_NO: h === 0 || a === 0,
  })[market];
}
function topClass(p) {
  return ["home", "draw", "away"][ [p.home, p.draw, p.away].indexOf(Math.max(p.home, p.draw, p.away)) ];
}
function wilson(successes, n) {
  if (!n) return null;
  const z = 1.959963984540054; const p = successes / n; const d = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / d;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / d;
  return { lower95: center - margin, upper95: center + margin };
}
async function main() {
  const { fixtures, sources } = await loadDataset({ offline: true });
  const targets = new Map(fixtures.map(f => [String(f.fixture.id), f]));
  const baseById = new Map(baseRecords.map(r => [String(r.id), r]));
  const evaluated = testRows.filter(r => splitOf(r.date) === "test");
  let eligible = 0; let correct = 0; let noBet = 0; let missing = 0; let matched = 0;
  let baseCorrect = 0; let calibratedCorrect = 0;
  const markets = {}; const examples = [];
  for (const row of evaluated) {
    const target = targets.get(String(row.id)); const baseline = baseById.get(String(row.id));
    if (!target || !baseline) { missing++; continue; }
    matched++;
    const input = replayInput(fixtures, target);
    const profile = buildMatchStatistics(input.collected.fixture, { ...input.collected, now: input.now });
    const recommendation = buildHybridRecommendation(row.model40.probabilities, row.calibrated.probabilities,
      profile.dataQuality, { home: profile.home.sampleSize, away: profile.away.sampleSize });
    const actualWinner = row.goals.home > row.goals.away ? "home" : row.goals.home === row.goals.away ? "draw" : "away";
    if (topClass(row.model40.probabilities) === actualWinner) baseCorrect++;
    if (topClass(row.calibrated.probabilities) === actualWinner) calibratedCorrect++;
    if (recommendation.status !== "RECOMMEND") { noBet++; continue; }
    const pick = recommendation.recommendation;
    const hit = actualMarket(pick.market, row.goals);
    eligible++; if (hit) correct++;
    if (!markets[pick.market]) markets[pick.market] = { label: pick.label, selected: 0, correct: 0 };
    markets[pick.market].selected++; if (hit) markets[pick.market].correct++;
    if (examples.length < 12) examples.push({ id: row.id, date: row.date, league: row.league, market: pick.market,
      probability: Number(pick.probability.toFixed(4)), model40: Number(pick.model40Probability.toFixed(4)),
      model41: Number(pick.model41Probability.toFixed(4)), hit });
  }
  const result = {
    version: "HYBRID_SELECTIVE_1.0",
    evaluatedAt: new Date().toISOString(),
    data: { testFixtures: evaluated.length, matchedAndEvaluated: evaluated.length - missing, missing, sources },
    baseline1X2: { correct: baseCorrect, total: matched, hitRate: matched ? baseCorrect / matched : null },
    calibrated41_1X2: { correct: calibratedCorrect, total: matched, hitRate: matched ? calibratedCorrect / matched : null },
    hybridSelective: { targetHitRate: 0.75, selected: eligible, noBet, coverage: eligible / Math.max(1, evaluated.length),
      correct, incorrect: eligible - correct, hitRate: eligible ? correct / eligible : null, wilson95: wilson(correct, eligible),
      targetReached: eligible > 0 && correct / eligible >= 0.75 },
    markets: Object.fromEntries(Object.entries(markets).map(([key, value]) => [key, { ...value, hitRate: value.correct / value.selected }])),
    examples,
    limitations: [
      "The test set was held out from Model 4.1 fitting, but overlaps the earlier Model 4.0 historical period; it is not an external future season.",
      "A 75% probability gate is not a guarantee of 75% realised hit rate. This report measures realised selective hit rate and coverage.",
      "Thresholds are fixed before evaluation; do not retune them on this test set.",
      "Historical results come from the local public OpenFootball archive; independent source reconciliation is not claimed for every row.",
    ],
  };
  console.log(JSON.stringify(result, null, 2));
  if (!eligible) process.exitCode = 2;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
