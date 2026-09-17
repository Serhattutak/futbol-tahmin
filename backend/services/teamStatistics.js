const { selectHistory, historicalTeamKey: teamKey } = require("./historicalForm");
const { RECENCY_DECAY } = require("./predictionModel");

const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
function aggregate(rows, weighted = false) {
  const weights = rows.map((_, i) => weighted ? RECENCY_DECAY ** i : 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const sum = fn => rows.reduce((n, row, i) => n + fn(row) * weights[i], 0);
  const rate = fn => total ? sum(fn) / total : null;
  const half = rows.filter(row => Number.isFinite(row.halfFor) && Number.isFinite(row.halfAgainst));
  const halfWeight = rows.reduce((n, row, i) => n + (Number.isFinite(row.halfFor) && Number.isFinite(row.halfAgainst) ? weights[i] : 0), 0);
  return {
    sampleSize: rows.length,
    wins: sum(r => Number(r.gf > r.ga)), draws: sum(r => Number(r.gf === r.ga)), losses: sum(r => Number(r.gf < r.ga)),
    winRate: rate(r => Number(r.gf > r.ga)), drawRate: rate(r => Number(r.gf === r.ga)), lossRate: rate(r => Number(r.gf < r.ga)),
    pointsPerGame: rate(r => r.gf > r.ga ? 3 : r.gf === r.ga ? 1 : 0),
    goalsFor: rows.length ? sum(r => r.gf) : null, goalsAgainst: rows.length ? sum(r => r.ga) : null,
    goalsForPerMatch: rate(r => r.gf), goalsAgainstPerMatch: rate(r => r.ga), goalDifferencePerMatch: rate(r => r.gf - r.ga),
    over05Rate: rate(r => Number(r.gf + r.ga > 0.5)), over15Rate: rate(r => Number(r.gf + r.ga > 1.5)),
    over25Rate: rate(r => Number(r.gf + r.ga > 2.5)), over35Rate: rate(r => Number(r.gf + r.ga > 3.5)), under25Rate: rate(r => Number(r.gf + r.ga < 2.5)),
    bttsRate: rate(r => Number(r.gf > 0 && r.ga > 0)), bttsNoRate: rate(r => Number(r.gf === 0 || r.ga === 0)),
    cleanSheetRate: rate(r => Number(r.ga === 0)), failedToScoreRate: rate(r => Number(r.gf === 0)),
    firstHalfSample: half.length,
    firstHalfGoalsFor: half.length ? sum(r => r.halfFor ?? 0) : null,
    firstHalfGoalsAgainst: half.length ? sum(r => r.halfAgainst ?? 0) : null,
    firstHalfOver05Rate: halfWeight ? sum(r => Number(Number.isFinite(r.halfFor) && Number.isFinite(r.halfAgainst) && r.halfFor + r.halfAgainst > 0.5)) / halfWeight : null,
  };
}

function splitStats(rows, weighted) {
  const stats = aggregate(rows, weighted);
  for (const venue of ["home", "away"]) {
    const split = aggregate(rows.filter(row => row.venue === venue), weighted);
    stats[venue] = split;
    stats[`${venue}Matches`] = split.sampleSize;
    for (const key of ["wins", "draws", "losses", "goalsForPerMatch", "goalsAgainstPerMatch"]) stats[`${venue}${key[0].toUpperCase()}${key.slice(1)}`] = split[key];
  }
  return stats;
}

function calculateTeamStatistics(matches, team, beforeDate, { now = Date.now(), limit = 10 } = {}) {
  const valid = selectHistory(matches, { team, before: beforeDate, now, limit });
  const rows = valid.map(match => {
    const home = teamKey(match.teams.home.name) === teamKey(team.name);
    const half = match.score?.halftime;
    const completeHalf = Number.isFinite(half?.home) && Number.isFinite(half?.away) && half.home >= 0 && half.away >= 0;
    return { venue: home ? "home" : "away", gf: home ? match.goals.home : match.goals.away, ga: home ? match.goals.away : match.goals.home,
      halfFor: completeHalf ? (home ? half.home : half.away) : null, halfAgainst: completeHalf ? (home ? half.away : half.home) : null };
  });
  const raw = splitStats(rows, false);
  return { sampleSize: rows.length, last5: rows.slice(0, 5).map(r => r.gf > r.ga ? "W" : r.gf < r.ga ? "L" : "D"),
    last10: rows.map(r => r.gf > r.ga ? "W" : r.gf < r.ga ? "L" : "D"), raw, weighted: splitStats(rows, true),
    sources: [...new Set(valid.flatMap(m => m.providers || [m.provider]).filter(Boolean))], cutoff: beforeDate, recencyDecay: RECENCY_DECAY };
}

function buildMatchStatistics(fixture, { homeMatches = [], awayMatches = [], h2hMatches = [], now = Date.now() } = {}) {
  const home = calculateTeamStatistics(homeMatches, fixture.homeTeam, fixture.kickoff, { now });
  const away = calculateTeamStatistics(awayMatches, fixture.awayTeam, fixture.kickoff, { now });
  const pair = [teamKey(fixture.homeTeam.name), teamKey(fixture.awayTeam.name)];
  const meetings = [...homeMatches, ...awayMatches, ...h2hMatches].filter(m => pair.includes(teamKey(m.teams?.home?.name)) && pair.includes(teamKey(m.teams?.away?.name)) && teamKey(m.teams?.home?.name) !== teamKey(m.teams?.away?.name))
    .map(m => ({ ...m, teams: Object.fromEntries(["home", "away"].map(side => [side, { ...m.teams[side], id: `history:${teamKey(m.teams[side].name)}` }])) }));
  const unique = [...new Map(meetings.map(m => [`${m.fixture?.date}:${teamKey(m.teams?.home?.name)}:${teamKey(m.teams?.away?.name)}`, m])).values()];
  const head = calculateTeamStatistics(unique, fixture.homeTeam, fixture.kickoff, { now });
  const h2h = head.sampleSize ? { sampleSize: head.sampleSize, homeWins: head.raw.wins, draws: head.raw.draws, awayWins: head.raw.losses,
    goalsPerMatch: head.raw.goalsForPerMatch + head.raw.goalsAgainstPerMatch, over25Rate: head.raw.over25Rate, bttsRate: head.raw.bttsRate } : null;
  const combine = key => Number.isFinite(home.weighted[key]) && Number.isFinite(away.weighted[key]) ? mean([home.weighted[key], away.weighted[key]]) : null;
  const homeAttackStrength = home.weighted.home.goalsForPerMatch ?? home.weighted.goalsForPerMatch;
  const awayAttackStrength = away.weighted.away.goalsForPerMatch ?? away.weighted.goalsForPerMatch;
  const homeDefenceStrength = home.weighted.home.goalsAgainstPerMatch ?? home.weighted.goalsAgainstPerMatch;
  const awayDefenceStrength = away.weighted.away.goalsAgainstPerMatch ?? away.weighted.goalsAgainstPerMatch;
  const rates = [homeAttackStrength, awayAttackStrength, homeDefenceStrength, awayDefenceStrength];
  const missingFields = [];
  if (home.sampleSize < 5) missingFields.push("homeHistory");
  if (away.sampleSize < 5) missingFields.push("awayHistory");
  if (!home.raw.homeMatches) missingFields.push("homeSplit");
  if (!away.raw.awayMatches) missingFields.push("awaySplit");
  if (!h2h) missingFields.push("h2h");
  if (!home.raw.firstHalfSample || !away.raw.firstHalfSample) missingFields.push("firstHalf");
  const score = Math.round(Math.min(home.sampleSize / 10, 1) * 40 + Math.min(away.sampleSize / 10, 1) * 40
    + Math.min(home.raw.homeMatches / 5, 1) * 10 + Math.min(away.raw.awayMatches / 5, 1) * 10);
  return { home, away, h2h, matchup: { expectedGoalEnvironment: rates.every(Number.isFinite) ? rates.reduce((a, b) => a + b, 0) / 2 : null,
    combinedOver15Rate: combine("over15Rate"), combinedOver25Rate: combine("over25Rate"), combinedOver35Rate: combine("over35Rate"),
    combinedBTTSRate: combine("bttsRate"), combinedCleanSheetRate: combine("cleanSheetRate"),
    homeAttackStrength, awayAttackStrength, homeDefenceStrength, awayDefenceStrength },
    dataQuality: { score, homeSample: home.sampleSize, awaySample: away.sampleSize, missingFields, sources: [...new Set([...home.sources, ...away.sources])] } };
}

module.exports = { calculateTeamStatistics, buildMatchStatistics };
