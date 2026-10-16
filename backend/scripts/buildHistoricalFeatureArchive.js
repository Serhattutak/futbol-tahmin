"use strict";

const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");

const BASE_URL = "https://raw.githubusercontent.com/openfootball/football.json/master";
const LEAGUES = {
  "Premier League": { file: "en.1.json", country: "England" },
  "Championship": { file: "en.2.json", country: "England" },
  "League One": { file: "en.3.json", country: "England" },
  "League Two": { file: "en.4.json", country: "England" },
  "La Liga": { file: "es.1.json", country: "Spain" },
  "Segunda División": { file: "es.2.json", country: "Spain" },
  "Bundesliga": { file: "de.1.json", country: "Germany" },
  "2. Bundesliga": { file: "de.2.json", country: "Germany" },
  "Serie A": { file: "it.1.json", country: "Italy" },
  "Serie B": { file: "it.2.json", country: "Italy" },
  "Ligue 1": { file: "fr.1.json", country: "France" },
  "Ligue 2": { file: "fr.2.json", country: "France" },
  "Eredivisie": { file: "nl.1.json", country: "Netherlands" },
  "Primeira Liga": { file: "pt.1.json", country: "Portugal" },
  "Scottish Premiership": { file: "sco.1.json", country: "Scotland" },
  "Süper Lig": { file: "tr.1.json", country: "Turkey" },
  "Pro League": { file: "be.1.json", country: "Belgium" },
  "Austrian Bundesliga": { file: "at.1.json", country: "Austria" },
  "Super League Greece": { file: "gr.1.json", country: "Greece" }
};

function seasonRange(fromSeason = "2006-07", toSeason = "2025-26") {
  const start = Number(String(fromSeason).slice(0, 4));
  const end = Number(String(toSeason).slice(0, 4));
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end - start > 40) {
    throw new RangeError("Season range must be valid and span no more than 40 seasons");
  }
  return Array.from({ length: end - start + 1 }, (_, i) => {
    const year = start + i;
    return `${year}-${String(year + 1).slice(-2)}`;
  });
}

function parseScore(match) {
  const score = Array.isArray(match.score) ? match.score : Array.isArray(match.score?.ft) ? match.score.ft : null;
  if (!score || score.length < 2) return null;
  const homeGoals = Number(score[0]), awayGoals = Number(score[1]);
  if (!Number.isInteger(homeGoals) || homeGoals < 0 || !Number.isInteger(awayGoals) || awayGoals < 0) return null;
  return { homeGoals, awayGoals };
}

