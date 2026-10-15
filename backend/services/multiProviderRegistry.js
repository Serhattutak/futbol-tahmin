const { HistoryCacheV2 } = require("./historyCacheV2");
const { VERSION, mergeHistory, provenance } = require("./divisionHistory");
const { FixtureDiscovery } = require("./fixtureDiscovery");
const { selectHistory, apiHistory, historicalTeamKey } = require("./historicalForm");
const { ProviderError } = require("./apiFootballClient");

const { normalize, teamKey, normalizeStatus, normalizeKickoff, normalizeProviderIds } = require("./fixtureNormalization");
const canonicalTeamId = (team) => `team:${teamKey(team?.name)}`;
const kickoffKey = (value) => normalizeKickoff(value)?.slice(0, 16);
const LEAGUE_ALIASES = { primeradivision: "laliga" };
const leagueKey = (name) => { const key = normalize(name); return LEAGUE_ALIASES[key] || key; };
function sameFixture(a, b, tolerance = 15 * 60 * 1000) {
  return canonicalTeamId(a.homeTeam) === canonicalTeamId(b.homeTeam) && canonicalTeamId(a.awayTeam) === canonicalTeamId(b.awayTeam)
    && leagueKey(a.league?.name) === leagueKey(b.league?.name) && Boolean(leagueKey(a.league?.name))
    && Math.abs(Date.parse(a.kickoff) - Date.parse(b.kickoff)) <= tolerance;
}

function canonicalFixture({ provider, fixture, league, homeTeam, awayTeam, status, result }) {
  const kickoff = normalizeKickoff(fixture?.kickoff || fixture?.date);
  if (!provider || !kickoff || !homeTeam?.name || !awayTeam?.name) return null;
  fixture = { ...fixture, id: fixture?.id ?? `${provider}:${kickoff}:${teamKey(homeTeam.name)}:${teamKey(awayTeam.name)}` };
  return { provider, providerFixtureId: String(fixture.id), providerFixtureIds: { [provider]: String(fixture.id) }, canonicalFixtureId: `${kickoffKey(kickoff)}:${canonicalTeamId(homeTeam)}:${canonicalTeamId(awayTeam)}:${normalize(league?.name)}`, league: { id: league?.id ?? null, name: league?.name ?? null, country: league?.country ?? null, logo: league?.logo ?? null }, season: league?.season ?? null, kickoff, kickoffPrecision: fixture.kickoffPrecision || (/^\d{4}-\d{2}-\d{2}$/.test(fixture.date || "") ? "date" : "time"), homeTeam: { provider, providerTeamId: String(homeTeam.id ?? homeTeam.name), canonicalTeamId: canonicalTeamId(homeTeam), name: homeTeam.name, logo: homeTeam.logo || null }, awayTeam: { provider, providerTeamId: String(awayTeam.id ?? awayTeam.name), canonicalTeamId: canonicalTeamId(awayTeam), name: awayTeam.name, logo: awayTeam.logo || null }, status: normalizeStatus(status), result: result ? { ...result, status: normalizeStatus(status) } : null, sources: [provider], providerTeams: { [provider]: { home: homeTeam, away: awayTeam, league } }, dataConflict: false };
}

function toCanonicalApiFootball(fixture) { return canonicalFixture({ provider: "api-football", fixture: { id: fixture?.fixture?.id, date: fixture?.fixture?.date, kickoffPrecision: fixture?.fixture?.kickoffPrecision }, league: fixture?.league, homeTeam: fixture?.teams?.home, awayTeam: fixture?.teams?.away, status: fixture?.fixture?.status?.short, result: Number.isFinite(fixture?.goals?.home) && Number.isFinite(fixture?.goals?.away) ? { homeGoals: fixture.goals.home, awayGoals: fixture.goals.away, status: fixture.fixture.status.short, completedAt: fixture.fixture.date } : null }); }
function toCanonicalLegacy(provider, fixture) { return canonicalFixture({ provider, fixture: { id: fixture?.fixture?.id, date: fixture?.fixture?.date, kickoffPrecision: fixture?.fixture?.kickoffPrecision }, league: fixture?.league, homeTeam: fixture?.teams?.home, awayTeam: fixture?.teams?.away, status: fixture?.fixture?.status?.short, result: Number.isFinite(fixture?.goals?.home) && Number.isFinite(fixture?.goals?.away) ? { homeGoals: fixture.goals.home, awayGoals: fixture.goals.away, status: fixture.fixture.status.short, completedAt: fixture.fixture.date } : null }); }

