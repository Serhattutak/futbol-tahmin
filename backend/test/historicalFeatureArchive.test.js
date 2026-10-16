"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { seasonRange, normalizeMatches, buildFeatureRows, argsFrom } = require("../scripts/buildHistoricalFeatureArchive");

test("season range includes both endpoints and rejects invalid spans", () => {
  assert.deepEqual(seasonRange("2023-24", "2025-26"), ["2023-24", "2024-25", "2025-26"]);
  assert.throws(() => seasonRange("2025-26", "2023-24"), /valid/);
});

test("normalizer retains only completed matches with valid score labels", () => {
  const rows = normalizeMatches([
    { date: "2024-08-01", team1: "A", team2: "B", score: { ft: [2, 1] } },
    { date: "2024-08-02", team1: "A", team2: "C", score: { ft: [1, 1] } },
    { date: "2024-08-03", team1: "B", team2: "C" },
    { date: "bad", team1: "X", team2: "Y", score: { ft: [1, 0] } }
  ], "Premier League", "2024-25", "https://example.test/data.json");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].outcome, "H");
  assert.equal(rows[1].outcome, "D");
});

test("feature rows use only completed matches from strictly earlier calendar days", () => {
  const raw = [
    { date: "2024-08-01", team1: "A", team2: "B", score: { ft: [2, 0] } },
    { date: "2024-08-02", team1: "A", team2: "C", score: { ft: [1, 1] } },
    { date: "2024-08-02", team1: "B", team2: "A", score: { ft: [0, 3] } },
    { date: "2024-08-03", team1: "A", team2: "B", score: { ft: [0, 1] } }
  ];
  const matches = normalizeMatches(raw, "Premier League", "2024-25", "fixture-source");
  const rows = buildFeatureRows(matches);
  const day1 = rows.filter(row => row.date === "2024-08-01");
  const day2 = rows.filter(row => row.date === "2024-08-02");
  const day3 = rows.filter(row => row.date === "2024-08-03");
  assert.equal(day1[0].features.home_history_matches, 0);
  assert.equal(day2.length, 2);
  assert.ok(day2.every(row => row.features.home_history_matches === 0 || row.features.away_history_matches === 0));
  assert.equal(day3[0].features.home_history_matches, 2);
  assert.equal(day3[0].features.home_home_last5_win_rate, 1);
  assert.equal(day3[0].features.h2h_last5_matches, 2);
  assert.equal(day3[0].cutoffExclusive, "2024-08-03");
  assert.equal(day3[0].featureTiming, "previous calendar days only");
});

test("CLI arguments have bounded configurable defaults", () => {
  const args = argsFrom(["--from-season", "2010-11", "--to-season", "2025-26", "--concurrency", "3", "--out", "./tmp/archive"]);
  assert.equal(args.fromSeason, "2010-11");
  assert.equal(args.toSeason, "2025-26");
  assert.equal(args.concurrency, 3);
  assert.ok(args.outputDirectory.endsWith("tmp/archive"));
  assert.throws(() => argsFrom(["--surprise"]), /Unknown argument/);
});
