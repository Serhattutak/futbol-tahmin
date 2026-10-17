#!/usr/bin/env python3
"""Research-only: find market/confidence gates whose hit rate on a LOCKED,
chronologically later test period is >= target. Thresholds are chosen on the
validation period only. Base rates are reported so trivially-likely markets
are not mistaken for model skill."""
import argparse, json
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.preprocessing import StandardScaler

def wilson(k, n, z=1.96):
    if n == 0: return (None, None)
    p = k / n; d = 1 + z*z/n; c = (p + z*z/(2*n))/d
    m = z*np.sqrt(p*(1-p)/n + z*z/(4*n*n))/d
    return (max(0, c-m), min(1, c+m))

MARKETS = {
    "1": lambda h,a: h>a, "X": lambda h,a: h==a, "2": lambda h,a: h<a,
    "1X": lambda h,a: h>=a, "X2": lambda h,a: h<=a, "12": lambda h,a: h!=a,
    "O0.5": lambda h,a: h+a>=1, "O1.5": lambda h,a: h+a>=2, "O2.5": lambda h,a: h+a>=3,
    "U2.5": lambda h,a: h+a<=2, "U3.5": lambda h,a: h+a<=3, "U4.5": lambda h,a: h+a<=4,
    "BTTS": lambda h,a: (h>0)&(a>0), "NoBTTS": lambda h,a: ~((h>0)&(a>0)),
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--model-out"); ap.add_argument("--target", type=float, default=0.90)
    ap.add_argument("--min-n", type=int, default=150)
    args = ap.parse_args()
    rows = [json.loads(l) for l in open(args.input)]
    df = pd.DataFrame([{**r["features"], "date": r["date"], "league": r["league"], "hg": r["homeGoals"], "ag": r["awayGoals"]} for r in rows])
    df["date"] = pd.to_datetime(df["date"]); df = df.sort_values("date").reset_index(drop=True)
    # require some history so the model is not guessing on empty features
    df = df[(df.home_last5_matches >= 3) & (df.away_last5_matches >= 3)].reset_index(drop=True)
    feats = [c for c in df.columns if c not in ("date","league","hg","ag")]
    tr = df[df.date < "2021-07-01"]; va = df[(df.date >= "2021-07-01") & (df.date < "2023-07-01")]; te = df[df.date >= "2023-07-01"]
    med = tr[feats].median()
    def X(d):
        x = d[feats].astype(float)
        miss = x.isna().astype(float).add_suffix("_missing")
        return pd.concat([x.fillna(med), miss], axis=1)
    Xtr, Xva, Xte = X(tr), X(va), X(te)
    sc = StandardScaler().fit(Xtr)
    out = {"split": {"train": [str(tr.date.min().date()), str(tr.date.max().date()), len(tr)],
                     "validation": [str(va.date.min().date()), str(va.date.max().date()), len(va)],
                     "test": [str(te.date.min().date()), str(te.date.max().date()), len(te)]},
           "target": args.target, "markets": {}}
    export = {"features": list(Xtr.columns), "medians": {k: float(v) for k,v in med.items()},
              "scalerMean": sc.mean_.tolist(), "scalerScale": sc.scale_.tolist(), "markets": {}}
    for name, fn in MARKETS.items():
        ytr, yva, yte = [fn(d.hg.values, d.ag.values).astype(int) for d in (tr, va, te)]
        lr = LogisticRegression(max_iter=2000, C=0.5).fit(sc.transform(Xtr), ytr)
        pva = lr.predict_proba(sc.transform(Xva))[:,1]; pte = lr.predict_proba(sc.transform(Xte))[:,1]
        gate = None
        for t in np.arange(0.50, 0.995, 0.005):
            s = pva >= t; n = int(s.sum())
            if n < args.min_n: break
            k = int(yva[s].sum())
            if wilson(k, n)[0] >= args.target: gate = round(float(t), 3); break
        rec = {"baseRateTest": float(yte.mean()), "baseRateValidation": float(yva.mean())}
        if gate is not None:
            s = pte >= gate; n = int(s.sum()); k = int(yte[s].sum())
            lo, hi = wilson(k, n)
            rec.update({"gate": gate, "testPicks": n, "testHits": k, "testHitRate": k/n if n else None,
                        "testCoverage": n/len(te), "testWilson95": [lo, hi], "liftOverBase": (k/n - yte.mean()) if n else None})
            export["markets"][name] = {"coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0]), "gate": gate,
                                       "testHitRate": k/n if n else None, "testPicks": n, "baseRate": float(yte.mean())}
        out["markets"][name] = rec
    json.dump(out, open(args.out, "w"), indent=2)
    if args.model_out: json.dump(export, open(args.model_out, "w"))
    print(json.dumps(out["split"]))
    for k, v in out["markets"].items():
        print(f"{k:7s} base={v['baseRateTest']:.3f} gate={v.get('gate')} picks={v.get('testPicks')} hit={v.get('testHitRate') and round(v['testHitRate'],3)} cov={v.get('testCoverage') and round(v['testCoverage'],3)} wilsonLo={v.get('testWilson95') and round(v['testWilson95'][0],3)}")
main()
