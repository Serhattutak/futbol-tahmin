const path = require("node:path");
module.exports = Object.freeze({
  minLeadMinutes: 30,
  maxLeadMinutes: 24 * 60,
  intervalMs: 15 * 60_000,
  maxAnalysesPerRun: 20,
  maxUncoveredAnalysesPerRun: 2,
  betweenAnalysesMs: 1000,
  discoveryTimezones: ["UTC", "Europe/Istanbul"],
  directory: path.join(__dirname, "../data/forward-capture"),
});
