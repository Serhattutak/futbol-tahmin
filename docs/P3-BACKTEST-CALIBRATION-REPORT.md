# P3 Backtest And Calibration Report

## Execution Status

- Generated on: 2026-09-15
- Model version evaluated: 4.0
- Historical real fixtures available locally: 0
- Historical real fixtures evaluated: 0
- Data source used in this run: none
- API-Football requests made for this report: 0
- API quota status: preserved; no upstream request was made

## Method

The backtest module accepts only completed historical fixtures supplied by a trusted, lawful data export. Fixtures are ordered chronologically. For each fixture, team history contains only fixtures with an earlier kickoff time. The fixture result, post-match statistics, future form, and future odds are never used to create that fixture's prediction.

The module evaluates 1X2, double chance, over/under, and BTTS with accuracy, hit rate, Brier score, log loss, confusion matrix, prediction count, wins, losses, average data quality, and average confidence. It also reports 1X2 confidence buckets from 50-59 through 90-100.

## Results

No real historical fixture archive is stored in this project. Calling API-Football's current `last` form endpoint for an old fixture would create future-data leakage, and requesting a broad historical archive would unnecessarily consume the protected daily quota. Therefore no numerical performance, calibration, Brier score, log loss, or confusion matrix is reported for this run.

## Calibration And Versioning

No confidence calibration was applied. There is insufficient real historical data to separate training, validation, and test periods. Model weights were not optimized, and the model remains version 4.0.

## Leakage And Overfitting Controls

- Pre-match histories are restricted to fixtures before the evaluated kickoff.
- Incomplete fixtures create no performance record.
- No odds are synthesized or inferred.
- Calibration must use a training/validation period; a held-out test period must remain untouched.

## Next Steps

Import a lawful, versioned export of completed API-Football fixtures with kickoff timestamps. Use chronological training, validation, and held-out test ranges before considering a verified 4.1 calibration.