function reconcileFixtures(fixtures) {
  const merged = new Map();
  for (const fixture of fixtures.filter(Boolean)) {
    const existing = [...merged.values()].find((item) => sameFixture(item, fixture));
    if (existing) { existing.sources = [...new Set([...existing.sources, ...fixture.sources])]; existing.providerTeams = { ...existing.providerTeams, ...fixture.providerTeams }; existing.providerFixtureIds = { ...existing.providerFixtureIds, ...fixture.providerFixtureIds }; if (existing.result && fixture.result && (existing.result.homeGoals !== fixture.result.homeGoals || existing.result.awayGoals !== fixture.result.awayGoals)) existing.dataConflict = true; continue; }
    merged.set(fixture.canonicalFixtureId, { ...fixture });
  }
  const values = [...merged.values()];
  for (const fixture of values) {
    for (const other of values) {
      if (fixture === other) continue;
      if (fixture.homeTeam.canonicalTeamId === other.homeTeam.canonicalTeamId && fixture.awayTeam.canonicalTeamId === other.awayTeam.canonicalTeamId && normalize(fixture.league.name) === normalize(other.league.name) && fixture.kickoff.slice(0, 10) === other.kickoff.slice(0, 10) && kickoffKey(fixture.kickoff) !== kickoffKey(other.kickoff)) fixture.dataConflict = true;
    }
  }
  return values;
}

function reconcileResults(results) {
  const valid = results.filter((result) => Number.isFinite(result?.homeGoals) && Number.isFinite(result?.awayGoals));
  if (!valid.length) return { result: null, resultVerificationStatus: "unavailable" };
  const unique = new Set(valid.map((result) => `${result.homeGoals}-${result.awayGoals}`));
  if (unique.size > 1) return { result: null, resultVerificationStatus: "conflict" };
  return { result: valid[0], resultVerificationStatus: valid.length > 1 ? "verified" : "unverified" };
}

function numericAgreement(values, tolerance = 0.15) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return { status: "unavailable", sourceCount: 0, value: null };
  if (valid.length === 1) return { status: "unverified", sourceCount: 1, value: valid[0] };
  const minimum = Math.min(...valid); const maximum = Math.max(...valid); const average = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  return { status: maximum - minimum <= tolerance ? "high" : "low", sourceCount: valid.length, value: average, conflict: maximum - minimum > tolerance };
}

function toFrontendFixture(fixture) {
  return { source: fixture.provider, provider: fixture.provider, providers: fixture.sources, providerFixtureIds: fixture.providerFixtureIds, dataConflict: fixture.dataConflict, canonicalFixtureId: fixture.canonicalFixtureId, fixture: { id: fixture.providerFixtureId, date: fixture.kickoffPrecision === "date" ? fixture.kickoff.slice(0, 10) : fixture.kickoff, kickoffPrecision: fixture.kickoffPrecision, status: { short: fixture.status } }, league: { ...fixture.league, season: fixture.season }, teams: { home: { id: fixture.homeTeam.canonicalTeamId, name: fixture.homeTeam.name, logo: fixture.homeTeam.logo || null }, away: { id: fixture.awayTeam.canonicalTeamId, name: fixture.awayTeam.name, logo: fixture.awayTeam.logo || null } }, goals: fixture.result ? { home: fixture.result.homeGoals, away: fixture.result.awayGoals } : { home: null, away: null } };
}

