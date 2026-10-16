# ZEUS AI — Chronological Feature Discovery

## Purpose

This is an offline research component for discovering potentially useful pre-match football patterns. It is not connected to production recommendations and does not change Model 4.0, Model 4.1, hybrid gates, or live user-facing picks.

## Historical archive builder

The first archive builder is `backend/scripts/buildHistoricalFeatureArchive.js`. It downloads available season files from OpenFootball's public-domain `football.json` archive and creates pre-kickoff features plus verified final-score labels.

Example command, run from `backend/`:

```bash
node scripts/buildHistoricalFeatureArchive.js --from-season 2006-07 --to-season 2025-26 --concurrency 5
```

Outputs are written under `backend/data/historical-feature-archive/` by default:
- `rows.jsonl`: one row per completed match, including features, target label, source URL, and cutoff;
- `report.json`: requested league-seasons, downloaded/unavailable files, row counts, date range, and feature count.

The builder attempts the configured leagues and season range, records 404/missing seasons as unavailable, and skips invalid/incomplete score rows. **A requested 20-season window is not proof that all 20 seasons or every league exists in the source.** The report is the source of truth for actual coverage. The builder does not write to production databases or influence live picks.

OpenFootball's football.json data is dedicated to the public domain (CC0). Do not bulk-ingest Football-Data.co.uk data into this commercial AI training archive: its own data page states that free spreadsheet data is intended for private individuals and not commercial data-training products. Any additional source must be reviewed for license/terms before use.

## Input contract

Each research row represents one completed fixture and must contain:
- `date`: ISO-8601 date or kickoff timestamp;
- `outcome`: verified full-time 1X2 result (`H`, `D`, `A`);
- `homeGoals`, `awayGoals`: verified full-time goals;
- `features`: numeric/categorical values calculated using only information available before kickoff.

The archive builder currently calculates prior form over the last 5/10 overall matches, venue-specific home/away form, goals for/against, head-to-head results, and recent league-wide outcome rates. It excludes every match on the target calendar day from the target's feature history because kickoff times may be absent or inconsistent. This is conservative, and means the generated features are based on prior calendar days only.

The public-domain results archive does not supply all historical injuries, lineups, xG, shots, standings snapshots, or timestamped odds. Missing fields stay missing; current values must not be backfilled into past matches.

## Feature discovery method

1. Validate and sort rows chronologically.
2. Use the earliest 70% as the research/training period and the latest 30% as a chronological holdout.
3. Derive candidate numeric thresholds (training quartiles) and category values from the training period only.
4. Measure market outcome rate, sample size, 95% Wilson interval and lift over the corresponding period's baseline.
5. Keep holdout results visible for each candidate; do not promote a rule solely because it looked good in training.
6. Treat every discovered rule as exploratory. Multiple-testing correction and a second untouched forward period are required before any model or threshold changes.

Markets currently scored: 1X2, 1X, X2, no-draw, over 1.5, over 2.5, under 3.5, and BTTS yes/no.

## No-leakage contract

Final scores can be used as labels only after features have been frozen. Final score, post-match shots, post-match xG, later standings, or any feature derived from the target match outcome must never be included as a feature. The feature-discovery module also verifies that the declared 1X2 outcome matches the supplied final score.

## Production and membership policy

Keep this module research-only until data coverage, chronological holdout performance, confidence calibration, and live forward tracking have been independently verified. Paid membership should wait until users receive consistent, explainable value and the product's terms, privacy, and payment handling are ready.
