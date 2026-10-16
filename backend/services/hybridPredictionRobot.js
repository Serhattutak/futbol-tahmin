"use strict";

const VERSION = "HYBRID_SELECTIVE_1.0";
const TARGET_HIT_RATE = 0.75;
const MIN_EACH_MODEL_PROBABILITY = 0.72;
const MIN_COMBINED_PROBABILITY = 0.75;
const MAX_MODEL_DISAGREEMENT = 0.10;
const MIN_STATISTICS_QUALITY = 70;
const MIN_TEAM_SAMPLE = 5;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finiteProbability = value => Number.isFinite(value) && value >= 0 && value <= 1;

function marketCandidates(p) {
  const home = p.home; const draw = p.draw; const away = p.away;
  return [
    { market: "1", label: "Ev sahibi kazanır", probability: home },
    { market: "X", label: "Beraberlik", probability: draw },
    { market: "2", label: "Deplasman kazanır", probability: away },
    { market: "1X", label: "Ev sahibi kaybetmez (1X)", probability: home + draw },
    { market: "X2", label: "Deplasman kaybetmez (X2)", probability: draw + away },
    { market: "12", label: "Beraberlik olmaz (12)", probability: home + away },
    { market: "OVER_1_5", label: "1,5 gol üstü", probability: p.over15 },
    { market: "UNDER_1_5", label: "1,5 gol altı", probability: 1 - p.over15 },
    { market: "OVER_2_5", label: "2,5 gol üstü", probability: p.over25 },
    { market: "UNDER_2_5", label: "2,5 gol altı", probability: 1 - p.over25 },
    { market: "OVER_3_5", label: "3,5 gol üstü", probability: p.over35 },
    { market: "UNDER_3_5", label: "3,5 gol altı", probability: 1 - p.over35 },
    { market: "BTTS_YES", label: "Karşılıklı gol var", probability: p.bttsYes },
    { market: "BTTS_NO", label: "Karşılıklı gol yok", probability: 1 - p.bttsYes },
  ];
}

function noBet(reason, details = {}) {
  return {
    version: VERSION,
    status: "NO_BET",
    targetHitRate: TARGET_HIT_RATE,
    recommendation: null,
    reason,
    ...details,
  };
}

/**
 * Selective ensemble: average calibrated 4.0/4.1 probabilities, but recommend
 * only when both models independently clear the floor and agree closely.
 * The 75% value is a selection threshold, NOT a guarantee of realised accuracy.
 */
function buildHybridRecommendation(model40, model41, statisticsQuality, historicalSampleSize) {
  if (!model40 || !model41) return noBet("BOTH_MODELS_REQUIRED");
  const required = ["home", "draw", "away", "over15", "over25", "over35", "bttsYes"];
  if (required.some(key => !finiteProbability(model40[key]) || !finiteProbability(model41[key]))) {
    return noBet("INVALID_OR_MISSING_PROBABILITIES");
  }
  if (Math.abs(model40.home + model40.draw + model40.away - 1) > 1e-6
    || Math.abs(model41.home + model41.draw + model41.away - 1) > 1e-6) {
    return noBet("INVALID_1X2_SIMPLEX");
  }
  if (!Number.isFinite(statisticsQuality) || statisticsQuality < MIN_STATISTICS_QUALITY) {
    return noBet("LOW_STATISTICS_QUALITY", { statisticsQuality: statisticsQuality ?? null });
  }
  const homeN = historicalSampleSize?.home;
  const awayN = historicalSampleSize?.away;
  if (!Number.isFinite(homeN) || !Number.isFinite(awayN) || homeN < MIN_TEAM_SAMPLE || awayN < MIN_TEAM_SAMPLE) {
    return noBet("INSUFFICIENT_HISTORY", { historicalSampleSize: historicalSampleSize || null });
  }

  const combined = {};
  for (const key of required) combined[key] = clamp((model40[key] + model41[key]) / 2, 0, 1);
  const candidates40 = marketCandidates(model40);
  const candidates41 = new Map(marketCandidates(model41).map(item => [item.market, item]));
  const eligible = candidates40.map(item => {
    const other = candidates41.get(item.market);
    const p40 = item.probability; const p41 = other?.probability;
    if (!Number.isFinite(p40) || !Number.isFinite(p41)) return null;
    const average = (p40 + p41) / 2;
    const disagreement = Math.abs(p40 - p41);
    if (Math.min(p40, p41) < MIN_EACH_MODEL_PROBABILITY
      || average < MIN_COMBINED_PROBABILITY
      || disagreement > MAX_MODEL_DISAGREEMENT) return null;
    return { market: item.market, label: item.label, model40Probability: p40, model41Probability: p41,
      probability: average, conservativeProbability: Math.min(p40, p41), disagreement };
  }).filter(Boolean).sort((a, b) => b.conservativeProbability - a.conservativeProbability
    || a.disagreement - b.disagreement);

  if (!eligible.length) {
    return noBet("NO_MARKET_PASSES_CONSENSUS_GATES", {
      statisticsQuality,
      historicalSampleSize: { home: homeN, away: awayN },
      modelAgreementThreshold: MAX_MODEL_DISAGREEMENT,
      minimumEachModelProbability: MIN_EACH_MODEL_PROBABILITY,
      minimumCombinedProbability: MIN_COMBINED_PROBABILITY,
    });
  }
  return {
    version: VERSION,
    status: "RECOMMEND",
    targetHitRate: TARGET_HIT_RATE,
    recommendation: eligible[0],
    combinedProbabilities: combined,
    method: "equal-weight probability blend with dual-model consensus and abstention",
    statisticsQuality,
    historicalSampleSize: { home: homeN, away: awayN },
    note: "75% is a minimum probability gate, not a guaranteed historical hit rate. Verify realised hit rate on the locked test set before claiming the target is achieved.",
  };
}

module.exports = {
  VERSION, TARGET_HIT_RATE, MIN_EACH_MODEL_PROBABILITY, MIN_COMBINED_PROBABILITY,
  MAX_MODEL_DISAGREEMENT, MIN_STATISTICS_QUALITY, MIN_TEAM_SAMPLE,
  marketCandidates, buildHybridRecommendation,
};
