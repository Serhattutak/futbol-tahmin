"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePostgresConnectionString } = require("./postgresConnectionConfig");

test("normalizes legacy PostgreSQL SSL aliases to explicit verify-full", () => {
  for (const alias of ["prefer", "require", "verify-ca"]) {
    const normalized = new URL(normalizePostgresConnectionString(
      `postgresql://user:secret@db.example.test/zeus?sslmode=${alias}&application_name=zeus`
    ));
    assert.equal(normalized.searchParams.get("sslmode"), "verify-full");
    assert.equal(normalized.searchParams.get("application_name"), "zeus");
    assert.equal(normalized.username, "user");
    assert.equal(normalized.password, "secret");
    assert.equal(normalized.pathname, "/zeus");
  }
});

test("leaves explicit verify-full and unrelated connection strings unchanged", () => {
  const explicit = "postgres://user:secret@db.example.test/zeus?sslmode=verify-full";
  assert.equal(normalizePostgresConnectionString(explicit), explicit);
  const unrelated = "https://example.test/path?sslmode=require";
  assert.equal(normalizePostgresConnectionString(unrelated), unrelated);
});

test("rejects an empty PostgreSQL connection string", () => {
  assert.throws(() => normalizePostgresConnectionString(" "), {
    name: "TypeError",
    message: "POSTGRES_CONNECTION_STRING_REQUIRED"
  });
});
