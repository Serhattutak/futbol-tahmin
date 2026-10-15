const finite = value => Number.isFinite(Number(value)) && value !== null && value !== undefined && value !== "";

function ppg(form) {
  const value = form?.pointsPerGame ?? form?.ppg;
  return finite(value) ? Number(value) : null;
}

export function buildZeusInsight(analysis) {
  if (!analysis || analysis.predictionEligible === false) {
    return {
      headline: "Bu maç için tahmin üretmek yerine veri bekleniyor.",
      summary: "Takım geçmişi veya kritik maç verileri yeterli değil. ZEUS AI eksik bilgileri varsayımla doldurmaz.",
      signals: ["Tahmin uygunluğu: kapalı", "Eksik veriyle kesin yorum yapılmıyor."],
      availability: "Sakatlık ve kadro bilgisi doğrulanmış bir kaynaktan alınamadı."
    };
  }

  const fixture = analysis.fixture || {};
  const home = fixture.home?.name || "Ev sahibi";
  const away = fixture.away?.name || "Deplasman";
  const homePpg = ppg(analysis.homeForm5) ?? ppg(analysis.homeForm);
  const awayPpg = ppg(analysis.awayForm5) ?? ppg(analysis.awayForm);
  const xgHome = analysis.expectedGoals?.home;
  const xgAway = analysis.expectedGoals?.away;
  const signals = [];

  if (homePpg !== null && awayPpg !== null) {
    const gap = homePpg - awayPpg;
    if (Math.abs(gap) < 0.2) signals.push("Son dönem puan ortalamaları birbirine yakın.");
    else signals.push(gap > 0
      ? `${home} son dönem puan ortalamasında önde.`
      : `${away} son dönem puan ortalamasında önde.`);
  } else {
    signals.push("Son dönem form verisi iki takım için karşılaştırılabilir düzeyde değil.");
  }

  if (finite(xgHome) && finite(xgAway)) {
    const total = Number(xgHome) + Number(xgAway);
    signals.push(`Model gol beklentisi: ${home} ${Number(xgHome).toFixed(2)} — ${away} ${Number(xgAway).toFixed(2)} (toplam ${total.toFixed(2)}).`);
  } else {
    signals.push("Gol beklentisi için yeterli veri bulunmuyor.");
  }

  const h2h = analysis.h2h;
  if (h2h && Number(h2h.count) >= 3 && finite(h2h.homeWins) && finite(h2h.awayWins)) {
    signals.push(`Karşılıklı maçlar (${h2h.count} maç): ev sahibi ${h2h.homeWins}, deplasman ${h2h.awayWins} galibiyet.`);
  } else {
    signals.push("Karşılıklı maç geçmişi sınırlı; tek başına belirleyici sinyal olarak kullanılmadı.");
  }

  const quality = Number(analysis.dataQuality?.score ?? analysis.statisticsQuality?.score);
  if (Number.isFinite(quality)) signals.push(`Veri kalitesi: ${quality}/100.`);
  if (analysis.sourceAgreement?.status === "low") signals.push("Model ve piyasa sinyalleri arasında belirgin fark var; bu belirsizliği artırır.");
  else if (analysis.sourceAgreement?.status === "high") signals.push("Mevcut oran sağlayıcısı ile model sinyalleri genel olarak uyumlu.");

  const availability = analysis.dataAvailability || {};
  const injuriesKnown = availability.injuries === true;
  const lineupsKnown = availability.lineups === true;
  return {
    headline: `${home} – ${away}: form, gol beklentisi ve veri kalitesi birlikte değerlendirildi.`,
    summary: "Bu yorum, ekrandaki maç öncesi istatistiklerden kurallı olarak üretilir; doğrulanmamış haber veya oyuncu bilgisi uydurmaz.",
    signals,
    availability: `Sakatlık: ${injuriesKnown ? "veri mevcut; kaynak ve güncellik maç detaylarında kontrol edilmeli" : "doğrulanmış veri yok"}. Kadro/ilk 11: ${lineupsKnown ? "veri mevcut" : "doğrulanmış veri yok"}.`
  };
}
