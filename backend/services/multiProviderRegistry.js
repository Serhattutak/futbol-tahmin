const { HistoryCacheV2 } = require("./historyCacheV2");
const { VERSION, mergeHistory, provenance } = require("./divisionHistory");
const { FixtureDiscovery } = require("./fixtureDiscovery");
const { selectHistory, apiHistory, historicalTeamKey } = require("./historicalForm");
const { ProviderError } = require("./apiFootballClient");

const { normalize, teamKey, normalizeStatus, normalizeKickoff, normalizeProviderIds } = require("./fixtureNormalization");
const canonicalTeamId = (team) => `team:${teamKey(team?.name)}`;
const kickoffKey = (value) => normalizeKickoff(value)?.slice(0, 16);
const LEAGUE_ALIASES = { primeradivision: "laliga" };
function leagueKey(name, country) {
  const key = normalize(name), c = normalize(country);
  if (c === "switzerland" && ["swisssuperleague", "superleague"].includes(key)) return "swisssuperleague";
  if (c === "usa" && ["majorleaguesoccer", "mls"].includes(key)) return "mls";
  if (c === "denmark" && ["danishsuperliga", "superliga"].includes(key)) return "danishsuperliga";
  if (c === "hungary" && ["hungariannbi", "nbi"].includes(key)) return "hungariannbi";
  if (c === "brazil" && ["brazilianseriea", "campeonatobrasileiroseriea"].includes(key)) return "brazilianseriea";
  if (c === "croatia" && ["croatianfirstfootballleague", "hnl"].includes(key)) return "croatianfirstfootballleague";
  if (c === "bulgaria" && ["bulgarianfirstleague", "firstleague"].includes(key)) return "bulgarianfirstleague";
  if (c === "wales" && ["welshcymrupremier", "cymrupremier"].includes(key)) return "welshcymrupremier";
  if (c === "argentina" && ["primeradivisionargentina", "primeradivision", "ligaprofesional", "ligaprofesionalargentina"].includes(key)) return "argentinaprimera";
  return LEAGUE_ALIASES[key] || key;
}
function sameFixture(a, b, tolerance = 15 * 60 * 1000) {
  const sameTeamsAndLeague = canonicalTeamId(a.homeTeam) === canonicalTeamId(b.homeTeam)
    && canonicalTeamId(a.awayTeam) === canonicalTeamId(b.awayTeam)
    && (!a.league?.country || !b.league?.country || normalize(a.league.country) === normalize(b.league.country))
    && leagueKey(a.league?.name, a.league?.country) === leagueKey(b.league?.name, b.league?.country)
    && Boolean(leagueKey(a.league?.name, a.league?.country));
  if (!sameTeamsAndLeague) return false;
  // A date-only source cannot provide a reliable kickoff time. Merge it with a timed
  // source on the same calendar date rather than displaying the same match twice.
  if (a.kickoffPrecision === "date" || b.kickoffPrecision === "date") {
    const dayA = Date.parse(`${a.kickoff.slice(0, 10)}T00:00:00Z`);
    const dayB = Date.parse(`${b.kickoff.slice(0, 10)}T00:00:00Z`);
    // Date-only feeds omit kickoff time and may use the league's local match day.
    // A timed source can therefore place the same real fixture on the adjacent UTC date.
    return Number.isFinite(dayA) && Number.isFinite(dayB) && Math.abs(dayA - dayB) <= 24 * 60 * 60 * 1000;
  }
  return Math.abs(Date.parse(a.kickoff) - Date.parse(b.kickoff)) <= tolerance;
}

function canonicalFixture({ provider, fixture, league, homeTeam, awayTeam, status, result }) {
  const kickoff = normalizeKickoff(fixture?.kickoff || fixture?.date);
  if (!provider || !kickoff || !homeTeam?.name || !awayTeam?.name) return null;
  fixture = { ...fixture, id: fixture?.id ?? `${provider}:${kickoff}:${teamKey(homeTeam.name)}:${teamKey(awayTeam.name)}` };
  return { provider, providerFixtureId: String(fixture.id), providerFixtureIds: { [provider]: String(fixture.id) }, canonicalFixtureId: `${kickoffKey(kickoff)}:${canonicalTeamId(homeTeam)}:${canonicalTeamId(awayTeam)}:${normalize(league?.name)}`, league: { id: league?.id ?? null, name: league?.name ?? null, country: league?.country ?? null, logo: league?.logo ?? null }, season: league?.season ?? null, kickoff, kickoffPrecision: fixture.kickoffPrecision || (/^\d{4}-\d{2}-\d{2}$/.test(fixture.date || "") ? "date" : "time"), homeTeam: { provider, providerTeamId: String(homeTeam.id ?? homeTeam.name), canonicalTeamId: canonicalTeamId(homeTeam), name: homeTeam.name, logo: homeTeam.logo || null }, awayTeam: { provider, providerTeamId: String(awayTeam.id ?? awayTeam.name), canonicalTeamId: canonicalTeamId(awayTeam), name: awayTeam.name, logo: awayTeam.logo || null }, status: normalizeStatus(status), result: result ? { ...result, status: normalizeStatus(status) } : null, sources: [provider], providerTeams: { [provider]: { home: homeTeam, away: awayTeam, league } }, dataConflict: false };
}

