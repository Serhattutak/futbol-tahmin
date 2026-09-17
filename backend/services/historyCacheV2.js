const fs = require("node:fs");
const path = require("node:path");
const { selectHistory, historicalTeamKey } = require("./historicalForm");
const { VERSION } = require("./divisionHistory");
class HistoryCacheV2 {
  constructor(load, { now = () => Date.now(), file } = {}) {
    Object.assign(this, { load, now, file }); this.cache = new Map(); this.pending = new Map(); this.metrics = { loads: 0, hits: 0 };
    if (file) { try { this.cache = new Map(JSON.parse(fs.readFileSync(file, "utf8")).filter(([k]) => k.startsWith(`${VERSION}:`))); } catch { /* No V2 cache yet. */ } }
  }
  async getTeamHistoricalMatches(team, before, options) {
    const f = options.fixture;
    const identity = `${team.provider || f.provider}:${team.providerTeamId || team.canonicalTeamId || historicalTeamKey(team.name)}`;
    const key = `${VERSION}:sources-v1:${identity}:${f.league?.country}:${f.league?.name}:${before}`;
    const cached = this.cache.get(key);
    const present = value => ({ ...value, fixture: value.fixture || f, matches: selectHistory(value.matches, { team, before, fixtureId: f.providerFixtureId, now: this.now() }) });
    if (cached?.expiresAt > this.now()) { this.metrics.hits++; return present(cached.value); }
    if (this.pending.has(key)) { this.metrics.hits++; return present(await this.pending.get(key)); }
    this.metrics.loads++;
    const request = Promise.resolve().then(() => this.load(team, before, options)).then(result => {
      const value = present(result);
      const resolved = !value.matches.length && cached?.value.matches.length ? { ...present(cached.value), stale: true } : value;
      this.cache.set(key, { value: resolved, expiresAt: this.now() + (resolved.stale || !resolved.matches.length ? 60_000 : 6 * 3600_000) });
      while (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
      if (this.file && resolved.matches.length) {
        try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const temp = `${this.file}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify([...this.cache])); fs.renameSync(temp, this.file); } catch { /* Memory remains valid. */ }
      }
      return resolved;
    }).catch(error => { if (cached?.value.matches.length) { this.cache.set(key, { value: cached.value, expiresAt: this.now() + 60_000 }); return { ...present(cached.value), stale: true }; } throw error; }).finally(() => this.pending.delete(key));
    this.pending.set(key, request); return request;
  }
}
module.exports = { HistoryCacheV2 };
