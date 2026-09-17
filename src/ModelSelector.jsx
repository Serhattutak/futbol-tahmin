import { MODEL40, MODEL41, fallbackMessage } from "./modelSelection.js";
const percent = p => Number.isFinite(p) ? `%${(p * 100).toFixed(2)}` : "—";
export default function ModelSelector({ response, selected, onChange }) {
  if (!response.models) return null;
  const baseline = response.models[MODEL40]; const advanced = response.models[MODEL41];
  return <section className="detail-section model-selector">
    <label>Tahmin Modeli <select aria-label="Tahmin Modeli" value={selected} onChange={event => onChange(event.target.value)}><option value={MODEL40}>Model 4.0</option><option value={MODEL41} disabled={!response.model41Available}>Model 4.1</option></select></label>
    <p>Gösterilen: <strong>{selected === MODEL41 ? "Model 4.1" : "Model 4.0"}</strong></p>
    {selected === MODEL41 && <p className="muted-note">1X2 olasılıkları kilitli artifact ile kalibre edilmiştir.</p>}
    {!response.model41Available && <p className="muted-note" role="status">{fallbackMessage(response.model41FallbackReason)}</p>}
    <p className="muted-note">Tahmin olasılığı, ilgili sonucun model tarafından hesaplanan olasılığıdır. Model güveni veri ve model sinyallerini özetler; kazanma olasılığı değildir.</p>
    {advanced && <details><summary>4.0 ile karşılaştır</summary>{[["Ev", "home"], ["Beraberlik", "draw"], ["Deplasman", "away"], ["Over 2.5", "over25"], ["BTTS", "bttsYes"]].map(([label, key]) => <div className="probability-row" key={key}><span>{label}</span><span>4.0 {percent(baseline.probabilities?.[key])}</span><strong>4.1 {percent(advanced.probabilities?.[key])}</strong></div>)}</details>}
  </section>;
}
