"use strict";

const crypto = require("node:crypto");

const TABLE = "public.zeus_prediction_ledger_events";
const EVENT_TYPES = new Set(["prediction", "settlement", "conflict"]);

function stableEventId(event) {
  if (!event || !EVENT_TYPES.has(event.type) || typeof event.ledgerId !== "string" || !event.ledgerId) {
    throw new TypeError("INVALID_LEDGER_EVENT");
  }
  if (event.type === "prediction" || event.type === "settlement") {
    return `${event.type}:${event.ledgerId}`;
  }
  // A ledger entry can have multiple distinct conflict observations.
  return `conflict:${event.ledgerId}:${crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex")}`;
}

/**
 * PostgreSQL event-store adapter. The caller owns the Pool lifecycle.
 * It is intentionally independent from PredictionLedger's synchronous
 * filesystem API until async startup/restore semantics are wired and tested.
 */
class NeonPredictionLedgerStore {
  constructor({ pool, table = TABLE } = {}) {
    if (!pool || typeof pool.query !== "function") throw new TypeError("POSTGRES_POOL_REQUIRED");
    if (typeof table !== "string" || !/^public\.[a-z_][a-z0-9_]*$/.test(table)) throw new TypeError("INVALID_LEDGER_TABLE");
    this.pool = pool;
    this.table = table;
  }

  async append(event) {
    const eventId = stableEventId(event);
    const result = await this.pool.query(
      `INSERT INTO ${this.table} (event_id, ledger_id, event_type, payload) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [eventId, event.ledgerId, event.type, JSON.stringify(event)]
    );
    return { saved: result.rowCount === 1, eventId };
  }

  async loadEvents() {
    const result = await this.pool.query(
      `SELECT payload FROM ${this.table} ORDER BY created_at ASC, event_id ASC`
    );
    return (result.rows || []).map(row => {
      const event = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      stableEventId(event); // Validate persisted data before returning it to callers.
      return event;
    });
  }

  async status() {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS event_count, COUNT(*) FILTER (WHERE event_type = 'prediction')::int AS prediction_count, COUNT(*) FILTER (WHERE event_type = 'settlement')::int AS settlement_count, COUNT(*) FILTER (WHERE event_type = 'conflict')::int AS conflict_count FROM ${this.table}`
    );
    return { connected: true, ...(result.rows?.[0] || {}) };
  }
}

module.exports = { NeonPredictionLedgerStore, stableEventId, TABLE };
