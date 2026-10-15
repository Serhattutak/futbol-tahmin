export const MODEL40 = "MODEL_4_0";
export const MODEL41 = "MODEL_4_1";
// User-facing product identity is intentionally unified. Version identifiers stay internal for auditability.
export function modelLabel() {
  return "ZEUS AI";
}
export function modelCacheKey(fixtureId, version, cache = {}) {
  return [fixtureId, version, cache.statisticsVersion || "legacy", version === MODEL41 ? cache.artifactVersion || "unavailable" : "4.0", cache.inputVersion || ""].join(":");
}
export function selectModelAnalysis(response, requested) {
  if (!response) return null;
  // Keep the detail view aligned with the prediction already shown on the match card.
  // The API-selected production model is authoritative; 4.1 remains an internal candidate
  // until an untouched chronological forward test justifies promotion.
  const version = requested || response.modelVersion || MODEL40;
  const selected = response.models?.[version];
  if (selected && (version !== MODEL41 || response.model41Available)) return { ...selected, cache: response.cache };
  return response.models?.[MODEL40] ? { ...response.models[MODEL40], cache: response.cache } : response;
}
export function fallbackMessage(reason) {
  if (["INSUFFICIENT_HISTORY", "MISSING_CRITICAL_STATISTICS", "MODEL41_NO_BET"].includes(reason)) return "Gelişmiş model için yeterli geçmiş veri yok; ZEUS AI güvenli biçimde mevcut istatistik modeline dönüyor.";
  if (reason === "BEFORE_MODEL_SELECTION_CUTOFF") return "Bu karşılaşma gelişmiş modelin doğrulama döneminin dışında; ZEUS AI uygun mevcut modeli kullanıyor.";
  if (reason === "UNKNOWN_KICKOFF") return "Maç başlangıç saati doğrulanamadı. Tahmin güveni sınırlandırıldı.";
  return "Gelişmiş model şu anda kullanılamıyor; ZEUS AI mevcut güvenli modeli kullanıyor.";
}
