const aliases = { manutd: "manchesterunited", manunited: "manchesterunited", manchesterutd: "manchesterunited", realbetisbalompie: "realbetis" };
function normalize(value) { return String(value || "").toLowerCase().replace(/ı/g, "i").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }
function teamKey(value) { const words = String(value || "").replace(/\b(?:F\.?C\.?|C\.?F\.?|S\.?K\.?|F\.?K\.?|A\.?F\.?C\.?|S\.?C\.?)\b/gi, " "); const key = normalize(words); return aliases[key] || key; }
function normalizeStatus(value) {
  const key = String(value || "").toUpperCase().replace(/[ -]/g, "_");
  if (["SCHEDULED", "TIMED", "NS", "TBD", "NOT_STARTED"].includes(key)) return "SCHEDULED";
  if (["LIVE", "IN_PLAY", "1H", "2H", "HT", "ET", "BT", "P", "BREAK", "INT", "INPLAY_1ST_HALF", "INPLAY_2ND_HALF", "INPLAY_ET", "INPLAY_PENALTIES", "HALFTIME", "EXTRA_TIME_BREAK", "PEN_BREAK", "SUSPENDED", "INTERRUPTED", "PAUSED"].includes(key)) return "LIVE";
  if (["FINISHED", "MATCH_FINISHED", "FT", "AET", "PEN", "FT_PEN", "AFTER_EXTRA_TIME", "AFTER_PENALTIES"].includes(key)) return "FINISHED";
  if (["POSTPONED", "PST"].includes(key)) return "POSTPONED";
  if (["CANCELLED", "CANCELED", "CANC", "ABD", "ABANDONED", "AWD", "WO", "WALKOVER", "AWARDED"].includes(key)) return "CANCELLED";
  return "UNKNOWN";
}
function normalizeKickoff(value) {
  if (!value) return null;
  let text = String(value).trim().replace(" ", "T");
  if (!/(Z|[+-]\d\d:\d\d)$/i.test(text)) text += "Z";
  const time = Date.parse(text); return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
const providerAliases = { apiFootball: "api-football", footballData: "football-data", openFootball: "openfootball", sportsDb: "thesportsdb" };
function normalizeProviderIds(ids = {}) { return Object.fromEntries(Object.entries(ids).filter(([, id]) => id != null).map(([name, id]) => [providerAliases[name] || name, String(id)])); }
module.exports = { normalize, teamKey, normalizeStatus, normalizeKickoff, normalizeProviderIds };
