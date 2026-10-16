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

## Locked historical evaluation (2026-10-16)

The fixed-gate evaluator completed successfully in [GitHub Actions run 38886989536](https://github.com/Serhattutak/futbol-tahmin/actions/runs/38886989536). All 246 backend/UI regression tests passed. On the 533-match locked test set:

- Model 4.0 1X2: 247/533 correct (**46.34%**).
- Calibrated Model 4.1 1X2: 252/533 correct (**47.28%**).
- Hybrid selective picks: 463 selected, 362 correct (**78.19%** observed hit rate); 70 matches abstained; coverage **86.87%**.
- Naive Wilson 95% interval for the hybrid hit rate: **74.20%–81.71%**. Since the interval includes 75%, this single historical run does **not** establish with 95% confidence that the true hit rate exceeds 75%.
- By market: no-draw (12) 59/78 (**75.64%**); over 1.5 goals 120/156 (**76.92%**); home double chance (1X) 104/129 (**80.62%**); away double chance (X2) 23/25 (**92.00%**, small sample); under 3.5 goals 56/75 (**74.67%**).

Interpretation: the observed aggregate result clears the 75% point-estimate target, but is not a guarantee of future accuracy. Market-level samples vary, the X2 sample is especially small, and match outcomes are not perfectly independent. The benchmark also overlaps the historical window used by Model 4.0; it is not an external future-season test. Keep the hybrid in shadow/review status and collect a forward-only, timestamped prediction ledger before promoting it.

## Operational safety

- Model 4.0 remains the default model.
- Model 4.1 remains the locked calibrated model.
- Hybrid recommendations are exposed as a separate `hybridRobot` field and saved alongside shadow records.
- Forward ledger capture stores one hybrid decision on the Model 4.0 snapshot per fixture, including `RECOMMEND` or `NO_BET`, selected market, model probabilities, and disagreement. Settlement calculates the selected-market hit and Brier score from the verified final score.
- `/api/ledger/performance` reports hybrid total decisions, coverage, selected/pending/settled/conflicted counts, realised hit rate, Brier score, and market-level results. Hit rate is calculated only from settled, conflict-free selected recommendations; NO_BET decisions count toward coverage but not hit rate.
- These forward metrics are live evidence only after new predictions are captured and later settled. Existing 20 staging events predate this change and contain no hybrid settlements.
- Production deployment, production database writes, changing the active model, and merging release PRs remain separately gated by explicit approval.
- This test set overlaps the historical window used by the earlier Model 4.0 benchmark and is not an external future-season validation. Live forward-performance collection remains necessary.
