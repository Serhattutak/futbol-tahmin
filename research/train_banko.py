#!/usr/bin/env python3
"""Train the ZEUS Banko selective robot (research -> exported logistic model).

Chronological split: train < 2021-07-01, validation 2021-07-01..2023-06-30,
locked test >= 2023-07-01. Gates are the validation-period confidence quantile;
the locked test period is only used to REPORT the hit rate, never to tune.
Tier is decided on VALIDATION hit rate only: banko >= --target, strong >= 0.80.
"""
import argparse, json
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

DROP = {"league_prior_matches", "home_history_matches", "away_history_matches"}  # depend on archive depth, not on form
MARKETS = {"1X": (lambda h, a: h >= a, 0.04), "U4.5": (lambda h, a: h + a <= 4, 0.05),
           "X2": (lambda h, a: h <= a, 0.03), "O1.5": (lambda h, a: h + a >= 2, 0.02), "1": (lambda h, a: h > a, 0.03)}

def wilson(k, n, z=1.96):
    p = k / n; d = 1 + z*z/n; c = (p + z*z/(2*n))/d; m = z*np.sqrt(p*(1-p)/n + z*z/(4*n*n))/d
    return [max(0, c-m), min(1, c+m)]

ap = argparse.ArgumentParser(); ap.add_argument("--input", required=True); ap.add_argument("--model-out", required=True)
ap.add_argument("--report-out", required=True); ap.add_argument("--target", type=float, default=0.90); a = ap.parse_args()
rows = [json.loads(l) for l in open(a.input)]
df = pd.DataFrame([{**r["features"], "date": r["date"], "league": r["league"], "hg": r["homeGoals"], "ag": r["awayGoals"]} for r in rows])
df["date"] = pd.to_datetime(df.date)
df = df[(df.home_last5_matches >= 3) & (df.away_last5_matches >= 3)]
feats = [c for c in rows[0]["features"] if c not in DROP]
tr, va, te = df[df.date < "2021-07-01"], df[(df.date >= "2021-07-01") & (df.date < "2023-07-01")], df[df.date >= "2023-07-01"]
med = tr[feats].median()
def X(d): return pd.concat([d[feats].astype(float).fillna(med), d[feats].isna().astype(float).add_suffix("__missing")], axis=1)
Xtr, Xva, Xte = X(tr), X(va), X(te); sc = StandardScaler().fit(Xtr)
cols = list(Xtr.columns); scale = np.where(sc.scale_ == 0, 1, sc.scale_)
model = {"version": "banko-1.0", "trainedOn": "OpenFootball public-domain archive", "features": feats, "columns": cols,
         "medians": {k: float(v) for k, v in med.items()}, "mean": sc.mean_.tolist(), "scale": scale.tolist(),
         "minHistory": 3, "markets": {}}
report = {"split": {n: {"from": str(d.date.min().date()), "to": str(d.date.max().date()), "matches": int(len(d))} for n, d in (("train", tr), ("validation", va), ("test", te))},
          "target": a.target, "markets": {}}
for name, (fn, cov) in MARKETS.items():
    y = [fn(d.hg.values, d.ag.values).astype(int) for d in (tr, va, te)]
    lr = LogisticRegression(max_iter=3000, C=0.5).fit((Xtr - sc.mean_) / scale, y[0])
    pv = lr.predict_proba((Xva - sc.mean_) / scale)[:, 1]; pt = lr.predict_proba((Xte - sc.mean_) / scale)[:, 1]
    gate = float(np.quantile(pv, 1 - cov)); s = pt >= gate; n = int(s.sum()); k = int(y[2][s].sum())
    sv = pv >= gate
    rec = {"gate": gate, "validationPicks": int(sv.sum()), "validationHitRate": float(y[1][sv].mean()),
           "testPicks": n, "testHits": k, "testHitRate": k / n, "testWilson95": wilson(k, n), "testCoverage": n / len(te),
           "testBaseRate": float(y[2].mean()), "tier": ("banko" if float(y[1][sv].mean()) >= a.target else "strong" if float(y[1][sv].mean()) >= 0.80 else None)}
    rec["kept"] = rec["tier"] is not None
    by_league = te[s].assign(hit=y[2][s]).groupby("league").hit.agg(["count", "mean"])
    rec["testByLeague"] = {lg: {"picks": int(r["count"]), "hitRate": float(r["mean"])} for lg, r in by_league.iterrows()}
    report["markets"][name] = rec
    if rec["kept"]:
        model["markets"][name] = {"coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0]), "gate": gate, "tier": rec["tier"],
                                  "testHitRate": rec["testHitRate"], "testPicks": n, "testWilson95": rec["testWilson95"],
                                  "testBaseRate": rec["testBaseRate"], "testPeriod": [report["split"]["test"]["from"], report["split"]["test"]["to"]]}
    print(f"{name:5s} gate={gate:.3f} val={rec['validationHitRate']:.3f}({rec['validationPicks']}) test={rec['testHitRate']:.3f}({n}) wilson={rec['testWilson95'][0]:.3f}-{rec['testWilson95'][1]:.3f} base={rec['testBaseRate']:.3f} tier={rec['tier']}")
json.dump(model, open(a.model_out, "w"), indent=1); json.dump(report, open(a.report_out, "w"), indent=2)
