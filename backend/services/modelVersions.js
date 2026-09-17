const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const MODEL_4_0 = "MODEL_4_0";
const MODEL_4_1 = "MODEL_4_1";
const ARTIFACT_FILE = path.join(__dirname, "../data/backtest/model41-artifact.json");
const FEATURE_GROUPS = { A: ["ppgDifference", "last5Difference", "last10Difference", "winDifference", "drawTendency", "lossDifference"], B: ["homeGF", "homeGA", "awayGF", "awayGA"], C: ["venueHomeGF", "venueHomeGA", "venueAwayGF", "venueAwayGA", "venuePPGDifference"], D: ["combinedOver15Rate", "combinedOver25Rate", "combinedOver35Rate"], E: ["combinedBTTS", "homecleanSheetRate", "homefailedToScoreRate", "awaycleanSheetRate", "awayfailedToScoreRate"] };
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function validateArtifact(artifact) {
  const fail = () => { throw failure("ARTIFACT_SCHEMA_INVALID", "Invalid Model 4.1 artifact schema"); };
  if (artifact?.version !== MODEL_4_1 || artifact.training?.testAccess !== false || artifact.training?.selectedThrough !== "2026-02-28" || !["poisson", "model40"].includes(artifact.goalChoice)) fail();
  const expected = Object.entries(FEATURE_GROUPS).flatMap(([group, names]) => names.map(name => ({ group, name })));
  for (const [key, outputs] of [["classifier", 3], ["goalModel", 2]]) {
    const model = artifact[key];
    if (model?.normalizer?.length !== expected.length || model?.weights?.length !== outputs || !Array.isArray(model.groups) || model.groups.some(g => !FEATURE_GROUPS[g])) fail();
    model.normalizer.forEach((f, i) => { if (f.name !== expected[i].name || f.group !== expected[i].group || !Number.isFinite(f.mean) || !Number.isFinite(f.scale) || f.scale <= 0) fail(); });
    if (model.weights.some(w => !Array.isArray(w) || w.length !== expected.length + 1 || !w.every(Number.isFinite))) fail();
  }
  if (!Number.isFinite(artifact.classifier.baseScale) || artifact.classifier.baseScale <= 0) fail();
  const c = artifact.calibration;
  if (!["none", "logistic"].includes(c?.method)) fail();
  if (c.method === "logistic") {
    if (!Number.isFinite(c.temperature) || c.temperature <= 0 || typeof c.useClass !== "boolean" || typeof c.useGoals !== "boolean") fail();
    for (const key of ["over15", "over25", "over35", "bttsYes"]) if (!Number.isFinite(c.binary?.[key]?.slope) || c.binary[key].slope <= 0 || !Number.isFinite(c.binary[key].intercept)) fail();
  }
  return artifact;
}
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function createArtifactLoader({ file = ARTIFACT_FILE, expectedHash = () => JSON.parse(fs.readFileSync(path.join(__dirname, "../data/backtest/model41-report.json"), "utf8")).artifactSha256, codeHash = () => require("./model41Experiment").codeHash() } = {}) {
  let cached;
  return () => {
    let bytes;
    try { bytes = fs.readFileSync(file); } catch { throw failure("ARTIFACT_UNAVAILABLE", "Locked Model 4.1 artifact is unavailable"); }
    const fingerprint = crypto.createHash("sha256").update(bytes).digest("hex");
    if (fingerprint !== expectedHash()) throw failure("ARTIFACT_INTEGRITY_MISMATCH", "Artifact differs from the locked benchmark");
    if (cached?.fingerprint === fingerprint && cached.artifact.codeHash === codeHash()) return cached;
    let artifact;
    try { artifact = JSON.parse(bytes.toString("utf8")); } catch { throw failure("ARTIFACT_SCHEMA_INVALID", "Artifact is not valid JSON"); }
    validateArtifact(artifact);
    if (artifact.codeHash !== codeHash()) throw failure("ARTIFACT_CODE_MISMATCH", "Model code differs from locked artifact");
    cached = { artifact: freeze(artifact), fingerprint };
    return cached;
  };
}
const loadArtifact = createArtifactLoader();
function selectedModel(value = process.env.PREDICTION_MODEL || MODEL_4_0) {
  if (![MODEL_4_0, MODEL_4_1].includes(value)) throw Error("Unsupported PREDICTION_MODEL");
  return value;
}
function loadModel41() {
  return loadArtifact().artifact;
}
module.exports = { MODEL_4_0, MODEL_4_1, selectedModel, loadModel41, loadArtifact, createArtifactLoader, validateArtifact, FEATURE_GROUPS };