function normalizeMatches(matches, league, season, sourceUrl) {
  return (Array.isArray(matches) ? matches : []).flatMap((match, index) => {
    const date = String(match.date || match.date?.utc || "").slice(0, 10);
    const home = String(match.team1 || match.home || "").trim();
    const away = String(match.team2 || match.away || "").trim();
    const score = parseScore(match);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !home || !away || home === away || !score) return [];
    const outcome = score.homeGoals > score.awayGoals ? "H" : score.homeGoals < score.awayGoals ? "A" : "D";
    return [{
      id: `${league}:${season}:${date}:${home}:${away}:${index}`,
      date, league, country: LEAGUES[league].country, season, home, away,
      homeGoals: score.homeGoals, awayGoals: score.awayGoals, outcome,
      source: "openfootball-public-domain", sourceUrl
    }];
  });
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function teamRecord(match, team, venue) {
  const isHome = match.home === team;
  const actualVenue = isHome ? "home" : "away";
  if (venue && actualVenue !== venue) return null;
  const gf = isHome ? match.homeGoals : match.awayGoals;
  const ga = isHome ? match.awayGoals : match.homeGoals;
  return { gf, ga, win: Number(gf > ga), draw: Number(gf === ga), points: gf > ga ? 3 : gf === ga ? 1 : 0, date: match.date };
}
function lastRecords(history, limit, venue) {
  const records = history.filter(record => !venue || record.venue === venue).slice(-limit);
  return records;
}
function teamFeatures(prefix, records, venueLabel, features) {
  for (const n of [5, 10]) {
    const rows = lastRecords(records, n, venueLabel);
    features[`${prefix}_${venueLabel ? venueLabel + "_" : ""}last${n}_matches`] = rows.length;
    features[`${prefix}_${venueLabel ? venueLabel + "_" : ""}last${n}_win_rate`] = average(rows.map(row => row.win));
    features[`${prefix}_${venueLabel ? venueLabel + "_" : ""}last${n}_points_per_game`] = average(rows.map(row => row.points));
    features[`${prefix}_${venueLabel ? venueLabel + "_" : ""}last${n}_goals_for_per_match`] = average(rows.map(row => row.gf));
    features[`${prefix}_${venueLabel ? venueLabel + "_" : ""}last${n}_goals_against_per_match`] = average(rows.map(row => row.ga));
  }
}
function makeFeatures(match, homeHistory, awayHistory, h2hHistory, leagueHistory) {
  const features = {};
  teamFeatures("home", homeHistory, null, features);
  teamFeatures("home", homeHistory, "home", features);
  teamFeatures("away", awayHistory, null, features);
  teamFeatures("away", awayHistory, "away", features);
  for (const n of [5, 10]) {
    const meetings = h2hHistory.slice(-n);
    features[`h2h_last${n}_matches`] = meetings.length;
    features[`h2h_last${n}_home_win_rate`] = average(meetings.map(row => Number(row.home === match.home ? row.homeGoals > row.awayGoals : row.awayGoals > row.homeGoals)));
    features[`h2h_last${n}_over_2_5_rate`] = average(meetings.map(row => Number(row.homeGoals + row.awayGoals >= 3)));
    features[`h2h_last${n}_btts_rate`] = average(meetings.map(row => Number(row.homeGoals > 0 && row.awayGoals > 0)));
  }
  const recent = leagueHistory.slice(-100);
  features.league_prior_matches = leagueHistory.length;
  features.league_last100_home_win_rate = average(recent.map(row => Number(row.homeGoals > row.awayGoals)));
  features.league_last100_draw_rate = average(recent.map(row => Number(row.homeGoals === row.awayGoals)));
  features.league_last100_over_2_5_rate = average(recent.map(row => Number(row.homeGoals + row.awayGoals >= 3)));
  features.home_history_matches = homeHistory.length;
  features.away_history_matches = awayHistory.length;
  return features;
}

/**
 * Builds pre-kickoff features in chronological batches. All matches on the
 * target calendar day are held out from each other because source kickoff times
 * may be missing or timezone-inconsistent. Only completed earlier-day matches
 * contribute to a target's feature vector.
 */
function buildFeatureRows(fixtures) {
  const byLeague = new Map();
  for (const match of fixtures) {
    const key = `${match.country}:${match.league}`;
    if (!byLeague.has(key)) byLeague.set(key, []);
    byLeague.get(key).push(match);
  }
  const output = [];
  for (const leagueRows of byLeague.values()) {
    leagueRows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const teamHistories = new Map(), h2h = new Map(), leagueHistory = [];
    for (let i = 0; i < leagueRows.length;) {
      const date = leagueRows[i].date, batch = [];
      while (i < leagueRows.length && leagueRows[i].date === date) batch.push(leagueRows[i++]);
      for (const match of batch) {
        const homeHistory = teamHistories.get(match.home) || [];
        const awayHistory = teamHistories.get(match.away) || [];
        const pair = [match.home, match.away].sort().join("::");
        const meetings = h2h.get(pair) || [];
        const features = makeFeatures(match, homeHistory, awayHistory, meetings, leagueHistory);
        output.push({
          id: match.id, date: match.date, league: match.league, country: match.country, season: match.season,
          home: match.home, away: match.away, homeGoals: match.homeGoals, awayGoals: match.awayGoals,
          outcome: match.outcome, features, cutoffExclusive: match.date,
          featureTiming: "previous calendar days only", source: match.source, sourceUrl: match.sourceUrl
        });
      }
      // Add the entire date batch only after all predictions/features for that day are frozen.
      for (const match of batch) {
        const homeHistory = teamHistories.get(match.home) || [];
        const awayHistory = teamHistories.get(match.away) || [];
        const home = teamRecord(match, match.home, "home");
        const away = teamRecord(match, match.away, "away");
        home.venue = "home"; away.venue = "away";
        teamHistories.set(match.home, [...homeHistory, home]);
        teamHistories.set(match.away, [...awayHistory, away]);
        const pair = [match.home, match.away].sort().join("::");
        h2h.set(pair, [...(h2h.get(pair) || []), match]);
        leagueHistory.push(match);
      }
    }
  }
  return output.sort((a, b) => a.date.localeCompare(b.date) || a.league.localeCompare(b.league) || a.id.localeCompare(b.id));
}

