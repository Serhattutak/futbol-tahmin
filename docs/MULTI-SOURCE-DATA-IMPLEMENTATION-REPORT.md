# Multi-Source Data Implementation Report

## Providers And Field Mapping

| Field | Primary Source | Fallback / Verification | Current Limitation |
| --- | --- | --- | --- |
| Fixture, kickoff, status, result | API-Football | OpenFootball, TheSportsDB fixture adapters | Fallback fixture IDs cannot provide full pre-match analysis data |
| Team form, H2H, standings | API-Football | OpenFootball form is not yet canonicalized | No equivalent multi-source analysis fallback |
| xG, shots, possession, corners, cards | API-Football fixture statistics | None | Plan/league coverage dependent |
| Odds and bookmaker offers | API-Football odds | None | Missing odds remain null |

No unsupported provider capability is represented as available. Model 4.0 receives normalized analysis values and no provider-specific raw response.

## Canonical And Reconciliation Flow

`provider adapter -> canonical fixture -> registry cache/fallback -> API-Football analysis -> immutable pre-kickoff archive -> provider-ID-scoped result settlement -> verified performance`

Canonical fixtures retain a stable canonical fixture ID, normalized canonical team IDs, and a `providerFixtureIds` map. Fixture merge requires matching kickoff minute, home/away teams, league, and season. A conflicting kickoff or score is marked as a conflict; it is not silently selected.

Result settlement checks only provider IDs stored at prediction time. One real result is `unverified`, matching results from at least two sources are `verified`, and different scores are `conflict`. Only verified results enter performance metrics.

## Data Quality, Cache, And Budget

Data quality continues to record missing form, H2H, standings, statistics, xG, and odds. Source agreement is calculated only for supplied numeric source values; missing values are not synthesized. API-Football uses the existing 100-request daily budget, timeout, bounded TTL cache, in-flight deduplication, rate limits, and concurrency guards. Registry fallback occurs only when fixture data is absent or the prior provider fails.

## Archive And Performance

Snapshot creation is limited to future kickoff fixtures in `NS`, `TBD`, or `PST` state. The snapshot keeps canonical/provider IDs, source metadata, pre-match features, probabilities, odds offers, confidence, data quality, timestamp, and model version. Result data is stored separately and cannot alter the snapshot. Archive performance reports verified-only accuracy, Brier score, log loss, calibration, coverage, and NO BET counts when eligible real data exists.

## Current State

- Model version: 4.0
- Real archive predictions: 0
- Verified completed results: 0
- Real accuracy/Brier/log loss/calibration: not available
- No real API call was made during this implementation pass.