const assert = require("node:assert/strict");

const baseUrl = (process.env.ZEUS_API_BASE_URL || "https://zeus-one-betting-api.onrender.com").replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(path, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(20000), headers: { accept: "application/json" } });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`);
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 4000);
    }
  }
  throw lastError;
}

function dateKey(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const base = new Date(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day) + offsetDays));
  return base.toISOString().slice(0, 10);
}

(async () => {
  const health = await getJson("/api/health");
  assert.equal(health.status, "ok", "production health endpoint should report ok");
  assert.ok(health.providers && typeof health.providers === "object", "provider status should be exposed");
  const providerNames = Array.isArray(health.providers)
    ? health.providers.map(provider => provider.name).filter(Boolean)
    : Object.keys(health.providers);
  assert.ok(providerNames.length > 0, "at least one provider status should be exposed");

  const checks = [];
  for (const date of ["2026-10-11", dateKey(0), dateKey(1)]) {
    const body = await getJson(`/api/football-test?date=${date}`);
    assert.equal(body.success, true, `fixture endpoint should succeed for ${date}`);
    assert.equal(body.date, date, `API should preserve requested calendar date ${date}`);
    assert.ok(Array.isArray(body.matches), `matches should be an array for ${date}`);
    assert.equal(body.results, body.matches.length, `results count should match array length for ${date}`);
    checks.push({ date, results: body.results, source: body.source || null, stale: Boolean(body.stale), providerError: body.providerError || null });
  }
  assert.ok(checks[0].results > 0, "known historical date 2026-10-11 should include real completed fixtures");
  console.log(JSON.stringify({ ok: true, health: health.status, providerNames, dateChecks: checks }));
})().catch(error => {
  console.error("Production API compatibility smoke test failed:", error.message);
  process.exitCode = 1;
});
