# ZEUS AI — Historical Feature Model Benchmark

**Status: research-only; do not promote this model to production.**

## Dataset and method

The public-domain OpenFootball archive contains 72,896 completed matches from 19 leagues, with 54 pre-match numeric features. Available coverage spans 2010-07-17 to 2026-05-24; this is not a complete 20-season archive.

The benchmark uses chronological calendar-day partitions. The pinned full-archive run and downloadable evidence artifact are recorded in [GitHub Actions run 38904714553](https://github.com/Serhattutak/futbol-tahmin/actions/runs/38904714553).

| Partition | Matches | Date range |
|---|---:|---|
| Training | 43,719 | Through 2020-07-03 |
| Validation | 14,592 | 2020-07-04 to 2023-08-25 |
| Later test | 14,585 | 2023-08-26 to 2026-05-24 |

A `HistGradientBoostingClassifier` was trained on all 54 numeric pre-match features. Validation log loss selected between 100 and 200 maximum iterations; both settings produced the same validation score, so the lower-complexity 100-iteration option was selected. The final estimator was refit on training plus validation and scored on the later period. The baseline uses only training-period class prevalence.

Reproduce the research run:

```bash
python -m pip install -r research/requirements.txt
python research/benchmark_historical_model.py \\
  --input /path/to/rows.jsonl \\
  --out /path/to/historical-model-benchmark.json
```

## Results

### 1X2

| Metric | Feature model | Training-prior baseline |
|---|---:|---:|
| Test accuracy | **48.57%** | 43.47% majority-class accuracy |
| Multiclass log loss | **1.0217** | 1.0753 |
| Multiclass Brier score | **0.6124** | 0.6506 |

At a fixed raw model-confidence threshold of 75%, the 1X2 model selected 370 of 14,585 test matches (2.54% coverage). It correctly predicted 312/370 (**84.32%**, Wilson 95% interval 80.27%–87.67%). This is a very selective subset, not an all-match success rate.

### Binary markets

The confidence-gated hit rate counts a pick on either side of each binary market, provided the model's raw probability for that side is at least 75%. Coverage is shown because hit rate without coverage is misleading.

| Market | Test accuracy at 50% | Log loss (model / baseline) | Brier (model / baseline) | Picks at 75% | Hit rate (Wilson 95% interval) | Coverage |
|---|---:|---:|---:|---:|---:|---:|
| Home or draw (1X) | 71.35% | 0.5757 / 0.6154 | 0.1956 / 0.2121 | 4,462 | **83.35%** (82.23%–84.41%) | 30.59% |
| Away or draw (X2) | 62.91% | 0.6419 / 0.6847 | 0.2257 / 0.2458 | 1,302 | **82.57%** (80.41%–84.53%) | 8.93% |
| No draw | 73.95% | 0.5709 / 0.5738 | 0.1917 / 0.1927 | 4,404 | **77.91%** (76.66%–79.11%) | 30.20% |
| Over 1.5 goals | 75.73% | 0.5483 / 0.5552 | 0.1818 / 0.1842 | 6,875 | **80.04%** (79.08%–80.97%) | 47.14% |
| Over 2.5 goals | 54.87% | 0.6853 / 0.6940 | 0.2461 / 0.2504 | 28 | 89.29% (72.80%–96.29%) | 0.19% |
| Under 3.5 goals | 70.56% | 0.5981 / 0.6077 | 0.2044 / 0.2084 | 4,012 | **77.02%** (75.69%–78.29%) | 27.51% |
| Both teams to score (yes/no) | 53.59% | 0.6889 / 0.6913 | 0.2479 / 0.2491 | 0 | No qualifying picks | 0.00% |

## Interpretation

- The feature model improves the training-prior baseline on 1X2 log loss and Brier score, but its all-match 1X2 accuracy remains below 50%.
- Some binary markets show observed hit rates above 75% at a fixed raw-probability threshold, with materially different coverage. Over 2.5 has only 28 selected picks and a wide interval; it is not sufficient evidence for promotion.
- The probabilities have **not** been separately calibrated. A raw 75% model probability is not a guarantee of 75% realised accuracy.
- Feature-rule association tests and classifier performance are different questions. A feature can correlate with an outcome without adding value to a production model once other features are included.

## Critical limitation: test-period contamination

The later test spans 2023-08-26 through 2026-05-24. The same archive and overlapping later dates were already inspected in the earlier exploratory feature-discovery report before this benchmark was run. Therefore these results are a **secondary historical diagnostic, not a pristine confirmatory test**. The model was not added to production, the live Model 4.0/4.1 weights were not changed, and no live pick gates were modified.

## Promotion gate

Do not promote this research model based on this report. Freeze the code and probability threshold, then collect a forward-only ledger where predictions and timestamps are saved before kickoff and settled against verified results afterward. Report accuracy, log loss, Brier score, calibration, confidence-gated hit rate, and coverage for all eligible picks including `NO BET`. Only a later, unseen forward period can provide independent evidence for a production decision.
