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

1. `ProductionAnalysis.analyze()`: await prediction writes and preserve explicit storage-error reporting. The awaited call is now in place and remains compatible with the synchronous filesystem ledger.
2. `ForwardCapture.run()`: await writes and preserve duplicate detection, capture-window guards, and status persistence. The capture callback now awaits the ledger write.
3. `ForwardCapture.status()`: use an initialized in-memory event projection or an asynchronous route contract; it must not read a half-restored ledger.
4. `forwardPerformance.mountLedgerRoutes()`: status, entries, pending, settled, performance, and model-comparison handlers now await reads and convert rejected async reads into explicit 503 errors. Focused tests cover promise reads, rejection handling, and synchronous filesystem compatibility.
5. `server.js`: services share a stable ledger handle. Filesystem remains the default; Neon mode initializes the PostgreSQL pool, validates schema, restores the event projection, and only then starts schedulers/listener. Neon startup fails closed unless `ZEUS_LEDGER_RECONCILIATION_VERIFIED=true` is explicitly set after a successful migration dry-run/apply and final ID-set verification.
6. Settlement flow: await settlement/conflict writes and keep the current provider-evidence and score-conflict rules.

## Migration algorithm

1. Add an explicit storage mode: `filesystem` by default, `neon` only when deliberately configured.
2. Connect with a bounded timeout and validate required table/index shape. A missing or incompatible schema must fail startup in Neon mode.
3. Load and validate all Neon events before serving requests. Validate event IDs and indexed columns against payload fields.
4. Reconcile existing filesystem events into Neon using stable event IDs and `ON CONFLICT DO NOTHING`. The guarded CLI `backend/scripts/reconcileFilesystemLedgerToNeon.js` now supports read-only dry-run by default; writes require `--apply`, an explicit non-empty `ZEUS_LEDGER_DIR`, and `ZEUS_RECONCILE_CONFIRM=I_HAVE_VERIFIED_SOURCE_AND_TARGET`. It refuses destination-only events and never deletes source files. A dry-run is only marked safe to apply when the source directory is explicitly configured. Compare deterministic event-ID sets before switching reads.
5. Make Neon the active store only after reconciliation is verified. Keep filesystem data as a rollback source; do not dual-write silently because partial dual-write success creates ambiguity.
6. Make writes and reads asynchronous end-to-end. Database errors must be observable in logs, health/status endpoints, and affected responses.
7. Test restart recovery, duplicate predictions, duplicate settlements, provider conflicts, malformed rows, DB unavailable at startup, and DB unavailable during a write.
8. Deploy to a separate preview/staging service first. Verify live read-only health and capture behavior before changing production environment variables.

## Acceptance checklist

- [x] Adapter uses parameterized inserts and idempotent event IDs.
- [x] Adapter validates event payload against indexed DB columns.
- [x] Startup facade validates required table columns and the event-ID unique index before restoring persisted events.
- [x] Isolated PostgreSQL CI verifies append, idempotency, fresh-pool recovery, event types, status counts, and malformed-row rejection.
- [x] Existing frontend/backend regression and historical replay checks passed on commits `f8f4160fa94e014282c9bf7b66276e2e74cd4d41` (run #278), `5189c209f8bf98d8128fef2dc73c537bb9424a78` (run #282), and `e271f5bfc850165606c0f5368377d56179d4ce29` (run #283).
- [x] Async ledger facade has focused unit coverage for restore, append, entries projection, settlement, and failure propagation. The isolated facade and tests cover initialization gating, restore/projection, idempotent append, duplicate-ID rejection, DB read/write error propagation, final-result settlement, duplicate settlement, and contradictory-score auditing. A separate reconciliation helper now copies supplied source events idempotently, validates the resulting event-ID set, detects destination-only records, and supports safe retry after partial failure. Reading the existing filesystem ledger and invoking reconciliation during a real migration remain unwired.
- [x] Runtime dependency and lockfile now pin `pg@8.23.0` with its transitive dependency closure. The server can select the initialized Neon runtime before listening, but only when the explicit reconciliation-verification gate is set; tests cover missing reconciliation approval and missing database URL.
- [ ] Complete deployment-level settlement validation and staging/preview verification before enabling Neon on any service.
- [x] Isolated reconciliation helper tests duplicate writes, partial-failure retry, source identity collisions, and destination-only events.
- [x] Add a guarded filesystem-to-Neon reconciliation CLI with a read-only default, explicit confirmation for writes, and refusal when Neon contains destination-only events.
- [x] Add the `pg` runtime dependency and matching lockfile closure; workflow #297 is validating the lockfile with a clean CI install.
- [ ] Run the CLI dry-run against a dedicated staging Neon database, inspect source/destination event-ID sets, then explicitly apply and verify a second dry-run reports no missing IDs.
- [ ] Read the current filesystem ledger, invoke reconciliation in the actual migration flow, and verify the full source/destination event-ID sets.
- [x] Startup fails closed if `ZEUS_LEDGER_MODE` is set to a non-filesystem value before migration gates are complete; the current filesystem mode marks the ledger ready before schedulers/listener. Full Neon restore-before-listen sequencing remains blocked until runtime wiring is complete.
- [ ] Staging/preview verification passes.
- [ ] Production cutover approved and separately verified.

## Current validation

The isolated PostgreSQL test and full main CI passed on commit `e271f5bfc850165606c0f5368377d56179d4ce29` (workflow run #283). Workflow run #288 (`38764033920`) passed both `test-and-build` and `neon-ledger-integration`; workflow #291 (`38764420077`) is validating the stable runtime handle and fail-closed server startup guard. Workflow #291 (`38764420077`) and #297 (`38764913781`) passed both jobs, including clean install of the pinned PostgreSQL runtime dependency. Workflows #293 (`38764580731`), #294 (`38764592430`), #299 (`38764994929`), and #300 (`38765021737`) passed both jobs, including reconciliation dry-run and server startup-gate coverage. Workflow #302 (`38765114586`) is validating the serverless fail-closed test; the latest reconciliation-source-path guard tests are queued behind it. PR runs intentionally skip live Render diagnostics; this does not establish production readiness. No production data has been written to Neon. A real staging reconciliation run, settlement validation, preview verification, and explicit production cutover approval remain outstanding.
