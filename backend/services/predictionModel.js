const MODEL_VERSION = "4.0";
const HOME_ADVANTAGE = 1.06;
const RECENCY_DECAY = 0.82;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function poissonProbability(lambda, goals) {
  let factorial = 1;
  for (let index = 1; index <= goals; index += 1) factorial *= index;
  return Math.exp(-lambda) * Math.pow(lambda, goals) / factorial;
}

function weightedStrength(matches, teamId, venue = "all") {
  const completed = matches.filter((match) => {
    const isHome = String(match.teams?.home?.id) === String(teamId);
    const isAway = String(match.teams?.away?.id) === String(teamId);
    return (isHome || isAway) && (venue === "all" || (venue === "home" && isHome) || (venue === "away" && isAway)) && Number.isFinite(match.goals?.home) && Number.isFinite(match.goals?.away);
  }).sort((left, right) => new Date(right.fixture?.date || 0) - new Date(left.fixture?.date || 0));
  let weightTotal = 0; let goalsFor = 0; let goalsAgainst = 0; let points = 0;
  completed.forEach((match, index) => {
    const weight = Math.pow(RECENCY_DECAY, index);
    const isHome = String(match.teams.home.id) === String(teamId);
    const scored = isHome ? match.goals.home : match.goals.away;
    const conceded = isHome ? match.goals.away : match.goals.home;
    weightTotal += weight; goalsFor += scored * weight; goalsAgainst += conceded * weight;
    points += (scored > conceded ? 3 : scored === conceded ? 1 : 0) * weight;
  });
  return { games: completed.length, averageGoalsFor: weightTotal ? goalsFor / weightTotal : null, averageGoalsAgainst: weightTotal ? goalsAgainst / weightTotal : null, pointsPerGame: weightTotal ? points / weightTotal : null };
}

function calculateConfidence({ dataQuality, homeGames, awayGames, probabilities, value }) {
  const sorted = [...probabilities].sort((left, right) => right - left);
  const sampleScore = Math.min((homeGames + awayGames) / 20, 1) * 18;
  const separationScore = clamp((sorted[0] - sorted[1]) / 35, 0, 1) * 17;
  const probabilityScore = clamp((sorted[0] - 33) / 35, 0, 1) * 10;
  const valueScore = Number.isFinite(value) && value > 0 ? Math.min(value / 20, 1) * 5 : 0;
  return Math.round(clamp(dataQuality * 0.5 + sampleScore + separationScore + probabilityScore + valueScore, 0, 100));
}

function rankMarket({ probability, confidence, dataQuality, value, hasOdds }) {
  const valueBonus = hasOdds && Number.isFinite(value) && value > 0 ? Math.min(value, 25) * 0.2 : 0;
  return Number((probability * 0.42 + confidence * 0.32 + dataQuality * 0.26 + valueBonus).toFixed(2));
}

function buildReasons({ homeRecent, awayRecent, homeVenue, awayVenue, h2h, standings, dataQuality, hasXg }) {
  const reasons = [];
  if (Number.isFinite(homeRecent.pointsPerGame) && Number.isFinite(awayRecent.pointsPerGame) && homeRecent.pointsPerGame > awayRecent.pointsPerGame + 0.35) reasons.push("Ev sahibinin ağırlıklı güncel formu daha güçlü.");
  if (Number.isFinite(awayRecent.averageGoalsFor) && awayRecent.averageGoalsFor < 0.9) reasons.push("Deplasman takımının ağırlıklı gol ortalaması düşük.");
  if (Number.isFinite(homeVenue.pointsPerGame) && Number.isFinite(homeRecent.pointsPerGame) && homeVenue.pointsPerGame > homeRecent.pointsPerGame + 0.25) reasons.push("Ev sahibi kendi sahasındaki ağırlıklı performansıyla öne çıkıyor.");
  if (h2h.count >= 3 && h2h.homeWins > h2h.awayWins) reasons.push("Yeterli H2H örnekleminde ev sahibi avantajı var.");
  if (standings.home && standings.away && standings.home.rank < standings.away.rank) reasons.push("Lig sıralamasında ev sahibi daha üstte.");
  if (hasXg) reasons.push("Mevcut maç xG verisi gol beklentisine dahil edildi.");
  if (dataQuality.score >= 75) reasons.push("Veri kalitesi güçlü.");
  return reasons;
}

function blendHistoricalMarkets(probabilities, profile) {
  const weight = Math.min(profile.home.sampleSize, profile.away.sampleSize, 10) / 10 * 0.15;
  const blend = (probability, observed) => Number.isFinite(observed) ? clamp(probability * (1 - weight) + observed * weight, 0, 1) : probability;
  const defence = [profile.home.weighted.cleanSheetRate, profile.away.weighted.cleanSheetRate,
    profile.home.weighted.failedToScoreRate, profile.away.weighted.failedToScoreRate];
  const btts = Number.isFinite(profile.matchup.combinedBTTSRate) && defence.every(Number.isFinite)
    ? profile.matchup.combinedBTTSRate * 0.8 + (1 - defence.reduce((a, b) => a + b, 0) / 4) * 0.2 : null;
  return { ...probabilities, over15: blend(probabilities.over15, profile.matchup.combinedOver15Rate),
    over25: blend(probabilities.over25, profile.matchup.combinedOver25Rate), over35: blend(probabilities.over35, profile.matchup.combinedOver35Rate),
    bttsYes: blend(probabilities.bttsYes, btts) };
}

module.exports = { MODEL_VERSION, HOME_ADVANTAGE, RECENCY_DECAY, poissonProbability, weightedStrength, calculateConfidence, rankMarket, buildReasons, blendHistoricalMarkets };
