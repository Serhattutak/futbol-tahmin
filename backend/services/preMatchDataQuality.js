const { normalizeStatus } = require("./fixtureNormalization");

const hasText = value => typeof value === "string" && value.trim().length > 0;
const hasExplicitTimezone = value => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);

function assessPreMatchFixture(fixture, { now = Date.now(), stale = false, providerError = null } = {}) {
  const reasons = [];
  const rawDate = fixture?.fixture?.date ?? fixture?.kickoff;
  const kickoffPrecision = fixture?.fixture?.kickoffPrecision ?? fixture?.kickoffPrecision;
  const kickoffTime = typeof rawDate === "string" && hasExplicitTimezone(rawDate) ? Date.parse(rawDate) : NaN;
  const status = normalizeStatus(fixture?.fixture?.status?.short ?? fixture?.status);

  if (!Number.isFinite(kickoffTime) || kickoffPrecision === "date" || /^\d{4}-\d{2}-\d{2}$/.test(String(rawDate || ""))) {
    reasons.push("UNKNOWN_KICKOFF");
  } else if (!Number.isFinite(now) || kickoffTime <= now) {
    reasons.push("KICKOFF_REACHED");
  }

  if (status !== "SCHEDULED") reasons.push(status === "POSTPONED" ? "FIXTURE_POSTPONED" : status === "CANCELLED" ? "FIXTURE_CANCELLED" : status === "LIVE" ? "FIXTURE_ALREADY_STARTED" : status === "FINISHED" ? "FIXTURE_FINISHED" : "UNKNOWN_FIXTURE_STATUS");
  if (fixture?.dataConflict === true) reasons.push("FIXTURE_DATA_CONFLICT");
  if (!hasText(fixture?.league?.name)) reasons.push("MISSING_LEAGUE");
  if (!hasText(fixture?.teams?.home?.name) || !hasText(fixture?.teams?.away?.name)) reasons.push("MISSING_TEAM");
  if (hasText(fixture?.teams?.home?.name) && hasText(fixture?.teams?.away?.name) && fixture.teams.home.name.trim().toLowerCase() === fixture.teams.away.name.trim().toLowerCase()) reasons.push("SAME_HOME_AWAY_TEAM");

  const sources = Array.isArray(fixture?.providers) ? fixture.providers.filter(hasText) : [];
  const provider = fixture?.provider ?? fixture?.source;
  if (sources.length === 0 && !hasText(provider)) reasons.push("MISSING_SOURCE_PROVENANCE");
  if (stale === true || fixture?.stale === true) reasons.push("STALE_FIXTURE_DATA");
  if (providerError) reasons.push("PROVIDER_DISCOVERY_ERROR");

  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    status,
    kickoff: Number.isFinite(kickoffTime) ? new Date(kickoffTime).toISOString() : null,
    sourceCount: Math.max(sources.length, hasText(provider) ? 1 : 0),
  };
}

module.exports = { assessPreMatchFixture };
