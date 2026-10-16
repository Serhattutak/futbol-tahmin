# Stage 16 — Settlement evidence safety

## Scope

Stage 16 hardens the existing asynchronous prediction ledger settlement boundary. A settlement must not be accepted when the prediction has no parseable kickoff timestamp. This prevents malformed/missing fixture time from bypassing the pre-kickoff guard. The stage also adds regression coverage for unfinished fixtures, invalid scores, and provider fixture-ID mismatches.

## Behavior

- Missing prediction ledger ID returns the existing NOT_FOUND reason.
- Missing or malformed kickoff timestamp returns UNKNOWN_KICKOFF and does not append a settlement event.
- Valid future kickoff returns NOT_STARTED.
- Only provider results matching the prediction's recorded provider fixture ID, with both fixture and result status normalized to FINISHED and non-negative integer scores, can be considered.
- If no matching final result remains, the ledger returns NO_FINAL_RESULT and records neither settlement nor conflict.
- Existing multi-provider conflict detection, idempotency, and settlement scoring remain unchanged.

## Verification status

- Code and regression tests have been committed to the Stage 16 branch.
- Test execution is not yet observed; do not report tests as passed until CI or a local backend test run confirms them.
- The change does not write to production data, change provider/model selection, alter historical records, or perform a merge/deploy.

## Acceptance checklist

- [x] Fail closed on unknown kickoff timestamps.
- [x] Add regression tests for unknown kickoff, unfinished results, malformed scores, and fixture-ID mismatch.
- [x] Document settlement boundary behavior.
- [ ] Run targeted and full backend test suites.
- [ ] Verify CI and staging settlement with real completed fixtures.