function createApiFootballAdapter(get, configured = true) {
  return { name: "api-football", configured, enabled: configured, capabilities: ["fixtures", "fixture", "teamForm", "h2h", "standings", "odds", "statistics", "result", "results", "historicalResults", "form", "xg"],
    async getFixtures(date) { return (await get("/fixtures", { date, timezone: "Europe/Istanbul" })).map(toCanonicalApiFootball).filter(Boolean); },
    async getFixture(id) { return (await get("/fixtures", { id })).map(toCanonicalApiFootball).filter(Boolean); },
    getTeamForm: (id, before, context) => apiHistory(get, id, before, context),
    getH2H: (home, away) => get("/fixtures/headtohead", { h2h: `${home}-${away}`, last: 10 }),
    getStandings: (league, season) => get("/standings", { league, season }),
    getStatistics: (id) => get("/fixtures/statistics", { fixture: id }),
    getOdds: (id) => get("/odds", { fixture: id }),
  };
}
function createLegacyAdapter(provider) {
  return { ...provider, configured: provider.configured !== false, enabled: provider.enabled !== false, capabilities: [...new Set([...(provider.capabilities || ["fixtures", "fixture", "result"]), ...(provider.getTeamForm && provider.capabilities?.includes("teamForm") ? ["historicalResults", "form"] : []), ...(provider.capabilities?.includes("result") ? ["results"] : [])])],
    async getFixtures(date, league) { return (await provider.getFixtures(date, league)).map((fixture) => toCanonicalLegacy(provider.name, fixture)).filter(Boolean); },
    async getFixture(id) { const fixture = await provider.getFixture(id); return fixture ? [toCanonicalLegacy(provider.name, fixture)].filter(Boolean) : []; },
  };
}

