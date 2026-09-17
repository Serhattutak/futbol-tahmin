// Read-only with respect to production: writes ONLY docs/audit evidence.
// Never imports server, runs inference, invokes capture, or writes provider caches.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { selectHistory, historicalTeamKey: key } = require("../services/historicalForm");
const { validateInputs } = require("../services/productionAnalysis");
const openFootball = require("../providers/openFootball");
const root = path.resolve(__dirname, "../..");
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), "utf8").replace(/^\uFEFF/, ""));
const save = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sourceTeamId = name => `of-team-${String(name).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "")}`;
const leagues = [
  ["Premier League", "England", "en.1.json"], ["La Liga", "Spain", "es.1.json"],
  ["Bundesliga", "Germany", "de.1.json"], ["Serie A", "Italy", "it.1.json"],
  ["Ligue 1", "France", "fr.1.json"], ["Eredivisie", "Netherlands", "nl.1.json"],
  ["Primeira Liga", "Portugal", "pt.1.json"], ["Scottish Premiership", "Scotland", "sco.1.json"],
];
function protectedHashes() {
  const files = [];
  const walk = dir => { for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) { const name = `${dir}/${item.name}`; if (item.isDirectory()) walk(name); else files.push(name); } };
  for (const dir of ["backend/data", "backend/services", "backend/providers", "src"]) walk(dir);
  files.push("backend/server.js", "backend/.env");
  return Object.fromEntries(files.sort().map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
}
function stats(matches, now) {
  const finished = matches.filter(m => ["FT", "FINISHED", "AET", "PEN"].includes(m.fixture?.status?.short) && Date.parse(m.fixture.date) < now && Number.isFinite(m.goals?.home) && Number.isFinite(m.goals?.away));
  return { matchCount: matches.length, finishedBeforeAuditCount: finished.length, teamCount: new Set(matches.flatMap(m => [m.teams.home.name, m.teams.away.name])).size, latestHistoricalMatchDate: finished.map(m => m.fixture.date).sort().at(-1) || null };
}
function select(matches, name, fixture, now) {
  return selectHistory(matches, { team: { name }, before: fixture.kickoff, fixtureId: fixture.providerFixtureId, now });
}
function brief(m) { return { fixtureId: m.fixture.id, kickoff: m.fixture.date, league: m.league.name, season: m.league.season, home: m.teams.home.name, away: m.teams.away.name, goals: m.goals }; }
async function main() {
  const before = protectedHashes();
  const frozen = read("docs/forward-capture-resumed-dry-run.json");
  const asOf = Date.parse(frozen.startedAt);
  const windowRows = frozen.fixtures.filter(f => ["INSUFFICIENT_PRODUCTION_DATA", "HISTORY_COVERAGE_PROBE_LIMIT", "RUN_ANALYSIS_LIMIT", "ALREADY_CAPTURED_PAIR", "DRY_RUN"].includes(f.reason));
  assert.equal(windowRows.length, 253);
  const fixtureEntries = read("backend/data/fixture-cache.json");
  const canonical = new Map(fixtureEntries.flatMap(([, e]) => e.fixtures).map(f => [String(f.providerFixtureId), f]));
  const historyEntries = read("backend/data/historical-cache.json");
  const localSets = [];
  for (const file of fs.readdirSync(path.join(root, "backend/data/backtest"))) {
    if (!/^(Premier-League|La-Liga|Bundesliga|Serie-A|Ligue-1)-\d{4}-\d{2}\.json$/.test(file)) continue;
    const data = read(`backend/data/backtest/${file}`);
    localSets.push({ league: data.league, season: data.season, matches: data.fixtures, source: `backend/data/backtest/${file}`, origin: "local-benchmark-read-only", ...stats(data.fixtures, asOf) });
  }
  // The cohort is classified before any optional network access.
  const metadata = windowRows.map(row => {
    const f = canonical.get(row.fixtureId);
    assert.ok(f, `Missing canonical metadata: ${row.fixtureId}`);
    assert.equal(f.kickoff, row.kickoff);
    const leagueMapped = openFootball.supportsHistoricalLeague(f.league);
    return { fixtureId: row.fixtureId, league: f.league.name, country: f.league.country, home: row.home, away: row.away, kickoff: row.kickoff, provider: f.provider, season: f.season, leagueMapped, deferredReason: row.reason, providerIdentityAvailable: Boolean(f.providerTeams?.["api-football"]?.home?.id && f.providerTeams?.["api-football"]?.away?.id) };
  });
  save("docs/historical-coverage-metadata.json", metadata);
  const evidenceFile = "docs/historical-coverage-source-evidence.json";
  let remote = fs.existsSync(path.join(root, evidenceFile)) ? read(evidenceFile) : [];
  if (process.argv.includes("--fetch-openfootball")) {
    for (const [league, , file] of leagues) for (const season of ["2024-25", "2025-26", "2026-27"]) {
      if (localSets.some(s => s.league === league && s.season === season) || remote.some(s => s.league === league && s.season === season && !s.error)) continue;
      const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${season}/${file}`;
      try { const matches = await openFootball.getSeasonFixtures(league, season); remote.push({ league, season, url, retrievedAt: new Date().toISOString(), normalizedSha256: hash(JSON.stringify(matches)), matches }); }
      catch (error) { remote.push({ league, season, url, retrievedAt: new Date().toISOString(), error: error.category || error.code || "unavailable", matches: [] }); }
      save(evidenceFile, remote);
      console.log(`Read ${league} ${season}: ${remote.at(-1).matches.length}`);
    }
    // Read-only diagnostic for a promoted team's previous division; no adapter change.
    const axios = require("axios");
    for (const season of ["2024-25", "2025-26"]) {
      if (remote.some(s => s.league === "Segunda División" && s.season === season)) continue;
      const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${season}/es.2.json`;
      try {
        const response = await axios.get(url, { timeout: 15000 });
        const matches = (response.data.matches || []).map(m => {
          const score = Array.isArray(m.score) ? m.score : m.score?.ft;
          return { provider: "openfootball", fixture: { id: `audit-es2-${m.date}-${key(m.team1)}-${key(m.team2)}`, date: m.time ? `${m.date}T${m.time.length === 5 ? m.time + ":00" : m.time}Z` : m.date, kickoffPrecision: m.time ? "time" : "date", status: { short: score ? "FINISHED" : "SCHEDULED" } }, league: { name: "Segunda División", country: "Spain", season }, teams: { home: { id: sourceTeamId(m.team1), name: m.team1 }, away: { id: sourceTeamId(m.team2), name: m.team2 } }, goals: { home: score?.[0] ?? null, away: score?.[1] ?? null } };
        });
        remote.push({ league: "Segunda División", season, url, retrievedAt: new Date().toISOString(), rawSha256: hash(JSON.stringify(response.data)), matches });
      } catch (error) { remote.push({ league: "Segunda División", season, url, retrievedAt: new Date().toISOString(), error: error.response?.status || error.code, matches: [] }); }
      save(evidenceFile, remote);
    }
  }
  const datasets = [...localSets, ...remote.map(s => ({ ...s, origin: "audit-public-source", ...stats(s.matches, asOf) }))];
  // Normalize source-derived audit IDs consistently when replaying older evidence.
  for (const s of datasets.filter(s => s.league === "Segunda División")) for (const m of s.matches) for (const team of Object.values(m.teams)) team.id = sourceTeamId(team.name);
  const artifact = read("backend/data/backtest/model41-artifact.json");
  const leakage = [];
  const rows = metadata.map(meta => {
    const f = canonical.get(meta.fixtureId);
    const localLeague = localSets.filter(s => s.league === meta.league && s.matches[0]?.league.country === meta.country).flatMap(s => s.matches);
    const currentPrevious = datasets.filter(s => s.league === meta.league && ["2026-27", "2025-26"].includes(s.season) && s.matches[0]?.league.country === meta.country).flatMap(s => s.matches);
    const countryLocal = localSets.flatMap(s => s.matches).filter(m => m.league.country === meta.country);
    const countryExpanded = datasets.flatMap(s => s.matches).filter(m => m.league.country === meta.country || meta.country === "World");
    const bestCached = name => historyEntries.map(([, e]) => e.value.matches).filter(ms => ms.some(m => m.league?.country === meta.country)).map(ms => select(ms, name, f, Math.min(asOf, Date.parse(`${f.kickoff.slice(0, 10)}T00:00:00Z`)))).sort((a, b) => b.length - a.length)[0] || [];
    const mapped = name => currentPrevious.some(m => [m.teams.home, m.teams.away].some(t => key(t.name) === key(name)));
    const cutoff = Math.min(asOf, Date.parse(`${f.kickoff.slice(0, 10)}T00:00:00Z`));
    const home = select(currentPrevious, meta.home, f, cutoff), away = select(currentPrevious, meta.away, f, cutoff);
    const lh = select(localLeague, meta.home, f, cutoff), la = select(localLeague, meta.away, f, cutoff);
    const ch = bestCached(meta.home), ca = bestCached(meta.away);
    const crossHome = select(countryLocal, meta.home, f, cutoff), crossAway = select(countryLocal, meta.away, f, cutoff);
    const expandedHome = select(countryExpanded, meta.home, f, cutoff), expandedAway = select(countryExpanded, meta.away, f, cutoff);
    const ready = validateInputs({ fixture: f, homeMatches: home, awayMatches: away }, artifact, asOf);
    for (const [scope, ms] of [["currentPreviousHome", home], ["currentPreviousAway", away], ["cachedHome", ch], ["cachedAway", ca], ["localCrossHome", crossHome], ["localCrossAway", crossAway], ["expandedHome", expandedHome], ["expandedAway", expandedAway]]) for (const m of ms) if (!(Date.parse(m.fixture.date) < cutoff && Date.parse(m.fixture.date) < Date.parse(f.kickoff))) leakage.push({ fixtureId: meta.fixtureId, scope, historical: brief(m) });
    const reason = !meta.leagueMapped ? "OUTSIDE_CONFIGURED_OPENFOOTBALL_LEAGUES" : !mapped(meta.home) || !mapped(meta.away) ? "TEAM_NOT_FOUND_IN_INSPECTED_LEAGUE_SEASONS" : !ready.ready ? ready.reason : "INPUT_READY_INFERENCE_NOT_RUN";
    const expandedReady = validateInputs({ fixture: f, homeMatches: expandedHome, awayMatches: expandedAway }, artifact, asOf);
    return { ...meta, homeMapped: mapped(meta.home), awayMapped: mapped(meta.away), localHistoryPossible: Math.max(lh.length, ch.length) > 0 && Math.max(la.length, ca.length) > 0, localSamples: { home: Math.max(lh.length, ch.length), away: Math.max(la.length, ca.length) }, localCrossCompetitionSamples: { home: crossHome.length, away: crossAway.length }, expandedCrossCompetitionSamples: { home: expandedHome.length, away: expandedAway.length }, expandedInputReady: expandedReady.ready, historicalSamples: { home: home.length, away: away.length }, minimumSampleMet: home.length >= 5 && away.length >= 5, inputValidationReady: ready.ready, productionPredictionEligible: null, skipReason: reason, selectedHistory: { home: home.map(brief), away: away.map(brief) }, expandedSelectedHistory: expandedReady.ready ? { home: expandedHome.map(brief), away: expandedAway.map(brief) } : null, originalAnalysis: frozen.fixtures.find(r => r.fixtureId === meta.fixtureId)?.dataQuality || null };
  });
  const leagueStatus = leagues.map(([league, country]) => {
    const cohort = rows.filter(r => r.league === league && r.country === country);
    const sets = datasets.filter(s => s.league === league);
    return { league, country, windowFixtures: cohort.length, bothTeamsMapped: cohort.filter(r => r.homeMapped && r.awayMapped).length, minimumSample: cohort.filter(r => r.minimumSampleMet).length, inspectedSeasons: sets.map(s => ({ season: s.season, origin: s.origin, source: s.source || s.url, error: s.error || null, ...stats(s.matches, asOf) })), reason: cohort.length ? cohort.map(r => ({ fixtureId: r.fixtureId, reason: r.skipReason })) : "NO_FIXTURE_IN_FROZEN_CAPTURE_WINDOW" };
  });
  // Suggestions are cross-provider spelling candidates only; never auto-applied.
  const aliases = [];
  for (const f of canonical.values()) {
    const supported = datasets.filter(s => s.league === f.league.name && s.matches[0]?.league.country === f.league.country);
    if (!supported.length) continue;
    const names = [...new Set(supported.flatMap(s => s.matches.flatMap(m => [m.teams.home.name, m.teams.away.name])))];
    for (const team of [f.homeTeam, f.awayTeam]) {
      if (names.some(n => key(n) === key(team.name))) continue;
      const candidates = names.filter(n => key(n).includes(key(team.name)) || key(team.name).includes(key(n)));
      aliases.push({ league: f.league.name, country: f.league.country, apiName: team.name, candidates, fixtureId: f.providerFixtureId, inWindow: rows.some(r => r.fixtureId === f.providerFixtureId), action: "REVIEW_ONLY_NO_FUZZY_MATCH_APPLIED" });
    }
  }
  const malaga = rows.find(r => r.fixtureId === "1570390");
  const malagaSeasons = datasets.filter(s => ["La Liga", "Segunda División"].includes(s.league)).map(s => ({ league: s.league, season: s.season, source: s.source || s.url, error: s.error || null, allTeamMatches: s.matches.filter(m => [m.teams.home, m.teams.away].some(t => key(t.name) === key("Malaga"))).map(brief), historicalTeamMatches: select(s.matches, "Malaga", canonical.get("1570390"), Math.min(asOf, Date.parse("2026-09-17T00:00:00Z")) ).map(brief) }));
  const groupCounts = field => Object.fromEntries([...new Set(rows.map(r => r[field]))].map(k => [k, rows.filter(r => r[field] === k).length]));
  const localEnough = r => r.localSamples.home >= 5 && r.localSamples.away >= 5;
  const expandedEnough = r => r.expandedCrossCompetitionSamples.home >= 5 && r.expandedCrossCompetitionSamples.away >= 5;
  const apiConfig = require("dotenv").parse(fs.readFileSync(path.join(root, "backend/.env")));
  const apiEvidence = fs.existsSync(path.join(root, "docs/historical-coverage-api-evidence.json")) ? read("docs/historical-coverage-api-evidence.json") : null;
  const api2024Evidence = fs.existsSync(path.join(root, "docs/historical-coverage-api-2024-evidence.json")) ? read("docs/historical-coverage-api-2024-evidence.json") : null;
  const oldSeasonScenarios = [...new Set(api2024Evidence?.requests.map(r => r.fixtureId) || [])].map(id => {
    const f = canonical.get(id), cutoff = Math.min(asOf, Date.parse(`${f.kickoff.slice(0, 10)}T00:00:00Z`));
    const histories = Object.fromEntries(["home", "away"].map(side => {
      const request = api2024Evidence.requests.find(r => r.fixtureId === id && r.side === side);
      const raw = request?.matches || datasets.filter(s => s.league === f.league.name && ["2026-27", "2025-26"].includes(s.season)).flatMap(s => s.matches);
      return [side, select(raw, f[`${side}Team`].name, f, cutoff)];
    }));
    const validation = validateInputs({ fixture: f, homeMatches: histories.home, awayMatches: histories.away }, artifact, asOf);
    for (const ms of Object.values(histories)) for (const m of ms) assert.ok(Date.parse(m.fixture.date) < cutoff);
    return { fixtureId: id, home: f.homeTeam.name, away: f.awayTeam.name, homeSample: histories.home.length, awaySample: histories.away.length, inputReady: validation.ready, latestHomeMatch: histories.home[0]?.fixture.date, latestAwayMatch: histories.away[0]?.fixture.date, selectedHistory: { home: histories.home.map(brief), away: histories.away.map(brief) }, productionPredictionEligible: null, warning: "Older-season access is measured only. Stale samples and competition changes need a separate data policy; no season fallback or model change was applied." };
  });
  const configuration = { apiFootballConfigured: Boolean(apiConfig.API_FOOTBALL_KEY || process.env.API_FOOTBALL_KEY), apiFootballBudget: Number(apiConfig.API_FOOTBALL_DAILY_BUDGET || process.env.API_FOOTBALL_DAILY_BUDGET || 100), sportmonksConfigured: Boolean(apiConfig.SPORTMONKS_API_TOKEN || process.env.SPORTMONKS_API_TOKEN), footballDataConfigured: Boolean(apiConfig.FOOTBALL_DATA_API_TOKEN || process.env.FOOTBALL_DATA_API_TOKEN), meteredProviderCallsByAudit: (apiEvidence?.requests.length || 0) + (api2024Evidence?.requests.length || 0), publicBulkSourceRequests: remote.length, captureConfig: { ...require("../services/forwardCaptureConfig") } };
  delete configuration.captureConfig.directory;
  const after = protectedHashes();
  assert.deepEqual(after, before, "Production data or code changed during audit");
  const report = { generatedAt: new Date().toISOString(), cohortAsOf: frozen.startedAt, cohortSource: "docs/forward-capture-resumed-dry-run.json", note: "Frozen historical cohort, not a new live capture. Null production eligibility means inference deliberately not run. Unsupported means outside configured OpenFootball adapter, not globally unavailable from all providers.", configuration,
    funnel: { windowFixtures: rows.length, configuredSupportedLeagues: 8, supportedLeaguesRepresented: leagueStatus.filter(l => l.windowFixtures).length, supportedLeagueFixtures: rows.filter(r => r.leagueMapped).length, leagueMapped: rows.filter(r => r.leagueMapped).length, bothTeamsMapped: rows.filter(r => r.leagueMapped && r.homeMapped && r.awayMapped).length, historyLookupPossible: rows.filter(r => r.leagueMapped && r.homeMapped && r.awayMapped).length, minimumHistory: rows.filter(r => r.minimumSampleMet).length, productionInputReady: rows.filter(r => r.inputValidationReady).length, originalProductionEligible: frozen.eligibleFixtures, productionInferenceRunByAudit: 0 },
    categories: groupCounts("skipReason"), apiEvidence, api2024Evidence, oldSeasonScenarios, deferredReasons: groupCounts("deferredReason"), leagueStatus, fixtures: rows,
    diagnosticCounts: { exactLeagueNameWrongCountry: rows.filter(r => leagues.some(([name]) => name === r.league) && !r.leagueMapped).length, missingApiProviderIdentity: rows.filter(r => !r.providerIdentityAvailable).length, bothTeamMappingFailuresInsideSupportedLeague: rows.filter(r => r.leagueMapped && (!r.homeMapped || !r.awayMapped)).length, deferredOnlyByCaptureBudgetBeforeLookup: rows.filter(r => ["HISTORY_COVERAGE_PROBE_LIMIT", "RUN_ANALYSIS_LIMIT"].includes(r.deferredReason)).length, deferredByTwentyAnalysisLimit: rows.filter(r => r.deferredReason === "RUN_ANALYSIS_LIMIT").length, api2024InputReadyMeasured: oldSeasonScenarios.filter(r => r.inputReady).length },
    localFirst: { localSufficientWithinLeagueOrExistingCache: rows.filter(localEnough).length, localInsufficient: rows.filter(r => !localEnough(r)).length, localCrossCompetitionMinimumCandidates: rows.filter(r => r.localCrossCompetitionSamples.home >= 5 && r.localCrossCompetitionSamples.away >= 5).map(r => r.fixtureId), expandedCrossCompetitionMinimumCandidates: rows.filter(expandedEnough).map(r => r.fixtureId), notRoutableToConfiguredOpenFootball: rows.filter(r => !r.leagueMapped).length, unavailableFromEveryProviderProven: 0, requiresOtherProviderOrCoverageExpansionForHistory: rows.filter(r => !expandedEnough(r)).length, warning: "Cross-competition counts are audit-only exact-name candidates, not approved identity mappings or production eligibility. Missing local data cannot prove missing upstream data." },
    aliasAudit: [...new Map(aliases.map(a => [`${a.country}:${a.league}:${a.apiName}`, a])).values()], knownAliasExamples: ["Manchester United", "Manchester Utd", "Man United"].map(name => ({ name, normalized: key(name) })),
    malaga: { cohort: malaga, bySeason: malagaSeasons }, historicalCache: { entries: historyEntries.length, oldKeysWithoutCountry: historyEntries.filter(([k]) => !k.includes(":Spain:") && k.includes(":La Liga:")).length, runtimeBenchmarkFilesReadByHistoricalPipeline: false }, leakage: { auditedSelectionViolations: leakage, cutoff: "min(cohortAsOf, target day 00:00 UTC) for production 4.1 input gate; selectHistory always historicalTime < min(before, now); date-only uses day end", limitation: "Recorded source times are checked. OpenFootball adapter appends Z to unqualified times; actual source timezone correctness is not established by the strict numerical comparison. Model 4.1 additionally excludes the entire target day." }, integrity: { unchanged: true, before, after } };
  save("docs/historical-coverage-audit.json", report);
  console.log(JSON.stringify({ funnel: report.funnel, categories: report.categories, deferredReasons: report.deferredReasons, localFirst: report.localFirst, aliasAudit: report.aliasAudit, leagueStatus: leagueStatus.map(l => ({ league: l.league, window: l.windowFixtures, seasons: l.inspectedSeasons })) }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
