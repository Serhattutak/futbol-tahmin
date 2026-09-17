# P4 Historical Data Archive Report

## System

`backend/data/historicalPredictions.json` stores immutable prediction-time snapshots separately from result settlement data. Writes use a temporary file and rename for atomic persistence. Invalid or corrupt JSON is treated as an empty archive without overwriting the source file.

## Record Structure

Each real record contains a stable fixture/model/kickoff identifier, prediction-time fixture identity, model version, selected prediction, all calculated market probabilities, confidence, data quality, form, H2H, standings, available statistics, expected goals, source agreement, and only real bookmaker offers available at prediction time. Settlement is stored in a separate `result` object with status, final score, actual winner, total goals, BTTS result, and market outcomes.

## Leakage And Duplicate Protection

- Snapshot content is cloned when written and never changed during settlement.
- Only upcoming API-Football fixture states (`NS`, `TBD`, `PST`) may create an archive snapshot.
- Completed fixture data is written only to `result`.
- Duplicate fixture, model version, and kickoff records use one stable identifier and are rejected.
- No odds or result is synthesized when provider data is missing.

## Settlement And Quota Protection

Settlement checks only pending records, with a maximum of 10 records per manual or scheduled pass. It uses the existing centralized `ApiFootballClient`, cache, timeout, and daily budget. A quota error stops the pass without changing pending snapshots. Missing or unavailable fixtures become `unavailable` with no fabricated result.

## Performance And Backtest Compatibility

`/api/performance` includes an archive summary. `/api/archive/status` and `/api/archive/performance` expose only safe counts and aggregate records. Pending and unavailable records are excluded from success rate. The snapshot/result separation can be transformed into the P3 chronological backtest input without using future results as model input.

## Current Archive State

- Real archive records: 0
- Completed real results: 0
- Backtest minimum dataset available: no
- Model version: 4.0
- API-Football requests made by this implementation report: 0

## Verification

Archive tests cover duplicate protection, immutable snapshots, result separation, pending exclusion, settlement, no fake odds/results, quota handling, missing fixtures, and model-version preservation.