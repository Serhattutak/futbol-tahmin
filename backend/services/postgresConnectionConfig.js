"use strict";

/**
 * Make the intended PostgreSQL TLS verification mode explicit for pg-connection-string.
 * Current pg-connection-string treats these legacy aliases as verify-full; normalizing
 * them avoids the warning without weakening TLS or changing non-PostgreSQL URLs.
 */
function normalizePostgresConnectionString(connectionString) {
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new TypeError("POSTGRES_CONNECTION_STRING_REQUIRED");
  }

  const parsed = new URL(connectionString);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return connectionString;
  }

  const sslMode = (parsed.searchParams.get("sslmode") || "").toLowerCase();
  if (["prefer", "require", "verify-ca"].includes(sslMode)) {
    parsed.searchParams.set("sslmode", "verify-full");
  }

  return parsed.toString();
}

module.exports = { normalizePostgresConnectionString };
