# Stage 15 — Forward-performance evidence and release gates

## Scope

Stage 15 adds a deterministic, fail-closed readiness evaluator for the forward prediction ledger. It does not change prediction probabilities, model selection, provider configuration, settlement rules, storage mode, or production behavior. It reports whether enough operational and real-outcome evidence exists to begin a separate model-performance review.

## Gates

- Neon PostgreSQL is the explicitly reported active storage mode.
- Ledger counts are non-negative integers and reconcile: total = pending + settled.
- No unresolved conflict records remain in the status summary.
- Read-only event integrity evidence has matching total event IDs, unique event IDs, and unique ledger IDs.
- Both Model 4.0 and Model 4.1 each have at least 100 settled, eligible records in the report.
- The paired comparison has at least 100 comparable fixtures under the existing frozen pairing policy.

Thresholds are configurable by callers for a stricter review; defaults are intentionally conservative. Missing fields, invalid counts, and insufficient samples fail closed.

## Interpretation

READY_FOR_REVIEW is not a claim that either model is more accurate, profitable, calibrated, or safe for betting. It only means the supplied operational and sample-size gates passed. Any model comparison still requires reviewing Brier score, log loss, market-level results, league and confidence strata, temporal leakage, and uncertainty. Never treat historical backtest output as forward-performance evidence.

## Verification status

- Implementation and deterministic unit tests are added.
- Automated test execution for this commit remains outstanding; do not report these tests as passed until CI or a local backend test run is observed.
- Live staging must collect enough real settled fixtures over time. The last read-only staging ledger audit found 20 prediction events, 0 settlements, and 0 conflicts; therefore the sample-size gate must currently remain closed.
- Production ledger writes, production environment changes, paid provider activation, model changes, merge, and production cutover are out of scope.

## Acceptance checklist

- [x] Add a pure readiness evaluator with stable gate codes and fail-closed handling.
- [x] Add tests for missing evidence, sample thresholds, conflicts, ID integrity, storage mode, and arithmetic consistency.
- [x] Document the interpretation and the no-model-change guardrail.
- [ ] Run targeted and full backend tests on the resulting commit.
- [ ] Observe CI results.
- [ ] Accumulate at least 100 settled samples per model and 100 paired fixtures before performance review.
- [ ] Complete separate read-only staging and production-readiness review.
