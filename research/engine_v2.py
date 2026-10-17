#!/usr/bin/env python3
"""Engine v2 research: Elo features + model comparison (LR vs HGB).
Chronological split as in train_banko.py. Prints 1X2 accuracy/logloss/brier and
selective hit-rate curves on the locked test period."""
import json, sys, math
import numpy as np, pandas as pd
from collections import defaultdict
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import log_loss, accuracy_score

ELO_K, ELO_HOME, ELO_INIT = 20.0, 60.0, 1500.0

def gd_mult(gd):
    gd = abs(gd)
    return 1.0 if gd <= 1 else 1.5 if gd == 2 else (11.0 + gd) / 8.0

def add_elo(rows):
    """rows sorted by date; per league; same-day batch frozen before update."""
    by_league = defaultdict(list)
    for i, r in enumerate(rows): by_league[(r["country"], r["league"])].append(i)
    out = [None] * len(rows)
    for idx in by_league.values():
        elo = {}
        i = 0
        while i < len(idx):
            d = rows[idx[i]]["date"]; batch = []
            while i < len(idx) and rows[idx[i]]["date"] == d: batch.append(idx[i]); i += 1
            for j in batch:
                r = rows[j]; h = elo.get(r["home"], ELO_INIT); a = elo.get(r["away"], ELO_INIT)
                out[j] = (h, a)
            for j in batch:
                r = rows[j]; h = elo.get(r["home"], ELO_INIT); a = elo.get(r["away"], ELO_INIT)
                exp_h = 1 / (1 + 10 ** ((a - h - ELO_HOME) / 400))
                s = 1.0 if r["homeGoals"] > r["awayGoals"] else 0.5 if r["homeGoals"] == r["awayGoals"] else 0.0
                delta = ELO_K * gd_mult(r["homeGoals"] - r["awayGoals"]) * (s - exp_h)
                elo[r["home"]] = h + delta; elo[r["away"]] = a - delta
    return out

if __name__ == "__main__":
    path = sys.argv[1]
    rows = [json.loads(l) for l in open(path)]
    rows.sort(key=lambda r: (r["date"], r["league"], r["id"]))
    elos = add_elo(rows)
    recs = []
    for r, (eh, ea) in zip(rows, elos):
        f = dict(r["features"]); f.update(elo_home=eh, elo_away=ea, elo_diff=eh - ea + ELO_HOME)
        recs.append({**f, "date": r["date"], "league": r["league"], "hg": r["homeGoals"], "ag": r["awayGoals"]})
    df = pd.DataFrame(recs); df["date"] = pd.to_datetime(df.date)
    df = df[(df.home_last5_matches >= 3) & (df.away_last5_matches >= 3)]
    DROP = {"league_prior_matches", "home_history_matches", "away_history_matches"}
    base = [c for c in rows[0]["features"] if c not in DROP]
    tr, va, te = df[df.date < "2021-07-01"], df[(df.date >= "2021-07-01") & (df.date < "2023-07-01")], df[df.date >= "2023-07-01"]
    y = lambda d: np.where(d.hg > d.ag, 2, np.where(d.hg == d.ag, 1, 0))
    def prep(feats):
        med = tr[feats].median()
        X = lambda d: pd.concat([d[feats].astype(float).fillna(med), d[feats].isna().astype(float).add_suffix("__m")], axis=1)
        return X(tr), X(va), X(te)
    for name, feats in [("base", base), ("base+elo", base + ["elo_home", "elo_away", "elo_diff"]), ("elo_only", ["elo_diff", "league_last100_home_win_rate", "league_last100_draw_rate"])]:
        Xtr, Xva, Xte = prep(feats)
        sc = StandardScaler().fit(Xtr)
        for mname, m in [("LR", LogisticRegression(max_iter=3000, C=0.5)), ("HGB", HistGradientBoostingClassifier(max_iter=300, learning_rate=0.04, max_leaf_nodes=15, l2_regularization=1.0))]:
            if mname == "LR": m.fit(sc.transform(Xtr), y(tr)); p = m.predict_proba(sc.transform(Xte)); pv = m.predict_proba(sc.transform(Xva))
            else: m.fit(Xtr, y(tr)); p = m.predict_proba(Xte); pv = m.predict_proba(Xva)
            yt = y(te); acc = accuracy_score(yt, p.argmax(1)); ll = log_loss(yt, p)
            # 1X = P(H)+P(D)
            p1x = p[:, 2] + p[:, 1]; v1x = pv[:, 2] + pv[:, 1]; hit1x = (yt >= 1)
            curve = []
            for cov in (0.02, 0.04, 0.08):
                t = np.quantile(v1x, 1 - cov); s = p1x >= t; curve.append(f"{int(cov*100)}%:{hit1x[s].mean():.3f}/{s.sum()}")
            # top pick any of H/A at confidence
            conf = p.max(1); top = []
            for cov in (0.05, 0.10, 0.25):
                t = np.quantile(pv.max(1), 1 - cov); s = conf >= t; top.append(f"{int(cov*100)}%:{(p.argmax(1)[s]==yt[s]).mean():.3f}/{s.sum()}")
            print(f"{name:9s} {mname:3s} acc={acc:.4f} logloss={ll:.4f} 1X {' '.join(curve)} | 1X2-top {' '.join(top)}", flush=True)
