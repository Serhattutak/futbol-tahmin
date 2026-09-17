const assert = require("node:assert/strict");
const test = require("node:test");
const { getBookmakerOdds, getBookmakerOddsDetails } = require("../services/bookmakerOdds");

test("oranlari sadece dogru bet marketinden eslestirir", () => {
  const odds = getBookmakerOdds([{
    bookmakers: [{ bets: [
      { name: "Both Teams Score", values: [{ value: "Yes", odd: "1.80" }] },
      { name: "Team to Score", values: [{ value: "Yes", odd: "1.10" }] },
      { name: "Match Winner", values: [{ value: "Home", odd: "2.10" }, { value: "Draw", odd: "3.20" }, { value: "Away", odd: "3.40" }] },
      { name: "Double Chance", values: [{ value: "Home/Draw", odd: "1.30" }] },
      { name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: "1.95" }] },
    ] }],
  }]);

  assert.deepEqual(odds, { "1": 2.1, X: 3.2, "2": 3.4, "1X": 1.3, over25: 1.95, bttsYes: 1.8 });
});

test("bilinmeyen bet veya sonuc metnini atlar", () => {
  assert.deepEqual(getBookmakerOdds([{ bookmakers: [{ bets: [{ name: "Match Winner", values: [{ value: "Yes", odd: "2" }] }] }] }]), {});
});

test("dogrulanmis tekliflerde bookmaker, market ve outcome bilgisini korur", () => {
  const details = getBookmakerOddsDetails([{ bookmakers: [{ name: "Bookmaker A", bets: [{ name: "Both Teams Score", values: [{ value: "Yes", odd: "1.80" }] }] }] }]);
  assert.deepEqual(details.offers.bttsYes, [{ bookmaker: "Bookmaker A", market: "Both Teams Score", outcome: "Yes", odd: 1.8 }]);
});