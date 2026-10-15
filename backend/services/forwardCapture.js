const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const defaults = require("./forwardCaptureConfig");
const { snapshot, MODELS } = require("./predictionLedger");
const { normalizeStatus } = require("./fixtureNormalization");
const { loadArtifact } = require("./modelVersions");
const iso = time => new Date(time).toISOString();
function windowReason(fixture, now, config = defaults) {
  if (!fixture?.providerFixtureId || !fixture.homeTeam?.name || !fixture.awayTeam?.name || fixture.dataConflict || fixture.kickoffPrecision !== "time" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(fixture.kickoff || "") || !Number.isFinite(Date.parse(fixture.kickoff))) return "INVALID_FIXTURE";
  if (Number(fixture.kickoff.slice(11, 13)) > 23 || new Date(`${fixture.kickoff.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== fixture.kickoff.slice(0, 10)) return "INVALID_FIXTURE";
  const minutes = (Date.parse(fixture.kickoff) - now) / 60_000;
  if (minutes <= 0) return "KICKOFF_REACHED";
  if (normalizeStatus(fixture.status) !== "SCHEDULED" || fixture.result) return "INVALID_FIXTURE";
  // OpenFootball's adapter assumes UTC for otherwise unqualified source times.
  // Historical scores remain usable, but that alone is not a reliable live kickoff.
  const sources = fixture.sources?.length ? fixture.sources : [fixture.provider];
  if (!sources.some(p => ["api-football", "sportmonks", "football-data", "thesportsdb"].includes(p))) return "UNVERIFIED_KICKOFF_SOURCE";
  if (minutes < config.minLeadMinutes) return "TOO_CLOSE_TO_KICKOFF";
  if (minutes > config.maxLeadMinutes) return "TOO_EARLY";
  return null;
}
function discoveryDates(now, config = defaults) {
  const dates = new Set();
  for (const timeZone of config.discoveryTimezones) for (const time of [now, now + config.maxLeadMinutes * 60_000]) dates.add(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time)));
  return [...dates].sort();
}
function safeError(error) { return ["quota", "timeout_network", "provider_unavailable", "authentication", "STALE_FIXTURES", "NO_PRODUCTION_MODEL"].includes(error?.category || error?.code) ? error.category || error.code : "CAPTURE_ERROR"; }
class ForwardCapture {
  constructor({ discover, analysis, ledger, now = () => Date.now(), config = {}, historicalCoverage = () => false, artifactFingerprint = () => loadArtifact().fingerprint, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), logger = row => console.warn(JSON.stringify(row)) }) {
    Object.assign(this, { discover, analysis, ledger, now, historicalCoverage, artifactFingerprint, sleep, logger });
    this.config = { ...defaults, ...config }; this.running = null; this.timer = null;
    this.state = { lastRunAt: null, lastSuccessfulRunAt: null, lastDurationMs: null, lastSummary: null, lastError: null, lastAttempts: {} };
    try { this.state = { ...this.state, ...JSON.parse(fs.readFileSync(path.join(this.config.directory, "status.json"), "utf8")) }; } catch { /* First run. */ }
  }
  acquire() {
    fs.mkdirSync(this.config.directory, { recursive: true });
    const lock = path.join(this.config.directory, "run.lock");
    for (let attempt = 0; attempt < 2; attempt++) {
      let fd;
      try { fd = fs.openSync(lock, "wx"); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: iso(this.now()) })); fs.closeSync(fd); return () => fs.unlinkSync(lock); }
      catch (error) {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* Already closed. */ } }
        if (error.code !== "EEXIST") throw error;
        // Serialize stale-lock recovery and re-read its owner inside the guard.
        // Never delete a replacement lock published by another recovering process.
        const recovery = `${lock}.recovery`; let recoveryFd;
        try { recoveryFd = fs.openSync(recovery, "wx"); } catch (guard) { if (guard.code === "EEXIST") return null; throw guard; }
        try {
          let owner;
          try { owner = JSON.parse(fs.readFileSync(lock, "utf8")); } catch { return null; }
          if (!Number.isInteger(owner.pid) || owner.pid <= 0) return null;
          try { process.kill(owner.pid, 0); return null; }
          catch (probe) { if (probe.code !== "ESRCH") return null; }
          fs.unlinkSync(lock);
          try { fd = fs.openSync(lock, "wx"); } catch (race) { if (race.code === "EEXIST") return null; throw race; }
          fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: iso(this.now()) })); fs.closeSync(fd);
          return () => fs.unlinkSync(lock);
        } finally { fs.closeSync(recoveryFd); fs.unlinkSync(recovery); }
      }
    }
    return null;
  }
  persistState() {
    const file = path.join(this.config.directory, "status.json"); const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2)); fs.renameSync(tmp, file); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  }
  status() {
    let state = this.state;
    try { state = JSON.parse(fs.readFileSync(path.join(this.config.directory, "status.json"), "utf8")); } catch { /* No completed run. */ }
    const rows = this.ledger.entries();
    const { lastAttempts: _attempts, ...publicState } = state;
    return { ...publicState, isRunning: Boolean(this.running) || fs.existsSync(path.join(this.config.directory, "run.lock")), schedulerActive: Boolean(this.timer), nextRunAt: this.nextRunAt || null,
      recordedPredictions: rows.length, recordedFixtures: new Set(rows.map(r => r.fixtureId)).size,
      window: { minLeadMinutes: this.config.minLeadMinutes, maxLeadMinutes: this.config.maxLeadMinutes } };
  }
  run({ dryRun = false } = {}) {
    if (this.running) return Promise.resolve({ skipped: true, reason: "ALREADY_RUNNING" });
    this.running = this.execute(dryRun).finally(() => { this.running = null; });
    return this.running;
  }
  async execute(dryRun) {
    let release; const started = this.now();
    try { release = this.acquire(); } catch (error) { this.logger({ type: "CAPTURE_LOCK_ERROR", error: error.message }); return { errors: 1, reason: "CAPTURE_LOCK_ERROR" }; }
    if (!release) return { skipped: true, reason: "ALREADY_RUNNING" };
    const summary = { dryRun, startedAt: iso(started), discoveredFixtures: 0, withinWindowFixtures: 0, eligibleFixtures: 0, previouslyCapturedFixtures: 0, capturedFixtures: 0, capturedPredictions: 0, wouldCapturePredictions: 0, duplicates: 0, skippedInsufficientData: 0, skippedOutsideWindow: 0, skippedKickoffReached: 0, skippedInvalidFixture: 0, deferredFixtures: 0, errors: 0, completePairs: 0, model40Only: 0, model41Only: 0, fixtures: [], discovery: [] };
    this.state.lastRunAt = iso(started);
    try {
      const existing = this.ledger.entries(); let artifact = null;
      try { artifact = this.artifactFingerprint(); } catch { /* Production handles unavailable artifact. */ }
      const fixtures = new Map();
      for (const date of discoveryDates(started, this.config)) {
        try {
          const batch = await this.discover(date);
          if (batch.stale) throw Object.assign(Error("Stale fixture list"), { code: "STALE_FIXTURES" });
          if (!batch.fixtures.length && batch.providerError?.some(e => e.category !== "no_data")) throw Object.assign(Error("Discovery providers unavailable"), { code: "provider_unavailable" });
          summary.discovery.push({ date, source: batch.source || null, count: batch.fixtures.length, providerError: batch.providerError || null });
          for (const f of batch.fixtures) fixtures.set(`${String(f.league?.country || "").toLowerCase()}:${f.canonicalFixtureId || `${f.provider}:${f.providerFixtureId}`}`, f);
        } catch (error) { summary.errors++; summary.discovery.push({ date, error: safeError(error) }); }
      }
      summary.discoveredFixtures = fixtures.size;
      const coverage = new Map([...fixtures.values()].map(f => [f, Boolean(this.historicalCoverage(f))]));
      summary.historicalCoverageLeagues = [...new Set([...fixtures.values()].filter(f => coverage.get(f)).map(f => f.league?.name))].sort();
      summary.analysedFixtures = 0;
      let analysed = 0;
      let uncoveredAnalysed = 0;
      for (const fixture of [...fixtures.values()].sort((a, b) => Number(coverage.get(b)) - Number(coverage.get(a)) || (Date.parse(this.state.lastAttempts[a.providerFixtureId]) || 0) - (Date.parse(this.state.lastAttempts[b.providerFixtureId]) || 0) || Date.parse(a.kickoff) - Date.parse(b.kickoff))) {
        const detail = { fixtureId: String(fixture.providerFixtureId || ""), league: fixture.league?.name || null, home: fixture.homeTeam?.name || null, away: fixture.awayTeam?.name || null, kickoff: fixture.kickoff || null };
        summary.fixtures.push(detail);
        const reject = reason => {
          detail.reason = reason;
          if (reason === "KICKOFF_REACHED") summary.skippedKickoffReached++;
          else if (["TOO_EARLY", "TOO_CLOSE_TO_KICKOFF"].includes(reason)) summary.skippedOutsideWindow++;
          else summary.skippedInvalidFixture++;
        };
        const reason = windowReason(fixture, this.now(), this.config);
        if (reason) { reject(reason); continue; }
        summary.withinWindowFixtures++;
        const saved = existing.filter(r => r.fixtureId === detail.fixtureId && Date.parse(r.kickoffTime) === Date.parse(fixture.kickoff));
        const pair = saved.find(a => a.usedModel === MODELS[0] && saved.some(b => b.usedModel === MODELS[1] && b.artifactFingerprint === artifact && b.inputFingerprint === a.inputFingerprint && b.statisticsVersion === a.statisticsVersion));
        if (pair) {
          detail.reason = "ALREADY_CAPTURED_PAIR"; detail.records = saved.filter(r => r.inputFingerprint === pair.inputFingerprint && (r.usedModel === MODELS[0] || r.artifactFingerprint === artifact)).map(r => ({ model: r.usedModel, ledgerId: r.ledgerId, saved: false, reason: "DUPLICATE" }));
          detail.dataQuality = Object.fromEntries(saved.filter(r => r.inputFingerprint === pair.inputFingerprint).map(r => [r.usedModel, { dataQuality: r.dataQuality, statisticsQuality: r.statisticsQuality }]));
          detail.minutesBeforeKickoff = (Date.parse(fixture.kickoff) - this.now()) / 60_000;
          summary.duplicates += detail.records.length; summary.completePairs++; summary.eligibleFixtures++; summary.previouslyCapturedFixtures++; continue;
        }
        if (analysed >= this.config.maxAnalysesPerRun) { detail.reason = "RUN_ANALYSIS_LIMIT"; summary.deferredFixtures++; continue; }
        // Unknown coverage is not proof of missing history. Keep a small rotating
        // probe budget while reserving the main budget for supported leagues.
        if (!coverage.get(fixture) && uncoveredAnalysed >= this.config.maxUncoveredAnalysesPerRun) { detail.reason = "HISTORY_COVERAGE_PROBE_LIMIT"; summary.deferredFixtures++; continue; }
        if (!coverage.get(fixture)) uncoveredAnalysed++;
        if (analysed++) await this.sleep(this.config.betweenAnalysesMs);
        summary.analysedFixtures++;
        detail.historicalCoverage = coverage.get(fixture);
        if (!dryRun) this.state.lastAttempts[detail.fixtureId] = iso(this.now());
        try {
          const result = await this.analysis.analyze(detail.fixtureId, { modelVersion: MODELS[1], persist: false, recordLedger: false, allowPartial: true,
            onAnalyzed: (response, collected) => {
              // Recheck the enriched source and current clock immediately before publishing.
              const late = windowReason(collected.fixture, this.now(), this.config);
              if (late) return { reason: late, records: [] };
              const candidates = Object.values(response.models).filter(Boolean).map(model => ({ model: model.modelVersion, ...snapshot(model, response, collected, this.now()) }));
              const valid = candidates.filter(c => c.record);
              detail.dataQuality = Object.fromEntries(Object.values(response.models).filter(Boolean).map(m => [m.modelVersion, { dataQuality: m.dataQuality, statisticsQuality: m.statisticsQuality, historicalSampleSize: m.historicalSampleSize }]));
              detail.minutesBeforeKickoff = (Date.parse(collected.fixture.kickoff) - this.now()) / 60_000;
              detail.kickoff = collected.fixture.kickoff;
              const records = dryRun ? candidates.map(c => ({ model: c.model, ledgerId: c.record?.ledgerId, saved: false, wouldSave: Boolean(c.record) && !existing.some(r => r.ledgerId === c.record.ledgerId), reason: c.reason || (existing.some(r => r.ledgerId === c.record?.ledgerId) ? "DUPLICATE" : "DRY_RUN") })) : this.ledger.recordResponse(response, collected, { guard: (f, time) => windowReason(f, time, this.config) });
              const rejectedWindow = records.find(r => ["KICKOFF_REACHED", "TOO_CLOSE_TO_KICKOFF", "TOO_EARLY", "INVALID_FIXTURE", "UNVERIFIED_KICKOFF_SOURCE"].includes(r.reason));
              if (rejectedWindow) return { reason: rejectedWindow.reason, records };
              return { records, validModels: valid.map(c => c.model), rejected: candidates.filter(c => !c.record).map(c => ({ model: c.model, reason: c.reason })), fallbackReason: response.model41FallbackReason };
            } });
          const capture = result.capture;
          if (!capture) throw Error("Production capture callback missing");
          if (capture.reason) { reject(capture.reason); continue; }
          detail.records = capture.records; detail.model41FallbackReason = capture.fallbackReason;
          const valid = capture.validModels;
          if (!valid.length) { summary.skippedInsufficientData++; detail.reason = "INSUFFICIENT_PRODUCTION_DATA"; detail.rejected = capture.rejected; continue; }
          summary.eligibleFixtures++;
          const writes = capture.records.filter(r => r.saved).length;
          summary.capturedPredictions += writes; if (writes) summary.capturedFixtures++;
          summary.wouldCapturePredictions += capture.records.filter(r => r.wouldSave).length;
          summary.duplicates += capture.records.filter(r => r.reason === "DUPLICATE").length;
          if (valid.length === 2) summary.completePairs++;
          else if (valid.includes(MODELS[0])) summary.model40Only++;
          else summary.model41Only++;
          detail.reason = dryRun ? "DRY_RUN" : writes ? "CAPTURED" : "DUPLICATE";
        } catch (error) { summary.errors++; detail.reason = safeError(error); this.logger({ type: "FORWARD_CAPTURE_ERROR", fixture: detail.fixtureId, error: error.message }); }
      }
      if (!summary.errors) this.state.lastSuccessfulRunAt = iso(this.now());
    } catch (error) { summary.errors++; this.logger({ type: "FORWARD_CAPTURE_ERROR", error: error.message }); }
    finally {
      summary.completedAt = iso(this.now());
      this.state.lastDurationMs = this.now() - started; this.state.lastSummary = summary; this.state.lastError = summary.errors ? "CAPTURE_COMPLETED_WITH_ERRORS" : null;
      try { this.persistState(); } catch (error) { summary.errors++; this.state.lastError = "CAPTURE_STATUS_WRITE_ERROR"; this.logger({ type: "CAPTURE_STATUS_WRITE_ERROR", error: error.message }); }
      try { release(); } catch (error) { this.logger({ type: "CAPTURE_UNLOCK_ERROR", error: error.message }); }
    }
    return summary;
  }
  startScheduler() {
    if (this.timer) return;
    this.nextRunAt = iso(this.now() + this.config.intervalMs);
    this.timer = setInterval(() => {
      this.nextRunAt = iso(this.now() + this.config.intervalMs);
      this.run().catch(error => { this.state.lastError = "SCHEDULER_ERROR"; this.logger({ type: "FORWARD_CAPTURE_SCHEDULER_ERROR", error: error.message }); });
    }, this.config.intervalMs);
    this.timer.unref?.();
  }
  stopScheduler() { clearInterval(this.timer); this.timer = null; this.nextRunAt = null; }
}
module.exports = { ForwardCapture, windowReason, discoveryDates };
