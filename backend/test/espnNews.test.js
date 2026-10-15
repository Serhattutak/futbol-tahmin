const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeNewsForTeams } = require("../providers/espn");

test("ESPN news normalization keeps only articles mentioning either match team", () => {
  const result = normalizeNewsForTeams({ articles: [
    { headline: "Arsenal injury update ahead of weekend", description: "Arsenal could miss a midfielder.", published: "2026-10-14T10:00:00Z", links: { web: { href: "https://example.com/arsenal" } } },
    { data: { headline: "Chelsea latest team news", description: "Chelsea prepare for their match.", links: { web: { href: "https://example.com/chelsea" } } } },
    { headline: "Real Madrid training report", description: "Unrelated league story." },
    { headline: "Invalid record" },
  ] }, "Arsenal", "Chelsea");
  assert.equal(result.length, 2);
  assert.equal(result[0].headline, "Arsenal injury update ahead of weekend");
  assert.equal(result[0].url, "https://example.com/arsenal");
  assert.equal(result[1].headline, "Chelsea latest team news");
});

test("ESPN news normalization tolerates missing feeds and empty team names", () => {
  assert.deepEqual(normalizeNewsForTeams(null, "Arsenal", "Chelsea"), []);
  assert.deepEqual(normalizeNewsForTeams({ articles: [{ headline: "Arsenal injury update" }] }, "", "Chelsea"), []);
});
