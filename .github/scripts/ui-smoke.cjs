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
    const response = await fixtureResponse;
    assert.equal(response.status(), 200, "fixture API should return HTTP 200");
    const payload = await response.json();
    assert.equal(payload.success, true, "fixture API should return success");
    assert.ok(payload.results > 0, "real public-source fixtures should be shown for Turkey-local date 2025-10-12");
    assert.ok(payload.matches.some(match =>
      /Palmeiras|Juventude/i.test((match.teams?.home?.name || "") + " " + (match.teams?.away?.name || ""))
    ), "the known real Brazilian fixture should be discoverable");
    const fixtureKeys = payload.matches.map(match => [
      match.league?.name || "",
      match.teams?.home?.id || match.teams?.home?.name || "",
      match.teams?.away?.id || match.teams?.away?.name || "",
      String(match.fixture?.date || "").slice(0, 10),
    ].join("|"));
    assert.equal(new Set(fixtureKeys).size, fixtureKeys.length, "the same fixture must not appear twice under provider name/time variants");
    await page.waitForFunction(() => document.querySelectorAll(".match-row").length > 0, null, { timeout: 45000 });
    await page.screenshot({ path: "artifacts/zeus-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "artifacts/zeus-mobile.png", fullPage: true });
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
