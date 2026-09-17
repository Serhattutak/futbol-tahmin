class ProviderError extends Error {
  constructor(category, message) {
    super(message);
    this.name = "ProviderError";
    this.category = category;
  }
}

function createProviderError(error) {
  if (error instanceof ProviderError) return error;

  const status = error.response?.status;
  if (status === 401 || status === 403) return new ProviderError("authentication", "Veri sağlayıcısı kimlik doğrulamasını reddetti.");
  if (status === 429) return new ProviderError("quota", "Veri sağlayıcısı istek kotası aşıldı.");
  if (status === 408 || error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return new ProviderError("timeout_network", "Veri sağlayıcısı zaman aşımına uğradı.");
  if (status >= 500) return new ProviderError("provider_unavailable", "Veri sağlayıcısı geçici olarak kullanılamıyor.");
  if (!error.response) return new ProviderError("timeout_network", "Veri sağlayıcısına ulaşılamadı.");
  return new ProviderError("unexpected_provider_response", "Veri sağlayıcısından beklenmeyen bir yanıt alındı.");
}

function sortParams(params = {}) {
  return Object.fromEntries(Object.entries(params).sort(([left], [right]) => left.localeCompare(right)));
}

class ApiFootballClient {
  constructor({ client, apiKey, dailyBudget = 400, cacheLimit = 500, now = () => Date.now() }) {
    this.client = client;
    this.apiKey = apiKey;
    this.dailyBudget = Math.max(1, Number(dailyBudget) || 400);
    this.cacheLimit = Math.max(1, Number(cacheLimit) || 500);
    this.now = now;
    this.cache = new Map();
    this.budgetDay = null;
    this.usedToday = 0;
  }

  getBudgetStatus() {
    this.resetDailyBudget();
    return { limit: this.dailyBudget, used: this.usedToday, remaining: Math.max(0, this.dailyBudget - this.usedToday) };
  }

  async get(pathname, params, { ttlMs } = {}) {
    const normalizedParams = sortParams(params);
    const key = `${pathname}?${new URLSearchParams(normalizedParams).toString()}`;
    const now = this.now();
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > now) {
      cached.lastUsedAt = now;
      return cached.value;
    }

    if (!this.apiKey) throw new ProviderError("authentication", "Veri sağlayıcısı yapılandırılmadı.");
    this.consumeBudget();

    const value = this.client.get(pathname, { params: normalizedParams })
      .then((response) => this.extractResponse(response))
      .catch((error) => {
        this.cache.delete(key);
        throw createProviderError(error);
      });

    this.cache.set(key, {
      value,
      expiresAt: now + Math.max(1, Number(ttlMs) || 60_000),
      lastUsedAt: now,
    });
    this.pruneCache(now);
    return value;
  }

  extractResponse(response) {
    const body = response?.data;
    if (!body || typeof body !== "object" || !Array.isArray(body.response)) {
      throw new ProviderError("unexpected_provider_response", "Veri sağlayıcısından beklenmeyen bir yanıt alındı.");
    }
    if (body.errors && Object.keys(body.errors).length) {
      const message = JSON.stringify(body.errors).toLowerCase();
      if (message.includes("limit") || message.includes("quota") || message.includes("rate")) throw new ProviderError("quota", "Veri sağlayıcısı istek kotası aşıldı.");
      if (message.includes("key") || message.includes("auth")) throw new ProviderError("authentication", "Veri sağlayıcısı kimlik doğrulamasını reddetti.");
      if (message.includes("no data") || message.includes("not found")) throw new ProviderError("no_data", "Veri sağlayıcısı istenen veri için sonuç döndürmedi.");
      throw new ProviderError("unexpected_provider_response", "Veri sağlayıcısı isteği işleyemedi.");
    }
    return body.response;
  }

  consumeBudget() {
    this.resetDailyBudget();
    if (this.usedToday >= this.dailyBudget) throw new ProviderError("quota", "Günlük veri sağlayıcısı bütçesi tükendi.");
    this.usedToday += 1;
  }

  resetDailyBudget() {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (this.budgetDay !== day) {
      this.budgetDay = day;
      this.usedToday = 0;
    }
  }

  pruneCache(now) {
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    if (this.cache.size <= this.cacheLimit) return;

    const leastRecentlyUsed = [...this.cache.entries()]
      .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt)
      .slice(0, this.cache.size - this.cacheLimit);
    for (const [key] of leastRecentlyUsed) this.cache.delete(key);
  }
}

module.exports = { ApiFootballClient, ProviderError, createProviderError };