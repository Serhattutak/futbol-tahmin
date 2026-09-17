const pending = new Map();
const cache = new Map();
let heavyRequests = Promise.resolve();

const fixtureUrl = url => /\/api\/football-test\?/.test(url);
export function getCachedFrontendJson(url) {
  if (cache.has(url)) return cache.get(url);
  if (!fixtureUrl(url)) return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem("real-fixture-cache") || "[]");
    const entry = saved.find(([key]) => key === url)?.[1];
    if (entry?.data?.matches?.length && Number.isFinite(entry.savedAt)) {
      cache.set(url, entry);
      return entry;
    }
  } catch { /* Storage is optional. */ }
  return null;
}

function saveFixtures(url, entry) {
  if (!fixtureUrl(url) || !entry.data.matches?.length) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem("real-fixture-cache") || "[]").filter(([key]) => key !== url);
    sessionStorage.setItem("real-fixture-cache", JSON.stringify([...saved, [url, entry]].slice(-5)));
  } catch { /* The in-memory cache still works if storage is full. */ }
}

// The backend shares concurrency/rate limits across these read endpoints.
// Coalesce StrictMode subscribers and serialize heavy reads without cancelling
// a request that the server is already processing.
export function readFrontendJson(url) {
  const cached = getCachedFrontendJson(url);
  // Detail responses must revalidate the artifact fingerprint on the backend.
  // Backend versioned caches keep this cheap; model switches stay local.
  if (!/\/api\/analyze\//.test(url) && cached && Date.now() - cached.savedAt < 60_000) return Promise.resolve(cached.data);
  if (pending.has(url)) return pending.get(url);
  const load = async () => {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || data.success === false) {
      throw new Error(response.status === 429
        ? "İstek sınırına ulaşıldı. Lütfen biraz sonra yeniden deneyin."
        : data?.error || "Veri sağlayıcısına ulaşılamıyor.");
    }
    if (fixtureUrl(url) && (!Array.isArray(data.matches) || (data.date && new URL(url).searchParams.get("date") !== data.date))) throw new Error("Geçersiz fikstür yanıtı.");
    if (fixtureUrl(url) && !data.matches.length && cached?.data.matches?.length) return { ...cached.data, cached: true, stale: true, providerError: data.providerError || "empty_response" };
    if (!Array.isArray(data.matches) || data.matches.length) {
      const entry = { data, savedAt: Date.now() };
      cache.set(url, entry);
      saveFixtures(url, entry);
    }
    return data;
  };
  const heavy = /\/api\/(best-predictions|archive\/performance)(?:\?|$)/.test(url);
  const request = (heavy ? heavyRequests.then(load) : load()).catch(error => {
    if (fixtureUrl(url) && cached?.data.matches?.length) {
      const data = { ...cached.data, cached: true, stale: true, providerError: error.message };
      cache.set(url, { data, savedAt: Date.now() });
      return data;
    }
    throw error;
  });
  if (heavy) heavyRequests = request.catch(() => {});
  pending.set(url, request);
  const clear = () => pending.delete(url);
  request.then(clear, clear);
  return request;
}
