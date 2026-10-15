import { useMemo, useState } from "react";
import "./ZeusAssistant.css";

const QUICK_PROMPTS = [
  "Bugün en dikkat çeken analiz hangisi?",
  "Tahmin güveni ne anlama geliyor?",
  "Veri kalitesi neden önemli?",
  "Model performansı nasıl hesaplanıyor?",
];

function answerFor(question, { matches, predictions, performance }) {
  const q = question.toLocaleLowerCase("tr-TR");
  const valid = (predictions || []).filter(item => item?.eligible === true && item?.prediction?.market && item?.dataQuality?.score >= 60);
  if (q.includes("dikkat") || q.includes("öner") || q.includes("en iyi") || q.includes("analiz")) {
    if (!valid.length) return "Şu anda veri kalitesi ve model koşullarını birlikte karşılayan öne çıkan bir seçim yok. Tahmin uydurmak yerine beklemek daha doğru. Maçlar bölümünden karşılaşma seçip detaylı analizi açabilirsin.";
    const best = [...valid].sort((a,b) => (b.confidence || 0) - (a.confidence || 0))[0];
    return `Veri koşullarını karşılayan ${valid.length} analiz var. Model güveni en yüksek görünen eşleşme: ${best.fixture?.home || "Ev sahibi"} – ${best.fixture?.away || "Deplasman"}. Öneri: ${best.prediction.market}; olasılık: ${best.prediction.probability == null ? "gösterilmiyor" : "%" + Number(best.prediction.probability).toFixed(1)}. Bu bir garanti değil; maç detayında eksik veri ve kaynakları da kontrol et.`;
  }
  if (q.includes("güven")) return "Model güveni, sistemin mevcut veriler ve model koşulları açısından analize ne kadar güvendiğini ifade eder. Bir seçeneğin gerçekleşme olasılığıyla aynı şey değildir. Örneğin %75 model güveni, seçimin %75 gerçekleşeceği anlamına gelmez.";
  if (q.includes("kalite") || q.includes("veri")) return "Veri kalitesi; kaynakların kapsamı, istatistiklerin yeterliliği ve eksik alanlar gibi unsurları özetler. Düşük kaliteli veya doğrulanamayan veride ZEUS tahmini gizleyebilir. Bu, sistemin tahmin uydurmasını önlemek içindir.";
  if (q.includes("performans") || q.includes("başarı")) {
    if (!performance?.completed) return "Doğrulanmış ve sonuçlanmış tahmin geçmişi henüz başarı oranı hesaplamak için yeterli değil. Güvenilir bir oran oluşması için tahminlerin maçtan önce kaydedilmesi ve maç sonuçlarının bağımsız kaynaktan doğrulanması gerekir.";
    return `Kayıtlı performans: ${performance.completed} tamamlanmış tahmin, ${performance.successful} başarılı ve ${performance.failed} başarısız. Hesaplanan başarı oranı %${performance.successRate}. Örneklem büyüdükçe bu oran daha anlamlı hale gelir; tek başına geleceği garanti etmez.`;
  }
  if (q.includes("kaç maç") || q.includes("fikstür")) return `Seçili tarihte listelenen maç sayısı: ${(matches || []).length}. Fikstürü Maçlar bölümünden inceleyebilirsin. Veri sağlayıcısının kapsamı lige ve tarihe göre değişebilir.`;
  return "ZEUS Rehber; mevcut fikstür, tahmin özeti ve doğrulanmış performans bilgilerini açıklayabilir. Şunları sorabilirsin: öne çıkan analiz, model güveni, veri kalitesi veya performans. Mevcut olmayan bilgileri uydurmaz.";
}

export default function ZeusAssistant({ matches = [], predictions = [], performance = null }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState([]);
  const context = useMemo(() => ({ matches, predictions, performance }), [matches, predictions, performance]);

  function ask(value) {
    const text = String(value || "").trim();
    if (!text) return;
    const answer = answerFor(text, context);
    setHistory(items => [...items, { role: "user", text }, { role: "assistant", text: answer }]);
    setQuestion("");
  }

  return <div className="zeus-assistant-root">
    {open && <section className="zeus-assistant-panel" aria-label="ZEUS AI rehber sohbeti">
      <header className="zeus-assistant-header">
        <span className="zeus-bot-avatar" aria-hidden="true">Z</span>
        <div><strong>ZEUS Rehber</strong><small>Maç verileri ve model açıklamaları</small></div>
        <button type="button" aria-label="Rehberi kapat" onClick={() => setOpen(false)}>×</button>
      </header>
      <div className="zeus-assistant-messages" aria-live="polite">
        {history.length === 0 && <div className="zeus-assistant-welcome"><span className="eyebrow accent">VERİ DESTEKLİ YARDIMCI</span><p>Analizleri anlamana yardımcı olayım. Yalnızca uygulamada bulunan verilere dayanırım; kesin sonuç veya kazanç garantisi vermem.</p></div>}
        {history.map((item, i) => <div key={i} className={`zeus-chat-bubble ${item.role}`}>{item.text}</div>)}
      </div>
      {history.length === 0 && <div className="zeus-quick-prompts">{QUICK_PROMPTS.map(prompt => <button type="button" key={prompt} onClick={() => ask(prompt)}>{prompt}<span>↗</span></button>)}</div>}
      <form className="zeus-assistant-input" onSubmit={event => { event.preventDefault(); ask(question); }}>
        <input aria-label="ZEUS Rehbere soru sor" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Analiz hakkında sor..." maxLength={300} />
        <button type="submit" disabled={!question.trim()} aria-label="Soruyu gönder">↑</button>
      </form>
      <p className="zeus-assistant-footnote">Açıklayıcı yardımcı · sonuç garantisi vermez</p>
    </section>}
    <button className={open ? "zeus-assistant-launcher open" : "zeus-assistant-launcher"} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label={open ? "ZEUS Rehberi kapat" : "ZEUS Rehberi aç"}>
      <span className="zeus-launcher-orb">Z</span><span>{open ? "Kapat" : "ZEUS AI"}</span><span className="zeus-launcher-spark">✦</span>
    </button>
  </div>;
}
