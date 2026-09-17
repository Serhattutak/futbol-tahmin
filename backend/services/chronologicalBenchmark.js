const crypto = require("node:crypto");
const { toCanonicalLegacy, toFrontendFixture } = require("./multiProviderRegistry");
const { normalizeStatus } = require("./fixtureNormalization");
const { selectHistory } = require("./historicalForm");
const { modelReport } = require("./benchmarkMetrics");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dayOf = fixture => fixture.fixture.date.slice(0, 10);

function completed(fixture) {
  return normalizeStatus(fixture?.fixture?.status?.short) === "FINISHED" && [fixture?.goals?.home, fixture?.goals?.away].every(v => Number.isInteger(v) && v >= 0) && Number.isFinite(Date.parse(fixture.fixture.date));
}

function replayInput(history, target) {
  const day = dayOf(target); const now = Date.parse(`${day}T00:00:00Z`);
  // Strip the target result before passing it to any feature/model function.
  const fixture = toCanonicalLegacy(target.provider || "openfootball", { ...target, goals: { home: null, away: null }, score: undefined, fixture: { ...target.fixture, status: { short: "SCHEDULED" } } });
  if (!fixture) throw Error("Invalid target fixture");
  const prior = history.filter(m => completed(m) && dayOf(m) < day && Date.parse(m.fixture.date) < now && m.fixture.id !== target.fixture.id)
    .filter(m => m.league?.name === target.league?.name && m.league?.country === target.league?.country)
    .map(m => ({ ...toFrontendFixture(toCanonicalLegacy(m.provider || "openfootball", m)), score: m.score }));
  const homeMatches = selectHistory(prior, { team: fixture.homeTeam, before: fixture.kickoff, now });
  const awayMatches = selectHistory(prior, { team: fixture.awayTeam, before: fixture.kickoff, now });
  const ids = [fixture.homeTeam.canonicalTeamId, fixture.awayTeam.canonicalTeamId];
  const h2hMatches = prior.filter(m => ids.includes(m.teams.home.id) && ids.includes(m.teams.away.id)).sort((a, b) => Date.parse(b.fixture.date) - Date.parse(a.fixture.date)).slice(0, 10);
  const all = [...homeMatches, ...awayMatches, ...h2hMatches];
  if (all.some(m => dayOf(m) >= day || Date.parse(m.fixture.date) >= now)) throw Error("Future-data leakage blocked");
  return { now, collected: { fixture, homeMatches, awayMatches, h2hMatches, standingsResponse: [], oddsResponse: [], recentStats: [], sourceMetadata: { providers: [...new Set(all.flatMap(m => m.providers))] } },
    audit: { cutoff: new Date(now).toISOString(), historyIds: [...new Set(all.map(m => m.fixture.id))], latestHistoryDay: all.length ? all.map(dayOf).sort().at(-1) : null } };
}

function runChronologicalBenchmark(fixtures, { from = "2025-08-01", to = "2026-07-31", now = Date.now(), predict } = {}) {
  if (!predict) predict = require("../server").analyzeCollectedFixture;
  const unique = new Map();
  for (const f of fixtures) if (completed(f) && Date.parse(f.fixture.date) < now) {
    const key = `${f.provider}:${f.fixture.id}`;
    if (unique.has(key) && JSON.stringify(unique.get(key).goals) !== JSON.stringify(f.goals)) throw Error(`Conflicting result: ${key}`);
    unique.set(key, f);
  }
  const sorted = [...unique.values()].sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || String(a.fixture.id).localeCompare(String(b.fixture.id)));
  const records = []; const history = []; const skipped = {}; let candidates = 0;
  for (let index = 0; index < sorted.length;) {
    const day = dayOf(sorted[index]); const batch = [];
    while (index < sorted.length && dayOf(sorted[index]) === day) batch.push(sorted[index++]);
    if (day >= from && day <= to) for (const target of batch) {
      candidates++;
      const input = replayInput(history, target);
      const baseline = predict(structuredClone(input.collected), { variant: "baseline", now: input.now, persist: false });
      const stats = predict(structuredClone(input.collected), { variant: "stats", now: input.now, persist: false });
      if (!baseline.eligible || !stats.eligible) {
        const reason = target.fixture.kickoffPrecision === "date" || target.fixture.date.length === 10 ? "unknownKickoff" : input.collected.homeMatches.length < 5 || input.collected.awayMatches.length < 5 ? "insufficientHistory" : "modelNoBet";
        skipped[reason] = (skipped[reason] || 0) + 1; continue;
      }
      const compact = p => ({ probabilities: p.probabilities, confidence: p.model.confidence, quality: p.dataQuality.score });
      records.push({ id: target.fixture.id, date: target.fixture.date, league: target.league.name, home: target.teams.home.name, away: target.teams.away.name, goals: target.goals, audit: input.audit, baseline: compact(baseline), stats: compact(stats) });
    }
    // Never expose a result to another target on the same day, even with a known time.
    history.push(...batch);
  }
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), modelVersion: "4.0", evaluation: { from, to, actualFrom: records[0]?.date ?? null, actualTo: records.at(-1)?.date ?? null },
    datasetHash: hash(sorted), pairedSampleHash: hash(records.map(r => r.id)), fixturesSupplied: sorted.length, candidates, evaluated: records.length, skipped,
    methodology: { cutoff: "Strictly previous provider calendar days (UTC day boundary); same-day results excluded", pairing: "Intersection of eligible predictions; identical input histories and targets", baseline: "Reconstructed pre-statistics Model 4.0 path: weightedStrength, original H2H, no empirical market blend or profile quality cap; not a versioned historical binary", missingInputs: ["pre-match standings", "odds", "shots", "possession", "provider xG"], baselineComparability: "Controlled ablation on result-only histories; not full historical live-provider coverage", brier: "1X2 sum of three squared errors (0..2); binary markets (0..1)", calibration: "Binary event frequency; 1X2 top-label confidence; all 0..100% bins included in ECE", confidence: "Fixed model confidence thresholds, reported per market; not probability calibration", leagueMinimum: 50, tuning: "None: no fitting, weight changes, calibration transform or threshold selection" },
    baseline: modelReport(records, "baseline"), stats: modelReport(records, "stats"), records };
}
module.exports = { runChronologicalBenchmark, replayInput, completed, hash };
