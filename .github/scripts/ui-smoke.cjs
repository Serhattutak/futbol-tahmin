const assert = require("node:assert/strict");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, timezoneId: "Europe/Istanbul" });
    page.on("pageerror", error => errors.push(error.message));
    const fixtureResponse = page.waitForResponse(response =>
      response.url().includes("/api/football-test?date=2025-10-12"),
      { timeout: 90000 }
    );
    await page.goto("http://127.0.0.1:4173/?date=2025-10-12", { waitUntil: "domcontentloaded" });
    const dateInput = page.locator('input[aria-label="Maç analiz tarihi"]');
    await dateInput.waitFor({ state: "visible", timeout: 30000 });
    assert.equal(await dateInput.inputValue(), "2025-10-12", "deep-link date should be preserved");
    const todayButton = page.locator(".today-button");
    assert.equal(await todayButton.getAttribute("aria-pressed"), "false", "BUGÜN must not appear selected for a historical date");
    assert.equal(await todayButton.getAttribute("class"), "today-button", "historical date must leave BUGÜN visually inactive");
    const response = await fixtureResponse;
    assert.equal(response.status(), 200, "fixture API should return HTTP 200");
    const payload = await response.json();
    assert.equal(payload.success, true, "fixture API should return success");
    assert.ok(payload.results > 0, "real public-source fixtures should be shown for Turkey-local date 2025-10-12");
    assert.ok(payload.matches.some(match =>
      /Palmeiras|Juventude/i.test((match.teams?.home?.name || "") + " " + (match.teams?.away?.name || ""))
    ), "the known real Brazilian fixture should be discoverable");
    const normalizeTeamName = value => {
      const key = String(value || "").toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      const aliases = {
        albacetebalompie: "albacete", adceutafc: "ceuta", adceuta: "ceuta",
        sdeibar: "eibar", cdcastellon: "castellon", sportinggijon: "sportinggijon",
        realsportingdegijon: "sportinggijon", realsportinggijon: "sportinggijon",
        burgoscf: "burgos", realvalladolidcf: "realvalladolid", cadizcf: "cadiz",
        sdhuesca: "huesca", malagacf: "malaga", deportivolacoruna: "deportivo",
      };
      return aliases[key] || key;
    };
    const fixtureKeys = payload.matches.map(match => [
      String(match.league?.name || "").toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]/g, ""),
      normalizeTeamName(match.teams?.home?.name),
      normalizeTeamName(match.teams?.away?.name),
      // All returned fixtures are already filtered to the requested Turkey-local day.
    ].join("|"));
    const duplicateKeys = fixtureKeys.filter((key, index) => fixtureKeys.indexOf(key) !== index);
    if (duplicateKeys.length) console.log("Duplicate fixture diagnostics:", JSON.stringify(payload.matches.filter(match => match.league?.name === "Segunda División").map(match => ({ date: match.fixture?.date, id: match.fixture?.id, home: match.teams?.home?.name, homeId: match.teams?.home?.id, away: match.teams?.away?.name, awayId: match.teams?.away?.id, league: match.league?.name, providers: match.providers }))));
    assert.deepEqual(duplicateKeys, [], `duplicate fixture keys: ${duplicateKeys.join("; ")}`);
    await page.waitForFunction(() => document.querySelectorAll(".center-row, .match-row").length > 0, null, { timeout: 45000 });
    await page.screenshot({ path: "artifacts/zeus-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "artifacts/zeus-mobile.png", fullPage: true });
    await todayButton.click();
    await page.waitForFunction(() => {
      const input = document.querySelector('input[aria-label="Maç analiz tarihi"]');
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return input?.value === `${p.year}-${p.month}-${p.day}` && document.querySelector(".today-button")?.getAttribute("aria-pressed") === "true";
    }, null, { timeout: 5000 });
    const dateNavFits = await page.locator(".date-nav").evaluate(el => el.scrollWidth <= el.clientWidth + 1);
    assert.equal(dateNavFits, true, "date navigation must fit a 390px mobile viewport without horizontal overflow");
    await dateInput.fill("2025-10-13");
    await page.waitForFunction(() => document.querySelector('input[aria-label="Maç analiz tarihi"]')?.value === "2025-10-13");
    assert.deepEqual(errors, [], "the UI must not throw uncaught browser errors");
    console.log(JSON.stringify({ ok: true, historicalFixtureCount: payload.results, dateNavigationFitsMobile: dateNavFits, browserErrors: errors.length }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
