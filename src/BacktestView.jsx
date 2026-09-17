import { useEffect, useState } from "react";
import { readFrontendJson } from "./frontendApi.js";
import "./BacktestView.css";
import Model41Report from "./Model41Report.jsx";
const number = value => Number.isFinite(value) ? value.toFixed(4) : "—";
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";

export default function BacktestView({ apiBase }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    readFrontendJson(`${apiBase}/api/backtest`).then(data => { if (active) setReport(data.report); }).catch(() => { if (active) setError("Henüz okunabilir bir backtest raporu yok."); });
    return () => { active = false; };
  }, [apiBase]);
  if (!report) return <section className="detail-section"><h2>Kronolojik Backtest</h2><p>{error || "Rapor yükleniyor…"}</p></section>;
  const baseline = report.baseline.markets; const stats = report.stats.markets;
  return <><Model41Report apiBase={apiBase} /><section className="detail-section backtest-report"><h2>Backtest · Baseline / Model 4.0 + Stats</h2>
    <p>{report.evaluated} gerçek maç · {report.evaluation.actualFrom?.slice(0, 10)} — {report.evaluation.actualTo?.slice(0, 10)}</p>
    <p className="muted-note">Aynı maçlar, yalnızca önceki günlerin sonuçları. Ağırlık veya eşik optimizasyonu yapılmadı. Geçmiş oran, xG ve puan durumu olmadan sonuç verileriyle karşılaştırma.</p>
    <div style={{ overflowX: "auto" }}><table><caption>1X2 Brier: 0–2; diğer pazarlar: 0–1. Brier, Log Loss ve ECE için düşük değer daha iyidir.</caption>
      <thead><tr><th>Pazar</th><th>Maç</th><th>Başarı B / S</th><th>Brier B / S</th><th>Log Loss B / S</th><th>ECE B / S</th></tr></thead>
      <tbody>{Object.keys(stats).map(m => <tr key={m}><th>{m}</th><td>{stats[m].sampleSize}</td><td>{percent(baseline[m].hitRate)} / {percent(stats[m].hitRate)}</td><td>{number(baseline[m].brier)} / {number(stats[m].brier)}</td><td>{number(baseline[m].logLoss)} / {number(stats[m].logLoss)}</td><td>{number(baseline[m].ece)} / {number(stats[m].ece)}</td></tr>)}</tbody>
    </table></div>
    <h3>Güven eşikleri · 1X2</h3><div style={{ overflowX: "auto" }}><table><thead><tr><th>Eşik</th><th>Maç B / S</th><th>Başarı B / S</th><th>Brier B / S</th><th>Log Loss B / S</th></tr></thead><tbody>
      {Object.entries(report.stats.confidence).map(([threshold, markets]) => { const s = markets["1X2"]; const b = report.baseline.confidence[threshold]["1X2"]; return <tr key={threshold}><th>≥ {threshold}</th><td>{b.sampleSize} / {s.sampleSize}</td><td>{percent(b.hitRate)} / {percent(s.hitRate)}</td><td>{number(b.brier)} / {number(s.brier)}</td><td>{number(b.logLoss)} / {number(s.logLoss)}</td></tr>; })}
    </tbody></table></div>
    <p className="muted-note">İkili pazarlarda başarı, %50 eşiğinde evet/hayır sınıflandırmasıdır; bahis kazanma oranı değildir. Az örnekli alt gruplar kesin sonuç sayılmaz.</p>
  </section></>;
}
