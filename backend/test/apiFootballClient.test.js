const assert = require("node:assert/strict");
const test = require("node:test");
const { ApiFootballClient, ProviderError } = require("../services/apiFootballClient");

test("aynı upstream isteğini eşzamanlı olarak tek kez gönderir", async () => {
  let calls = 0;
  const client = new ApiFootballClient({
    apiKey: "test-key",
    client: { get: async () => { calls += 1; return { data: { response: [{ id: 1 }], errors: {} } }; } },
  });

  const [first, second] = await Promise.all([
    client.get("/fixtures", { date: "2026-09-15" }, { ttlMs: 1_000 }),
    client.get("/fixtures", { date: "2026-09-15" }, { ttlMs: 1_000 }),
  ]);

  assert.deepEqual(first, [{ id: 1 }]);
  assert.deepEqual(second, [{ id: 1 }]);
  assert.equal(calls, 1);
});

test("günlük bütçe tükendiğinde yeni upstream isteği göndermez", async () => {
  let calls = 0;
  const client = new ApiFootballClient({
    apiKey: "test-key",
    dailyBudget: 1,
    client: { get: async () => { calls += 1; return { data: { response: [], errors: {} } }; } },
  });

  await client.get("/fixtures", { id: 1 });
  await assert.rejects(client.get("/fixtures", { id: 2 }), (error) => error instanceof ProviderError && error.category === "quota");
  assert.equal(calls, 1);
});

test("sağlayıcı hata yanıtlarını güvenli kategorilere ayırır", () => {
  const client = new ApiFootballClient({ apiKey: "test-key", client: { get: async () => ({ data: { response: [] } }) } });
  assert.throws(() => client.extractResponse({ data: { response: [], errors: { fixture: "No data found" } } }), (error) => error instanceof ProviderError && error.category === "no_data");
  assert.throws(() => client.extractResponse({ data: { response: [], errors: { rate: "Rate limit reached" } } }), (error) => error instanceof ProviderError && error.category === "quota");
});