#!/usr/bin/env python3
"""Offline, research-only benchmark for historical ZEUS pre-match features.

This script does not write to production or change live recommendations.
Install the optional research dependencies with:
    python -m pip install -r research/requirements.txt
Run it with:
    python research/benchmark_historical_model.py --input rows.jsonl --out benchmark.json
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss


ITERATIONS = (100, 200)
CONFIDENCE_GATE = 0.75
LABELS_1X2 = ["A", "D", "H"]


def wilson_interval(successes, n, z=1.96):
    if n <= 0:
        return {"low": None, "high": None}
    p = successes / n
    denominator = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denominator
    margin = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator
    return {"low": max(0.0, center - margin), "high": min(1.0, center + margin)}


def selective_summary(predicted, truth, confidence, gate=CONFIDENCE_GATE):
    selected = np.asarray(confidence) >= gate
    n = int(selected.sum())
    correct = int(np.sum(np.asarray(predicted)[selected] == np.asarray(truth)[selected]))
    return {
        "threshold": gate,
        "n": n,
        "correct": correct,
        "coverage": float(selected.mean()) if len(selected) else 0.0,
        "hitRate": correct / n if n else None,
        "wilson95": wilson_interval(correct, n),
    }


def make_model(iterations):
    return HistGradientBoostingClassifier(
        max_iter=iterations,
        learning_rate=0.08,
        max_leaf_nodes=15,
        l2_regularization=1.0,
        early_stopping=True,
        validation_fraction=0.1,
        n_iter_no_change=10,
        random_state=42,
    )


def safe_log_loss(y, probabilities, labels=None):
    return float(log_loss(y, probabilities, labels=labels))


def multiclass_brier(y, probabilities, labels):
    truth = np.column_stack([(np.asarray(y) == label).astype(float) for label in labels])
    return float(np.mean(np.sum((probabilities - truth) ** 2, axis=1)))


def align_multiclass(probabilities, classes, labels):
    return probabilities[:, [list(classes).index(label) for label in labels]]


def target_map(frame):
    outcome = frame["outcome"].astype(str)
    total = frame["homeGoals"].astype(int) + frame["awayGoals"].astype(int)
    home_goals = frame["homeGoals"].astype(int)
    away_goals = frame["awayGoals"].astype(int)
    return {
        "home_or_draw": ((outcome == "H") | (outcome == "D")).astype(int),
        "away_or_draw": ((outcome == "A") | (outcome == "D")).astype(int),
        "no_draw": ((outcome == "H") | (outcome == "A")).astype(int),
        "over_1_5": (total >= 2).astype(int),
        "over_2_5": (total >= 3).astype(int),
        "under_3_5": (total <= 3).astype(int),
        "btts_yes": ((home_goals > 0) & (away_goals > 0)).astype(int),
    }


def chronological_split(frame, train_fraction=0.6, validation_fraction=0.2):
    if not (0 < train_fraction < 1 and 0 < validation_fraction < 1 and train_fraction + validation_fraction < 1):
        raise ValueError("Training and validation fractions must be between 0 and 1 and sum to less than 1")
    first_index = min(len(frame) - 1, int(len(frame) * train_fraction))
    second_index = min(len(frame) - 1, int(len(frame) * (train_fraction + validation_fraction)))
    train_boundary = frame.iloc[first_index]["date"].date()
    test_boundary = frame.iloc[second_index]["date"].date()
    train = frame[frame["date"].dt.date < train_boundary].copy()
    validation = frame[
        (frame["date"].dt.date >= train_boundary) &
        (frame["date"].dt.date < test_boundary)
    ].copy()
    test = frame[frame["date"].dt.date >= test_boundary].copy()
    if min(len(train), len(validation), len(test)) == 0:
        raise ValueError("Chronological split produced an empty partition")
    return train, validation, test, train_boundary, test_boundary


def choose_iterations(x_train, y_train, x_validation, y_validation, labels=None):
    candidates = []
    for iterations in ITERATIONS:
        model = make_model(iterations)
        model.fit(x_train, y_train)
        probabilities = model.predict_proba(x_validation)
        if labels is not None:
            probabilities = align_multiclass(probabilities, model.classes_, labels)
        candidates.append((safe_log_loss(y_validation, probabilities, labels=labels), iterations))
    return min(candidates, key=lambda item: (item[0], item[1]))[1], {
        str(iterations): score for score, iterations in candidates
    }


def run(input_path, output_path, train_fraction=0.6, validation_fraction=0.2):
    rows = []
    with Path(input_path).open("r", encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError("Invalid JSONL at line " + str(line_number)) from exc
            features = row.pop("features", {}) or {}
            rows.append({**row, **features})

    frame = pd.DataFrame(rows)
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce", utc=True).dt.tz_convert(None)
    frame = frame.dropna(subset=["date", "outcome", "homeGoals", "awayGoals"]).sort_values("date").reset_index(drop=True)
    train, validation, test, train_boundary, test_boundary = chronological_split(
        frame, train_fraction, validation_fraction
    )

    excluded = {
        "id", "date", "league", "country", "season", "home", "away",
        "homeGoals", "awayGoals", "outcome", "source", "sourceUrl",
    }
    features = [
        column for column in frame.columns
        if column not in excluded and pd.api.types.is_numeric_dtype(frame[column])
    ]
    x_train = train[features].replace([np.inf, -np.inf], np.nan)
    x_validation = validation[features].replace([np.inf, -np.inf], np.nan)
    x_test = test[features].replace([np.inf, -np.inf], np.nan)
    combined = pd.concat([train, validation], ignore_index=True)
    x_combined = combined[features].replace([np.inf, -np.inf], np.nan)

    result = {
        "method": (
            "Research-only HistGradientBoostingClassifier on all numeric pre-match features. "
            "Select max_iter from [100, 200] by validation log loss, refit on training+validation, "
            "and evaluate the later chronological test once. This is a secondary historical diagnostic: "
            "the same date window was previously inspected in exploratory feature mining, so it is not "
            "a pristine confirmatory holdout."
        ),
        "model": {
            "type": "HistGradientBoostingClassifier",
            "maxIterationsCandidates": list(ITERATIONS),
            "learningRate": 0.08,
            "maxLeafNodes": 15,
            "l2Regularization": 1.0,
            "confidenceGate": CONFIDENCE_GATE,
            "features": len(features),
        },
        "split": {
            "total": len(frame),
            "training": len(train),
            "validation": len(validation),
            "test": len(test),
            "firstDate": str(frame.iloc[0]["date"].date()),
            "trainingLastDate": str(train.iloc[-1]["date"].date()),
            "validationFirstDate": str(validation.iloc[0]["date"].date()),
            "validationLastDate": str(validation.iloc[-1]["date"].date()),
            "testFirstDate": str(test.iloc[0]["date"].date()),
            "lastDate": str(frame.iloc[-1]["date"].date()),
            "trainingBoundary": str(train_boundary),
            "testBoundary": str(test_boundary),
        },
        "results": {},
    }

    y_train = train["outcome"].astype(str)
    y_validation = validation["outcome"].astype(str)
    y_test = test["outcome"].astype(str)
    best_iterations, validation_scores = choose_iterations(
        x_train, y_train, x_validation, y_validation, LABELS_1X2
    )
    model = make_model(best_iterations)
    model.fit(x_combined, combined["outcome"].astype(str))
    probabilities = align_multiclass(model.predict_proba(x_test), model.classes_, LABELS_1X2)
    predicted = np.asarray(LABELS_1X2)[probabilities.argmax(axis=1)]
    confidence = probabilities.max(axis=1)
    prior = np.asarray([(y_train == label).mean() for label in LABELS_1X2])
    majority_label = LABELS_1X2[int(np.argmax(prior))]
    result["results"]["1X2"] = {
        "bestIterations": best_iterations,
        "validationLogLossByIterations": validation_scores,
        "testAccuracy": float(accuracy_score(y_test, predicted)),
        "testLogLoss": safe_log_loss(y_test, probabilities, LABELS_1X2),
        "testBrier": multiclass_brier(y_test, probabilities, LABELS_1X2),
        "trainingClassPrior": {label: float((y_train == label).mean()) for label in LABELS_1X2},
        "constantPriorTestLogLoss": safe_log_loss(y_test, np.tile(prior, (len(test), 1)), LABELS_1X2),
        "constantPriorTestBrier": multiclass_brier(y_test, np.tile(prior, (len(test), 1)), LABELS_1X2),
        "majorityClassTestAccuracy": float(np.mean(y_test.to_numpy() == majority_label)),
        "selective75": selective_summary(predicted, y_test.to_numpy(), confidence),
    }

    train_targets = target_map(train)
    validation_targets = target_map(validation)
    test_targets = target_map(test)
    combined_targets = target_map(combined)
    for market in train_targets:
        best_iterations, validation_scores = choose_iterations(
            x_train, train_targets[market], x_validation, validation_targets[market]
        )
        model = make_model(best_iterations)
        model.fit(x_combined, combined_targets[market])
        probabilities = model.predict_proba(x_test)[:, 1]
        truth = test_targets[market].to_numpy()
        predicted = (probabilities >= 0.5).astype(int)
        confidence = np.maximum(probabilities, 1 - probabilities)
        baseline_rate = float(train_targets[market].mean())
        result["results"][market] = {
            "bestIterations": best_iterations,
            "validationLogLossByIterations": validation_scores,
            "testAccuracyAt50": float(accuracy_score(truth, predicted)),
            "testLogLoss": safe_log_loss(truth, probabilities, labels=[0, 1]),
            "testBrier": float(brier_score_loss(truth, probabilities)),
            "trainingRate": baseline_rate,
            "constantTrainingRateTestLogLoss": safe_log_loss(
                truth, np.full(len(truth), baseline_rate), labels=[0, 1]
            ),
            "constantTrainingRateTestBrier": float(
                brier_score_loss(truth, np.full(len(truth), baseline_rate))
            ),
            "selective75": selective_summary(predicted, truth, confidence),
        }

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Historical archive JSONL")
    parser.add_argument("--out", default="historical-model-benchmark.json", help="Output JSON report")
    parser.add_argument("--train-fraction", type=float, default=0.6)
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    args = parser.parse_args()
    report = run(args.input, args.out, args.train_fraction, args.validation_fraction)
    print(json.dumps({"out": args.out, "split": report["split"], "results": report["results"]}, indent=2))


if __name__ == "__main__":
    main()
