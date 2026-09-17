# Production Prediction Ledger

## Scope and recording

The production detail analysis (`GET /api/analyze/:fixtureId`) automatically snapshots both eligible models already computed for comparison. The ledger never invokes a model, trains, changes calibration or re-collects historical inputs. Fast match discovery/list analysis is unchanged. Legacy prediction archives, model-shadow records and backtests are not imported as forward predictions.

`response.ledger` reports each save, duplicate or rejection. Rejected snapshots do not block analysis. A storage failure produces `LEDGER_STORAGE_ERROR` and a server-side diagnostic; the prediction response remains usable.

The server clock must be strictly before an explicitly timezone-qualified kickoff. Unknown kickoff, live/finished/postponed/cancelled fixtures, target results/conflicts, ineligible analysis, invalid probabilities and historical rows at/after recording time are rejected. The ledger records the time of durable snapshot creation, not a client-supplied timestamp. Cached responses are checked again, so opening a fixture after kickoff cannot backfill a pre-match record.

## Storage and immutability

Storage is `backend/data/prediction-ledger/`, created lazily on the first eligible snapshot:

- `prediction-<ledgerId>.json`: immutable prediction event.
- `settlement-<ledgerId>.json`: first accepted final result and evaluation.
- `conflict-<ledgerId>-<scoreHash>.json`: immutable conflicting-result audit evidence.

Each event is written to a unique temporary file, flushed with `fsync`, then published with an atomic, no-replace hard link. Temporary files are removed; interrupted `.tmp` files are ignored. Existing events are never replaced. Concurrent writers cannot overwrite an existing key. The target filesystem must support hard links (tested on the local filesystem). JSON corruption fails reads visibly instead of silently resetting the ledger.

Identity is SHA256 of `[fixtureId, usedModel, artifactFingerprint, inputFingerprint]`. Model 4.0 has a null artifact fingerprint, so a 4.1 artifact change does not duplicate 4.0. Different inputs/models/artifacts can create distinct immutable snapshots. Request/fallback metadata describes the request that first created the snapshot; duplicate requests do not rewrite that history.

Entries expose prediction time, lead time, identities, quality/samples/providers, calibrated and raw 1X2, goal markets and complements, double chance, DNB, expected goals, score, strongest prediction, confidence and fallback metadata. Result/evaluation fields start null. Raw prediction JSON is unchanged by settlement.

## Settlement

The existing 15-minute backend timer processes up to ten fixture groups per cycle. Models/snapshots for the same fixture share a provider result request. Calls coalesce in-process. The worker rotates through eligible fixture groups, including settled records, so provider corrections become audit events. The backend must remain running; larger queues can take multiple cycles.

Only final, nonnegative integer scores from matching recorded provider fixture IDs are accepted. One provider may settle a match, explicitly marked `single_provider`; agreeing distinct providers are marked `verified`. Nonfinal/missing/error responses do not invent results. Conflicting scores or provider fixture conflict flags produce an audit event without replacing the first settlement. Conflicted entries are excluded from performance, including after later agreement; conflict resolution is deliberately not automatic.

No public score-writing or manual settlement endpoint exists. Tests call the service in isolated temporary storage; no synthetic records are written into production storage.

## Metrics and selection policy

Counts refer to snapshots. Metrics use the **earliest snapshot per fixture/model**, selected before filtering outcomes, avoiding repeated-input overweighting and outcome-driven revision selection. Only settled, conflict-free selected records contribute.

1X2 accuracy uses the maximum-probability class (ties use home/draw/away order). Multiclass Brier sums the three squared errors (range 0–2). Log Loss clips only the logarithm input to `[1e-15, 1 - 1e-15]`; stored probabilities remain unchanged. Over 1.5/2.5/3.5 and BTTS use 0.5 classification thresholds and binary Brier (range 0–1).

Model, league and confidence-bucket breakdowns include sample sizes. Empty metrics are null. Fewer than 100 scored fixtures is labelled a small sample; this is a display caution, not a significance test.

Paired comparison requires both models for the same fixture, kickoff, statistics version and input fingerprint. The earliest common pair is chosen independently of outcomes, one pair per fixture. Both sides must be settled, conflict-free and agree on the actual score. Backtest predictions never enter this report.

## API and UI

Read-only endpoints:

- `GET /api/ledger/status`
- `GET /api/ledger/entries?limit=50&offset=0`
- `GET /api/ledger/pending`
- `GET /api/ledger/settled`
- `GET /api/ledger/performance`
- `GET /api/ledger/comparison`

Entry pages are capped at 100 rows. Read failures return a safe HTTP 503. Performance reports expose `source: production_prediction_ledger` and the selection policy.

The existing Performance screen now starts with **Canlı Model Performansı · Forward Performance**, with counts, metrics, N and paired comparison. Existing Backtest reports stay separate. No forecast values or other UI were changed.

## Verification (2026-09-17)

- Initial suite: 114 PASS. Final suite: **140 PASS, 0 FAIL, 0 skipped**.
- Tests include boundaries/timezones, future history, separate model snapshots, duplicate/restart/concurrent writers, immutable bytes, exact scores, clipping, settlement conflicts/idempotency, pairing, invalid inputs, atomic publish failure, corrupt files, safe API, provider errors/coalescing, and real inference through ledger/cache in isolated test storage.
- Production build PASS. New files and service/test changes lint clean; existing App.jsx/server.js warnings remain. Syntax checks PASS.
- All six live ledger endpoints returned HTTP 200 with honest empty reports. A real past Atletico Madrid–Osasuna analysis returned Model 4.1 but rejected both ledger writes with `KICKOFF_REACHED`.
- September 16 discovery still returns **417 matches**, including San Luis–Antofagasta. Frontend HTTP 200.
- Artifact SHA256 `8a2be7d9c4fe131bbf6959c43be2b0245152478dec339d2f783ffb6bc2d72b82` matches the locked report. Model-code hash and original **1,686-match** reference-report hash match. `.env`, locked models, calibration, benchmark and provider logic were not edited.
- Browser runtime has no available connection: **manuel browser QA gerekli** for rendering, navigation, table scrolling and browser console. Real forward settlement performance will only become measurable after new pre-match predictions and real final scores accumulate; no historical backfill was performed.

## Operational limits

Keep the ledger directory on persistent storage and back it up. Readers currently scan event files; suitable for the intended thousands of predictions, but a database/index would be appropriate for substantially larger volumes. The app clock and upstream fixture identity/kickoff/result quality remain dependencies. This filesystem scheme prevents partial visible events and overwrites, but it is not cryptographic tamper protection or a distributed database. No Model 4.2 or optimization work is included.
