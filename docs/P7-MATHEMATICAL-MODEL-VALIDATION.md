# P7 Mathematical Model Validation

## Current Model 4.0

Model 4.0 remains unchanged in production. For each team, completed pre-match fixtures are ordered newest first and receive weight $w_n = 0.82^n$. Weighted attack, defence, and points-per-game are calculated from goals scored, conceded, and match outcomes. Home/away samples are preferred when present.

The current expected goals are:

$$\lambda_h = \frac{A_{h,home} + D_{a,away}}{2} \times 1.06 \times (1 + e)$$
$$\lambda_a = \frac{A_{a,away} + D_{h,home}}{2} \times (1 - e)$$

where $e$ is a bounded combination of weighted form, H2H, standings, shots on target, and possession. Available xG is blended at 30%. The edge is bounded to prevent extreme adjustments. Current inputs are form, venue form, goals, H2H, standings, xG, shots, and possession when provider data exists. League baseline, Bayesian smoothing, and calibrated probability transforms are not production inputs yet.

## Poisson And Markets

Score probabilities use $P(X=k)=e^{-\lambda}\lambda^k/k!$ over a finite $0..8$ score grid. The grid mass is normalized before 1X2, double chance, totals, BTTS, and most-likely-score probabilities are derived. 1X2 percentages are rounded with a final adjustment so displayed values total 100%. Correct score is inherently lower-confidence and is not treated as a separate high-confidence recommendation.

## Validation Toolkit

`backend/services/modelValidation.js` is isolated from production routing. It provides:

- Dixon-Coles low-score tau evaluation for `0-0`, `0-1`, `1-0`, and `1-1`; no rho is used in production.
- Bayesian rate smoothing: $(total + baseline \times prior)/(games + prior)$ for small samples; not enabled in production.
- Chronological walk-forward train/validation/test splitting.
- Calibration buckets and mean absolute calibration error.
- Accuracy, precision, recall, F1, Brier score, log loss, coverage, NO BET count, and confusion matrix for binary markets.
- Odds calculations only for supplied real valid odds: implied probability $1/o$, fair odds $1/p$, and value $p \times o - 1$.
- NO BET gating for low quality, small samples, probability separation below 0.06, provider conflict, or failed calibration.

## Dixon-Coles, Recency, Home Advantage, And Smoothing

Dixon-Coles is retained for validation research only. Its tau correction is mathematically defined but rho must be fit from a training period and validated chronologically before production use. The recency candidates `0.70, 0.75, 0.80, 0.82, 0.85, 0.90, 0.95` and the current home multiplier 1.06 must be selected from training/validation only. A league-specific home advantage requires a documented minimum sample size and historical league data. Bayesian smoothing must use a training-derived baseline, not future match outcomes.

## Walk-Forward And Leakage Controls

Records are sorted by kickoff: training uses the oldest period, validation uses the next period, and test is held out. Test observations are never used to choose decay, rho, feature weights, thresholds, smoothing priors, or calibration. Prediction inputs must be strictly earlier than kickoff. Post-match statistics, final results, future form, and bookmaker closing odds cannot become features. P3's backtest performs the same pre-kickoff filtering.

## Calibration, Features, And NO BET

Platt, isotonic, and beta calibration are candidate validation techniques only. Selection requires enough independent validation observations per market and must be frozen before test evaluation. Feature weights for H2H, standings, xG, shots, and possession are not optimized in this phase. Missing signals remain missing; no synthetic form, odds, or results are permitted. NO BET records must remain visible as coverage/no-bet counts and cannot be deleted to inflate accuracy.

## Current Evidence And Versioning

The historical archive has zero real completed and verified results. Therefore training count, validation count, test count, market accuracy, Brier score, log loss, calibration, coverage, and NO BET rate have no real out-of-sample value yet. No optimization or calibration was performed, and the model remains 4.0. There is not enough real out-of-sample data to claim an 80% result.

## Real Data Requirements

Before considering version 4.1, collect lawful, versioned, prediction-time snapshots with verified final results across enough chronological periods to form independent training, validation, and held-out test sets. Store provider conflicts and unavailable data explicitly. Report all eligible predictions, all NO BET decisions, and market-level metrics without filtering failures.