import { useEffect, useState } from "react";
import { readFrontendJson } from "./frontendApi.js";
const number = value => Number.isFinite(value) ? value.toFixed(4) : "—";
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
const labels = { MODEL_4_0: "Model 4.0", MODEL_4_1: "Model 4.1" };
const markets = [["1X2", "1X2"], ["Over15", "Over 1.5"], ["Over25", "Over 2.5"], ["Over35", "Over 3.5"], ["BTTS", "BTTS"]];
function MetricsTable({ models }) {
  return <div style={{ overflowX: "auto" }}><table><thead><tr><th>Model</th><th>Pazar</th><th>Örneklem (N)</th><th>Başarı</th><th>Brier</th><th>Log Loss</th></tr></thead><tbody>
    {Object.entries(models).flatMap(([model, data]) => markets.map(([key, label]) => <tr key={`${model}-${key}`}><th>{labels[model]}</th><td>{label}</td><td>{data.sampleSize}</td><td>{percent(data[key].accuracy)}</td><td>{number(data[key].brier)}</td><td>{number(data[key].logLoss)}</td></tr>))}
  </tbody></table></div>;
}
export default function ForwardPerformance({ apiBase }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(false);
  const [capture, setCapture] = useState(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
    readFrontendJson(`${apiBase}/api/ledger/performance`).then(data => { if (active) setReport(data.report); }).catch(() => { if (active) setError(true); });
    readFrontendJson(`${apiBase}/api/capture/status`).then(data => { if (active) setCapture(data); }).catch(() => { if (active) setCapture(null); });
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [apiBase]);
  return <section className="detail-section backtest-report"><h2>Canlı Model Performansı · Forward Performance</h2>
    <p className="muted-note">Forward takip: {capture?.schedulerActive || capture?.isRunning ? "Aktif" : "Bekliyor"} · Son tarama: {capture?.lastRunAt ? new Date(capture.lastRunAt).toLocaleString("tr-TR") : "—"} · Kayıtlı: {capture ? `${capture.recordedPredictions} tahmin / ${capture.recordedFixtures} maç` : "—"}</p>
    <p>Yalnızca maç başlamadan kaydedilen gerçek production tahminleri. Backtest sonuçları bu rapora dahil değildir.</p>
    {!report ? <p role="status">{error ? "Canlı performans kayıtları şu anda okunamıyor." : "Kayıtlar yükleniyor…"}</p> : <>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Model</th><th>Kayıtlı tahmin</th><th>Sonuçlanan</th><th>Bekleyen</th><th>Çelişkili sonuç</th></tr></thead><tbody>{Object.entries(report.models).map(([model, data]) => <tr key={model}><th>{labels[model]}</th><td>{data.totalPredictions}</td><td>{data.settledPredictions}</td><td>{data.pendingPredictions}</td><td>{data.conflictPredictions}</td></tr>)}</tbody></table></div>
      {Object.values(report.models).some(m => m.smallSample) && <p className="muted-note">Örneklem henüz küçük. 100 maçtan az sonuçla model üstünlüğü çıkarılmamalıdır.</p>}
      <p className="muted-note">Metriklerde her maç/model için ilk kayıt kullanılır; bekleyen ve çelişkili kayıtlar dışlanır. Başarı ikili pazarlarda %50 eşiğiyle hesaplanır. Brier ve Log Loss için düşük değer daha iyidir.</p>
      <MetricsTable models={report.models} />
      <h3>4.0 vs 4.1 · Eşleşmiş ileri dönem karşılaştırması</h3>
      <p>Aynı maç ve aynı girdiyle üretilmiş, sonuçlanmış çiftler: N = {report.comparison.sampleSize}.</p>
      {report.comparison.smallSample && <p className="muted-note">Örneklem henüz küçük.</p>}
      <MetricsTable models={report.comparison.models} />
    </>}
  </section>;
}
