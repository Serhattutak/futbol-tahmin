"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const serverPath = path.join(__dirname, "..", "server.js");

function runStartup(overrides) {
  return spawnSync(process.execPath, [serverPath], {
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      ZEUS_DISABLE_CAPTURE_SCHEDULER: "1",
      PORT: "0",
      ...overrides,
    },
  });
}

test("Neon startup refuses to listen without explicit reconciliation verification", () => {
  const result = runStartup({
    ZEUS_LEDGER_MODE: "neon",
    ZEUS_LEDGER_RECONCILIATION_VERIFIED: "",
    DATABASE_URL: "",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NEON_RECONCILIATION_REQUIRED/);
  assert.doesNotMatch(result.stdout, /backend çalışıyor/);
});

test("Neon startup refuses to listen when the database URL is missing", () => {
  const result = runStartup({
    ZEUS_LEDGER_MODE: "neon",
    ZEUS_LEDGER_RECONCILIATION_VERIFIED: "true",
    DATABASE_URL: "",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NEON_DATABASE_URL_REQUIRED/);
  assert.doesNotMatch(result.stdout, /backend çalışıyor/);
});
