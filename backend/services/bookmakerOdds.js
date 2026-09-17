function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function marketForBet(bet) {
  const name = normalize(bet?.name);
  if (["match winner", "match result", "1x2"].includes(name)) return "1x2";
  if (name === "double chance") return "double_chance";
  if (["goals over under", "over under", "total goals over under"].includes(name)) return "goals";
  if (["both teams score", "both teams to score", "btts"].includes(name)) return "btts";
  return null;
}

function outcomeMarket(group, value) {
  const outcome = normalize(value);
  if (group === "1x2") return ({ home: "1", draw: "X", away: "2" })[outcome] || null;
  if (group === "double_chance") return ({ "home draw": "1X", "draw away": "X2", "home away": "12", "1x": "1X", x2: "X2", "12": "12" })[outcome] || null;
  if (group === "goals") {
    const thresholdOutcome = String(value || "").trim().toLowerCase().replace(",", ".").replace(/\s+/g, " ");
    const match = thresholdOutcome.match(/^(over|under) (1\.5|2\.5|3\.5)$/);
    if (!match) return null;
    return `${match[1] === "over" ? "over" : "under"}${match[2].replace(".", "")}`;
  }
  if (group === "btts") return ({ yes: "bttsYes", no: "bttsNo" })[outcome] || null;
  return null;
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function getBookmakerOddsDetails(oddsResponse) {
  const collected = new Map();
  const offers = new Map();
  for (const fixtureOdds of oddsResponse || []) {
    for (const bookmaker of fixtureOdds.bookmakers || []) {
      for (const bet of bookmaker.bets || []) {
        const group = marketForBet(bet);
        if (!group) continue;
        for (const value of bet.values || []) {
          const market = outcomeMarket(group, value.value);
          const odd = Number(value.odd);
          if (!market || !Number.isFinite(odd) || odd <= 1) continue;
          const values = collected.get(market) || [];
          values.push(odd);
          collected.set(market, values);
          const marketOffers = offers.get(market) || [];
          marketOffers.push({ bookmaker: bookmaker.name || null, market: bet.name || null, outcome: value.value || null, odd: Number(odd.toFixed(3)) });
          offers.set(market, marketOffers);
        }
      }
    }
  }
  return {
    averageOdds: Object.fromEntries([...collected.entries()].map(([market, values]) => [market, Number(average(values).toFixed(3))])),
    offers: Object.fromEntries(offers),
  };
}

function getBookmakerOdds(oddsResponse) {
  return getBookmakerOddsDetails(oddsResponse).averageOdds;
}

module.exports = { getBookmakerOdds, getBookmakerOddsDetails };