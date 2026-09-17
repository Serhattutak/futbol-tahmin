# Model 4.1 production verification — 2026-09-17

Status: implementation, terminal/API verification and automated checks pass. Per the user's updated scope, visual/interactive checks are marked **manuel browser QA gerekli**; browser QA is not claimed as passed.

1. Initial state: productionAnalysis, artifact validation, model selector, calibrated inference, isolated caches and 13 production tests already existed. Initial unrestricted suite: 111/111. No .git directory or Git executable was available, so a historical diff could not be established. Existing changes were retained.
2. This session: added requested/actual model fields to fallback logs, explicit calibrated 1X2 UI label, schema-fallback and invalid-simplex regression tests, and repeatable real-provider verification script.
3. Production flow: detail endpoint collects real inputs once, computes 4.0 and locked-artifact 4.1, returns the requested model plus both results. List analysis explicitly stays on 4.0. No runtime training.
4. Artifact: SHA256 `8a2be7d9c4fe131bbf6959c43be2b0245152478dec339d2f783ffb6bc2d72b82` matches locked report. Schema, feature order, finite weights, source-code hash and immutable load checks pass. Original benchmark report hash is unchanged.
5. Fallback: missing artifact, invalid schema, invalidated artifact, insufficient history, runtime failure and invalid probabilities preserve 4.0. San Luis–Antofagasta returned HTTP 200 with INSUFFICIENT_HISTORY and actual MODEL_4_0. No invented historical records.
6. Cache: keys contain model, statistics version, input fingerprint and 4.1 artifact fingerprint. Artifact is checked before using cached 4.1 output. Concurrent calls coalesce.
7. Frontend: both versions and comparison rows exist; selection tests use calibrated probabilities. Probability and model confidence have separate labels. Interactive browser verification is pending.
8. Real production fixture: Atletico Madrid–Osasuna, 1570384, 2026-09-16 17:00 UTC. Real historical source: openfootball; 10 home + 10 away observations; statistics quality 98/100. This is a production-path verification, not independent verification of provider fixture truth or a new benchmark.

| Metric | Model 4.0 | Model 4.1 calibrated |
|---|---:|---:|
| Home | 62.6369% | 51.3306% |
| Draw | 18.8194% | 26.5937% |
| Away | 18.5437% | 22.0757% |
| Over 1.5 | 85.3907% | 78.4780% |
| Over 2.5 | 69.0721% | 55.3125% |
| Over 3.5 | 46.2333% | 32.9495% |
| BTTS | 63.3888% | 56.8177% |
| Confidence (score /100) | 83 | 75 |

4.1 raw H/D/A: 55.9813% / 24.5644% / 19.4544%. Calibrated probabilities sum to 1 within 1e-10; models differ.

9. Repeat analysis: inputHit, model40Hit and model41Hit all true. Collection count 1; each model ran once. Historical metrics before and after repeat both loads=0, hits=2 (first analysis used durable history cache). Second analysis does not reach collection or historical provider calls. Full evidence: model41-production-verification.json. Reproduce with `node backend/scripts/verifyProduction41.js`.
10. Final tests: 113 PASS, 0 FAIL, 0 skipped. Standard `npm test` passed outside the sandbox; initial sandbox spawn EPERM was an environment restriction.
11. Final Vite production build PASS. Changed files lint clean and backend syntax checks pass. Wider lint reports existing warnings in App.jsx/server.js and browser profile files; these were not refactored.
12. Running frontend HTTP 200 at http://127.0.0.1:5173/; backend health, both saved report endpoints and actual 4.1 analysis HTTP 200. Browser runtime returned no available browsers, confirmed by an empty browser list. Home/list/detail/statistics/model-switch/comparison/report visual behavior and browser console errors are NOT verified.
13. Real `/api/football-test?date=2026-09-16` response contains 417 matches and San Luis–Antofagasta (1511694). This count belongs to September 16, not today's changing schedule.
14. Source changes this session: backend/services/productionAnalysis.js, backend/test/productionAnalysis.test.js, src/ModelSelector.jsx. Added backend/scripts/verifyProduction41.js and this report plus verification JSONs. Build regenerated dist; running production analysis may append existing prediction/shadow stores through their existing behavior. No ledger feature was developed.
15. Remaining check: **manuel browser QA gerekli** for visual appearance, clicks, selector/comparison interaction and browser console. User explicitly requested terminal/API verification and final reporting when the browser connection proved unavailable. API model switching and invalid-model HTTP 400 were also verified. Environment/config selection and Model 4.0 default are retained. .env, locked artifact, mathematical model sources and reference benchmark were not edited. No Model 4.2 work.
