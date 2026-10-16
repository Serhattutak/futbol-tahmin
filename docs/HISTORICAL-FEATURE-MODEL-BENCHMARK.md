# ZEUS AI — Historical Feature Model Benchmark

**Status: research-only; do not promote this model to production.**

## Dataset and method

The public-domain OpenFootball archive contains 72,896 completed matches from 19 leagues, with 54 pre-match numeric features. Available coverage spans 2010-07-17 to 2026-05-24; this is not a complete 20-season archive.

The benchmark uses chronological calendar-day partitions:

| Partition | Matches | Date range |
|---|---:|---|
| Training | 43,719 | Through 2020-07-03 |
| Validation | 14,592 | 2020-07-04 to 2023-08-25 |
| Later test | 14,585 | 2023-08-26 to 2026-05-24 |

A \`HistGradientBoostingClassifier\` was trained on all 54 numeric pre-match features. Validation log loss selected between 100 and 200 maximum iterations; both settings produced the same validation score, so the lower-complexity 100-iteration option was selected. The final estimator was refit on training plus validation and scored on the later period. The baseline uses only training-period class prevalence.

Reproduce the research run:

\`\`\`bash
python -m pip install -r research/requirements.txt
python research/benchmark_historical_model.py \\
  --input /path/to/rows.jsonl \\
  --out /path/to/historical-model-benchmark.json
\`\`\`

## Results

### 1X2

| Metric | Feature model | Training-prior baseline |
|---|---:|---:|
| Test accuracy | **48.63%** | 43.47% majority-class accuracy |
| Multiclass log loss | **1.0219** | 1.0753 |
| Multiclass Brier score | **0.6124** | 0.6506 |

At a fixed raw model-confidence threshold of 75%, the 1X2 model selected 352 of 14,585 test matches (2.41% coverage). It correctly predicted 294/352 (**83.52%**, Wilson 95% interval 79.29%–87.03%). This is a very selective subset, not an 83.52% all-match success rate.

### Binary markets

The confidence-gated hit rate counts a pick on either side of each binary market, provided the model's raw probability for that side is at least 75%. Coverage is shown because hit rate without coverage is misleading.

| Market | Test accuracy at 50% | Log loss (model / baseline) | Brier (model / baseline) | Picks at 75% | Hit rate (Wilson 95% interval) | Coverage |
|---|---:|---:|---:|---:|---:|---:|
| Home or draw (1X) | 71.16% | 0.5761 / 0.6154 | 0.1957 / 0.2121 | 4,343 | **83.31%** (82.17%–84.39%) | 29.78% |
| Away or draw (X2) | 63.09% | 0.6417 / 0.6847 | 0.2255 / 0.2458 | 1,240 | **83.39%** (81.21%–85.36%) | 8.50% |
| No draw | 73.95% | 0.5709 / 0.5738 | 0.1917 / 0.1927 | 4,446 | **77.58%** (76.33%–78.78%) | 30.48% |
| Over 1.5 goals | 75.73% | 0.5486 / 0.5552 | 0.1819 / 0.1842 | 6,936 | **79.80%** (78.84%–80.73%) | 47.56% |
| Over 2.5 goals | 55.04% | 0.6853 / 0.6940 | 0.2461 / 0.2504 | 41 | 80.49% (65.99%–89.77%) | 0.28% |
| Under 3.5 goals | 70.52% | 0.5979 / 0.6077 | 0.2043 / 0.2084 | 4,340 | **76.73%** (75.45%–77.96%) | 29.76% |
| Both teams to score (yes/no) | 53.32% | 0.6888 / 0.6913 | 0.2478 / 0.2491 | 0 | No qualifying picks | 0.00% |

## Interpretation

- The feature model improves the training-prior baseline on 1X2 log loss and Brier score, but its all-match 1X2 accuracy remains below 50%.
- Some binary markets show observed hit rates above 75% at a fixed raw-probability threshold, with materially different coverage. Over 2.5 has only 41 selected picks and a wide interval; it is not sufficient evidence for promotion.
- The probabilities have **not** been separately calibrated. A raw 75% model probability is not a guarantee of 75% realised accuracy.
- Feature-rule association tests and classifier performance are different questions. A feature can correlate with an outcome without adding value to a production model once other features are included.

## Critical limitation: test-period contamination

The later test spans 2023-08-26 through 2026-05-24. The same archive and overlapping later dates were already inspected in the earlier exploratory feature-discovery report before this benchmark was run. Therefore these results are a **secondary historical diagnostic, not a pristine confirmatory test**. The model was not added to production, the live Model 4.0/4.1 weights were not changed, and no live pick gates were modified.

## Promotion gate

Do not promote this research model based on this report. Freeze the code and probability threshold, then collect a forward-only ledger where predictions and timestamps are saved before kickoff and settled against verified results afterward. Report accuracy, log loss, Brier score, calibration, confidence-gated hit rate, and coverage for all eligible picks including \`NO BET\`. Only a later, unseen forward period can provide independent evidence for a production decision.
