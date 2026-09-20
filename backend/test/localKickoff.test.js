const test = require("node:test");
const assert = require("node:assert/strict");
const { localKickoffToUtc } = require("../services/localKickoff");
test("OpenFootball local kickoff times convert to real UTC", () => {
  assert.equal(localKickoffToUtc("2026-09-20", "12:15", "Netherlands"), "2026-09-20T10:15:00.000Z");
  assert.equal(localKickoffToUtc("2026-09-20", "14:00", "England"), "2026-09-20T13:00:00.000Z");
  assert.equal(localKickoffToUtc("2026-11-01", "12:15", "Netherlands"), "2026-11-01T11:15:00.000Z");
  assert.equal(localKickoffToUtc("2026-09-20", "12:15", "Unknown"), "2026-09-20T12:15:00Z");
});