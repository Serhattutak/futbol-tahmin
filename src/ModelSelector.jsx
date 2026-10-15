import { MODEL40, MODEL41, fallbackMessage, modelLabel } from "./modelSelection.js";

export default function ModelSelector({ response, selected }) {
  if (!response?.models) return null;
  const advancedReady = Boolean(response.model41Available && response.models[MODEL41]);
  const usingAdvanced = selected === MODEL41 && advancedReady;
  const fallback = !usingAdvanced && response.model41FallbackReason;
  return <section className="detail-section model-selector">
    <div className="section-heading">
      <div><span className="eyebrow">OTOMATİK TAHMİN MOTORU</span><h2>ZEUS AI</h2></div>
      <span className={usingAdvanced ? "status-pill status-good" : "status-pill"}>{usingAdvanced ? "Gelişmiş analiz aktif" : "Mevcut verilerle analiz"}</span>
    </div>
    <p>Her karşılaşmada uygun model otomatik seçilir. Yeterli geçmiş veri veya doğrulama yoksa sistem tahmini zorlamaz ve güvenli yedek modele döner.</p>
    {fallback && <p className="muted-note" role="status">{fallbackMessage(response.model41FallbackReason)}</p>}
    <p className="muted-note">Gösterilen olasılıklar sonuç garantisi değildir. Veri kalitesi, örneklem büyüklüğü ve gerçek maç öncesi fiyatlar ayrıca değerlendirilmelidir.</p>
  </section>;
}
