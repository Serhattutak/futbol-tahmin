const test = require("node:test");
const assert = require("node:assert/strict");
const { sameFixture } = require("../services/multiProviderRegistry");
const fx = league => ({ homeTeam: { name: "Getafe CF" }, awayTeam: { name: "Málaga CF" }, league: { name: league }, kickoff: "2026-09-20T12:00:00.000Z" });
test("La Liga provider league names merge, other leagues do not", () => {
  assert.equal(sameFixture(fx("Primera Division"), fx("La Liga")), true);
  assert.equal(sameFixture(fx("Serie A"), fx("La Liga")), false);
  assert.equal(sameFixture(fx(""), fx("")), false);
});