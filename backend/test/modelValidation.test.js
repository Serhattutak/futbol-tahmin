const assert = require("node:assert/strict");
const test = require("node:test");
const { assessPredictionEligibility, bayesianSmoothedRate, binaryMetrics, calibrationSummary, dixonColesTau, oddsValue, shouldNoBet, walkForwardSplit } = require("../services/modelValidation");
test("Dixon-Coles sadece dusuk skor hucrelerini duzeltir", () => { assert.notEqual(dixonColesTau(0, 0, 1.2, 0.8, -0.05), 1); assert.equal(dixonColesTau(2, 2, 1.2, 0.8, -0.05), 1); });
test("Bayesian smoothing kucuk orneklemi baseline'a yaklastirir", () => { assert.ok(bayesianSmoothedRate(3, 1, 1.2) < 3); assert.equal(bayesianSmoothedRate(0, -1, 1.2), null); });
test("walk-forward split zaman sirasini ve test izolasyonunu korur", () => { const split = walkForwardSplit([{ kickoff: "2026-03-01" }, { kickoff: "2026-01-01" }, { kickoff: "2026-02-01" }, { kickoff: "2026-04-01" }, { kickoff: "2026-05-01" }]); assert.ok(new Date(split.training.at(-1).kickoff) < new Date(split.validation[0].kickoff)); assert.ok(new Date(split.validation.at(-1).kickoff) < new Date(split.test[0].kickoff)); });
test("calibration ve binary metrikler no beti coverage disinda tutar", () => { const metrics = binaryMetrics([{ probability: .8, outcome: true }, { probability: .2, outcome: false }, { noBet: true }]); assert.equal(metrics.total, 2); assert.equal(metrics.noBet, 1); assert.equal(metrics.coverage, .6667); assert.notEqual(calibrationSummary([{ probability: .8, outcome: true }]).calibrationError, null); });
test("odds metrikleri ve value yalnizca gercek gecerli odds ile hesaplanir", () => { const value = oddsValue(.5, 2.2); assert.equal(value.fairOdds, 2); assert.equal(value.impliedProbability, 1 / 2.2); assert.ok(Math.abs(value.value - .1) < 1e-12); assert.equal(oddsValue(.5, null), null); });
test("no bet belirsizlik, dusuk kalite, conflict veya kalibrasyon sorunu ile tetiklenir", () => { assert.equal(shouldNoBet({ dataQuality: 80, sampleSize: 20, probabilities: [.55, .52], calibrated: true }), true); assert.equal(shouldNoBet({ dataQuality: 80, sampleSize: 20, probabilities: [.65, .25], calibrated: true }), false); assert.equal(shouldNoBet({ dataQuality: 80, sampleSize: 20, probabilities: [.65, .25], dataConflict: true }), true); });
test("eligibility fails closed when quality or history metadata is absent", () => {
  assert.deepEqual(assessPredictionEligibility({ probabilities: [.8, .1], calibrated: true }).reasons.sort(), ["INSUFFICIENT_HISTORY", "LOW_OR_UNKNOWN_DATA_QUALITY"]);
  assert.equal(shouldNoBet({ dataQuality: 80, sampleSize: 20, probabilities: [.7, .2] }), true);
});
test("critical data gaps and provider conflicts produce stable reasons", () => {
  const result = assessPredictionEligibility({ dataQuality: 90, sampleSize: 20, probabilities: [.7, .2], calibrated: true, providerConflict: true, staleData: true, unknownKickoff: true, requiredFieldsMissing: ["homeHistory"] });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["PROVIDER_CONFLICT", "STALE_CRITICAL_DATA", "UNKNOWN_KICKOFF", "MISSING_REQUIRED_FIELDS"]);
});
test("valid coverage inputs pass only with calibrated separated probabilities", () => {
  assert.deepEqual(assessPredictionEligibility({ dataQuality: 80, sampleSize: 20, probabilities: [.7, .2, .1], calibrated: true }), { eligible: true, reasons: [] });
});
