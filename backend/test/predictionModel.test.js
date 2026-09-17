const assert = require("node:assert/strict");
const test = require("node:test");
const { HOME_ADVANTAGE, MODEL_VERSION, buildReasons, calculateConfidence, poissonProbability, rankMarket, weightedStrength } = require("../services/predictionModel");

const matches = [{ fixture: { date: "2026-09-14" }, teams: { home: { id: 1 }, away: { id: 2 } }, goals: { home: 3, away: 0 } }, { fixture: { date: "2026-09-01" }, teams: { home: { id: 1 }, away: { id: 3 } }, goals: { home: 0, away: 2 } }];

test("poisson olasiligi ve model surumu gecerlidir", () => { assert.equal(MODEL_VERSION, "4.0"); assert.ok(poissonProbability(1.5, 2) > 0); assert.ok(poissonProbability(1.5, 2) < 1); });
test("recency weighting en yeni maca daha fazla etki verir", () => { const strength = weightedStrength(matches, 1); assert.ok(strength.averageGoalsFor > 1.5); assert.equal(strength.games, 2); });
test("home advantage pozitif ve ayri parametredir", () => assert.ok(HOME_ADVANTAGE > 1));
test("confidence veri kalitesi, orneklem ve ayrimla degisir", () => { const high = calculateConfidence({ dataQuality: 85, homeGames: 10, awayGames: 10, probabilities: [60, 25, 15], value: null }); const low = calculateConfidence({ dataQuality: 35, homeGames: 2, awayGames: 2, probabilities: [35, 34, 31], value: null }); assert.ok(high > low); });
test("ranking odds yokken cezalandirmaz, pozitif valueyi bonus sayar", () => { const withoutOdds = rankMarket({ probability: 60, confidence: 70, dataQuality: 80, value: null, hasOdds: false }); const withValue = rankMarket({ probability: 60, confidence: 70, dataQuality: 80, value: 10, hasOdds: true }); assert.ok(withValue > withoutOdds); });
test("aciklamalar sadece mevcut sinyallerden uretilir", () => { const reasons = buildReasons({ homeRecent: { pointsPerGame: 2.2, averageGoalsFor: 1.5 }, awayRecent: { pointsPerGame: 0.8, averageGoalsFor: 0.7 }, homeVenue: { pointsPerGame: 2.5 }, h2h: { count: 3, homeWins: 2, awayWins: 0 }, standings: { home: { rank: 2 }, away: { rank: 10 } }, dataQuality: { score: 80 }, hasXg: true }); assert.ok(reasons.length >= 5); });