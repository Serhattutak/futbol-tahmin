# Stage 18 — Consolidated operational release-readiness gate

## Scope

Combines Stage 17's read-only settlement-integrity audit with Stage 15's forward-performance evidence gate. The output is deterministic and fail-closed: any blocking integrity or performance check keeps the result at NOT_READY.

## Safety contract

- This module only evaluates caller-supplied evidence; it performs no database reads or writes.
- READY_FOR_REVIEW means the supplied operational and sample-size checks passed. It does not mean Model 4.1 is better, profitable, calibrated, or approved for production.
- It does not switch models, trigger bets, merge PRs, deploy services, activate providers, backfill historical results, or write to production.
- The event audit validates structural relationships and canonical event identities; it cannot establish the truth of a provider result.
- The existing forward-performance policy still requires Neon storage, reconciled ledger counts, zero unresolved conflicts, consistent reconciliation counts, 100 settled samples per model, and 100 paired samples by default.

## Verification status

Tests are committed but have not been executed in this environment. Do not report this stage as verified until the targeted and full backend test suites run and CI results are observed. A passing gate with synthetic test input is not evidence that live staging has sufficient outcomes.

## Acceptance checklist

- [x] Combine settlement integrity and forward-performance checks into one read-only report.
- [x] Fail closed if either evidence layer is missing or blocked.
- [x] Add tests for ready input, orphan outcomes, insufficient samples, and missing input.
- [x] Document non-authorization and no-write boundaries.
- [ ] Run targeted and full backend tests.
- [ ] Observe CI.
- [ ] Verify using read-only staging evidence before any separate production review.
