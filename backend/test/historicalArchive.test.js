const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { ProviderError } = require("../services/apiFootballClient");
const { readArchive, reconciledSettlement, saveSnapshot, settlePending, summarizeArchive } = require("../services/historicalArchive");

function tempPath() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "archive-")), "archive.json"); }
function analysis() { return { predictionEligible: true, fixture: { id: 10, date: "2026-09-20T12:00:00Z", home: { id: 1, name: "Home" }, away: { id: 2, name: "Away" }, league: "League", country: "Country" }, model: { version: "4.0", confidence: 70 }, recommendation: { bestMarket: { market: "1", probability: 55, fairOdds: 1.818, value: null } }, markets: { "1": { probability: 55 } }, dataQuality: { score: 75 }, homeForm: { games: 10 }, awayForm: { games: 10 }, h2h: { count: 2 }, standings: {}, statistics: {}, expectedGoals: { home: 1.4, away: 1.1 }, bookmakerOffers: {} }; }
function finishedFixture(home = 2, away = 1) { return { fixture: { status: { short: "FT" } }, goals: { home, away } }; }

test("ayni fixture ve model snapshot'i iki kez kaydedilmez", () => { const filePath = tempPath(); assert.equal(saveSnapshot(analysis(), { filePath }).saved, true); assert.equal(saveSnapshot(analysis(), { filePath }).reason, "duplicate"); assert.equal(readArchive(filePath).length, 1); });
test("prediction snapshot sonucu settlement sonrasinda degismez", async () => { const filePath = tempPath(); saveSnapshot(analysis(), { filePath }); const before = readArchive(filePath)[0].snapshot; await settlePending({ filePath, getFixture: async () => [finishedFixture()] }); const after = readArchive(filePath)[0]; assert.deepEqual(after.snapshot, before); assert.deepEqual(after.result.finalScore, { home: 2, away: 1 }); });
test("pending ve unavailable kayitlar performansa dahil edilmez", () => { const filePath = tempPath(); saveSnapshot(analysis(), { filePath }); const summary = summarizeArchive(readArchive(filePath)); assert.equal(summary.completed, 0); assert.equal(summary.successRate, null); });
test("quota hatasi settlement'i guvenle durdurur", async () => { const filePath = tempPath(); saveSnapshot(analysis(), { filePath }); const outcome = await settlePending({ filePath, getFixture: async () => { throw new ProviderError("quota", "quota"); } }); assert.equal(outcome.quotaStopped, true); assert.equal(readArchive(filePath)[0].result.status, "pending"); });
test("quota sonrasi tum arsiv kayitlari ortak bekleme suresine alinir", async () => {
  const filePath = tempPath();
  saveSnapshot(analysis(), { filePath });
  saveSnapshot({ ...analysis(), fixture: { ...analysis().fixture, id: 11 } }, { filePath });
  const now = () => "2026-10-15T10:00:00.000Z";
  const outcome = await settlePending({ filePath, getFixture: async () => { throw new ProviderError("quota", "quota"); }, now });
  const records = readArchive(filePath);
  assert.equal(outcome.quotaStopped, true);
  assert.equal(outcome.checked, 1);
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.equal(record.result.errorCategory, "quota");
    assert.equal(record.result.nextCheckAt, "2026-10-15T11:00:00.000Z");
  }
});
test("eksik fixture veya fake odds result olarak yazilmaz ve model surumu korunur", async () => { const filePath = tempPath(); const input = analysis(); saveSnapshot(input, { filePath }); await settlePending({ filePath, getFixture: async () => [] }); const record = readArchive(filePath)[0]; assert.equal(record.snapshot.modelVersion, "4.0"); assert.deepEqual(record.snapshot.bookmakerOffers, {}); assert.equal(record.result.status, "unavailable"); assert.equal(record.result.finalScore, null); });
test("verified olmayan completed sonuc performance hesabina dahil edilmez", async () => { const filePath = tempPath(); saveSnapshot(analysis(), { filePath }); await settlePending({ filePath, getFixture: async () => [finishedFixture()] }); const summary = summarizeArchive(readArchive(filePath)); assert.equal(summary.completed, 0); assert.equal(summary.successRate, null); });
test("verified sonuc market metriklerine dahil edilir, conflict dahil edilmez", async () => { const filePath = tempPath(); saveSnapshot(analysis(), { filePath }); const records = readArchive(filePath); records[0].result = { status: "completed", resultVerificationStatus: "verified", markets: { "1": true, X: false, "2": false } }; fs.writeFileSync(filePath, JSON.stringify([...records, { ...records[0], id: "conflict", result: { status: "completed", resultVerificationStatus: "conflict", markets: { "1": false } } }])); const summary = summarizeArchive(readArchive(filePath)); assert.equal(summary.verified, 1); assert.equal(summary.conflict, 1); assert.equal(summary.marketPerformance["1X2"].total, 1); });
test("eslesen iki provider sonucu verified, farkli skor conflict kalir", () => { const fixtures = [{ result: { homeGoals: 2, awayGoals: 1, status: "FT" } }, { result: { homeGoals: 2, awayGoals: 1, status: "FT" } }]; assert.equal(reconciledSettlement(fixtures).resultVerificationStatus, "verified"); assert.equal(reconciledSettlement([{ result: { homeGoals: 2, awayGoals: 1 } }, { result: { homeGoals: 1, awayGoals: 1 } }]).resultVerificationStatus, "conflict"); });