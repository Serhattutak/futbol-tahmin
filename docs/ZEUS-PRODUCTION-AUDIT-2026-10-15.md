# ZEUS ONE BETTING — Audit findings and remediation plan
Date: 2026-10-15
Repository: Serhattutak/futbol-tahmin
Production URL: https://zeus-one-betting.onrender.com/

## Verified findings from the repository

1. Production Model 4.0 uses recency-weighted form (decay 0.82), a fixed home multiplier (1.06), and a Poisson score grid. The model blends in selected historical markets but does not yet use league baselines, Bayesian smoothing, or a production-calibrated probability transform. Source: `backend/services/predictionModel.js`, `docs/P7-MATHEMATICAL-MODEL-VALIDATION.md`.
2. The provider audit says API-Football is the only current path for analysis-grade H2H, standings, odds, xG, shots, and possession. OpenFootball/TheSportsDB fixture fallback does not supply a complete analysis fallback. Provider odds and statistics are plan-dependent. Source: `docs/P6-PROVIDER-CAPABILITY-AUDIT.md`.
3. The existing audit documentation says the verified-results archive had zero independently verified completed results at the time of that audit. That means we must not claim a current hit rate or tune the model to maximize a claimed hit rate without first checking the live, settled prediction ledger.
4. Model 4.1 and its locked artifact exist, but the recorded verification is not proof of superior real-world performance. The documented production status explicitly leaves visual browser QA pending and preserves Model 4.0 as the list/default model.
5. The shadow log includes explicit `INSUFFICIENT_HISTORY` cases. Those fixtures should be excluded from confident recommendations, not filled with invented data.

## Immediate engineering priorities

- Verify live service health, API provider authentication/quota, date-specific fixture count, and analysis response errors before altering the model.
- Reconcile every displayed prediction to a pre-kickoff immutable snapshot and independently verified final score; never overwrite historical forecasts.
- Add a daily, immutable prediction ledger with kickoff timestamp, provider/data freshness, model version, probabilities, market odds and timestamp where legally/technically available, final score, settlement status, and source provenance.
- Backtest chronologically (walk-forward), with all eligible predictions and NO BET decisions included. Report 1X2 hit rate alongside Brier score, log loss, calibration error, sample size, coverage, and ROI only when actual time-stamped odds and settlement are available.
- Compare against de-vigged bookmaker probabilities where available; don't claim an edge from accuracy alone.
- Introduce conservative NO BET gating for missing/old data, insufficient team history, provider conflicts, uncalibrated probabilities, and no measurable value at an actual quoted price.
- Keep the production model unchanged until the candidate beats the incumbent on an untouched chronological test set and passes regression tests.

## Product behavior

Do not increase odds thresholds merely to show bigger prices. Higher odds imply lower implied probability and usually lower hit rate. Separate three outputs clearly: (a) most likely outcome, (b) statistically supported value candidate based on a real timestamped price, and (c) NO BET. Never label a prediction as guaranteed.

## Status of this audit

This is a repository-based audit, not a claim that production API calls, current match outcomes, or browser interactions have been fully verified. A deployment/API check and reproducible tests are required before changing production inference.
