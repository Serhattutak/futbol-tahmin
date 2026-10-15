const fs = require("node:fs");
const path = require("node:path");
const { ProviderError } = require("./apiFootballClient");

class FixtureDiscovery {
  constructor(registry, { file, ttl = 300_000, retryDelay = 60_000, reconcile = fixtures => fixtures } = {}) {
    this.registry = registry;
    this.file = file;
    this.ttl = ttl;
    this.retryDelay = retryDelay;
    this.reconcile = reconcile;
    this.entries = new Map();
    this.pending = new Map();
    this.cooldowns = new Map();
    this.attempts = new Map();
    if (file) {
      try {
        for (const [date, entry] of JSON.parse(fs.readFileSync(file, "utf8"))) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Array.isArray(entry.fixtures) && entry.fixtures.length && Number.isFinite(entry.savedAt)) this.entries.set(date, entry);
        }
      } catch { /* A missing cache never prevents live discovery. */ }
    }
  }
  snapshot(date) {
    const entry = this.entries.get(date);
    if (!entry) return null;
    return { fixtures: entry.fixtures, source: entry.source, cached: true, stale: this.registry.now() - entry.savedAt >= (entry.fixtures.length ? this.ttl : this.retryDelay), providerError: entry.providerError || null };
  }
  async getFixturesByDate(date) {
    const cached = this.snapshot(date);
    if (cached) {
      if (cached.stale && (this.entries.get(date).retryAt || 0) <= this.registry.now()) {
        // Revalidation must never clear or delay the last successful real list.
        this.refresh(date).catch(() => {});
      }
      cached.fixtures.forEach(fixture => this.registry.remember(fixture));
      return cached;
    }
    return this.refresh(date);
  }
  refresh(date) {
    if (this.pending.has(date)) return this.pending.get(date);
    const request = this.discover(date);
    this.pending.set(date, request);
    const clear = () => this.pending.delete(date);
    request.then(clear, clear);
    return request;
  }
  async discover(date) {
  const errors = [];
  const collectedFixtures = [];
  const successfulProviders = [];
    const order = ["sportmonks", "api-football", "football-data", "openfootball", "football-data-uk", "espn", "thesportsdb"];
    const providers = [...this.registry.providers].sort((a, b) => {
      const rank = name => order.includes(name) ? order.indexOf(name) : order.length;
      return rank(a.name) - rank(b.name);
    });
    for (const provider of providers) {
      if (!provider.enabled || provider.configured === false || !provider.getFixtures) continue;
      const cooldown = this.cooldowns.get(provider.name);
      if (cooldown?.until > this.registry.now()) { errors.push({ provider: provider.name, category: cooldown.category }); continue; }
      if (!this.registry.canRequest(provider)) { errors.push({ provider: provider.name, category: this.registry.status.get(provider.name)?.errorCategory || "provider_unavailable" }); continue; }
      try {
        this.attempts.set(provider.name, (this.attempts.get(provider.name) || 0) + 1);
        const response = await provider.getFixtures(date);
        if (!Array.isArray(response)) throw new ProviderError("unexpected_provider_response", "Invalid fixture response.");
        const fixtures = this.reconcile(response);
this.registry.updateStatus(provider.name, true);

if (!fixtures.length) {
  errors.push({
    provider: provider.name,
    category: "no_data"
  });
  continue;
}

collectedFixtures.push(...fixtures);
successfulProviders.push(provider.name);
      } catch (error) {
        const category = error.category || "provider_unavailable";
        errors.push({ provider: provider.name, category });
        this.registry.updateStatus(provider.name, false, category);
        this.cooldowns.set(provider.name, { category, until: this.registry.now() + (["authentication", "quota"].includes(category) ? 15 * 60_000 : this.retryDelay) });
      }
    }const fixtures = this.reconcile(collectedFixtures);

if (fixtures.length) {
  fixtures.forEach(fixture => this.registry.remember(fixture));

  const entry = {
    fixtures,
    source: successfulProviders.join("+"),
    savedAt: this.registry.now(),
    providerError: errors.length ? errors : null
  };

  this.entries.set(date, entry);
  this.persist();

  return {
    ...this.snapshot(date),
    cached: false
  };
}
    const previous = this.entries.get(date);
    if (previous?.fixtures.length) {
      previous.providerError = errors;
      previous.retryAt = this.registry.now() + this.retryDelay;
      return { ...this.snapshot(date), stale: true };
    }
    // Briefly cache an empty attempt too, but never replace successful fixtures.
    this.entries.set(date, { fixtures: [], source: null, savedAt: this.registry.now(), providerError: errors });
    while (this.entries.size > this.registry.cacheLimit) this.entries.delete(this.entries.keys().next().value);
    return { ...this.snapshot(date), cached: false };
  }
  persist() {
    while (this.entries.size > this.registry.cacheLimit) this.entries.delete(this.entries.keys().next().value);
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify([...this.entries].filter(([, entry]) => entry.fixtures.length)), "utf8");
      fs.renameSync(temporary, this.file);
    } catch { /* Keep the in-memory last-success cache if disk is unavailable. */ }
  }
}

module.exports = { FixtureDiscovery };
