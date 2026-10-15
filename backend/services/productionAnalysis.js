const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { buildMatchStatistics } = require("./teamStatistics");
const { features } = require("./model41");
const { MODEL_4_0, MODEL_4_1, loadArtifact, selectedModel } = require("./modelVersions");
const { VERSION: HISTORY_VERSION, provenance } = require("./divisionHistory");
const STATISTICS_VERSION = `${HISTORY_VERSION}-previous-day`;
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function validateInputs(collected, artifact, now = Date.now()) {
  const day = collected.fixture.kickoff.slice(0, 10);
  const cutoff = Math.min(now, Date.parse(`${day}T00:00:00Z`));
  const profile = buildMatchStatistics(collected.fixture, { ...collected, now: cutoff });
  const details = { statisticsQuality: profile.dataQuality, historicalSampleSize: { home: profile.home.sampleSize, away: profile.away.sampleSize } };
  if (collected.fixture.dataConflict) return { ready: false, reason: "FIXTURE_DATA_CONFLICT", ...details };
  if (collected.fixture.kickoffPrecision === "date") return { ready: false, reason: "UNKNOWN_KICKOFF", ...details };
  if (day <= artifact.training.selectedThrough) return { ready: false, reason: "BEFORE_MODEL_SELECTION_CUTOFF", ...details };
  if (profile.home.sampleSize < 5 || profile.away.sampleSize < 5) return { ready: false, reason: "INSUFFICIENT_HISTORY", ...details };
  const values = features(profile);
  if (values.length !== artifact.classifier.normalizer.length || values.some((v, i) => v.name !== artifact.classifier.normalizer[i].name || v.group !== artifact.classifier.normalizer[i].group)) return { ready: false, reason: "FEATURE_SCHEMA_MISMATCH", ...details };
  if (values.some(v => !Number.isFinite(v.value) || !Number.isFinite(v.reliability))) return { ready: false, reason: "MISSING_CRITICAL_STATISTICS", ...details };
  return { ready: true, reason: null, ...details };
}
function assertPrediction(result) {
  const p = result?.probabilities;
  if (!result?.eligible || !p) throw Object.assign(new Error("Model 4.1 returned no eligible prediction"), { code: "MODEL41_NO_BET" });
  if (["home", "draw", "away", "over15", "over25", "over35", "bttsYes"].some(k => !Number.isFinite(p[k]) || p[k] <= 0 || p[k] >= 1) || Math.abs(p.home + p.draw + p.away - 1) > 1e-8) throw Object.assign(new Error("Invalid Model 4.1 probabilities"), { code: "INVALID_MODEL41_PROBABILITIES" });
}
class ProductionAnalysis {
  constructor({ collect, calculate, artifactLoader = loadArtifact, now = () => Date.now(), file = path.join(__dirname, "../data/model-shadow.json"), ttl = 60_000, ledger = null, logger = record => console.warn(JSON.stringify(record)) }) {
    Object.assign(this, { collect, calculate, artifactLoader, now, file, ttl, ledger, logger });
    this.inputs = new Map(); this.models = new Map(); this.pending = new Map(); this.records = new Map();
    this.metrics = { collections: 0, inputHits: 0, model40Runs: 0, model41Runs: 0, modelHits: 0 };
    if (file) { try { this.records = new Map(JSON.parse(fs.readFileSync(file, "utf8")).map(r => [r.key, r])); } catch { /* Optional shadow store. */ } }
  }
  async cached(map, key, work) {
    const cached = map.get(key);
    if (cached && cached.expiresAt > this.now()) return { value: cached.value, hit: true };
    if (this.pending.has(key)) return { value: await this.pending.get(key), hit: true };
    const task = Promise.resolve().then(work); this.pending.set(key, task);
    try { const value = await task; map.set(key, { value, expiresAt: this.now() + this.ttl }); while (map.size > 150) map.delete(map.keys().next().value); return { value, hit: false }; }
    finally { this.pending.delete(key); }
  }
  async analyze(fixtureId, { modelVersion, persist = true, recordLedger = true, allowPartial = false, onAnalyzed = null } = {}) {
    const requested = selectedModel(modelVersion);
    const input = await this.cached(this.inputs, `input:${fixtureId}:${STATISTICS_VERSION}`, async () => { this.metrics.collections++; return this.collect(fixtureId); });
    if (input.hit) this.metrics.inputHits++;
    const collected = input.value; const inputHash = hash(collected);
    const baseKey = `${fixtureId}:${MODEL_4_0}:${STATISTICS_VERSION}:${inputHash}${persist ? "" : ":readonly"}`;
    let base;
    try { base = await this.cached(this.models, baseKey, () => { this.metrics.model40Runs++; return this.calculate(collected, { persist, now: this.now() }); }); }
    catch (error) {
      if (!allowPartial) throw error;
      base = { value: null, hit: false };
      this.logger({ type: "MODEL40_RUNTIME_ERROR", fixture: fixtureId, error: error.message });
    }
    if (base.hit) this.metrics.modelHits++;
    let advanced = null; let reason = null; let fingerprint = null; let advancedHit = false;
    let readiness = { statisticsQuality: base.value?.statisticsProfile?.dataQuality || base.value?.dataQuality, historicalSampleSize: base.value?.historicalSampleSize || { home: base.value?.statisticsProfile?.home?.sampleSize || 0, away: base.value?.statisticsProfile?.away?.sampleSize || 0 } };
    try {
      // Always check the artifact BEFORE a cache lookup; a changed or corrupt
      // artifact cannot reuse a successful result from an older version.
      const loaded = this.artifactLoader(); fingerprint = loaded.fingerprint;
      readiness = validateInputs(collected, loaded.artifact, this.now());
      if (!readiness.ready) reason = readiness.reason;
      else {
        const key = `${fixtureId}:${MODEL_4_1}:${STATISTICS_VERSION}:${fingerprint}:${inputHash}`;
        const result = await this.cached(this.models, key, () => {
          this.metrics.model41Runs++;
          const value = this.calculate(collected, { persist: false, now: this.now(), model41Artifact: loaded.artifact });
          assertPrediction(value); return value;
        });
        advanced = result.value; advancedHit = result.hit;
        if (result.hit) this.metrics.modelHits++;
      }
    } catch (error) {
      const safeCodes = ["ARTIFACT_UNAVAILABLE", "ARTIFACT_SCHEMA_INVALID", "ARTIFACT_CODE_MISMATCH", "ARTIFACT_INTEGRITY_MISMATCH", "MODEL41_NO_BET", "INVALID_MODEL41_PROBABILITIES"];
      reason = safeCodes.includes(error.code) ? error.code : /feature (schema|order) mismatch/i.test(error.message) ? "FEATURE_SCHEMA_MISMATCH" : "MODEL41_RUNTIME_ERROR";
      this.logger({ type: "MODEL41_FALLBACK", fixture: fixtureId, requestedModelVersion: requested, actualModelVersion: MODEL_4_0, modelVersion: MODEL_4_1, error: error.message, fallbackReason: reason });
    }
    if (reason && readiness.reason === reason) this.logger({
      type: "MODEL41_FALLBACK",
      fixture: fixtureId,
      requestedModelVersion: requested,
      actualModelVersion: MODEL_4_0,
      modelVersion: MODEL_4_1,
      error: "Historical input validation failed",
      fallbackReason: reason,
      historicalSampleSize: readiness.historicalSampleSize || null,
      statisticsQuality: readiness.statisticsQuality ?? null,
      sourceMetadata: collected.sourceMetadata ? {
        fields: collected.sourceMetadata.fields || {},
        unavailable: collected.sourceMetadata.unavailable || {},
        historyAttempts: collected.sourceMetadata.historyAttempts || [],
      } : null,
    });
    if (!base.value && !advanced) throw Object.assign(new Error("No production model available"), { code: "NO_PRODUCTION_MODEL" });
    const actual = (requested === MODEL_4_1 || !base.value) && advanced ? MODEL_4_1 : MODEL_4_0;
    const metadata = { history: provenance(collected.homeMatches || [], collected.awayMatches || []), model41Available: Boolean(advanced), MODEL_4_1_READY: Boolean(advanced), model41FallbackReason: reason, statisticsQuality: readiness.statisticsQuality, historicalSampleSize: readiness.historicalSampleSize };
    const models = { [MODEL_4_0]: base.value ? { ...base.value, modelVersion: MODEL_4_0, ...metadata } : null, [MODEL_4_1]: advanced ? { ...advanced, modelVersion: MODEL_4_1, ...metadata } : null };
    const cache = { statisticsVersion: STATISTICS_VERSION, artifactVersion: fingerprint, inputVersion: inputHash, expiresAt: this.now() + this.ttl, inputHit: input.hit, model40Hit: base.hit, model41Hit: advancedHit };
    const response = { ...models[actual], requestedModelVersion: requested, models, cache };
    const key = `${fixtureId}:${STATISTICS_VERSION}:${fingerprint || "unavailable"}:${reason || "ready"}:${inputHash}`;
    if (persist && !this.records.has(key)) {
      const compact = result => result ? { modelVersion: result.modelVersion, probabilities: result.probabilities || null, rawProbabilities: result.model?.rawProbabilities || null, confidence: result.model?.confidence ?? null, statisticsQuality: result.statisticsQuality, historicalSampleSize: result.historicalSampleSize } : null;
      this.records.set(key, { key, fixtureId, kickoff: collected.fixture.kickoff, createdAt: new Date(this.now()).toISOString(), statisticsVersion: STATISTICS_VERSION, artifactVersion: fingerprint, fallbackReason: reason, model40: compact(models[MODEL_4_0]), model41: compact(models[MODEL_4_1]) });
      while (this.records.size > 2000) this.records.delete(this.records.keys().next().value);
      if (this.file) { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const tmp = `${this.file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify([...this.records.values()], null, 2), "utf8"); fs.renameSync(tmp, this.file); } catch (error) { this.logger({ type: "SHADOW_STORE_FAILED", fixture: fixtureId, error: error.message }); } }
    }
    if (this.ledger && recordLedger) {
      try { response.ledger = this.ledger.recordResponse(response, collected); }
      catch (error) {
        this.logger({ type: "LEDGER_WRITE_FAILED", fixture: fixtureId, error: error.message });
        response.ledger = [{ saved: false, reason: "LEDGER_STORAGE_ERROR" }];
      }
    }
    if (onAnalyzed) response.capture = await onAnalyzed(response, collected);
    return response;
  }
}
module.exports = { ProductionAnalysis, validateInputs, STATISTICS_VERSION, assertPrediction };
