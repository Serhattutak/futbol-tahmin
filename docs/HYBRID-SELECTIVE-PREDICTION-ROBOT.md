# ZEUS AI Hybrid Selective Prediction Robot

## Purpose

The robot combines the existing Model 4.0 probabilities with calibrated Model 4.1 probabilities without changing either model's weights, the locked Model 4.1 artifact, or the frozen Model 4.0 reference benchmark.

## Current decision rule: HYBRID_SELECTIVE_1.0

- Blend each supported market probability with equal weights: 50% Model 4.0 + 50% calibrated Model 4.1.
- Only consider a recommendation when both models provide valid probabilities, 1X2 probabilities each sum to 1, historical sample sizes are at least five matches per team, and statistics quality is at least 70/100.
- Both models must assign at least 72% probability to the same candidate market.
- The equal-weight probability must be at least 75%, and absolute model disagreement must not exceed 10 percentage points.
- Rank qualifying picks by the lower of the two model probabilities, then by lower disagreement.
- If no candidate passes all gates, return `NO_BET`. Missing history, low data quality, invalid probabilities, or unavailable Model 4.1 never produce a fabricated pick.

Supported markets: 1X2, double chance, totals 1.5/2.5/3.5, and both teams to score.

## What “75%” means

75% is a minimum model-probability gate and a target for the *realised hit rate among selected picks*. It is not a promise that every pick or every match will be correct. The robot intentionally abstains on matches that do not pass its rules. Coverage (selected picks / all eligible matches) must be reported next to hit rate so a high success rate cannot hide a tiny sample.

The fixed gates must be evaluated on the locked 533-match Model 4.1 test set using `node backend/scripts/evaluateHybridRobot.js`. The script is read-only: it does not train, optimize thresholds, overwrite locked artifacts/reports, call paid providers, or deploy. If realised hit rate is below 75%, report that honestly and do not claim the target is achieved. Do not tune the gates on the locked test set; use a future chronological validation period for any subsequent changes.

## Operational safety

- Model 4.0 remains the default model.
- Model 4.1 remains the locked calibrated model.
- Hybrid recommendations are exposed as a separate `hybridRobot` field and saved alongside shadow records; the existing model outputs are not overwritten.
- Production deployment, production database writes, changing the active model, and merging release PRs remain separately gated by explicit approval.
- This test set overlaps the historical window used by the earlier Model 4.0 benchmark and is not an external future-season validation. Live forward-performance collection remains necessary.
