# ZEUS AI — Chronological Feature Discovery

## Purpose

This is an offline research component for discovering potentially useful pre-match football patterns. It is not connected to production recommendations and does not change Model 4.0, Model 4.1, hybrid gates, or live user-facing picks.

## Input contract

Each input row represents one completed fixture and must contain:
- `date`: ISO-8601 kickoff date/time;
- `outcome`: verified full-time 1X2 result (`H`, `D`, `A`);
- `homeGoals`, `awayGoals`: verified full-time goals;
- `features`: a record of numeric or categorical values captured/calculated using only information available before kickoff.

Examples of future-safe features include home team's previous-ten home win rate, away team's previous-ten away loss rate, rolling goals for/against, rest days, league-relative strength, and timestamped pre-match odds. Final score, post-match shots, post-match xG, later standings, or any feature derived from the target match outcome must never be included as a feature.

## Method

1. Validate and sort rows chronologically.
2. Use the earliest 70% as the research/training period and the latest 30% as a chronological holdout.
3. Derive candidate numeric thresholds (training quartiles) and category values from the training period only.
4. Measure market outcome rate, sample size, 95% Wilson interval and lift over the corresponding period's baseline.
5. Keep holdout results visible for each candidate; do not promote a rule solely because it looked good in training.
6. Treat every discovered rule as exploratory. Multiple-testing correction and a second untouched forward period are required before any model or threshold changes.

Markets currently scored: 1X2, 1X, X2, no-draw, over 1.5, over 2.5, under 3.5, and BTTS yes/no.

## Current limitations / next integration step

This module only analyzes a precomputed feature dataset. It does not yet download 20 years of match data or manufacture missing features. The next step is a provider-normalized historical ingestion pipeline that records source, competition, season, team identity, result verification, kickoff timestamp, and data availability. That pipeline must build features using strictly earlier fixtures, then feed this module.

Historical result archives and time-stamped pre-match snapshots are different datasets. Final scores can be used as labels only after features have been frozen. Where old odds or advanced stats were not archived, mark them missing; do not backfill current values into old matches.

## Production and membership policy

Keep this module research-only until data coverage, chronological holdout performance, confidence calibration, and live forward tracking have been independently verified. Paid membership should wait until users receive consistent, explainable value and the product's terms, privacy, and payment handling are ready.
