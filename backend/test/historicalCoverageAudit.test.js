const test = require("node:test");
const assert = require("node:assert/strict");
const { selectHistory, historicalTeamKey } = require("../services/historicalForm");
const report = require("../../docs/historical-coverage-audit.json");
const sources = require("../../docs/historical-coverage-source-evidence.json");

test("Real Malaga source rows obey strict equality and later-same-day history cutoffs", () => {
  const source = sources.find(s => s.league === "La Liga" && s.season === "2026-27");
  const rows = selectHistory(source.matches, { team: { name: "Malaga" }, before: report.malaga.cohort.kickoff, now: Date.parse(report.cohortAsOf) });
  assert.equal(rows.length, 4);
  const newest = rows[0];
  const atKickoff = selectHistory(source.matches, { team: { name: "Malaga" }, before: newest.fixture.date, now: Date.parse(report.cohortAsOf) });
  const oneMinuteEarlier = new Date(Date.parse(newest.fixture.date) - 60000).toISOString();
  const laterSameDay = selectHistory(source.matches, { team: { name: "Malaga" }, before: oneMinuteEarlier, now: Date.parse(report.cohortAsOf) });
  assert.ok(atKickoff.length > 0);
  assert.ok(!atKickoff.some(m => m.fixture.id === newest.fixture.id));
  assert.ok(!laterSameDay.some(m => m.fixture.id === newest.fixture.id));
  assert.ok(laterSameDay.every(m => Date.parse(m.fixture.date) < Date.parse(oneMinuteEarlier)));
});

test("Audit covers every frozen window fixture and distinguishes unknown prediction eligibility", () => {
  assert.equal(new Set(report.fixtures.map(f => f.fixtureId)).size, 253);
  assert.equal(report.fixtures.filter(f => f.deferredReason === "HISTORY_COVERAGE_PROBE_LIMIT").length, 250);
  assert.ok(report.fixtures.every(f => f.productionPredictionEligible === null));
  assert.equal(report.malaga.cohort.historicalSamples.home, 4);
  assert.equal(report.malaga.cohort.historicalSamples.away, 10);
  assert.equal(report.malaga.cohort.expandedCrossCompetitionSamples.home, 10);
});

test("Real audit selections including older API seasons contain no target-day or future rows", () => {
  const cases = [...report.fixtures.map(f => ({ ...f, selectedHistory: f.selectedHistory })), ...report.oldSeasonScenarios.map(s => ({ ...s, kickoff: report.fixtures.find(f => f.fixtureId === s.fixtureId).kickoff }))];
  for (const item of cases) {
    const cutoff = Math.min(Date.parse(report.cohortAsOf), Date.parse(`${item.kickoff.slice(0, 10)}T00:00:00Z`));
    for (const [side, matches] of Object.entries(item.selectedHistory)) for (const match of matches) {
      assert.ok(Date.parse(match.kickoff) < cutoff);
      assert.ok([match.home, match.away].some(name => historicalTeamKey(name) === historicalTeamKey(item[side])));
    }
  }
  assert.deepEqual(report.leakage.auditedSelectionViolations, []);
});
