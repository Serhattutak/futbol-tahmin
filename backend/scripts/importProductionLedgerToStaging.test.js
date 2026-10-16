"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertStagingTarget,
  canonicalJson,
  STAGING_HOST,
  STAGING_BRANCH_ID,
  CONFIRMATION,
} = require("./importProductionLedgerToStaging");

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) previous[key] = process.env[key];
  Object.assign(process.env, values);
  try { return fn(); }
  finally {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("staging import requires explicit Neon mode, branch ID, confirmation and exact staging host", () => {
  const connectionString = `postgresql://role:secret@${STAGING_HOST}/zeus_ai?sslmode=require`;
  assert.throws(() => withEnv({ ZEUS_LEDGER_MODE: "filesystem" }, () => assertStagingTarget(connectionString)), /STAGING_IMPORT_REQUIRES_NEON_MODE/);
  assert.throws(() => withEnv({
    ZEUS_LEDGER_MODE: "neon",
    ZEUS_LEDGER_STAGING_BRANCH_ID: "main",
    ZEUS_LEDGER_STAGING_IMPORT_CONFIRMATION: CONFIRMATION,
  }, () => assertStagingTarget(connectionString)), /STAGING_IMPORT_BRANCH_ID_MISMATCH/);
  assert.throws(() => withEnv({
    ZEUS_LEDGER_MODE: "neon",
    ZEUS_LEDGER_STAGING_BRANCH_ID: STAGING_BRANCH_ID,
    ZEUS_LEDGER_STAGING_IMPORT_CONFIRMATION: CONFIRMATION,
  }, () => assertStagingTarget("postgresql://role:secret@production.neon.tech/zeus_ai")), /STAGING_IMPORT_REFUSES_NON_STAGING_HOST/);
  assert.deepEqual(withEnv({
    ZEUS_LEDGER_MODE: "neon",
    ZEUS_LEDGER_STAGING_BRANCH_ID: STAGING_BRANCH_ID,
    ZEUS_LEDGER_STAGING_IMPORT_CONFIRMATION: CONFIRMATION,
  }, () => assertStagingTarget(connectionString)), { branchId: STAGING_BRANCH_ID, host: STAGING_HOST });
});

test("canonical JSON comparison ignores object key order but preserves array order", () => {
  assert.equal(canonicalJson({ b: 2, a: { y: 1, x: 0 } }), canonicalJson({ a: { x: 0, y: 1 }, b: 2 }));
  assert.notEqual(canonicalJson({ scores: [1, 2] }), canonicalJson({ scores: [2, 1] }));
});
