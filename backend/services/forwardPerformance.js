const { MODELS } = require("./predictionLedger");
const clean = r => r.resultStatus === "settled" && !r.conflicts.length;
function earliest(rows, key) {
  const selected = new Map();
  for (const r of [...rows].sort((a, b) => a.predictionCreatedAt.localeCompare(b.predictionCreatedAt) || a.ledgerId.localeCompare(b.ledgerId))) if (!selected.has(key(r))) selected.set(key(r), r);
  return [...selected.values()];
}
function metrics(rows) {
  const average = key => rows.length ? rows.reduce((sum, r) => sum + Number(r[key]), 0) / rows.length : null;
  return { sampleSize: rows.length, smallSample: rows.length < 100,
    "1X2": { accuracy: average("predictionCorrect1X2"), brier: average("brier1X2"), logLoss: average("logLoss1X2") },
    ...Object.fromEntries(["Over15", "Over25", "Over35", "BTTS"].map(k => [k, { accuracy: average(`predictionCorrect${k}`), brier: average(`brier${k}`) }])) };
}
function groupMetrics(rows, key) {
  return Object.fromEntries([...new Set(rows.map(key))].map(k => [k, metrics(rows.filter(r => key(r) === k))]));
}
function report(entries) {
  const models = Object.fromEntries(MODELS.map(model => {
    const all = entries.filter(r => r.usedModel === model);
    // Freeze the selection policy before considering results: earliest snapshot
    // per fixture/model. Later settled revisions cannot replace pending/conflicted firsts.
    const scored = earliest(all, r => r.fixtureId).filter(clean);
    return [model, { totalPredictions: all.length, settledPredictions: all.filter(r => r.resultStatus === "settled").length, pendingPredictions: all.filter(r => !r.resultStatus).length, conflictPredictions: all.filter(r => r.conflicts.length).length,
      ...metrics(scored), leagues: groupMetrics(scored, r => typeof r.league === "string" ? r.league : r.league?.name || "Unknown"),
      confidenceBuckets: groupMetrics(scored, r => !Number.isFinite(r.modelConfidence) ? "unknown" : r.modelConfidence < 50 ? "0-49" : r.modelConfidence < 70 ? "50-69" : "70-100") }];
  }));
  // Pair only snapshots sharing actual inputs and kickoff. One earliest pair
  // per fixture, chosen independently of outcomes.
  const pairedCandidates = [];
  const grouped = new Map();
  for (const row of entries) { const key = JSON.stringify([row.fixtureId, row.kickoffTime, row.inputFingerprint, row.statisticsVersion]); grouped.set(key, [...(grouped.get(key) || []), row]); }
  for (const rows of grouped.values()) {
    const a = earliest(rows.filter(r => r.usedModel === MODELS[0]), r => r.fixtureId)[0];
    const b = earliest(rows.filter(r => r.usedModel === MODELS[1]), r => r.fixtureId)[0];
    if (a && b) pairedCandidates.push({ ...a, pair: [a, b], predictionCreatedAt: a.predictionCreatedAt > b.predictionCreatedAt ? a.predictionCreatedAt : b.predictionCreatedAt });
  }
  const pairs = earliest(pairedCandidates, r => r.fixtureId).filter(r => r.pair.every(clean) && r.pair[0].actualHomeGoals === r.pair[1].actualHomeGoals && r.pair[0].actualAwayGoals === r.pair[1].actualAwayGoals);
  // Hybrid decisions are attached only to the earliest Model 4.0 snapshot to
  // avoid counting the same fixture twice. NO_BET decisions remain in the
  // denominator for coverage but not in the hit-rate denominator.
  const hybridDecisions = earliest(entries.filter(r => r.usedModel === MODELS[0] && r.hybridRobotVersion), r => r.fixtureId);
  const hybridSelected = hybridDecisions.filter(r => r.hybridStatus === "RECOMMEND");
  const hybridScored = hybridSelected.filter(r => clean(r) && typeof r.hybridPredictionCorrect === "boolean");
  const hybridAverage = key => hybridScored.length ? hybridScored.reduce((sum, r) => sum + Number(r[key]), 0) / hybridScored.length : null;
  const hybridRobot = {
    totalDecisions: hybridDecisions.length,
    selectedRecommendations: hybridSelected.length,
    noBetDecisions: hybridDecisions.filter(r => r.hybridStatus === "NO_BET").length,
    coverage: hybridDecisions.length ? hybridSelected.length / hybridDecisions.length : null,
    settledRecommendations: hybridSelected.filter(r => r.resultStatus === "settled").length,
    pendingRecommendations: hybridSelected.filter(r => !r.resultStatus).length,
    conflictedRecommendations: hybridSelected.filter(r => r.conflicts.length).length,
    scoredRecommendations: hybridScored.length,
    smallSample: hybridScored.length < 100,
    hitRate: hybridAverage("hybridPredictionCorrect"),
    brier: hybridAverage("hybridBrier"),
    markets: Object.fromEntries([...new Set(hybridScored.map(r => r.hybridMarket || "Unknown"))].map(market => {
      const rows = hybridScored.filter(r => (r.hybridMarket || "Unknown") === market);
      return [market, { sampleSize: rows.length, hitRate: rows.reduce((sum, r) => sum + Number(r.hybridPredictionCorrect), 0) / rows.length,
        brier: rows.reduce((sum, r) => sum + Number(r.hybridBrier), 0) / rows.length }];
    })),
  };
  return { source: "production_prediction_ledger", policy: "Earliest snapshot per fixture/model; paired comparison requires the same input fingerprint and kickoff. Conflicts excluded. No backtest data.", models, hybridRobot,
    comparison: { sampleSize: pairs.length, smallSample: pairs.length < 100, models: Object.fromEntries(MODELS.map((m, i) => [m, metrics(pairs.map(r => r.pair[i]))])) } };
}
function mountLedgerRoutes(app, ledger) {
  // Async-safe boundary for both the current filesystem ledger and the future
  // initialized async facade. Promise rejections must become explicit 503s.
  const safe = handler => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error(JSON.stringify({ type: "LEDGER_READ_FAILED", error: error.message }));
      if (!res.headersSent) res.status(503).json({ success: false, error: "Ledger kayıtları şu anda okunamıyor." });
    }
  };

  app.get("/api/ledger/status", safe(async (_req, res) => {
    const rows = await ledger.entries();
    res.json({
      success: true,
      total: rows.length,
      pending: rows.filter(r => !r.resultStatus).length,
      settled: rows.filter(r => r.resultStatus === "settled").length,
      conflicts: rows.filter(r => r.conflicts.length).length,
    });
  }));

  for (const status of ["entries", "pending", "settled"]) {
    app.get(`/api/ledger/${status}`, safe(async (req, res) => {
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
      const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
      const allRows = await ledger.entries();
      const rows = allRows
        .filter(r => status === "entries" || (status === "pending" ? !r.resultStatus : r.resultStatus === "settled"))
        .reverse();
      res.json({ success: true, total: rows.length, limit, offset, entries: rows.slice(offset, offset + limit) });
    }));
  }

  app.get("/api/ledger/performance", safe(async (_req, res) => {
    const rows = await ledger.entries();
    res.json({ success: true, report: report(rows) });
  }));

  app.get("/api/ledger/comparison", safe(async (_req, res) => {
    const rows = await ledger.entries();
    res.json({ success: true, comparison: report(rows).comparison });
  }));
}
module.exports = { report, metrics, mountLedgerRoutes };
