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
5. Make Neon the active store only after reconciliation is verified. Keep the pre-cutover filesystem copy unchanged for audit/recovery, but do not treat it as a current rollback source after Neon accepts new writes. A rollback must keep Neon authoritative or first reconcile post-cutover Neon events into a separate filesystem copy. Do not dual-write silently because partial dual-write success creates ambiguity.
6. Make writes and reads asynchronous end-to-end. Database errors must be observable in logs, health/status endpoints, and affected responses.
7. Test restart recovery, duplicate predictions, duplicate settlements, provider conflicts, malformed rows, DB unavailable at startup, and DB unavailable during a write.
8. Deploy to a separate preview/staging service first. Verify live read-only health and capture behavior before changing production environment variables.

## Acceptance checklist

- [x] Adapter uses parameterized inserts and idempotent event IDs.
- [x] Adapter validates event payload against indexed DB columns.
- [x] Startup facade validates required table columns and the event-ID unique index before restoring persisted events.
- [x] Isolated PostgreSQL CI verifies append, idempotency, fresh-pool recovery, event types, status counts, and malformed-row rejection.
- [x] Existing frontend/backend regression and historical replay checks passed on commits `f8f4160fa94e014282c9bf7b66276e2e74cd4d41` (run #278), `5189c209f8bf98d8128fef2dc73c537bb9424a78` (run #282), and `e271f5bfc850165606c0f5368377d56179d4ce29` (run #283).
- [x] Async ledger facade has focused unit coverage for restore, append, entries projection, settlement, and failure propagation. The isolated facade and tests cover initialization gating, restore/projection, idempotent append, duplicate-ID rejection, DB read/write error propagation, final-result settlement, duplicate settlement, and contradictory-score auditing. The guarded reconciliation CLI reads the filesystem ledger, compares stable event-ID sets, supports idempotent apply with explicit confirmation, and blocks unexpected destination-only events. Startup can run a read-only preflight and refuses to serve if source/target IDs differ.
- [x] Runtime dependency and lockfile pin `pg@8.23.0` with its transitive dependency closure; clean install passed in workflow #297.
- [x] Server selects the initialized Neon runtime before listening only after schema validation, restore, and either explicit migration verification or a strict read-only preflight with exact event-ID parity; tests cover missing approval, missing database URL, and serverless fail-closed behavior.
- [x] Reconciliation apply refuses a blank or implicit source directory; dry-run output marks apply safe only when `ZEUS_LEDGER_DIR` is explicitly configured and Neon has no destination-only events.
- [x] Capture status reports `neon_postgres` without a misleading filesystem durability warning when Neon mode is active.
- [x] Dedicated Render staging service starts in Neon mode, runs read-only reconciliation preflight, validates schema/restoration, and reports `LEDGER_RUNTIME_READY` with 0 events.
- [x] Staging-only live Neon smoke created a temporary table, verified first append, duplicate append rejection, fresh-pool restore and counts, then dropped the table. A direct query confirmed 0 leftover smoke tables and 0 rows in the actual staging ledger table.
- [x] Live staging API/health verification passed for health, provider status, capture status, ledger status, performance and model comparison endpoints; capture status reports `neon_postgres`.
- [x] Isolated reconciliation helper tests duplicate writes, partial-failure retry, source identity collisions, and destination-only events.
- [x] Add a guarded filesystem-to-Neon reconciliation CLI with a read-only default, explicit confirmation for writes, and refusal when Neon contains destination-only events.
- [x] Add the `pg` runtime dependency and matching lockfile closure; workflow #297 is validating the lockfile with a clean CI install.
- [x] Run the CLI dry-run against a dedicated staging Neon database. It reported source events 0, destination events 0, missing IDs 0, destination-only IDs 0, and `safeToApply=true`. No apply was needed because the staging source ledger is empty.
- [ ] For a non-empty migration source, explicitly apply only after inspecting the full event-ID diff, then rerun dry-run to verify no missing IDs.
- [x] Startup preflight reads the configured filesystem ledger and compares its event IDs against the staging Neon table before serving requests.
- [ ] Run an actual non-empty source-to-Neon migration in staging; this cannot be completed until an authoritative filesystem source with real historical ledger events is identified and mounted.
- [x] Neon startup fails closed on a missing/failed reconciliation gate and completes schema validation plus event restore before starting the listener or background schedulers.
- [ ] Staging/preview verification passes.
- [ ] Production cutover approved and separately verified.

## Current validation

Workflow #309 (`38765532427`), #310 (`38766525573`), #311 (`38766572326`), #313 (`38766841175`), and #315 (`38766925223`) passed both CI jobs. Workflow #314 (`38766901392`) passed after the main-branch staging-helper revert. Dedicated Render staging service `https://zeus-ai-ledger-staging.onrender.com` is live on `feat/neon-durable-prediction-ledger`; logs confirm the read-only preflight, Neon runtime initialization, and staging persistence smoke passed. The temporary smoke table was removed and the real staging ledger table remains empty. Production Render web/API services are live again on the main-branch revert commit; production environment variables and production Neon rows were not changed. Remaining: a non-empty source reconciliation using authoritative historical filesystem events and a provider-driven `settleFromProviders` end-to-end test using controlled fixtures. The facade-level settlement/conflict path and live persistence are verified; explicit production cutover approval is still required. PR runs intentionally skip live Render diagnostics; staging smoke success does not establish production readiness.
