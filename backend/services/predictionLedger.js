const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { normalizeStatus } = require("./fixtureNormalization");
const DEFAULT_DIRECTORY = process.env.ZEUS_LEDGER_DIR ? path.join(path.resolve(process.env.ZEUS_LEDGER_DIR), "prediction-ledger") : path.join(__dirname, "../data/prediction-ledger");
const MODELS = ["MODEL_4_0", "MODEL_4_1"];
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const probability = p => Number.isFinite(p) && p >= 0 && p <= 1;
const instant = value => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
function historyPrecedesPrediction(row, now) {
  const value = row?.fixture?.date;
  if (typeof value !== "string") return false;
  const dateOnly = row.fixture.kickoffPrecision === "date" || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (dateOnly) {
    const day = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const start = Date.parse(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== day) return false;
    // A date-only result is safely historical only after that whole UTC day ended.
    return start + 86_400_000 - 1 < now;
  }
  return instant(value) && Date.parse(value) < now;
}
const RESULT_FIELDS = ["resultStatus", "actualHomeGoals", "actualAwayGoals", "actual1X2", "actualOver15", "actualOver25", "actualOver35", "actualBTTS", "settledAt", "predictionCorrect1X2", "brier1X2", "logLoss1X2", "predictionCorrectOver15", "predictionCorrectOver25", "predictionCorrectOver35", "predictionCorrectBTTS", "hybridPredictionCorrect", "hybridBrier", "hybridSettledAt"];
function snapshot(analysis, response, collected, now) {
  const fixture = collected?.fixture;
  if (!fixture || !instant(fixture.kickoff) || fixture.kickoffPrecision === "date") return { reason: "UNKNOWN_KICKOFF" };
  if (!Number.isFinite(now) || now >= Date.parse(fixture.kickoff)) return { reason: "KICKOFF_REACHED" };
  if (normalizeStatus(fixture.status) !== "SCHEDULED" || fixture.dataConflict || fixture.result) return { reason: "NOT_PRE_MATCH" };
  const histories = [collected.homeMatches, collected.awayMatches, collected.h2hMatches].flatMap(rows => rows || []);
  if (histories.some(row => !historyPrecedesPrediction(row, now))) return { reason: "HISTORY_AFTER_PREDICTION" };
  if (!analysis?.eligible) return { reason: "INELIGIBLE" };
  const p = analysis.probabilities;
  if (!p || ["home", "draw", "away", "over15", "over25", "over35", "bttsYes"].some(k => !probability(p[k])) || Math.abs(p.home + p.draw + p.away - 1) > 1e-8 || p.over15 < p.over25 || p.over25 < p.over35) return { reason: "INVALID_PROBABILITIES" };
  const usedModel = analysis.modelVersion;
  const cache = response.cache || {};
  if (!MODELS.includes(usedModel) || !cache.inputVersion || !cache.statisticsVersion || !analysis.fixture?.id) return { reason: "MISSING_METADATA" };
  const raw = analysis.model?.rawProbabilities;
  if (usedModel === MODELS[1] && (!cache.artifactVersion || !raw || ["home", "draw", "away"].some(k => !probability(raw[k])) || Math.abs(raw.home + raw.draw + raw.away - 1) > 1e-8)) return { reason: "INVALID_MODEL41_METADATA" };
  const artifactFingerprint = usedModel === MODELS[1] ? cache.artifactVersion : null;
  const fixtureId = String(analysis.fixture.id);
  const fallbackUsed = response.requestedModelVersion === MODELS[1] && !response.model41Available && usedModel === MODELS[0];
  const best = analysis.strongestPrediction;
  // Record one hybrid decision alongside the Model 4.0 snapshot only, so the
  // same fixture-level decision is not duplicated across both model snapshots.
  const hybrid = usedModel === MODELS[0] ? response.hybridRobot : null;
  const hybridRecommendation = hybrid?.status === "RECOMMEND" ? hybrid.recommendation : null;
  const record = {
    schemaVersion: 1, ledgerId: hash([fixtureId, usedModel, artifactFingerprint, cache.inputVersion]), fixtureId,
    canonicalFixtureId: fixture.canonicalFixtureId || null, providerFixtureIds: fixture.providerFixtureIds || {},
    fixtureDate: fixture.kickoff.slice(0, 10), kickoffTime: new Date(fixture.kickoff).toISOString(), league: analysis.fixture.league,
    homeTeam: analysis.fixture.home, awayTeam: analysis.fixture.away,
    predictionCreatedAt: new Date(now).toISOString(), minutesBeforeKickoff: (Date.parse(fixture.kickoff) - now) / 60000,
    requestedModel: response.requestedModelVersion, usedModel, modelVersion: usedModel, artifactFingerprint,
    statisticsVersion: cache.statisticsVersion, inputFingerprint: cache.inputVersion,
    dataQuality: analysis.dataQuality ?? null, statisticsQuality: analysis.statisticsQuality ?? null,
    providers: analysis.sourceMetadata?.providers || fixture.sources || [], historicalSampleHome: analysis.historicalSampleSize?.home ?? null, historicalSampleAway: analysis.historicalSampleSize?.away ?? null,
    homeProbability: p.home, drawProbability: p.draw, awayProbability: p.away,
    rawHomeProbability: raw?.home ?? null, rawDrawProbability: raw?.draw ?? null, rawAwayProbability: raw?.away ?? null,
    calibratedHomeProbability: usedModel === MODELS[1] ? p.home : null, calibratedDrawProbability: usedModel === MODELS[1] ? p.draw : null, calibratedAwayProbability: usedModel === MODELS[1] ? p.away : null,
    over15: p.over15, under15: 1 - p.over15, over25: p.over25, under25: 1 - p.over25, over35: p.over35, under35: 1 - p.over35, bttsYes: p.bttsYes, bttsNo: 1 - p.bttsYes,
    doubleChance1X: p.home + p.draw, doubleChanceX2: p.draw + p.away, doubleChance12: p.home + p.away,
    dnbHome: p.home + p.away ? p.home / (p.home + p.away) : null, dnbAway: p.home + p.away ? p.away / (p.home + p.away) : null,
    expectedHomeGoals: analysis.expectedGoals?.home ?? null, expectedAwayGoals: analysis.expectedGoals?.away ?? null, predictedScore: analysis.estimatedScore ?? null,
    strongestPrediction: best?.market ?? null, strongestPredictionProbability: best?.probability ?? null, modelConfidence: analysis.model?.confidence ?? null,
    fallbackUsed, fallbackReason: fallbackUsed ? response.model41FallbackReason : null,
    hybridRobotVersion: hybrid?.version ?? null,
    hybridStatus: hybrid?.status ?? null,
    hybridReason: hybrid?.reason ?? null,
    hybridMarket: hybridRecommendation?.market ?? null,
    hybridProbability: hybridRecommendation?.probability ?? null,
    hybridModel40Probability: hybridRecommendation?.model40Probability ?? null,
    hybridModel41Probability: hybridRecommendation?.model41Probability ?? null,
    hybridDisagreement: hybridRecommendation?.disagreement ?? null,
    ...Object.fromEntries(RESULT_FIELDS.map(k => [k, null])),
  };
  return { record: clone(record) };
}
function evaluate(record, home, away, now) {
  const actual1X2 = home > away ? "home" : home < away ? "away" : "draw";
  const ps = [record.homeProbability, record.drawProbability, record.awayProbability];
  const index = ["home", "draw", "away"].indexOf(actual1X2);
  const total = home + away;
  const result = { resultStatus: "settled", actualHomeGoals: home, actualAwayGoals: away, actual1X2, actualOver15: total > 1.5, actualOver25: total > 2.5, actualOver35: total > 3.5, actualBTTS: home > 0 && away > 0, settledAt: new Date(now).toISOString(), predictionCorrect1X2: ps.indexOf(Math.max(...ps)) === index, brier1X2: ps.reduce((sum, p, i) => sum + (p - Number(i === index)) ** 2, 0), logLoss1X2: -Math.log(Math.max(1e-15, Math.min(1 - 1e-15, ps[index]))) };
  if (record.hybridStatus === "RECOMMEND" && typeof record.hybridMarket === "string" && probability(record.hybridProbability)) {
    const hybridWon = ({
      "1": home > away, "X": home === away, "2": away > home,
      "1X": home >= away, "X2": away >= home, "12": home !== away,
      "OVER_1_5": total >= 2, "UNDER_1_5": total <= 1,
      "OVER_2_5": total >= 3, "UNDER_2_5": total <= 2,
      "OVER_3_5": total >= 4, "UNDER_3_5": total <= 3,
      "BTTS_YES": home > 0 && away > 0, "BTTS_NO": home === 0 || away === 0,
    })[record.hybridMarket];
    if (typeof hybridWon === "boolean") {
      result.hybridPredictionCorrect = hybridWon;
      result.hybridBrier = (record.hybridProbability - Number(hybridWon)) ** 2;
      result.hybridSettledAt = new Date(now).toISOString();
    }
  }
  for (const [name, key, outcome] of [["Over15", "over15", "actualOver15"], ["Over25", "over25", "actualOver25"], ["Over35", "over35", "actualOver35"], ["BTTS", "bttsYes", "actualBTTS"]]) {
    result[`predictionCorrect${name}`] = (record[key] >= .5) === result[outcome];
    result[`brier${name}`] = (record[key] - Number(result[outcome])) ** 2;
  }
  return result;
}
class PredictionLedger {
  constructor({ directory = DEFAULT_DIRECTORY, now = () => Date.now(), io = fs } = {}) { Object.assign(this, { directory, now, io }); this.running = null; this.cursor = 0; }
  // Publish a complete, fsynced event with an atomic no-replace link. Concurrent
  // processes cannot overwrite an existing snapshot or first settlement.
  append(name, event) {
    const io = this.io; io.mkdirSync(this.directory, { recursive: true });
    const destination = path.join(this.directory, name + ".json");
    const temporary = path.join(this.directory, `${name}.${crypto.randomUUID()}.tmp`);
    let fd;
    try {
      fd = io.openSync(temporary, "wx"); io.writeFileSync(fd, JSON.stringify(event, null, 2)); io.fsyncSync(fd); io.closeSync(fd); fd = undefined;
      try { io.linkSync(temporary, destination); return true; } catch (error) { if (error.code === "EEXIST") return false; throw error; }
    } finally { if (fd !== undefined) io.closeSync(fd); if (io.existsSync(temporary)) io.unlinkSync(temporary); }
  }
  events() {
    if (!this.io.existsSync(this.directory)) return [];
    return this.io.readdirSync(this.directory).filter(n => n.endsWith(".json")).sort().map(name => {
      const event = JSON.parse(this.io.readFileSync(path.join(this.directory, name), "utf8"));
      if (!event.ledgerId || !["prediction", "settlement", "conflict"].includes(event.type)) throw Error("INVALID_LEDGER_EVENT");
      return event;
    });
  }
  entries() {
    const events = this.events();
    const settlements = new Map(events.filter(e => e.type === "settlement").map(e => [e.ledgerId, e]));
    const conflicts = new Map();
    for (const e of events.filter(e => e.type === "conflict")) conflicts.set(e.ledgerId, [...(conflicts.get(e.ledgerId) || []), e]);
    return events.filter(e => e.type === "prediction").map(e => ({ ...e.snapshot, ...settlements.get(e.ledgerId)?.result, conflicts: conflicts.get(e.ledgerId) || [] })).sort((a, b) => a.predictionCreatedAt.localeCompare(b.predictionCreatedAt) || a.ledgerId.localeCompare(b.ledgerId));
  }
  recordResponse(response, collected, { guard = () => null } = {}) {
    const now = this.now();
    return Object.values(response.models || {}).filter(Boolean).map(analysis => {
      const reason = guard(collected.fixture, now);
      if (reason) return { model: analysis.modelVersion, saved: false, reason };
      const built = snapshot(analysis, response, collected, now);
      if (!built.record) return { model: analysis.modelVersion, saved: false, reason: built.reason };
      const r = built.record;
      const saved = this.append(`prediction-${r.ledgerId}`, { type: "prediction", ledgerId: r.ledgerId, snapshot: r });
      return { model: r.usedModel, ledgerId: r.ledgerId, saved, reason: saved ? null : "DUPLICATE" };
    });
  }
  settle(ledgerId, fixtures) {
    const record = this.entries().find(r => r.ledgerId === ledgerId);
    if (!record) return { reason: "NOT_FOUND" };
    if (this.now() < Date.parse(record.kickoffTime)) return { reason: "NOT_STARTED" };
    const finals = fixtures.filter(f => f.provider && record.providerFixtureIds[f.provider] != null && f.providerFixtureId != null && String(record.providerFixtureIds[f.provider]) === String(f.providerFixtureId) && normalizeStatus(f.status) === "FINISHED" && normalizeStatus(f.result?.status) === "FINISHED" && Number.isInteger(f.result.homeGoals) && f.result.homeGoals >= 0 && Number.isInteger(f.result.awayGoals) && f.result.awayGoals >= 0);
    if (!finals.length) return { reason: "NO_FINAL_RESULT" };
    const scores = [...new Set(finals.map(f => `${f.result.homeGoals}:${f.result.awayGoals}`))];
    const [home, away] = scores[0].split(":").map(Number);
    const evidence = finals.map(f => ({ provider: f.provider, providerFixtureId: f.providerFixtureId, home: f.result.homeGoals, away: f.result.awayGoals }));
    if (scores.length > 1 || finals.some(f => f.dataConflict) || (record.resultStatus && (record.actualHomeGoals !== home || record.actualAwayGoals !== away))) {
      this.append(`conflict-${ledgerId}-${hash(scores.sort())}`, { type: "conflict", ledgerId, detectedAt: new Date(this.now()).toISOString(), evidence });
      return { reason: "RESULT_CONFLICT" };
    }
    const saved = this.append(`settlement-${ledgerId}`, { type: "settlement", ledgerId, result: { ...evaluate(record, home, away, this.now()), resultProviders: evidence, resultVerification: new Set(finals.map(f => f.provider)).size > 1 ? "verified" : "single_provider" } });
    if (!saved) {
      // Re-read after a competing writer wins, to audit a different score.
      const current = this.entries().find(r => r.ledgerId === ledgerId);
      if (current.actualHomeGoals !== home || current.actualAwayGoals !== away) return this.settle(ledgerId, fixtures);
    }
    return { saved, reason: saved ? null : "ALREADY_SETTLED" };
  }
  settleFromProviders(getResults, limit = 10) {
    if (this.running) return this.running;
    this.running = (async () => {
      // Recheck settled fixtures too: changed provider scores must become audit events.
      const groups = new Map();
      for (const r of this.entries().filter(r => Date.parse(r.kickoffTime) <= this.now())) groups.set(r.fixtureId, [...(groups.get(r.fixtureId) || []), r]);
      const all = [...groups.values()]; const results = [];
      for (let i = 0; i < Math.min(limit, all.length); i++) {
        const rows = all[(this.cursor + i) % all.length];
        try { const fixtures = await getResults(rows[0].providerFixtureIds); for (const r of rows) results.push(this.settle(r.ledgerId, fixtures)); }
        catch (error) { results.push({ fixtureId: rows[0].fixtureId, reason: error.category || "PROVIDER_UNAVAILABLE" }); if (error.category === "quota") break; }
      }
      this.cursor = all.length ? (this.cursor + Math.min(limit, all.length)) % all.length : 0;
      return results;
    })().finally(() => { this.running = null; });
    return this.running;
  }
}
module.exports = { PredictionLedger, snapshot, evaluate, DEFAULT_DIRECTORY, MODELS };
