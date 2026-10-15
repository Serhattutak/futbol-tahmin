const fs = require("fs");
const path = require("path");
const { ProviderError } = require("./apiFootballClient");
const { binaryMetrics, calibrationSummary } = require("./modelValidation");
const { normalizeStatus, normalizeProviderIds } = require("./fixtureNormalization");
const { reconcileResults } = require("./multiProviderRegistry");

const DEFAULT_PATH = path.join(__dirname, "..", "data", "historicalPredictions.json");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function readArchive(filePath = DEFAULT_PATH) { try { const value = JSON.parse(fs.readFileSync(filePath, "utf8")); return Array.isArray(value) ? value : []; } catch { return []; } }
function writeArchive(records, filePath = DEFAULT_PATH) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(records, null, 2), "utf8"); fs.renameSync(temporary, filePath); }

function buildSnapshot(analysis, createdAt = new Date().toISOString()) {
  if (!analysis?.predictionEligible || !analysis.fixture?.id || !analysis.fixture?.date || !analysis.model?.version) return null;
  const prediction = analysis.recommendation?.bestMarket;
  if (!prediction) return null;
  return {
    id: `${analysis.fixture.canonicalFixtureId || analysis.fixture.id}:${analysis.model.version}:${analysis.fixture.date}`,
    createdAt,
    snapshot: clone({
      fixtureId: analysis.fixture.id, canonicalFixtureId: analysis.fixture.canonicalFixtureId || null, providerFixtureIds: normalizeProviderIds(analysis.fixture.providerFixtureIds || (/^\d+$/.test(String(analysis.fixture.id)) ? { "api-football": analysis.fixture.id } : {})), sourceProviders: analysis.fixture.sourceProviders || analysis.sourceMetadata?.providers || [], createdAt, kickoff: analysis.fixture.date, homeTeam: analysis.fixture.home, awayTeam: analysis.fixture.away,
      historicalSampleSize: { home: analysis.homeForm?.games ?? 0, away: analysis.awayForm?.games ?? 0 },
      teams: { home: analysis.fixture.home, away: analysis.fixture.away },
      league: analysis.fixture.league, country: analysis.fixture.country, modelVersion: analysis.model.version,
      prediction: { market: prediction.market, probability: prediction.probability, fairOdds: prediction.fairOdds, value: prediction.value ?? null },
      probabilities: analysis.markets || {}, confidence: analysis.model.confidence, dataQuality: analysis.dataQuality,
      form: { home: analysis.homeForm, away: analysis.awayForm, homeVenue: analysis.homeVenueForm, awayVenue: analysis.awayVenueForm },
      h2h: analysis.h2h, standings: analysis.standings, statistics: analysis.statistics,
      expectedGoals: analysis.expectedGoals, bookmakerOffers: analysis.bookmakerOffers || {}, sourceAgreement: analysis.sourceAgreement,
      sourceMetadata: analysis.sourceMetadata || { providers: [], sourceCount: 0, verifiedFields: [], providerAvailability: {} },
    }),
    result: { status: "pending", checkedAt: null, completedAt: null, finalScore: null, actualWinner: null, totalGoals: null, bttsResult: null, markets: null },
  };
}

function saveSnapshot(analysis, { filePath, createdAt } = {}) {
  const record = buildSnapshot(analysis, createdAt);
  if (!record) return { saved: false, reason: "ineligible" };
  const records = readArchive(filePath);
  const existing = records.find((item) => item.id === record.id || (
    item.snapshot?.modelVersion === record.snapshot.modelVersion && item.snapshot?.kickoff === record.snapshot.kickoff && (
      String(item.snapshot?.fixtureId) === String(record.snapshot.fixtureId) ||
      Object.entries(normalizeProviderIds(item.snapshot?.providerFixtureIds)).some(([provider, id]) => record.snapshot.providerFixtureIds[provider] === id)
    )
  ));
  if (existing) return { saved: false, reason: "duplicate", record: clone(existing) };
  records.push(record); writeArchive(records, filePath); return { saved: true, record: clone(record) };
}

function resultMarkets(home, away) { const totalGoals = home + away; return { "1": home > away, X: home === away, "2": away > home, "1X": home >= away, X2: away >= home, "12": home !== away, "Üst 1.5": totalGoals > 1, "Alt 1.5": totalGoals < 2, "Üst 2.5": totalGoals > 2, "Alt 2.5": totalGoals < 3, "Üst 3.5": totalGoals > 3, "Alt 3.5": totalGoals < 4, "KG Var": home > 0 && away > 0, "KG Yok": home === 0 || away === 0 }; }
function settledResult(fixture, completedAt = new Date().toISOString()) {
  const home = fixture?.goals?.home; const away = fixture?.goals?.away;
  if (!Number.isFinite(home) || !Number.isFinite(away) || normalizeStatus(fixture?.fixture?.status?.short) !== "FINISHED") return null;
  return { status: "completed", resultVerificationStatus: "unverified", checkedAt: completedAt, completedAt, finalScore: { home, away }, actualWinner: home > away ? "home" : away > home ? "away" : "draw", totalGoals: home + away, bttsResult: home > 0 && away > 0, markets: resultMarkets(home, away) };
}

