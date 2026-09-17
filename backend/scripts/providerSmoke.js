// Deliberately bounded live smoke check: one discovery and at most one analysis.
const axios = require("axios");
const adapter = axios.getAdapter(axios.defaults.adapter);
const counts = {};
const requestLimit = 12;
axios.defaults.adapter = async (config) => {
  const host = new URL(config.url, config.baseURL).hostname;
  const provider = host.includes("sportmonks") ? "sportmonks" : host.includes("api-sports") ? "api-football" : host.includes("football-data") ? "football-data" : host.includes("githubusercontent") ? "openfootball" : "thesportsdb";
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total >= requestLimit || (provider === "api-football" && (counts[provider] || 0) >= 6)) {
    const error = new Error("Smoke request budget exhausted.");
    error.category = "quota";
    throw error;
  }
  counts[provider] = (counts[provider] || 0) + 1;
  return adapter(config);
};

const { providerRegistry, analyzeFixture } = require("../server");
const { readArchive, summarizeArchive } = require("../services/historicalArchive");

async function main() {
  const initialStatus = providerRegistry.getStatus();
  console.log(JSON.stringify({ phase: "provider-status", providers: initialStatus }));
  const report = { discoveryRequests: 0, analyzedFixtures: 0, fixture: null, analysis: null, readyForBeta: false };
  if (!initialStatus.some((provider) => provider.configured && provider.enabled)) return report;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86400000));
  report.date = date;
  report.discoveryRequests++;
  const fixtures = await providerRegistry.getFixtures(date);
  report.discovered = fixtures.length;
  const fixture = fixtures.find((item) => item.status === "SCHEDULED" && Date.parse(item.kickoff) > Date.now());
  if (fixture) {
    report.fixture = { id: fixture.providerFixtureId, canonicalFixtureId: fixture.canonicalFixtureId, providerFixtureIds: fixture.providerFixtureIds, home: fixture.homeTeam.name, away: fixture.awayTeam.name, kickoff: fixture.kickoff };
    report.analyzedFixtures++;
    try {
      const analysis = await analyzeFixture(fixture, { includeMatchStatistics: false });
      report.analysis = { status: analysis.predictionEligible ? "PREDICTION" : "INSUFFICIENT_DATA", eligible: analysis.predictionEligible, model: analysis.model, sourceMetadata: analysis.sourceMetadata, dataAvailability: analysis.dataAvailability };
    } catch (error) { report.analysis = { status: "FAILED", category: error.category || "provider_unavailable" }; }
  }
  const records = readArchive();
  report.archive = summarizeArchive(records);
  delete report.archive.history;
  report.archivedFixture = Boolean(fixture && records.some((record) => record.snapshot.canonicalFixtureId === fixture.canonicalFixtureId));
  return report;
}

main().then((report) => console.log(JSON.stringify({ ...report, providers: providerRegistry.getStatus(), requests: counts, totalRequests: Object.values(counts).reduce((sum, count) => sum + count, 0) }))).catch((error) => {
  console.log(JSON.stringify({ status: "FAILED", category: error.category || "provider_unavailable", providers: providerRegistry.getStatus(), requests: counts, totalRequests: Object.values(counts).reduce((sum, count) => sum + count, 0) }));
  process.exitCode = 1;
});