class MultiProviderRegistry {
  constructor(providers, { cacheLimit = 200, now = () => Date.now(), fixtureCacheFile, historicalCacheFile } = {}) { this.providers = providers; this.cacheLimit = cacheLimit; this.now = now; this.cache = new Map(); this.known = new Map(); this.status = new Map(providers.map((provider) => [provider.name, { name: provider.name, configured: provider.configured !== false, enabled: provider.enabled, available: null, supportedCapabilities: provider.capabilities || [], lastSuccessfulRequest: null, lastRetrievedAt: null, errorCategory: null, quotaStatus: "unknown", cachedDataCount: 0 }])); this.fixtureDiscovery = new FixtureDiscovery(this, { file: fixtureCacheFile, reconcile: reconcileFixtures }); this.historicalData = new HistoryCacheV2((team, before, options) => this.loadHistoricalForm(options.fixture, options.side), { now, file: historicalCacheFile ? historicalCacheFile.replace(/\.json$/, ".v2.json") : undefined }); }
  async getFixturesByDate(date) { return this.fixtureDiscovery.getFixturesByDate(date); }
  async getFixtures(date) { return (await this.getFixturesByDate(date)).fixtures; }
  remember(fixture) {
    this.known.set(fixture.canonicalFixtureId, { fixture, expiresAt: this.now() + 5 * 60 * 1000 });
    for (const id of Object.values(fixture.providerFixtureIds || {})) this.known.set(String(id), { fixture, expiresAt: this.now() + 5 * 60 * 1000 });
    while (this.known.size > this.cacheLimit * 10) this.known.delete(this.known.keys().next().value);
    return fixture;
  }
  async getFixture(id) {
    if (id && typeof id === "object") return [id];
    if (this.known.get(String(id))?.expiresAt > this.now()) return [this.known.get(String(id)).fixture];
    const name = /^sm-/.test(id) ? "sportmonks" : /^fd-/.test(id) ? "football-data" : /^of-/.test(id) ? "openfootball" : /^tsdb-/.test(id) ? "thesportsdb" : /^espn-/.test(id) ? "espn" : /^\d+$/.test(id) ? "api-football" : null;
    const provider = this.providers.find((p) => p.name === name && p.enabled);
    if (!provider) {
      const date = String(id).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
      if (!date) return [];
      return (await this.getFixtures(date)).filter((fixture) => fixture.canonicalFixtureId === id);
    }
    const fixtures = await this.providerRequest(provider, `fixture:${id}`, () => provider.getFixture(id), { strict: true });
    fixtures.forEach((fixture) => this.remember(fixture)); return fixtures;
  }
  async providerRequest(provider, key, execute, { strict = false } = {}) {
    const cached = this.cache.get(key); if (cached?.expiresAt > this.now()) return cached.value;
    const value = Promise.resolve().then(execute).then((data) => { this.updateStatus(provider.name, true); return data || []; }).catch((error) => {
      this.cache.delete(key); this.updateStatus(provider.name, false, error.category || "provider_unavailable");
      if (strict) throw error;
      return [];
    });
    this.cache.set(key, { value, expiresAt: this.now() + 5 * 60 * 1000 }); this.prune(); return value;
  }
  async matchProvider(fixture, provider, options = {}) {
    if (fixture.providerTeams?.[provider.name]) return fixture;
    if (provider.supportsLeague && !provider.supportsLeague(fixture.league.name)) return fixture;
    const data = await this.providerRequest(provider, `match:${provider.name}:${fixture.kickoff.slice(0, 10)}:${normalize(fixture.league.name)}`, () => provider.getFixtures(fixture.kickoff.slice(0, 10), fixture.league.name), options);
    const matches = data.filter((candidate) => sameFixture(fixture, candidate));
    if (matches.length !== 1) return fixture;
    return this.remember(reconcileFixtures([fixture, matches[0]])[0]);
  }
  async enrich(fixture, options = {}) {
    if (fixture.sources.length >= 2) return fixture;
    for (const provider of this.providers) {
      if (!provider.enabled || fixture.sources.includes(provider.name)) continue;
      fixture = await this.matchProvider(fixture, provider, options);
      if (fixture.sources.length >= 2) break;
    }
    return fixture;
  }
  canRequest(provider) {
    const status = this.status.get(provider.name);
    return provider.enabled && !(["quota", "authentication"].includes(status?.errorCategory) && this.now() - Date.parse(status.lastRetrievedAt) < 5 * 60 * 1000);
  }
  getTeamHistoricalMatches(team, beforeDate, options) { return this.historicalData.getTeamHistoricalMatches(team, beforeDate, options); }
  getHistoricalForm(fixture, side) { return this.getTeamHistoricalMatches(fixture[side === "home" ? "homeTeam" : "awayTeam"], fixture.kickoff, { fixture, side }); }
  async loadHistoricalForm(fixture, side) {
    const order = ["openfootball", "football-data-uk", "sportmonks", "football-data", "api-football", "thesportsdb", "espn"];
    let best = { matches: [], provider: null }; let updated = fixture;
    const historyCandidates = [];
    const historyAttempts = [];
    for (const name of order) {
      const provider = this.providers.find((p) => p.name === name);
      if (!provider) { historyAttempts.push({ provider: name, outcome: "not_installed" }); continue; }
      if (!this.canRequest(provider)) { historyAttempts.push({ provider: name, outcome: "disabled_or_cooling_down" }); continue; }
      if (!provider.capabilities?.some((capability) => ["historicalResults", "teamForm", "form"].includes(capability)) || !provider.getTeamForm) { historyAttempts.push({ provider: name, outcome: "history_not_supported" }); continue; }
      if (provider.supportsHistoricalLeague ? !provider.supportsHistoricalLeague(updated.league) : provider.supportsLeague && !provider.supportsLeague(updated.league.name)) { historyAttempts.push({ provider: name, outcome: "league_not_supported" }); continue; }
      let context = updated.providerTeams?.[name];
      if (!context && name !== "openfootball") {
        updated = await this.matchProvider(updated, provider);
        context = updated.providerTeams?.[name];
      }
      if (!context && name !== "openfootball") { historyAttempts.push({ provider: name, outcome: "fixture_not_matched" }); continue; }
      const team = updated[side === "home" ? "homeTeam" : "awayTeam"];
      const league = context?.league || { ...updated.league, season: updated.season };
      try {
        const raw = await this.providerRequest(provider, `history:${VERSION}:${name}:${team.canonicalTeamId}:${updated.kickoff}`, () => provider.getTeamForm(context?.[side]?.id || team.canonicalTeamId, updated.kickoff, { team, league, season: league.season, fixtureId: updated.providerFixtureIds?.[name] }), { strict: true });
        const matches = selectHistory(raw, { team, before: updated.kickoff, fixtureId: updated.providerFixtureIds?.[name], now: this.now() }).map((m) => { const canonical = toCanonicalLegacy(name, m); return canonical ? { ...toFrontendFixture(canonical), score: m.score } : null; }).filter(Boolean);
        for (const match of matches) for (const side of ["home", "away"]) { if (historicalTeamKey(match.teams[side].name) === historicalTeamKey(team.name)) match.teams[side].id = team.canonicalTeamId; }
        historyAttempts.push({ provider: name, outcome: matches.length ? "history_found" : "no_usable_history", matchCount: matches.length });
        historyCandidates.push(...matches);
        best = { matches: mergeHistory(historyCandidates, { team, before: updated.kickoff, now: this.now() }), provider: best.provider || (matches.length ? name : null) };
        if (best.matches.length >= 10) break;
      } catch (error) { historyAttempts.push({ provider: name, outcome: "request_failed", category: error.category || "provider_unavailable" }); this.updateStatus(name, false, error.category || "provider_unavailable"); }
    }
    return { ...best, fixture: updated, historyAttempts };
  }
  async collectAnalysis(fixture, { includeMatchStatistics = true } = {}) {
    const data = { fixture, homeMatches: [], awayMatches: [], h2hMatches: [], standingsResponse: [], oddsResponse: [], recentStats: [], sourceMetadata: { providers: [...fixture.sources], fields: {}, unavailable: {} } };
    for (const side of ["home", "away"]) {
      const history = await this.getHistoricalForm(fixture, side); fixture = history.fixture;
      if (history.historyAttempts?.length) data.sourceMetadata.historyAttempts = [...(data.sourceMetadata.historyAttempts || []), ...history.historyAttempts.map((attempt) => ({ ...attempt, side }))];
      const field = side === "home" ? "homeMatches" : "awayMatches";
      data[field] = history.matches;
      if (history.provider) data.sourceMetadata.fields[field] = history.provider;
      if (history.matches.length < 5) data.sourceMetadata.unavailable[field] = "insufficient_history";
    }
    const matchedProviders = new Set(Object.keys(fixture.providerTeams || {}));
    const methods = { h2hMatches: "h2h", standingsResponse: "standings", oddsResponse: "odds", recentStats: "statistics" };
    for (const [field, capability] of Object.entries(methods)) {
      if (!includeMatchStatistics) continue;
      // Historical bookmaker odds require a timestamped archive, but historical standings can be reconstructed from completed fixtures before kickoff.\n      if (Date.parse(fixture.kickoff) <= this.now() && capability === "odds") { data.sourceMetadata.unavailable[field] = "no_pre_match_snapshot"; continue; }
      if (capability !== "teamForm" && (data.homeMatches.length < 5 || data.awayMatches.length < 5)) {
        data.sourceMetadata.unavailable[field] = this.providers.some(provider => provider.enabled && provider.capabilities?.includes(capability)) ? "unavailable" : "not_supported";
        continue;
      }
      let supported = false;
      for (const provider of this.providers) {
        if (!this.canRequest(provider) || !provider.capabilities?.includes(capability)) continue;
        supported = true;
        if (!matchedProviders.has(provider.name)) { fixture = await this.matchProvider(fixture, provider); matchedProviders.add(provider.name); }
        const context = fixture.providerTeams?.[provider.name]; if (!context) continue;
        try {
          let value;
          if (capability === "teamForm") value = await provider.getTeamForm(context[field === "homeMatches" ? "home" : "away"].id, fixture.kickoff);
          if (capability === "h2h") value = await provider.getH2H(context.home.id, context.away.id, { before: fixture.kickoff, league: context.league, home: context.home, away: context.away });
          if (capability === "standings") value = await provider.getStandings(context.league?.id, context.league?.season, { before: fixture.kickoff, league: context.league });
          if (capability === "odds") value = await provider.getOdds(fixture.providerFixtureIds[provider.name]);
          if (capability === "statistics") {
            let matches = [...data.homeMatches.slice(0, 5), ...data.awayMatches.slice(0, 5)].filter((m) => m.provider === provider.name);
            if (!matches.length && provider.getTeamForm) {
              matches = [...await provider.getTeamForm(context.home.id, fixture.kickoff), ...await provider.getTeamForm(context.away.id, fixture.kickoff)]
                .filter((m) => normalizeStatus(m.fixture?.status?.short) === "FINISHED" && Date.parse(m.fixture.date) < Math.min(Date.parse(fixture.kickoff), this.now())).slice(0, 10);
            }
            value = [];
            for (const id of new Set(matches.map((m) => m.fixture.id))) {
              const stats = await provider.getStatistics(id);
              if (stats?.length) value.push(stats.map((row) => ({ ...row, team: { ...row.team, id: String(row.team.id) === String(context.home.id) ? fixture.homeTeam.canonicalTeamId : String(row.team.id) === String(context.away.id) ? fixture.awayTeam.canonicalTeamId : `${provider.name}:${row.team.id}` } })));
            }
          }
          if (["teamForm", "h2h"].includes(capability)) value = (value || []).map((match) => toCanonicalLegacy(provider.name, match)).filter((match) => match && match.status === "FINISHED" && (capability === "h2h" ? [match.homeTeam.canonicalTeamId, match.awayTeam.canonicalTeamId].includes(fixture.homeTeam.canonicalTeamId) && [match.homeTeam.canonicalTeamId, match.awayTeam.canonicalTeamId].includes(fixture.awayTeam.canonicalTeamId) : [match.homeTeam.canonicalTeamId, match.awayTeam.canonicalTeamId].includes(field === "homeMatches" ? fixture.homeTeam.canonicalTeamId : fixture.awayTeam.canonicalTeamId)) && Date.parse(match.kickoff) < Math.min(Date.parse(fixture.kickoff), this.now())).sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)).slice(0, 10).map(toFrontendFixture);
          if (capability === "standings") value = (value || []).map((group) => ({ ...group, league: { ...group.league, standings: (group.league?.standings || []).map((rows) => rows.map((row) => ({ ...row, team: { ...row.team, id: String(row.team?.id) === String(context.home.id) ? fixture.homeTeam.canonicalTeamId : String(row.team?.id) === String(context.away.id) ? fixture.awayTeam.canonicalTeamId : `${provider.name}:${row.team?.id}` } }))) } }));
          const usable = capability === "odds" ? value?.some((row) => row.bookmakers?.some((b) => b.bets?.some((bet) => bet.values?.some((v) => Number(v.odd) > 1)))) : capability === "standings" ? value?.some((row) => row.league?.standings?.some((rows) => rows.length)) : value?.length;
          this.updateStatus(provider.name, true);
          if (usable) {
            if (capability === "statistics") {
              const existing = new Set(data.recentStats.flat().flatMap((row) => row.statistics.map((stat) => `${row.team.id}:${stat.type}`)));
              const added = value.map((rows) => rows.map((row) => ({ ...row, statistics: row.statistics.filter((stat) => !existing.has(`${row.team.id}:${stat.type}`)) })).filter((row) => row.statistics.length)).filter((rows) => rows.length);
              data.recentStats.push(...added);
              if (added.length) data.sourceMetadata.fields[`statistics:${provider.name}`] = provider.name;
              const present = new Set(data.recentStats.flat().flatMap((row) => row.statistics.map((stat) => `${row.team.id}:${stat.type}`)));
              if ([fixture.homeTeam.canonicalTeamId, fixture.awayTeam.canonicalTeamId].every((id) => ["Total Shots", "Shots on Goal", "Ball Possession", "Expected Goals"].every((type) => present.has(`${id}:${type}`)))) break;
            } else { data[field] = value; data.sourceMetadata.fields[field] = provider.name; break; }
          }
        } catch (error) { this.updateStatus(provider.name, false, error.category || "provider_unavailable"); }
      }
      if (!data[field].length) data.sourceMetadata.unavailable[field] = supported ? "unavailable" : "not_supported";
    }
    data.fixture = fixture; data.sourceMetadata.providers = [...new Set([...fixture.sources, ...Object.values(data.sourceMetadata.fields)])];
    data.sourceMetadata.history = provenance(data.homeMatches, data.awayMatches);
    data.sourceMetadata.sourceCount = data.sourceMetadata.providers.length;
    return data;
  }
  getBestAvailableProvider(capability) { return this.providers.find((provider) => provider.enabled && provider.capabilities?.includes(capability) && this.status.get(provider.name)?.available !== false) || null; }
  async getResults(providerFixtureIds = {}) {
    let ids = normalizeProviderIds(providerFixtureIds);
    const results = []; let transient = null; let attempted = false;
    for (const provider of this.providers) {
      const fixtureId = ids[provider.name]; if (!fixtureId || !provider.enabled) continue;
      attempted = true;
      try { results.push(...await provider.getFixture(fixtureId)); this.updateStatus(provider.name, true); }
      catch (error) { this.updateStatus(provider.name, false, error.category || "provider_unavailable"); if (!["no_data", "unsupported"].includes(error.category)) transient = error; }
    }
    if (transient) throw transient;
    if (!attempted) throw new ProviderError("unsupported", "No enabled result provider.");
    if (results.length === 1) {
      const enriched = await this.enrich(results[0], { strict: true });
      ids = enriched.providerFixtureIds;
      for (const provider of this.providers) {
        if (!provider.enabled || !ids[provider.name] || results.some((item) => item.provider === provider.name)) continue;
        try { results.push(...await provider.getFixture(ids[provider.name])); } catch (error) { if (!["no_data", "unsupported"].includes(error.category)) throw error; }
      }
    }
    return results;
  }
  async request(key, ttl, execute) { const cached = this.cache.get(key); if (cached?.expiresAt > this.now()) return cached.value; const value = this.requestProviders(execute); this.cache.set(key, { value, expiresAt: this.now() + ttl }); this.prune(); return value; }
  async requestProviders(execute) { for (const provider of this.providers) { if (!provider.enabled) continue; try { const data = await execute(provider); if (data?.length) { this.updateStatus(provider.name, true); return reconcileFixtures(data); } this.updateStatus(provider.name, true); } catch (error) { this.updateStatus(provider.name, false, error.category || "provider_unavailable"); if (!(error instanceof ProviderError) || !["quota", "timeout_network", "provider_unavailable", "authentication"].includes(error.category)) continue; } } return []; }
  updateStatus(name, available, errorCategory = null) { const status = this.status.get(name); const retrievedAt = new Date(this.now()).toISOString(); this.status.set(name, { ...status, available, errorCategory, quotaStatus: errorCategory === "quota" ? "exhausted" : "unknown", lastSuccessfulRequest: available ? retrievedAt : status.lastSuccessfulRequest, lastRetrievedAt: retrievedAt, cachedDataCount: this.cache.size }); }
  getStatus() { return [...this.status.values()].map((status) => ({ ...status, configurationStatus: status.configured ? "CONFIGURED" : "NOT_CONFIGURED" })); }
  prune() { if (this.cache.size <= this.cacheLimit) return; for (const key of [...this.cache.keys()].slice(0, this.cache.size - this.cacheLimit)) this.cache.delete(key); }
}

module.exports = { sameFixture, canonicalFixture, toCanonicalLegacy, MultiProviderRegistry, canonicalTeamId, createApiFootballAdapter, createLegacyAdapter, numericAgreement, reconcileFixtures, reconcileResults, toCanonicalApiFootball, toFrontendFixture };
