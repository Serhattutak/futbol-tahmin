"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  VERSION, TARGET_HIT_RATE, buildHybridRecommendation,
} = require("../services/hybridPredictionRobot");

const strong40 = { home: 0.34, draw: 0.27, away: 0.39, over15: 0.88, over25: 0.62, over35: 0.38, bttsYes: 0.58 };
const strong41 = { home: 0.32, draw: 0.28, away: 0.40, over15: 0.84, over25: 0.60, over35: 0.36, bttsYes: 0.56 };
const quality = 92;
const samples = { home: 10, away: 10 };

test("hybrid robot recommends only when both models clear the 75% consensus gates", () => {
  const result = buildHybridRecommendation(strong40, strong41, quality, samples);
  assert.equal(result.version, VERSION);
  assert.equal(result.targetHitRate, TARGET_HIT_RATE);
  assert.equal(result.status, "RECOMMEND");
  assert.ok(result.recommendation.probability >= 0.75);
  assert.ok(result.recommendation.model40Probability >= 0.72);
  assert.ok(result.recommendation.model41Probability >= 0.72);
  assert.ok(result.recommendation.disagreement <= 0.10);
  assert.equal(result.recommendation.market, "OVER_1_5");
});

test("robot abstains if either model is unavailable", () => {
  assert.equal(buildHybridRecommendation(strong40, null, quality, samples).reason, "BOTH_MODELS_REQUIRED");
});

test("robot abstains on invalid 1X2 probabilities", () => {
  assert.equal(buildHybridRecommendation({ ...strong40, home: 0.9 }, strong41, quality, samples).reason, "INVALID_1X2_SIMPLEX");
});

test("robot abstains on low data quality or insufficient history", () => {
  assert.equal(buildHybridRecommendation(strong40, strong41, 69, samples).reason, "LOW_STATISTICS_QUALITY");
  assert.equal(buildHybridRecommendation(strong40, strong41, quality, { home: 4, away: 10 }).reason, "INSUFFICIENT_HISTORY");
});

test("robot abstains when model disagreement or probability is too large for the gates", () => {
  const disagree = { ...strong41, over15: 0.70 };
  assert.equal(buildHybridRecommendation(strong40, disagree, quality, samples).status, "NO_BET");
  const weak = { ...strong41, over15: 0.74 };
  assert.equal(buildHybridRecommendation(strong40, weak, quality, samples).status, "NO_BET");
});

test("robot does not call its threshold a measured or guaranteed hit rate", () => {
  const result = buildHybridRecommendation(strong40, strong41, quality, samples);
  assert.match(result.note, /not a guaranteed historical hit rate/i);
});
