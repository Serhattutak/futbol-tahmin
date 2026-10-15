export const MARKET_GROUPS = {
  "1x2": ["1", "X", "2"],
  double: ["1X", "X2", "12"],
  goals: ["Üst 1.5", "Alt 1.5", "Üst 2.5", "Alt 2.5", "Üst 3.5", "Alt 3.5"],
  btts: ["KG Var", "KG Yok"],
};

export function getMarketEntries(analysis, filter = "all") {
  const entries = Object.entries(analysis?.markets || {});
  if (filter === "all") return entries;
  if (filter === "value") return entries.filter(([, market]) => Array.isArray(market.bookmakerOffers) && market.bookmakerOffers.length > 0 && Number.isFinite(market.value));
  return entries.filter(([name]) => (MARKET_GROUPS[filter] || []).includes(name));
}

export function matchesMarketFilter(analysis, filter) {
  return getMarketEntries(analysis, filter).length > 0;
}

export function marketMetrics(probability, bookmakerOdd) {
  const modelProbability = Number(probability);
  const odd = Number(bookmakerOdd);
  const hasProbability = Number.isFinite(modelProbability) && modelProbability > 0;
  const hasOdd = Number.isFinite(odd) && odd > 1;
  return {
    fairOdds: hasProbability ? Number((100 / modelProbability).toFixed(3)) : null,
    impliedProbability: hasOdd ? Number((100 / odd).toFixed(2)) : null,
    value: hasProbability && hasOdd ? Number(((modelProbability / 100 * odd - 1) * 100).toFixed(2)) : null,
  };
}

export function dataQualityReasons(dataQuality) {
  const missing = new Set(dataQuality?.missing || []);
  return [
    ["Ev sahibi son 10", "Ev sahibi form verisi eksik"],
    ["Deplasman son 10", "Deplasman form verisi eksik"],
    ["H2H", "H2H verisi eksik"],
    ["Bookmaker odds", "Bookmaker odds verisi eksik"],
    ["Standings", "Puan durumu verisi eksik"],
    ["API xG", "xG verisi eksik"],
  ].filter(([key]) => missing.has(key)).map(([, reason]) => reason);
}

export function dataQualityText(score) {
  const value = score == null ? NaN : Number(score);
  if (!Number.isFinite(value)) return "Veri bekleniyor";
  if (value < 40) return "Yetersiz veri";
  if (value < 60) return "Sınırlı veri";
  if (value < 75) return "İyi veri";
  return "Güçlü veri";
}

export function oneXTwoSummary(predictions) {
  const raw = [predictions?.homeWin, predictions?.draw, predictions?.awayWin];
  if (raw.some(value => value === null || value === undefined || value === "")) return null;
  const [home, draw, away] = raw.map(Number);
  if (![home, draw, away].every(Number.isFinite) || [home, draw, away].some(value => value < 0 || value > 100)) return null;
  if (Math.abs(home + draw + away - 100) > 1.5) return null;
  return { home, draw, away };
}
