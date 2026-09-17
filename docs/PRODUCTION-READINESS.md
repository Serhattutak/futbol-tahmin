# Production Readiness

## Status

`READY_FOR_BETA=false`.

`PERFORMANCE_DATA_NOT_YET_AVAILABLE=true`.

## Controlled Live Test: 2026-09-16

- One authorized fixture-discovery request was made through the local provider registry.
- API-Football reported the safe provider status category `quota`; no direct retry was made.
- OpenFootball fallback responded successfully with zero fixtures for the requested day.
- No eligible future fixture was available, so no analysis, odds request, prediction snapshot, archive record, or synthetic data was created.
- Local smoke checks returned health `200`, invalid date `400`, invalid fixture `400`, disallowed CORS origin `403`, and the isolated health rate-limit check reached `429` without an upstream request.

## Implemented Controls

- React/Vite frontend and Express backend with Helmet, CORS allowlist, request body limit, rate limits, and per-IP concurrency guards.
- API-Football client with timeout, bounded cache, in-flight request de-duplication, and configurable daily budget defaulting to 100.
- Provider registry with API-Football primary fixture source and targeted OpenFootball/TheSportsDB fallback.
- Statistical Model 4.0 with immutable prediction snapshots, controlled settlement, safe provider errors, and no guaranteed outcomes.
- Historical archive with atomic writes, duplicate prevention, pre-kickoff snapshot creation, and result data separated from prediction input.
- Verified-only archive performance metrics, including market accuracy, Brier score, log loss, calibration, coverage, and NO BET counts when verified data exists.

## Data Flow

`provider -> canonical registry -> fixture discovery -> pre-kickoff analysis -> prediction snapshot -> bounded settlement -> verified performance`

## Beta Blockers

- The real archive has zero predictions and zero verified completed results. No real out-of-sample performance, calibration, coverage, or 80% claim exists.
- The current API-Football provider status is quota-limited; fixture fallback alone cannot produce a full analysis without equivalent pre-match capability.
- A real future fixture has not yet completed the immutable snapshot and verified-settlement path.
- OpenFootball and TheSportsDB are fixture-level fallback sources only; they do not yet provide an equivalent canonical form/H2H/standings/odds/statistics analysis path.
- Single-provider settlements remain unverified and are intentionally excluded from performance.
- No deployment, process supervision, persistent shared cache/rate-limit store, monitoring, alerting, backup/retention policy, or production API plan verification is configured.

## Beta Checklist

- Configure production origins, trusted proxy setting, and server-side provider credentials.
- Confirm licensed provider terms, account quota, and production limits.
- Add a second compatible result provider before relying on verified performance.
- Accumulate lawful pre-kickoff snapshots and verified final results across chronological periods.
- Run P3/P7 walk-forward validation before any Model 4.1 proposal.
- Add deployment health monitoring, log retention, archive backups, and shared persistence for multi-instance operation.