function reconciledSettlement(fixtures, completedAt = new Date().toISOString()) {
  const unique = (fixtures || []).filter((fixture, index, all) => !fixture.provider || all.findIndex((other) => other.provider === fixture.provider) === index);
  const reconciliation = reconcileResults(unique.filter((fixture) => !fixture?.result?.status || normalizeStatus(fixture.result.status) === "FINISHED").map((fixture) => fixture?.result));
  if (reconciliation.resultVerificationStatus === "unavailable") return null;
  if (reconciliation.resultVerificationStatus === "conflict") return { status: "completed", resultVerificationStatus: "conflict", checkedAt: completedAt, completedAt: null, finalScore: null, actualWinner: null, totalGoals: null, bttsResult: null, markets: null };
  return settledResult({ fixture: { status: { short: reconciliation.result.status } }, goals: { home: reconciliation.result.homeGoals, away: reconciliation.result.awayGoals } }, completedAt) && { ...settledResult({ fixture: { status: { short: reconciliation.result.status } }, goals: { home: reconciliation.result.homeGoals, away: reconciliation.result.awayGoals } }, completedAt), resultVerificationStatus: reconciliation.resultVerificationStatus };
}

async function settlePending({ getFixture, getResults, filePath, limit = 10, now = () => new Date().toISOString() }) {
  const records = readArchive(filePath); let changed = false; let checked = 0; let quotaStopped = false;
  for (const record of records) {
    if (!["pending", "unavailable"].includes(record.result?.status) || record.result?.retryable === false || checked >= limit) continue;
    if (record.result?.nextCheckAt && Date.parse(record.result.nextCheckAt) > Date.parse(now())) continue;
    checked += 1;
    try {
      const fixtures = getResults ? await getResults(Object.keys(record.snapshot.providerFixtureIds || {}).length ? record.snapshot.providerFixtureIds : (/^\d+$/.test(String(record.snapshot.fixtureId)) ? { "api-football": String(record.snapshot.fixtureId) } : {}), record.snapshot) : await getFixture(record.snapshot.fixtureId); const result = getResults ? reconciledSettlement(fixtures, now()) : settledResult(fixtures?.[0], now());
      if (result) { record.result = result; changed = true; }
      else if (!fixtures?.length) { record.result = { ...record.result, status: "unavailable", retryable: true, nextCheckAt: new Date(Date.parse(now()) + 15 * 60 * 1000).toISOString(), checkedAt: now() }; changed = true; }
    } catch (error) {
      const permanent = error.category === "unsupported";
      const quota = error instanceof ProviderError && error.category === "quota";
      const retryAt = new Date(Date.parse(now()) + (quota ? 60 : 15) * 60 * 1000).toISOString();
      record.result = { ...record.result, status: permanent ? "unavailable" : "pending", retryable: !permanent, errorCategory: error.category || "provider_unavailable", checkedAt: now(), nextCheckAt: retryAt }; changed = true;
      if (quota) {
        // One quota response applies to the shared result provider, not just this fixture.
        // Back off all pending archive checks so the next loop does not hammer the same endpoint.
        quotaStopped = true;
        for (const pending of records) {
          if (!["pending", "unavailable"].includes(pending.result?.status) || pending.result?.retryable === false) continue;
          pending.result = { ...pending.result, errorCategory: "quota", checkedAt: now(), nextCheckAt: retryAt };
          changed = true;
        }
        break;
      }
    }
  }
  if (changed) writeArchive(records, filePath);
  return { records, checked, quotaStopped };
}

function summarizeArchive(records) {
  const completed = records.filter((record) => record.result?.status === "completed" && record.result?.resultVerificationStatus === "verified"); const pending = records.filter((record) => record.result?.status === "pending"); const unavailable = records.filter((record) => record.result?.status === "unavailable"); const unverified = records.filter((record) => record.result?.resultVerificationStatus === "unverified"); const conflict = records.filter((record) => record.result?.resultVerificationStatus === "conflict"); const noBet = records.filter((record) => record.snapshot?.prediction?.market === "NO BET");
  const won = completed.filter((record) => record.result.markets?.[record.snapshot.prediction.market]).length;
  const groups = { "1X2": ["1", "X", "2"], "Çifte Şans": ["1X", "X2", "12"], "Üst/Alt": ["Üst 1.5", "Alt 1.5", "Üst 2.5", "Alt 2.5", "Üst 3.5", "Alt 3.5"], BTTS: ["KG Var", "KG Yok"], "Tahmini Skor": [] };
  const marketPerformance = Object.fromEntries(Object.entries(groups).map(([group, markets]) => {
    const predictions = completed.flatMap((record) => markets.map((market) => ({ probability: Number(record.snapshot?.probabilities?.[market]?.probability) / 100, outcome: record.result?.markets?.[market] })).filter((item) => Number.isFinite(item.probability) && typeof item.outcome === "boolean"));
    return [group, { ...binaryMetrics(predictions), calibration: calibrationSummary(predictions).calibrationError }];
  }));
  return { totalPredictions: records.length, completed: completed.length, verified: completed.length, unverified: unverified.length, conflict: conflict.length, pending: pending.length, unavailable: unavailable.length, noBet: noBet.length, coverage: records.length ? Number(((records.length - noBet.length) / records.length).toFixed(4)) : null, successful: won, failed: completed.length - won, successRate: completed.length ? Number((won / completed.length * 100).toFixed(2)) : null, marketPerformance, modelVersions: [...new Set(records.map((record) => record.snapshot?.modelVersion).filter(Boolean))], history: records.slice(-100).reverse().map(clone) };
}

module.exports = { DEFAULT_PATH, buildSnapshot, readArchive, reconciledSettlement, saveSnapshot, settlePending, settledResult, summarizeArchive };