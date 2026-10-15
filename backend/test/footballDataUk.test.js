const assert = require("node:assert/strict");
const test = require("node:test");
const provider = require("../providers/footballDataUk");

test("football-data.co.uk parses quoted CSV fields and commas", () => {
  assert.deepEqual(provider.parseCsvLine('"Date","HomeTeam","AwayTeam","Notes"'), ["Date", "HomeTeam", "AwayTeam", "Notes"]);
  assert.deepEqual(provider.parseCsvLine('"15/10/26","AFC Example, FC","Town ""B""","note, with comma"'), ["15/10/26", "AFC Example, FC", 'Town "B"', "note, with comma"]);
});

test("football-data.co.uk validates dates and maps dates to European seasons", () => {
  assert.equal(provider.parseDate("15/10/26"), "2026-10-15");
  assert.equal(provider.parseDate("01/02/2025"), "2025-02-01");
  assert.equal(provider.parseDate("31/02/26"), null);
  assert.equal(provider.seasonFor("2026-10-15"), "2627");
  assert.equal(provider.seasonFor("2026-06-01"), "2526");
  assert.equal(provider.turkeyDate("2026-10-15T22:30:00.000Z"), "2026-10-16");
});

test("football-data.co.uk fixtures preserve verified scores and never invent them", () => {
  const meta = provider.LEAGUES["Premier League"];
  const finished = provider.toFixture({ Date: "15/10/26", Time: "19:45", HomeTeam: "Arsenal", AwayTeam: "Chelsea", FTHG: "2", FTAG: "1", FTR: "H" }, "Premier League", meta, "2627");
  assert.equal(finished.provider, "football-data-uk");
  assert.equal(finished.fixture.status.short, "FINISHED");
  assert.deepEqual(finished.goals, { home: 2, away: 1 });
  assert.match(finished.fixture.id, /^fdu-e0-2627-2026-10-15-/);
  const upcoming = provider.toFixture({ Date: "20/10/26", Time: "20:00", HomeTeam: "Arsenal", AwayTeam: "Chelsea", FTHG: "", FTAG: "", FTR: "" }, "Premier League", meta, "2627");
  assert.equal(upcoming.fixture.status.short, "SCHEDULED");
  assert.deepEqual(upcoming.goals, { home: null, away: null });
  assert.equal(provider.toFixture({ Date: "bad", HomeTeam: "A", AwayTeam: "B" }, "Premier League", meta, "2627"), null);
});
