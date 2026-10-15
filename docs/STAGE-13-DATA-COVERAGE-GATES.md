# ZEUS AI — Stage 13: Data coverage gates and prediction eligibility

Status: in progress. This stage follows Stage 12 and must not be described as complete until the acceptance checks below have evidence.

## Goal

Turn the live-data failures observed on 2026-10-15 into explicit, testable eligibility decisions. A fixture being discoverable is not proof that it has enough pre-match evidence for a recommendation.

## Verified starting point

- The production API health endpoint returned HTTP 200 during the latest read-only check.
- Render diagnostics showed many fixtures with fixture/form data but missing H2H, odds, standings and xG.
- Logs include predictions whose results could not be checked and Model 4.1 fallback cases marked `INSUFFICIENT_HISTORY`.
- The provider capability matrix documents API-Football as the only configured analysis-grade path for several advanced fields; fallback fixture providers do not provide those fields.
- PR #41's CI passed, but its PR workflow does not prove live provider coverage or settlement integrity.

## Work items

1. Define a single explicit coverage report for each fixture: fixture identity/kickoff confidence, home and away history counts, field-level availability/provenance, provider errors and freshness.
2. Distinguish unavailable provider data from valid empty results and provider failures. Preserve HTTP status/category in safe diagnostics; never log tokens or raw credential-bearing headers.
3. Add regression tests for zero/low history, stale data, provider conflicts, unsupported leagues, HTTP 400/429, and missing optional versus critical fields.
4. Ensure recommendation eligibility is fail-closed for insufficient history, conflicting fixture identity, unknown kickoff, stale critical data, or missing required model inputs. Surface an explicit NO BET / insufficient-data reason rather than manufacturing values.
5. Keep the existing production model and provider configuration unchanged. Do not enable paid providers or write to production ledger as part of implementation.
6. Run full backend tests and CI; perform read-only live checks and save redacted evidence. Clearly separate code/test success from external provider limitations.

## Acceptance criteria

- Every fixture diagnostic includes stable reason codes and data provenance without secrets.
- Tests prove that critical data gaps cannot become confident recommendations and that optional gaps are accurately reported.
- HTTP 400, 429, authentication, league coverage, and fixture matching failures remain distinguishable.
- Existing model outputs are unchanged when input data and eligibility are unchanged.
- Full backend tests and CI pass.
- Read-only live audit documents current coverage rates by provider/league and identifies which blockers require provider access, account-plan changes, or upstream data.
- No production deployment, production database/ledger write, paid-provider activation, or model switch occurs without separate explicit approval.

## Dependency and release safety

This branch is based on `feat/stage-12-api-resilience-performance`; Stage 12 and prior draft PRs remain unmerged. Preserve the established merge order (#37 → #38 → #39 → #40 → #41 → Stage 13). Stage 13 must not target `main` directly until its prerequisites are merged and reviewed.