function canonicalResult(fixture) {
  const status = normalizeStatus(fixture?.fixture?.status?.short);
  const homeGoals = fixture?.goals?.home, awayGoals = fixture?.goals?.away;
  if (status !== "FINISHED" || !Number.isInteger(homeGoals) || homeGoals < 0 || !Number.isInteger(awayGoals) || awayGoals < 0) return null;
  return { homeGoals, awayGoals, status, completedAt: fixture.fixture.date };
}
function toCanonicalApiFootball(fixture) { return canonicalFixture({ provider: "api-football", fixture: { id: fixture?.fixture?.id, date: fixture?.fixture?.date, kickoffPrecision: fixture?.fixture?.kickoffPrecision }, league: fixture?.league, homeTeam: fixture?.teams?.home, awayTeam: fixture?.teams?.away, status: fixture?.fixture?.status?.short, result: canonicalResult(fixture) }); }
function toCanonicalLegacy(provider, fixture) { return canonicalFixture({ provider, fixture: { id: fixture?.fixture?.id, date: fixture?.fixture?.date, kickoffPrecision: fixture?.fixture?.kickoffPrecision }, league: fixture?.league, homeTeam: fixture?.teams?.home, awayTeam: fixture?.teams?.away, status: fixture?.fixture?.status?.short, result: canonicalResult(fixture) }); }

