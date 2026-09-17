const { normalizeStatus, teamKey: canonicalTeamKey } = require("./fixtureNormalization");
const historicalAliases = { clubatleticodemadrid: "atleticomadrid", atleticodemadrid: "atleticomadrid", caosasuna: "osasuna" };
function teamKey(name) { const key = canonicalTeamKey(name); return historicalAliases[key] || key; }

function selectHistory(matches, { team, before, fixtureId, limit = 10, now = Date.now() }) {
  const cutoff = Math.min(Date.parse(before), now);
  const names = new Map();
  for (const match of matches || []) for (const side of ["home", "away"]) {
    const candidate = match.teams?.[side];
    if (candidate && teamKey(candidate.name) === teamKey(team.name)) names.set(String(candidate.id), candidate.name);
  }
  // Never accept two distinct provider teams with the same normalized name.
  if (names.size > 1) return [];
  return [...new Map((matches || []).filter((match) => {
    const participants = [match.teams?.home, match.teams?.away].filter(Boolean);
    const dateOnly = match.fixture?.kickoffPrecision === "date" || /^\d{4}-\d{2}-\d{2}$/.test(match.fixture?.date || "");
    // Unknown kickoff times cannot establish ordering within the same day.
    const historicalTime = dateOnly ? Date.parse(`${match.fixture.date.slice(0, 10)}T23:59:59.999Z`) : Date.parse(match.fixture?.date);
    return normalizeStatus(match.fixture?.status?.short) === "FINISHED"
      && historicalTime < cutoff
      && String(match.fixture?.id) !== String(fixtureId)
      && !/friendl/i.test(match.league?.name || "")
      && Number.isFinite(match.goals?.home) && Number.isFinite(match.goals?.away)
      && match.goals.home >= 0 && match.goals.away >= 0
      && participants.some((candidate) => teamKey(candidate.name) === teamKey(team.name));
  }).map((match) => [String(match.fixture.id), match])).values()]
    .sort((a, b) => Date.parse(b.fixture.date) - Date.parse(a.fixture.date)).slice(0, limit);
}

async function apiHistory(get, teamId, before, context = {}) {
  const year = Number(context.season) || new Date(before).getUTCFullYear();
  let team = context.team;
  let matches = [];
  for (const season of [year, year - 1]) {
    let response;
    try { response = await get("/fixtures", { team: teamId, season, status: "FT-AET-PEN", from: `${season}-01-01`, to: new Date(Math.min(Date.parse(before), Date.now())).toISOString().slice(0, 10) }); }
    catch (error) { if (["no_data", "unexpected_provider_response"].includes(error.category)) continue; throw error; }
    matches = [...matches, ...response];
    if (!team) team = response.flatMap(match => [match.teams?.home, match.teams?.away]).find(candidate => candidate && String(candidate.id) === String(teamId));
    const selected = team ? selectHistory(matches, { team, before, fixtureId: context.fixtureId }) : [];
    if (selected.length >= 10) return selected.slice(0, 10);
  }
  return team ? selectHistory(matches, { team, before, fixtureId: context.fixtureId }) : [];
}
class HistoricalDataService {
  constructor(load, { now = () => Date.now(), file } = {}) {
    this.load = load; this.now = now; this.file = file; this.cache = new Map(); this.pending = new Map();
    this.metrics = { loads: 0, hits: 0 };
    if (file) { try { this.cache = new Map(JSON.parse(require("node:fs").readFileSync(file, "utf8"))); } catch { /* Optional durable cache. */ } }
  }
  async getTeamHistoricalMatches(team, beforeDate, options) {
    const key = `${teamKey(team.name)}:${options.fixture.league?.country || ""}:${options.fixture.league?.name}:${beforeDate}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.metrics.hits++;
      return { ...cached.value, matches: selectHistory(cached.value.matches, { team, before: beforeDate, now: this.now() }), fixture: options.fixture };
    }
    if (this.pending.has(key)) {
      this.metrics.hits++;
      return { ...await this.pending.get(key), fixture: options.fixture };
    }
    this.metrics.loads++;
    const request = Promise.resolve().then(() => this.load(team, beforeDate, options)).then(result => {
      const matches = selectHistory(result.matches, { team, before: beforeDate, now: this.now() });
      const value = !matches.length && cached?.value.matches.length
        ? { ...cached.value, matches: selectHistory(cached.value.matches, { team, before: beforeDate, now: this.now() }) }
        : { matches, provider: result.provider };
      this.cache.set(key, { value, expiresAt: this.now() + (matches.length ? 6 * 60 * 60_000 : 60_000) });
      while (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
      if (this.file && matches.length) {
        try {
          const fs = require("node:fs"); fs.mkdirSync(require("node:path").dirname(this.file), { recursive: true });
          const temporary = `${this.file}.${process.pid}.tmp`;
          fs.writeFileSync(temporary, JSON.stringify([...this.cache].filter(([, entry]) => entry.value.matches.length)));
          fs.renameSync(temporary, this.file);
        } catch { /* Retain the memory cache. */ }
      }
      return { ...value, fixture: result.fixture };
    }).catch(error => {
      if (!cached?.value.matches.length) throw error;
      const value = { ...cached.value, matches: selectHistory(cached.value.matches, { team, before: beforeDate, now: this.now() }), stale: true };
      this.cache.set(key, { value, expiresAt: this.now() + 60_000 });
      return { ...value, fixture: options.fixture };
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}
module.exports = { selectHistory, apiHistory, HistoricalDataService, historicalTeamKey: teamKey };
