#!/usr/bin/env python3
"""ZEUS Motor v2: one prediction for EVERY match + honest confidence tiers.

Model: multinomial logistic 1X2 + binary logistic goal markets on form/H2H/league
features plus Elo ratings (K=20, home=60, per league, frozen per day).
Split: train < 2021-07-01, validation 2021-07..2023-06 (tier thresholds),
locked test >= 2023-07-01 (reported hit rates only)."""
import argparse, json, sys
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import log_loss
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import engine_v2 as E

DROP = {"league_prior_matches", "home_history_matches", "away_history_matches"}
GOAL_MARKETS = {"O1.5": lambda h, a: h + a >= 2, "O2.5": lambda h, a: h + a >= 3, "U3.5": lambda h, a: h + a <= 3, "BTTS": lambda h, a: (h > 0) & (a > 0)}
HIT = {"1": lambda h, a: h > a, "X": lambda h, a: h == a, "2": lambda h, a: h < a, "1X": lambda h, a: h >= a, "X2": lambda h, a: h <= a, "12": lambda h, a: h != a,
       "O1.5": lambda h, a: h + a >= 2, "O2.5": lambda h, a: h + a >= 3, "U2.5": lambda h, a: h + a <= 2, "U3.5": lambda h, a: h + a <= 3,
       "BTTS": lambda h, a: (h > 0) & (a > 0), "NOBTTS": lambda h, a: ~((h > 0) & (a > 0))}
CANDIDATES = ["1", "2", "1X", "X2", "12", "O1.5", "O2.5", "U2.5", "U3.5", "BTTS", "NOBTTS"]
TIERS = [("banko", 0.92), ("guclu", 0.85), ("orta", 0.75)]

def wilson(k, n, z=1.96):
    if n == 0: return [None, None]
    p = k / n; d = 1 + z*z/n; c = (p + z*z/(2*n))/d; m = z*np.sqrt(p*(1-p)/n + z*z/(4*n*n))/d
    return [max(0, c-m), min(1, c+m)]

def market_probs(p1x2, goal):
    pa, pd_, ph = p1x2[:, 0], p1x2[:, 1], p1x2[:, 2]
    return {"1": ph, "X": pd_, "2": pa, "1X": ph + pd_, "X2": pa + pd_, "12": ph + pa,
            "O1.5": goal["O1.5"], "O2.5": goal["O2.5"], "U2.5": 1 - goal["O2.5"], "U3.5": goal["U3.5"],
            "BTTS": goal["BTTS"], "NOBTTS": 1 - goal["BTTS"]}

def choose(mp):
    names = CANDIDATES; M = np.vstack([mp[n] for n in names]).T
    idx = M.argmax(1); return np.array(names)[idx], M.max(1)

def hits(markets, hg, ag):
    return np.array([bool(HIT[m](h, a)) for m, h, a in zip(markets, hg, ag)])

ap = argparse.ArgumentParser(); ap.add_argument("--input", required=True); ap.add_argument("--model-out", required=True); ap.add_argument("--report-out", required=True); a = ap.parse_args()
rows = [json.loads(l) for l in open(a.input)]; rows.sort(key=lambda r: (r["date"], r["league"], r["id"]))
elos = E.add_elo(rows)
recs = []
for r, (eh, ea) in zip(rows, elos):
    f = {k: v for k, v in r["features"].items() if k not in DROP}; f.update(elo_home=eh, elo_away=ea, elo_diff=eh - ea + E.ELO_HOME)
    recs.append({**f, "date": r["date"], "league": r["league"], "hg": r["homeGoals"], "ag": r["awayGoals"]})
