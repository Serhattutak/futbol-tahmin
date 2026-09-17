export const MODEL40 = "MODEL_4_0";
export const MODEL41 = "MODEL_4_1";
export function modelLabel(analysis) {
  return analysis?.modelVersion === MODEL41 ? "MODEL 4.1" : "MODEL 4.0";
}
export function modelCacheKey(fixtureId, version, cache = {}) {
  return [fixtureId, version, cache.statisticsVersion || "legacy", version === MODEL41 ? cache.artifactVersion || "unavailable" : "4.0", cache.inputVersion || ""].join(":");
}
export function selectModelAnalysis(response, requested) {
  if (!response) return null;
  const version = requested || response.modelVersion || MODEL40;
  const selected = response.models?.[version];
  if (selected && (version !== MODEL41 || response.model41Available)) return { ...selected, cache: response.cache };
  return response.models?.[MODEL40] ? { ...response.models[MODEL40], cache: response.cache } : response;
}
export function fallbackMessage(reason) {
  if (["INSUFFICIENT_HISTORY", "MISSING_CRITICAL_STATISTICS", "MODEL41_NO_BET"].includes(reason)) return "Model 4.1 için yeterli geçmiş veri yok. Model 4.0 gösteriliyor.";
  if (reason === "BEFORE_MODEL_SELECTION_CUTOFF") return "Bu tarih Model 4.1 değerlendirme dönemi dışında. Model 4.0 gösteriliyor.";
  if (reason === "UNKNOWN_KICKOFF") return "Maç başlangıç saati doğrulanamadı. Model 4.0 gösteriliyor.";
  return "Model 4.1 şu anda kullanılamıyor. Model 4.0 gösteriliyor.";
}
