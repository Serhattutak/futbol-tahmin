# P5 Multi-Provider Data Architecture

## Architecture

API-Football, OpenFootball, and TheSportsDB are accessed through `MultiProviderRegistry`. Provider adapters convert source-specific payloads into a canonical football fixture model before data reaches application consumers. `predictionModel.js` continues to receive only normalized statistical inputs and has no provider response dependency.

## Adapter Interface

Adapters expose `name`, `enabled`, `getFixtures(date)`, and `getFixture(id)`. The API-Football adapter uses the existing centralized request client. OpenFootball and TheSportsDB are legacy adapters around their lawful public endpoints. Additional licensed providers can be added through the same interface.

## Canonical Model

A canonical fixture contains provider identity, provider fixture ID, canonical fixture ID, league, season, kickoff, canonical home/away team identities, status, optional real result, source list, and `dataConflict`. Canonical teams use stable normalized-name identifiers while retaining provider-specific IDs. No provider raw payload is stored in model input or exposed by status endpoints.

## Fallback, Cache, And Quota

Requests use API-Football first. A second provider is requested only when the current provider has no data or fails with an availability, timeout, authentication, or quota category. The registry has bounded request caching; API-Football additionally retains its existing timeout, request budget, TTL cache, concurrency guard, and rate limit layers. A provider quota error does not cause retries against that provider.

## Reconciliation

Fixtures merge only when kickoff minute, normalized home/away teams, league, and season match. Same teams/league/season with a different kickoff are retained as separate records and marked `dataConflict`. Matching results from at least two sources are `verified`; different scorelines are `conflict` and no automatic score is selected. A single-source result is `unverified`.

## Data Quality And Archive

Source metadata records provider availability, source count, and verified fields in the immutable P4 snapshot. Fixture result settlement remains separate from the prediction-time snapshot. Archive performance includes only `verified` completed results; pending, unavailable, unverified, and conflict results are excluded.

## Safe Endpoints

`GET /api/providers/status` returns provider name, enabled state, availability, last successful request time, cached item count, and safe error category. It never returns an API key or raw provider payload. Archive endpoints continue to return only safe aggregate or persisted prediction information.

## Tests And Limitations

Mock tests cover primary success, targeted fallback after timeout/quota, cache reuse, fixture reconciliation, kickoff conflicts, result verification/conflict, and canonical team identity. Existing archive tests cover immutable snapshots, duplicate protection, quota stop, and verified-only performance.

OpenFootball and TheSportsDB do not currently provide a full equivalent of all API-Football form, H2H, standings, odds, and statistics capabilities for every fixture. They are therefore fixture-level fallback sources in this iteration. A fully provider-neutral analysis requires licensed adapters with equivalent pre-match capabilities and a canonical form/standings/odds/statistics reconciliation layer.