function reconcileFixtures(fixtures) {
  const merged = new Map();
  for (const fixture of fixtures.filter(Boolean)) {
    const existing = [...merged.values()].find((item) => sameFixture(item, fixture));
    if (existing) { existing.sources = [...new Set([...existing.sources, ...fixture.sources])]; existing.providerTeams = { ...existing.providerTeams, ...fixture.providerTeams }; existing.providerFixtureIds = { ...existing.providerFixtureIds, ...fixture.providerFixtureIds }; if (existing.kickoffPrecision === "date" && fixture.kickoffPrecision !== "date") { existing.kickoff = fixture.kickoff; existing.kickoffPrecision = fixture.kickoffPrecision; existing.canonicalFixtureId = fixture.canonicalFixtureId; } if (existing.result && fixture.result && (existing.result.homeGoals !== fixture.result.homeGoals || existing.result.awayGoals !== fixture.result.awayGoals)) existing.dataConflict = true; continue; }
    // Canonical IDs predate country-aware league matching. Keep distinct countries separate internally without changing persisted public IDs.
    const mergeKey = `${normalize(fixture.league?.country)}:${fixture.canonicalFixtureId || `${fixture.provider}:${fixture.providerFixtureId}`}`;
    merged.set(mergeKey, { ...fixture });
  }
  const values = [...merged.values()];
  const reconciled = [];
  for (const fixture of values) {
    const sameDay = reconciled.find((other) =>
      canonicalTeamId(other.homeTeam) === canonicalTeamId(fixture.homeTeam)
      && canonicalTeamId(other.awayTeam) === canonicalTeamId(fixture.awayTeam)
      && (!other.league?.country || !fixture.league?.country || normalize(other.league.country) === normalize(fixture.league.country))
      && leagueKey(other.league?.name, other.league?.country) === leagueKey(fixture.league?.name, fixture.league?.country)
      && other.kickoff.slice(0, 10) === fixture.kickoff.slice(0, 10)
    );
    if (!sameDay) { reconciled.push({ ...fixture }); continue; }
    const kickoffConflict = kickoffKey(sameDay.kickoff) !== kickoffKey(fixture.kickoff);
    if (kickoffConflict) sameDay.dataConflict = true;
    sameDay.sources = [...new Set([...(sameDay.sources || []), ...(fixture.sources || [])])];
    sameDay.providerTeams = { ...(sameDay.providerTeams || {}), ...(fixture.providerTeams || {}) };
    sameDay.providerFixtureIds = { ...(sameDay.providerFixtureIds || {}), ...(fixture.providerFixtureIds || {}) };
    if (sameDay.kickoffPrecision === "date" && fixture.kickoffPrecision !== "date") {
      sameDay.kickoff = fixture.kickoff;
      sameDay.kickoffPrecision = fixture.kickoffPrecision;
      sameDay.canonicalFixtureId = fixture.canonicalFixtureId;
    }
    if (sameDay.result && fixture.result && (sameDay.result.homeGoals !== fixture.result.homeGoals || sameDay.result.awayGoals !== fixture.result.awayGoals)) {
      sameDay.result = null;
      sameDay.status = "UNKNOWN";
      sameDay.dataConflict = true;
    } else if (!sameDay.result && fixture.result && !sameDay.dataConflict) {
      sameDay.result = fixture.result;
      sameDay.status = fixture.status;
    }
  }
  return reconciled;
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
    if (fixture.providerTeams?.[provider.name] || !this.canRequest(provider)) return fixture;
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
    const elapsed = this.now() - Date.parse(status?.lastRetrievedAt);
    if (status?.errorCategory === "quota" && elapsed < 15 * 60 * 1000) return false;
    if (status?.errorCategory === "authentication" && elapsed < 60 * 60 * 1000) return false;
    return Boolean(provider.enabled);
  }
  getTeamHistoricalMatches(team, beforeDate, options) { return this.historicalData.getTeamHistoricalMatches(team, beforeDate, options); }
  getHistoricalForm(fixture, side) { return this.getTeamHistoricalMatches(fixture[side === "home" ? "homeTeam" : "awayTeam"], fixture.kickoff, { fixture, side }); }
  async loadHistoricalForm(fixture, side) {
    const order = ["openfootball", "openfootball-text", "sportmonks", "football-data", "api-football", "thesportsdb", "espn"];
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
      if (!context && name !== "openfootball" && !provider.historyLookupByName) {
        updated = await this.matchProvider(updated, provider);
        context = updated.providerTeams?.[name];
      }
      if (!context && name !== "openfootball" && !provider.historyLookupByName) { historyAttempts.push({ provider: name, outcome: "fixture_not_matched" }); continue; }
      const team = updated[side === "home" ? "homeTeam" : "awayTeam"];
      const league = context?.league || { ...updated.league, season: updated.season };
      try {
        const raw = await this.providerRequest(provider, `history:${VERSION}:${name}:${team.canonicalTeamId}:${updated.kickoff}`, () => provider.getTeamForm(context?.[side]?.id || team.canonicalTeamId, updated.kickoff, { team, league, season: league.season, fixtureId: updated.providerFixtureIds?.[name] }), { strict: true });
        const matches = selectHistory(raw, { team, before: updated.kickoff, fixtureId: updated.providerFixtureIds?.[name], now: this.now() }).map((m) => { const canonical = toCanonicalLegacy(name, m); return canonical ? { ...toFrontendFixture(canonical), score: m.score } : null; }).filter(Boolean);
        for (const match of matches) for (const side of ["home", "away"]) { if (historicalTeamKey(match.teams[side].name) === historicalTeamKey(team.name)) match.teams[side].id = team.canonicalTeamId; }
        historyAttempts.push({ provider: name, outcome: matches.length ? "history_found" : "no_usable_history", matchCount: matches.length });
        historyCandidates.push(...matches);
        best = { matches: mergeHistory(historyCandidates, { team, before: updated.kickoff, now: this.now() }), provider: best.provider || (matches.length ? name : null) };
        const sourceFamily = source => String(source || "").startsWith("openfootball") ? "openfootball" : source;
        const independentSources = new Set(historyCandidates.map(match => sourceFamily(match.provider)));
        // Keep checking independent providers even after ten matches from OpenFootball. The text and JSON mirrors are one source family, not two independent confirmations.
        if (best.matches.length >= 10 && independentSources.size >= 2) break;
      } catch (error) { historyAttempts.push({ provider: name, outcome: "request_failed", category: error.category || "provider_unavailable", ...(Number.isInteger(error.httpStatus) ? { httpStatus: error.httpStatus } : {}) }); this.updateStatus(name, false, error.category || "provider_unavailable"); }
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
        const matchedContext = fixture.providerTeams?.[provider.name];
        const historicalContext = !matchedContext
          && ["h2h", "standings"].includes(capability)
          && provider.supportsHistoricalLeague?.(fixture.league)
          ? {
              home: { id: fixture.homeTeam.providerTeamId || fixture.homeTeam.canonicalTeamId, name: fixture.homeTeam.name },
              away: { id: fixture.awayTeam.providerTeamId || fixture.awayTeam.canonicalTeamId, name: fixture.awayTeam.name },
              league: fixture.league,
            }
          : null;
        const context = matchedContext || historicalContext;
        if (!context) continue;
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
    const results = []; let transient = null; let attempted = false; let skippedError = null;
    for (const provider of this.providers) {
      const fixtureId = ids[provider.name]; if (!fixtureId || !provider.enabled) continue;
      if (!this.canRequest(provider)) {
        const category = this.status.get(provider.name)?.errorCategory;
        if (["quota", "authentication"].includes(category)) skippedError ||= new ProviderError(category, `Provider ${provider.name} is cooling down after ${category}.`);
        continue;
      }
      attempted = true;
      try { results.push(...await provider.getFixture(fixtureId)); this.updateStatus(provider.name, true); }
      catch (error) { this.updateStatus(provider.name, false, error.category || "provider_unavailable"); if (!["no_data", "unsupported"].includes(error.category)) transient = error; }
    }
    if (transient && !results.length) throw transient;
    if (!attempted && !results.length) {
      if (skippedError) throw skippedError;
      throw new ProviderError("unsupported", "No enabled result provider.");
    }
    if (results.length === 1) {
      const enriched = await this.enrich(results[0], { strict: true });
      ids = normalizeProviderIds(enriched.providerFixtureIds || providerFixtureIds);
      for (const provider of this.providers) {
        if (!provider.enabled || !ids[provider.name] || results.some((item) => item.provider === provider.name) || !this.canRequest(provider)) continue;
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
