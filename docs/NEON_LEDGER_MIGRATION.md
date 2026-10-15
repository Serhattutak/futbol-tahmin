# Neon prediction-ledger migration plan

Status: adapter-only; production remains on the existing filesystem ledger.

## Non-negotiable rollout rules

- Keep filesystem mode as the default. Neon mode must require explicit configuration.
- Do not silently fall back from Neon to filesystem after a connection or write failure.
- Await database connection, schema validation, and event restoration before starting the HTTP listener, capture scheduler, or settlement timer.
- Keep Model 4.0 and Model 4.1 prediction logic unchanged during the storage migration.
- Do not point integration tests at remote Neon or production. PostgreSQL integration tests must use an isolated local service.
- Keep the change in a non-production branch until all gates below pass.

## Current architecture constraint

The existing `PredictionLedger` API is synchronous and filesystem-backed. The Neon adapter is asynchronous. A safe migration therefore cannot be done by swapping the adapter instance alone.

Consumers that must be migrated together:

1. `ProductionAnalysis.analyze()`: await prediction writes and preserve explicit storage-error reporting.
2. `ForwardCapture.run()`: await writes and preserve duplicate detection, capture-window guards, and status persistence.
3. `ForwardCapture.status()`: use an initialized in-memory event projection or an asynchronous route contract; it must not read a half-restored ledger.
4. `forwardPerformance.mountLedgerRoutes()`: migrate status, entries, pending, settled, performance, and model-comparison handlers to async reads and explicit 503 errors.
5. `server.js`: initialize the selected store and restore/validate all events before registering background schedulers or accepting traffic.
6. Settlement flow: await settlement/conflict writes and keep the current provider-evidence and score-conflict rules.

## Migration algorithm

1. Add an explicit storage mode: `filesystem` by default, `neon` only when deliberately configured.
2. Connect with a bounded timeout and validate required table/index shape. A missing or incompatible schema must fail startup in Neon mode.
3. Load and validate all Neon events before serving requests. Validate event IDs and indexed columns against payload fields.
4. Reconcile existing filesystem events into Neon using stable event IDs and `ON CONFLICT DO NOTHING`. Compare event counts and deterministic event-ID sets before switching reads. Never delete source files during this step.
5. Make Neon the active store only after reconciliation is verified. Keep filesystem data as a rollback source; do not dual-write silently because partial dual-write success creates ambiguity.
6. Make writes and reads asynchronous end-to-end. Database errors must be observable in logs, health/status endpoints, and affected responses.
7. Test restart recovery, duplicate predictions, duplicate settlements, provider conflicts, malformed rows, DB unavailable at startup, and DB unavailable during a write.
8. Deploy to a separate preview/staging service first. Verify live read-only health and capture behavior before changing production environment variables.

## Acceptance checklist

- [x] Adapter uses parameterized inserts and idempotent event IDs.
- [x] Adapter validates event payload against indexed DB columns.
- [x] Isolated PostgreSQL CI verifies append, idempotency, fresh-pool recovery, event types, status counts, and malformed-row rejection.
- [x] Existing frontend/backend regression and historical replay checks pass on the latest tested adapter commit.
- [ ] Async ledger facade has full unit coverage for restore, append, entries projection, settlement, and failure propagation. A first isolated facade and tests now cover initialization gating, restore/projection, idempotent append, duplicate-ID rejection, and DB read/write error propagation; settlement logic and app wiring remain intentionally unfinished.
- [ ] All synchronous consumers and routes are migrated to awaited operations.
- [ ] Filesystem-to-Neon reconciliation is implemented and tested against duplicate and partial-migration cases.
- [ ] Startup ordering guarantees restore completes before listen/schedulers.
- [ ] Staging/preview verification passes.
- [ ] Production cutover approved and separately verified.

## Current validation

The isolated PostgreSQL test and main CI passed on commit `8e521ff23408ca8c4b454edaff64f4b859483b36` (workflow run #259). The PR run intentionally skips live Render diagnostics; this does not establish production readiness. The Neon adapter and new async facade are not wired into the application and no production data has been written to Neon. The facade is an isolated migration step only; it does not yet implement async settlement or filesystem-to-Neon reconciliation.
