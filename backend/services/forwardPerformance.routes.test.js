"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountLedgerRoutes } = require("./forwardPerformance");

function createApp() {
  const routes = new Map();
  return {
    routes,
    get(path, handler) { routes.set(path, handler); },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = true; return this; },
  };
}

function prediction(ledgerId, extra = {}) {
  return {
    ledgerId,
    fixtureId: ledgerId,
    usedModel: "MODEL_4_0",
    predictionCreatedAt: "2026-10-01T10:00:00.000Z",
    resultStatus: null,
    conflicts: [],
    ...extra,
  };
}

test("ledger routes await promise-returning entries and preserve pagination", async () => {
  const app = createApp();
  const rows = [prediction("a"), prediction("b", { resultStatus: "settled" })];
  mountLedgerRoutes(app, { entries: async () => rows });

  const response = createResponse();
  await app.routes.get("/api/ledger/entries")({ query: { limit: "1", offset: "1" } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.total, 2);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].ledgerId, "a");
});

test("ledger route returns explicit 503 when async storage read rejects", async () => {
  const app = createApp();
  mountLedgerRoutes(app, { entries: async () => { throw new Error("database unavailable"); } });

  const response = createResponse();
  await app.routes.get("/api/ledger/status")({ query: {} }, response);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    success: false,
    error: "Ledger kayıtları şu anda okunamıyor.",
  });
});

test("ledger routes remain compatible with synchronous filesystem entries", async () => {
  const app = createApp();
  mountLedgerRoutes(app, { entries: () => [prediction("a"), prediction("b", { resultStatus: "settled" })] });

  const response = createResponse();
  await app.routes.get("/api/ledger/status")({ query: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.total, 2);
  assert.equal(response.body.pending, 1);
  assert.equal(response.body.settled, 1);
});
