// Two bounded read-only diagnostics, no production service/cache imports.
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const root = path.resolve(__dirname, "../..");
async function main() {
  const env = require("dotenv").parse(fs.readFileSync(path.join(root, "backend/.env")));
  const apiKey = process.env.API_FOOTBALL_KEY || env.API_FOOTBALL_KEY;
  if (!apiKey) throw Error("API-Football not configured");
  const fixtures = JSON.parse(fs.readFileSync(path.join(root, "backend/data/fixture-cache.json"), "utf8"));
  if (process.argv.includes("--available-season")) {
    const output = { retrievedAt: new Date().toISOString(), maxRequests: 3, purpose: "Bounded 2024 access verification; older data is not installed into production", requests: [] };
    for (const [id, side] of [["1570390", "home"], ["1635564", "home"], ["1635564", "away"]]) {
      const f = fixtures.flatMap(([, entry]) => entry.fixtures).find(row => row.providerFixtureId === id);
      const team = f.providerTeams["api-football"][side];
      const params = { team: team.id, season: 2024, status: "FT-AET-PEN", from: "2024-01-01", to: "2026-09-17" };
      try {
        const response = await axios.get("https://v3.football.api-sports.io/fixtures", { params, timeout: 15000, headers: { "x-apisports-key": apiKey } });
        const errors = JSON.parse(JSON.stringify(response.data.errors || {}).split(apiKey).join("[REDACTED]"));
        output.requests.push({ fixtureId: id, side, teamName: team.name, params, httpStatus: response.status, errors, count: response.data.response?.length || 0, matches: response.data.response || [] });
        if (/quota|limit|rate/i.test(JSON.stringify(errors))) break;
      } catch (error) { output.requests.push({ fixtureId: id, side, params, httpStatus: error.response?.status || null, error: error.code || "request_failed" }); break; }
    }
    fs.writeFileSync(path.join(root, "docs/historical-coverage-api-2024-evidence.json"), JSON.stringify(output, null, 2));
    console.log(JSON.stringify({ ...output, requests: output.requests.map(({ matches: _matches, ...request }) => request) }));
    return;
  }
  const fixture = fixtures.flatMap(([, entry]) => entry.fixtures).find(f => f.providerFixtureId === "1570390");
  const output = { retrievedAt: new Date().toISOString(), maxRequests: 2, purpose: "Verify historical access for an already identified insufficient-history fixture", requests: [] };
  for (const season of [2026, 2025]) {
    const params = { team: fixture.providerTeams["api-football"].home.id, season, status: "FT-AET-PEN", from: `${season}-01-01`, to: "2026-09-17" };
    try {
      const response = await axios.get("https://v3.football.api-sports.io/fixtures", { params, timeout: 15000, headers: { "x-apisports-key": apiKey } });
      const errors = JSON.parse(JSON.stringify(response.data.errors || {}).split(apiKey).join("[REDACTED]"));
      output.requests.push({ params, httpStatus: response.status, errors, count: response.data.response?.length || 0, matches: response.data.response || [] });
      if (/quota|limit|rate/i.test(JSON.stringify(errors))) break;
    } catch (error) { output.requests.push({ params, httpStatus: error.response?.status || null, error: error.code || "request_failed" }); break; }
  }
  fs.writeFileSync(path.join(root, "docs/historical-coverage-api-evidence.json"), JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ ...output, requests: output.requests.map(({ matches: _matches, ...request }) => request) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
