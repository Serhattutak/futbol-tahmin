const TIMEZONES = { England: "Europe/London", Scotland: "Europe/London", Spain: "Europe/Madrid", Germany: "Europe/Berlin", Italy: "Europe/Rome", France: "Europe/Paris", Netherlands: "Europe/Amsterdam", Portugal: "Europe/Lisbon" };
function offsetMinutes(utcMs, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs)).map(part => [part.type, part.value]));
  return (Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - utcMs) / 60000;
}
function localKickoffToUtc(date, time, country) {
  const zone = TIMEZONES[country];
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(time || ""));
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!zone || !t || !d) return `${date}T${String(time).length === 5 ? time + ":00" : time}Z`;
  const naive = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +(t[3] || 0));
  let utc = naive - offsetMinutes(naive, zone) * 60000;
  utc = naive - offsetMinutes(utc, zone) * 60000;
  return new Date(utc).toISOString();
}
module.exports = { localKickoffToUtc, TIMEZONES };