async function fetchSeason(league, season, { client = axios, baseUrl = BASE_URL } = {}) {
  const meta = LEAGUES[league];
  const url = `${baseUrl}/${season}/${meta.file}`;
  try {
    const response = await client.get(url, { timeout: 20000 });
    return { league, season, url, matches: normalizeMatches(response.data?.matches, league, season, url), status: "downloaded" };
  } catch (error) {
    if (error.response?.status === 404) return { league, season, url, matches: [], status: "not_available" };
    return { league, season, url, matches: [], status: "error", error: error.message };
  }
}

async function fetchArchive({ fromSeason = "2006-07", toSeason = "2025-26", leagues = Object.keys(LEAGUES), concurrency = 5, client = axios } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) throw new RangeError("concurrency must be between 1 and 12");
  const seasons = seasonRange(fromSeason, toSeason);
  const tasks = leagues.flatMap(league => {
    if (!LEAGUES[league]) throw new Error(`Unknown league: ${league}`);
    return seasons.map(season => ({ league, season }));
  });
  const results = new Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      const task = tasks[index];
      results[index] = await fetchSeason(task.league, task.season, { client });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

function writeArchive(rows, reports, outputDirectory = path.join(__dirname, "../data/historical-feature-archive")) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const rowsPath = path.join(outputDirectory, "rows.jsonl");
  const temporaryPath = `${rowsPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
  fs.renameSync(temporaryPath, rowsPath);
  const report = {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    methodology: "Chronological feature replay; same-day results excluded; final score is label only, never a feature.",
    sourceLicense: "OpenFootball datasets are dedicated to the public domain (CC0); confirm source terms before adding any additional provider.",
    rowCount: rows.length, firstDate: rows[0]?.date || null, lastDate: rows.at(-1)?.date || null,
    featureCount: rows[0] ? Object.keys(rows[0].features).length : 0,
    sources: reports.map(({ league, season, url, status, matches, error }) => ({ league, season, url, status, matches: matches.length, ...(error ? { error } : {}) })),
    totals: {
      requestedLeagueSeasons: reports.length,
      downloaded: reports.filter(row => row.status === "downloaded").length,
      unavailable: reports.filter(row => row.status === "not_available").length,
      errors: reports.filter(row => row.status === "error").length,
      fixturesWithResults: rows.length
    }
  };
  fs.writeFileSync(path.join(outputDirectory, "report.json"), JSON.stringify(report, null, 2), "utf8");
  return { rowsPath, reportPath: path.join(outputDirectory, "report.json"), report };
}

function argsFrom(argv) {
  const args = { fromSeason: "2006-07", toSeason: "2025-26", concurrency: 5, outputDirectory: path.join(__dirname, "../data/historical-feature-archive") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from-season") args.fromSeason = argv[++i];
    else if (argv[i] === "--to-season") args.toSeason = argv[++i];
    else if (argv[i] === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (argv[i] === "--out") args.outputDirectory = path.resolve(argv[++i]);
    else if (argv[i] === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = argsFrom(argv);
  if (args.help) {
    console.log("Usage: node scripts/buildHistoricalFeatureArchive.js [--from-season 2006-07] [--to-season 2025-26] [--concurrency 5] [--out path]");
    return;
  }
  const reports = await fetchArchive(args);
  const rows = buildFeatureRows(reports.flatMap(report => report.matches));
  const result = writeArchive(rows, reports, args.outputDirectory);
  console.log(JSON.stringify({ rowsPath: result.rowsPath, reportPath: result.reportPath, ...result.report.totals, firstDate: result.report.firstDate, lastDate: result.report.lastDate, featureCount: result.report.featureCount }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { LEAGUES, seasonRange, parseScore, normalizeMatches, buildFeatureRows, fetchSeason, fetchArchive, writeArchive, argsFrom };
