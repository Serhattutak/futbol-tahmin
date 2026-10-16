const test = require("node:test");
const assert = require("node:assert/strict");
const { assessPreMatchFixture } = require("../services/preMatchDataQuality");

const NOW = Date.parse("2026-10-15T12:00:00Z");
function fixture(overrides = {}) {
  return {
    provider: "openfootball",
    providers: ["openfootball"],
    dataConflict: false,
    fixture: { id: "f-1", date: "2026-10-16T15:00:00Z", kickoffPrecision: "time", status: { short: "SCHEDULED" } },
    league: { name: "Test League", country: "Testland" },
    teams: { home: { name: "Home FC" }, away: { name: "Away FC" } },
    ...overrides,
  };
}

test("accepts a complete, sourced, future scheduled fixture", () => {
  const result = assessPreMatchFixture(fixture(), { now: NOW });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.sourceCount, 1);
  assert.equal(result.kickoff, "2026-10-16T15:00:00.000Z");
});

test("fails closed for unknown/date-only kickoff and kickoff at or before now", () => {
  assert.ok(assessPreMatchFixture(fixture({ fixture: { date: "2026-10-16", kickoffPrecision: "date", status: { short: "SCHEDULED" } } }), { now: NOW }).reasons.includes("UNKNOWN_KICKOFF"));
  assert.ok(assessPreMatchFixture(fixture({ fixture: { date: "2026-10-15T12:00:00Z", kickoffPrecision: "time", status: { short: "SCHEDULED" } } }), { now: NOW }).reasons.includes("KICKOFF_REACHED"));
  assert.ok(assessPreMatchFixture(fixture({ fixture: { date: "2026-10-16T15:00:00", kickoffPrecision: "time", status: { short: "SCHEDULED" } } }), { now: NOW }).reasons.includes("UNKNOWN_KICKOFF"));
});

test("rejects live, finished, postponed, cancelled and unknown fixture states", () => {
  for (const [status, reason] of [["LIVE", "FIXTURE_ALREADY_STARTED"], ["FINISHED", "FIXTURE_FINISHED"], ["POSTPONED", "FIXTURE_POSTPONED"], ["CANCELLED", "FIXTURE_CANCELLED"], ["UNRECOGNIZED", "UNKNOWN_FIXTURE_STATUS"]]) {
    const result = assessPreMatchFixture(fixture({ fixture: { date: "2026-10-16T15:00:00Z", kickoffPrecision: "time", status: { short: status } } }), { now: NOW });
    assert.equal(result.eligible, false, status);
    assert.ok(result.reasons.includes(reason), status);
  }
});

test("rejects conflicting, incomplete, duplicate-team, sourceless, stale and provider-error fixtures", () => {
  const cases = [
    [fixture({ dataConflict: true }), {}, "FIXTURE_DATA_CONFLICT"],
    [fixture({ league: { name: "" } }), {}, "MISSING_LEAGUE"],
    [fixture({ teams: { home: { name: "Home FC" }, away: { name: "" } } }), {}, "MISSING_TEAM"],
    [fixture({ teams: { home: { name: "Same FC" }, away: { name: "Same FC" } } }), {}, "SAME_HOME_AWAY_TEAM"],
    [fixture({ provider: null, source: null, providers: [] }), {}, "MISSING_SOURCE_PROVENANCE"],
    [fixture(), { stale: true }, "STALE_FIXTURE_DATA"],
    [fixture(), { providerError: "timeout" }, "PROVIDER_DISCOVERY_ERROR"],
  ];
  for (const [value, options, reason] of cases) {
    const result = assessPreMatchFixture(value, { now: NOW, ...options });
    assert.equal(result.eligible, false, reason);
    assert.ok(result.reasons.includes(reason), reason);
  }
});

test("deduplicates rejection reasons and does not trust unknown statuses", () => {
  const result = assessPreMatchFixture(fixture({ fixture: { date: "bad", kickoffPrecision: "time", status: { short: "TBD?" } }, dataConflict: true }), { now: NOW });
  assert.equal(new Set(result.reasons).size, result.reasons.length);
  assert.ok(result.reasons.includes("UNKNOWN_KICKOFF"));
  assert.ok(result.reasons.includes("UNKNOWN_FIXTURE_STATUS"));
});
