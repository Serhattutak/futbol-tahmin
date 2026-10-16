"use strict";

/**
 * Stable reference passed to services/routes while startup selects the backing
 * store. The active store may only be replaced before markReady(); callers must
 * complete schema validation, restore, and any required reconciliation first.
 */
function createPredictionLedgerHandle(initialLedger) {
  if (!initialLedger || typeof initialLedger.entries !== "function") {
    throw new TypeError("INITIAL_LEDGER_REQUIRED");
  }
  let current = initialLedger;
  let ready = false;

  const ledger = new Proxy(Object.create(null), {
    get(_target, property) {
      const value = current[property];
      return typeof value === "function" ? value.bind(current) : value;
    },
    has(_target, property) {
      return property in current;
    },
    ownKeys() {
      return Reflect.ownKeys(current);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (!(property in current)) return undefined;
      return { configurable: true, enumerable: true, writable: false, value: current[property] };
    },
  });

  return {
    ledger,
    getCurrent: () => current,
    isReady: () => ready,
    replace(nextLedger) {
      if (ready) throw new Error("LEDGER_HANDLE_ALREADY_READY");
      if (!nextLedger || typeof nextLedger.entries !== "function" ||
          typeof nextLedger.recordResponse !== "function" ||
          typeof nextLedger.settleFromProviders !== "function") {
        throw new TypeError("REPLACEMENT_LEDGER_INVALID");
      }
      current = nextLedger;
      return current;
    },
    markReady() {
      if (ready) return;
      if (typeof current.entries !== "function" ||
          typeof current.recordResponse !== "function" ||
          typeof current.settleFromProviders !== "function") {
        throw new Error("LEDGER_NOT_OPERATIONAL");
      }
      ready = true;
    },
  };
}

module.exports = { createPredictionLedgerHandle };
