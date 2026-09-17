const { forwardCapture } = require("../server");
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--dry-run")) throw Error("Usage: npm run capture:forward -- [--dry-run]");
  const summary = await forwardCapture.run({ dryRun: args.includes("--dry-run") });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors) process.exitCode = 1;
}
main().catch(error => { console.error("Forward capture failed:", error.message); process.exitCode = 1; });
