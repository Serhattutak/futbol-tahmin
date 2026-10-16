# Stage 17 — Read-only settlement integrity audit

## Scope

Adds a pure, read-only audit over ledger event arrays. It checks event identity, duplicate event IDs, duplicate prediction/settlement records, and settlement/conflict events that do not reference a prediction. It never repairs, deletes, backfills, or writes events.

## Safety and interpretation

- This audit is structural, not proof that a provider's score is true.
- Unknown event types are reported for forward compatibility but do not block this structural audit by themselves.
- Missing identities, duplicate event IDs, duplicate prediction/settlement records, and orphan outcomes fail closed.
- The existing ledger store's canonical event-ID implementation must be used by any caller; this audit consumes the eventId field and does not infer or synthesize IDs.
- No production data, provider configuration, model selection, merge, or deployment is changed.

## Verification

Unit tests are added but have not been executed in this environment. Do not mark the stage fully verified until targeted and full backend tests run and CI results are observed.

## Acceptance checklist

- [x] Pure read-only audit and stable issue codes.
- [x] Regression tests for consistent data, malformed data, duplicates, orphan records, and input immutability.
- [ ] Run targeted and full backend tests.
- [ ] Observe CI.
