// Builds the fixture list for one calendar day in the product timezone
// (Europe/Istanbul by default). Providers report fixtures by their own day
// boundaries (UTC, US local time, league local time), so we read the requested
// provider day plus the previous one, collapse cross-provider duplicates and keep
// only kickoffs that fall on the requested local day, ordered by kickoff time.
const { teamKey, normalizeStatus } = require("./fixtureNormalization");

const DEFAULT_TIMEZONE = process.env.ZEUS_TIMEZONE || "Europe/Istanbul";
const DUPLICATE_KICKOFF_TOLERANCE_MS = 20 * 60 * 1000;

const CITY_ALIASES = [
  [/cologne/g, "koln"], [/vienna/g, "wien"], [/munich/g, "munchen"], [/turin/g, "torino"],
  [/lisbon/g, "lisboa"], [/prague/g, "praha"], [/belgrade/g, "beograd"], [/bucharest/g, "bucuresti"],
  [/athens/g, "athina"], [/warsaw/g, "warszawa"], [/moscow/g, "moskva"], [/zurich/g, "zurich"],
];

const formatters = new Map();
function formatterFor(timeZone) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }));
  return formatters.get(timeZone);
}

function localDateKey(value, timeZone = DEFAULT_TIMEZONE) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const time = Date.parse(value);
  return Number.isFinite(time) ? formatterFor(timeZone).format(new Date(time)) : null;
}

function todayKey(timeZone = DEFAULT_TIMEZONE, now = Date.now()) { return formatterFor(timeZone).format(new Date(now)); }

function shiftDateKey(date, days) {
  const time = Date.parse(`${date}T12:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

function fuzzyTeamKey(name) {
  let key = teamKey(name);
  for (const [pattern, replacement] of CITY_ALIASES) key = key.replace(pattern, replacement);
  return key;
}

function similarTeam(a, b) {
  const left = fuzzyTeamKey(a), right = fuzzyTeamKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 4 && longer.includes(shorter);
}

const kickoffOf = match => match?.fixture?.date || null;
const isDateOnly = match => match?.fixture?.kickoffPrecision === "date" || /^\d{4}-\d{2}-\d{2}$/.test(String(kickoffOf(match) || ""));
const hasScore = match => Number.isFinite(match?.goals?.home) && Number.isFinite(match?.goals?.away);

function sameKickoff(a, b, timeZone) {
  if (isDateOnly(a) || isDateOnly(b)) return localDateKey(kickoffOf(a), timeZone) === localDateKey(kickoffOf(b), timeZone);
  const left = Date.parse(kickoffOf(a)), right = Date.parse(kickoffOf(b));
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= DUPLICATE_KICKOFF_TOLERANCE_MS;
}

function isDuplicate(a, b, timeZone) {
  return sameKickoff(a, b, timeZone)
    && similarTeam(a?.teams?.home?.name, b?.teams?.home?.name)
    && similarTeam(a?.teams?.away?.name, b?.teams?.away?.name);
}

// Higher rank = more advanced / more reliable state. A provider that already
// reports the final score wins over a stale feed that still says "scheduled".
function statusRank(match) {
  const status = normalizeStatus(match?.fixture?.status?.short);
  const base = { FINISHED: 50, LIVE: 40, CANCELLED: 30, POSTPONED: 30, SCHEDULED: 10, UNKNOWN: 0 }[status] ?? 0;
  return base + (hasScore(match) ? 5 : 0) + (isDateOnly(match) ? 0 : 1);
}

function mergeInto(primary, other) {
  const providers = [...new Set([...(primary.providers || [primary.provider]), ...(other.providers || [other.provider])].filter(Boolean))];
  const finishedBoth = normalizeStatus(primary.fixture?.status?.short) === "FINISHED" && normalizeStatus(other.fixture?.status?.short) === "FINISHED";
  const scoreConflict = finishedBoth && hasScore(primary) && hasScore(other) && (primary.goals.home !== other.goals.home || primary.goals.away !== other.goals.away);
  return {
    ...primary,
    providers,
    providerFixtureIds: { ...(other.providerFixtureIds || {}), ...(primary.providerFixtureIds || {}) },
    alternateFixtureIds: [...new Set([...(primary.alternateFixtureIds || []), String(other.fixture?.id)].filter(id => id && id !== String(primary.fixture?.id)))],
    dataConflict: Boolean(primary.dataConflict || other.dataConflict || scoreConflict),
  };
}

function collapseDuplicates(matches, timeZone = DEFAULT_TIMEZONE) {
  const ordered = [...matches].filter(Boolean).sort((a, b) => statusRank(b) - statusRank(a));
  const kept = [];
  for (const match of ordered) {
    const index = kept.findIndex(existing => isDuplicate(existing, match, timeZone));
    if (index === -1) kept.push(match);
    else kept[index] = mergeInto(kept[index], match);
  }
  return kept;
}

function sortByKickoff(matches) {
  // Fixtures with only a date (no kickoff time) go after every timed fixture of the day.
  const time = match => isDateOnly(match) ? Infinity : Date.parse(kickoffOf(match));
  return [...matches].sort((a, b) => {
    const left = time(a), right = time(b);
    return ((Number.isFinite(left) ? left : Infinity) - (Number.isFinite(right) ? right : Infinity) || 0)
      || String(a?.league?.name || "").localeCompare(String(b?.league?.name || ""))
      || String(a?.teams?.home?.name || "").localeCompare(String(b?.teams?.home?.name || ""));
  });
}

function selectLocalDay(matches, date, timeZone = DEFAULT_TIMEZONE) {
  return sortByKickoff(collapseDuplicates(matches, timeZone).filter(match => localDateKey(kickoffOf(match), timeZone) === date));
}

async function getLocalDayFixtures(registry, date, toFrontendFixture, { timeZone = DEFAULT_TIMEZONE } = {}) {
  const previous = shiftDateKey(date, -1);
  const [current, before] = await Promise.all([
    registry.getFixturesByDate(date),
    registry.getFixturesByDate(previous).catch(() => ({ fixtures: [], source: null, cached: false, stale: false, providerError: null })),
  ]);
  const matches = selectLocalDay([...current.fixtures, ...before.fixtures].map(toFrontendFixture), date, timeZone);
  return {
    matches,
    source: [...new Set([current.source, before.source].filter(Boolean).flatMap(value => String(value).split("+")))].join("+") || null,
    cached: Boolean(current.cached),
    stale: Boolean(current.stale),
    providerError: current.providerError || null,
    timeZone,
  };
}

module.exports = { DEFAULT_TIMEZONE, localDateKey, todayKey, shiftDateKey, similarTeam, collapseDuplicates, sortByKickoff, selectLocalDay, getLocalDayFixtures };
