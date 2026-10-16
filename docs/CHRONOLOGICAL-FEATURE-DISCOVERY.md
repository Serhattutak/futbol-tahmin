# ZEUS AI — Chronological Feature Discovery

## Purpose

This is an offline research component for discovering potentially useful pre-match football patterns. It is not connected to production recommendations and does not change Model 4.0, Model 4.1, hybrid gates, or live user-facing picks.

## Historical archive and observed coverage

The archive builder is `backend/scripts/buildHistoricalFeatureArchive.js`. It downloads available season files from OpenFootball's public-domain `football.json` archive and creates pre-kickoff features plus verified final-score labels.

Example command, run from `backend/`:

```bash
node scripts/buildHistoricalFeatureArchive.js --from-season 2006-07 --to-season 2025-26 --concurrency 5
```

The first full archive run (2026-10-16) produced **72,896 completed fixtures**, spanning **2010-07-17 through 2026-05-24**, with **54 features**. It requested 380 league-season files across 19 leagues: **203 downloaded, 177 unavailable, 0 request errors**. This is roughly 16 calendar seasons in the data, not a complete 20-season archive. Coverage varies by league; the artifact report is the source of truth.

Outputs are written under `backend/data/historical-feature-archive/`:
- `rows.jsonl`: one row per completed match, including features, target label, source URL, and cutoff;
- `report.json`: requested league-seasons, downloaded/unavailable files, row counts, date range, and feature count;
- `feature-discovery-report.json`: earlier 70/30 exploratory screen, retained for comparison only;
- `walk-forward-feature-discovery-report.json`: newer three-period research report with validation selection, untouched test, multiple-testing correction, and season stability diagnostics.

The builder attempts the configured leagues and season range, records missing seasons as unavailable, and skips invalid/incomplete score rows. **A requested 20-season window is not proof that all 20 seasons or every league exists in the source.** The report is the source of truth for actual coverage. The builder does not write to production databases or influence live picks.

OpenFootball's `football.json` data is dedicated to the public domain (CC0). Any additional source must be reviewed for license/terms before use. Do not bulk-ingest data whose terms do not permit commercial training.

## Feature inputs and leakage controls

The archive currently calculates prior form over the last 5/10 overall matches, venue-specific home/away form, goals for/against, head-to-head results, and recent league-wide outcome rates. It excludes every match on the target calendar day from the target's feature history because kickoff times may be absent or inconsistent. Final scores are labels only, never features.

The public-domain results archive does not supply all historical injuries, lineups, xG, shots, standings snapshots, or timestamped odds. Missing fields stay missing; current values must not be backfilled into past matches.

## Walk-forward evaluation method

Run from `backend/`:

```bash
npm run discover:historical:walk-forward
```

The default split uses chronological calendar-day boundaries:
1. **60% training:** feature thresholds and candidate rules are derived here only.
2. **20% validation:** candidates with positive training lift are screened; only rules with positive lift against a disjoint complement proceed.
3. **20% final test:** untouched during threshold generation and validation selection. It is used once to estimate the selected rules' performance.
4. **Multiple testing:** a one-sided two-proportion test is Bonferroni-corrected across all validation-selected rule/market hypotheses evaluated on the final test.
5. **Season stability:** the report also measures each selected rule's lift within sufficiently sampled seasons in the final test. `REPLICATED_TEST` requires adjusted p <= 0.05 and positive lift in at least two adequately sampled test seasons.

The report includes each partition's dates and sample sizes, baseline market rates, rule subgroup and disjoint-complement rates, lift, adjusted p-value, and per-season diagnostics. If a feature does not replicate on the final test or across seasons, it must not be promoted based on the earlier exploratory screen.

This is historical cross-validation, not prospective future performance. Bonferroni correction is conservative; the rules are correlated and do not prove causality. The archive has incomplete league-season coverage and the results are not independent future-season validation. Do not tune thresholds after inspecting the final test. Any subsequent changes require a new later chronological period or forward-only timestamped predictions.

## Markets and production policy

Markets currently scored include 1X2, double chance, over/under goals, and BTTS. This feature-discovery pipeline remains research-only until coverage, chronological performance, probability calibration, and forward tracking are independently verified. It does not modify production model weights, recommendation gates, or live picks. Paid membership should wait until consistent value is demonstrated.
