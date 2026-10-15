const TIMEZONES = { England: "Europe/London", Scotland: "Europe/London", Wales: "Europe/London", Ireland: "Europe/Dublin", Spain: "Europe/Madrid", Germany: "Europe/Berlin", Italy: "Europe/Rome", France: "Europe/Paris", Netherlands: "Europe/Amsterdam", Portugal: "Europe/Lisbon", Brazil: "America/Sao_Paulo", Turkey: "Europe/Istanbul", Belgium: "Europe/Brussels", Switzerland: "Europe/Zurich", Austria: "Europe/Vienna", Denmark: "Europe/Copenhagen", Sweden: "Europe/Stockholm", Norway: "Europe/Oslo", Greece: "Europe/Athens", Poland: "Europe/Warsaw", "Czech Republic": "Europe/Prague", Romania: "Europe/Bucharest", Hungary: "Europe/Budapest", Serbia: "Europe/Belgrade", Croatia: "Europe/Zagreb", Bulgaria: "Europe/Sofia", Israel: "Asia/Jerusalem", Argentina: "America/Argentina/Buenos_Aires", Mexico: "America/Mexico_City", USA: "America/New_York", Japan: "Asia/Tokyo", "South Korea": "Asia/Seoul", China: "Asia/Shanghai", "Saudi Arabia": "Asia/Riyadh", Egypt: "Africa/Cairo", UAE: "Asia/Dubai", Qatar: "Asia/Qatar", India: "Asia/Kolkata", Australia: "Australia/Sydney", Finland: "Europe/Helsinki", Iceland: "Atlantic/Reykjavik", Albania: "Europe/Tirane", Andorra: "Europe/Andorra", Armenia: "Asia/Yerevan", Azerbaijan: "Asia/Baku", Belarus: "Europe/Minsk", "Bosnia and Herzegovina": "Europe/Sarajevo", Cyprus: "Asia/Nicosia", Estonia: "Europe/Tallinn", "Faroe Islands": "Atlantic/Faroe", Georgia: "Asia/Tbilisi", Gibraltar: "Europe/Gibraltar", Kosovo: "Europe/Belgrade", Latvia: "Europe/Riga", Lithuania: "Europe/Vilnius", Luxembourg: "Europe/Luxembourg", Malta: "Europe/Malta", Moldova: "Europe/Chisinau", Montenegro: "Europe/Podgorica", "North Macedonia": "Europe/Skopje", "Northern Ireland": "Europe/London", Slovakia: "Europe/Bratislava", Slovenia: "Europe/Ljubljana", Ukraine: "Europe/Kyiv", Malawi: "Africa/Blantyre", Zimbabwe: "Africa/Harare", Kazakhstan: "Asia/Almaty", Ecuador: "America/Guayaquil", Paraguay: "America/Asuncion" };
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