df = pd.DataFrame(recs); df["date"] = pd.to_datetime(df.date)
df = df[(df.home_last5_matches >= 3) & (df.away_last5_matches >= 3)]
feats = [c for c in recs[0] if c not in ("date", "league", "hg", "ag")]
tr, va, te = df[df.date < "2021-07-01"], df[(df.date >= "2021-07-01") & (df.date < "2023-07-01")], df[df.date >= "2023-07-01"]
med = tr[feats].median()
X = lambda d: pd.concat([d[feats].astype(float).fillna(med), d[feats].isna().astype(float).add_suffix("__missing")], axis=1)
Xtr, Xva, Xte = X(tr), X(va), X(te); sc = StandardScaler().fit(Xtr); scale = np.where(sc.scale_ == 0, 1, sc.scale_)
Z = lambda x: (x.values - sc.mean_) / scale
y3 = lambda d: np.where(d.hg > d.ag, 2, np.where(d.hg == d.ag, 1, 0))
m1x2 = LogisticRegression(max_iter=4000, C=0.5).fit(Z(Xtr), y3(tr))
goal_models = {n: LogisticRegression(max_iter=4000, C=0.5).fit(Z(Xtr), fn(tr.hg.values, tr.ag.values).astype(int)) for n, fn in GOAL_MARKETS.items()}
def predict(Xd):
    p = m1x2.predict_proba(Z(Xd)); g = {n: m.predict_proba(Z(Xd))[:, 1] for n, m in goal_models.items()}
    return p, market_probs(p, g)
pva, mva = predict(Xva); pte, mte = predict(Xte)
# tier thresholds on validation
vm, vp = choose(mva); vh = hits(vm, va.hg.values, va.ag.values)
thresholds = {}
grid = np.arange(0.55, 0.99, 0.005)
for tier, target in TIERS:
    t_found = None
    for t in grid:
        s = vp >= t
        if s.sum() < 150: break
        if vh[s].mean() >= target: t_found = float(round(t, 3)); break
    thresholds[tier] = t_found
tm, tp = choose(mte); th = hits(tm, te.hg.values, te.ag.values)
def tier_of(p):
    for tier, _ in TIERS:
        if thresholds[tier] is not None and p >= thresholds[tier]: return tier
    return "zayif"
tiers_te = np.array([tier_of(p) for p in tp])
report = {"split": {n: {"from": str(d.date.min().date()), "to": str(d.date.max().date()), "matches": int(len(d))} for n, d in (("train", tr), ("validation", va), ("test", te))},
          "thresholds": thresholds, "test1x2": {"accuracy": float((pte.argmax(1) == y3(te)).mean()), "logLoss": float(log_loss(y3(te), pte))},
          "testAllPicks": {"picks": int(len(th)), "hitRate": float(th.mean())}, "tiers": {}, "marketsChosen": {}}
for tier in ["banko", "guclu", "orta", "zayif"]:
    s = tiers_te == tier; n = int(s.sum()); k = int(th[s].sum())
    report["tiers"][tier] = {"picks": n, "hits": k, "hitRate": k / n if n else None, "wilson95": wilson(k, n), "share": n / len(th)}
for mk in CANDIDATES:
    s = tm == mk; n = int(s.sum())
    if n: report["marketsChosen"][mk] = {"picks": n, "hitRate": float(th[s].mean())}
# 1X2 most-likely accuracy per tier band of max 1X2 prob (for "MS tahmini")
conf = pte.max(1); bands = []
for lo, hi in ((0, .45), (.45, .55), (.55, .65), (.65, .75), (.75, 1.01)):
    s = (conf >= lo) & (conf < hi); n = int(s.sum())
    if n: bands.append({"from": lo, "to": min(hi, 1), "picks": n, "hitRate": float((pte.argmax(1)[s] == y3(te)[s]).mean())})
report["msBands"] = bands
model = {"version": "zeus-motor-2.0", "features": feats, "columns": list(Xtr.columns), "medians": {k: float(v) for k, v in med.items()},
         "mean": sc.mean_.tolist(), "scale": scale.tolist(), "minHistory": 3,
         "elo": {"k": E.ELO_K, "home": E.ELO_HOME, "init": E.ELO_INIT},
         "oneXTwo": {"classes": ["2", "X", "1"], "coef": m1x2.coef_.tolist(), "intercept": m1x2.intercept_.tolist()},
         "goals": {n: {"coef": m.coef_[0].tolist(), "intercept": float(m.intercept_[0])} for n, m in goal_models.items()},
         "candidates": CANDIDATES, "thresholds": thresholds, "tiers": report["tiers"], "msBands": bands,
         "testPeriod": [report["split"]["test"]["from"], report["split"]["test"]["to"]]}
json.dump(model, open(a.model_out, "w"), indent=1); json.dump(report, open(a.report_out, "w"), indent=2)
print(json.dumps({k: report[k] for k in ("thresholds", "test1x2", "testAllPicks", "tiers", "marketsChosen", "msBands")}, indent=1))
