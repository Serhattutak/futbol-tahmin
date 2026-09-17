import { useEffect, useState } from "react";
import { readFrontendJson } from "./frontendApi.js";
const pct = n => Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "—";
const num = n => Number.isFinite(n) ? n.toFixed(4) : "—";
const LABELS = { model40: "Model 4.0 + Stats", raw: "Model 4.1 Raw", calibrated: "Model 4.1 Calibrated" };
const MARKETS = ["1X2", "Over 1.5", "Over 2.5", "Over 3.5", "BTTS Yes"];

export default function Model41Report({ apiBase }) {
  const [report, setReport] = useState(null);
  const [message, setMessage] = useState("Kilitli test raporu yükleniyor…");
  useEffect(() => {
    let active = true;
    readFrontendJson(`${apiBase}/api/backtest/model41`).then(data => { if (active) setReport(data.report); }).catch(() => { if (active) setMessage("Model 4.1 final raporu henüz hazır değil. Referans benchmark aşağıda korunuyor."); });
    return () => { active = false; };
  }, [apiBase]);
  if (!report) return <section className="detail-section model41-report"><h2>Model 4.1 · Kilitli Test</h2><p>{message}</p></section>;
  const final = report.finalTest; const dev = report.development;
  return <section className="detail-section backtest-report model41-report"><h2>Model 4.1 · Kilitli Test</h2>
    <p>1 Mart – 24 Mayıs 2026 · {final.count} gerçek maç · Aynı maçlarda üç sürüm</p>
    <p>Train: {dev.counts.train} · Validation: {dev.counts.validation} · Test: {dev.counts.test}</p>
    <p className="muted-note">Parametreler ve kalibrasyon testten önce kilitlendi. Test sonuçlarına göre yeniden ayar yapılmadı. Bu dönem önceki Model 4.0 benchmark’ında yer almıştı; tamamen yeni bir dış veri seti değildir.</p>
    <div style={{ overflowX: "auto" }}><table><caption>Brier, Log Loss ve ECE: düşük değer daha iyi. 1X2 Brier aralığı 0–2; diğerleri 0–1.</caption><thead><tr><th>Pazar</th><th>Model</th><th>Maç</th><th>Başarı</th><th>Brier</th><th>Log Loss</th><th>ECE</th></tr></thead><tbody>
      {MARKETS.flatMap(m => Object.keys(LABELS).map(key => { const v = final.models[key].markets[m]; return <tr key={`${m}-${key}`}><th>{m}</th><td>{LABELS[key]}</td><td>{v.sampleSize}</td><td>{pct(v.hitRate)}</td><td>{num(v.brier)}</td><td>{num(v.logLoss)}</td><td>{num(v.ece)}</td></tr>; }))}
    </tbody></table></div>
    <h3>Belirsizlik · Eşleşmiş bootstrap</h3><p>{final.uncertainty.calibrated.samples} tekrar; gün bazında örnekleme. Fark = Model 4.1 − Model 4.0. Negatif değer 4.1 lehine; aralık sıfırı içeriyorsa üstünlük net değil.</p>
    <div style={{ overflowX: "auto" }}><table><thead><tr><th>Pazar</th><th>Sürüm</th><th>Brier farkı [%95 aralık]</th><th>Log Loss farkı [%95 aralık]</th></tr></thead><tbody>
      {MARKETS.flatMap(m => ["raw", "calibrated"].map(key => { const v = final.uncertainty[key].metrics[m]; return <tr key={`${m}-${key}`}><th>{m}</th><td>{LABELS[key]}</td>{["brier", "logLoss"].map(metric => <td key={metric}>{num(v[metric].meanDifference)} [{num(v[metric].lower95)}, {num(v[metric].upper95)}]</td>)}</tr>; }))}
    </tbody></table></div>
    <details><summary>Confidence dilimleri · 1X2</summary><div style={{ overflowX: "auto" }}><table><thead><tr><th>Dilim</th><th>Model</th><th>Maç</th><th>Başarı</th><th>Brier</th><th>Log Loss</th></tr></thead><tbody>
      {Object.keys(final.models.model40.confidenceBuckets).flatMap(bucket => Object.keys(LABELS).map(key => { const v = final.models[key].confidenceBuckets[bucket]?.["1X2"]; return <tr key={`${bucket}-${key}`}><th>{bucket}</th><td>{LABELS[key]}</td><td>{v?.sampleSize ?? 0}</td><td>{pct(v?.hitRate)}</td><td>{num(v?.brier)}</td><td>{num(v?.logLoss)}</td></tr>; }))}
    </tbody></table></div></details>
    <details><summary>Feature ablation · Yalnızca Ocak validation</summary><p>A: form, B: GF/GA, C: saha, D: Over, E: BTTS/savunma. Mevcut 4.0 sinyalleri korunarak ek özelliklerin etkisi ölçüldü.</p><div style={{ overflowX: "auto" }}><table><thead><tr><th>Grup</th><th>1X2 başarı</th><th>1X2 Brier</th><th>Log Loss</th><th>Over 2.5 Brier</th><th>BTTS Brier</th></tr></thead><tbody>{dev.ablation.rows.map(r => <tr key={r.name}><th>{r.name}</th><td>{pct(r.accuracy)}</td><td>{num(r.brier)}</td><td>{num(r.logLoss)}</td><td>{num(r.over25Brier)}</td><td>{num(r.bttsBrier)}</td></tr>)}</tbody></table></div></details>
    <p>Kalibrasyon: 1X2 — {dev.calibration.choice.class}; gol pazarları — {dev.calibration.choice.goals}.</p>
    <p className="muted-note">İkili başarı evet/hayır sınıflandırmasıdır. Küçük gruplar ve tek sezon, sonuçların genellenebilirliğini sınırlar.</p>
  </section>;
}
