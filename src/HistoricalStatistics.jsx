import { useState } from "react";

const number = value => Number.isFinite(value) ? value.toLocaleString("tr-TR", { maximumFractionDigits: 2 }) : "Veri yok";
const percent = value => Number.isFinite(value) ? `%${(value * 100).toFixed(1)}` : "Veri yok";
const form = values => values?.length ? values.map(value => ({ W: "G", D: "B", L: "M" })[value]).join(" · ") : "Veri yok";

export default function HistoricalStatistics({ profile, home, away, statistics }) {
  const [mode, setMode] = useState("raw");
  if (!profile) return <section className="detail-section"><h2>Geçmiş maç istatistikleri</h2><p>Veri yok</p></section>;
  const columns = [profile.home, profile.away];
  const rows = (title, fields) => <section className="detail-section"><h3>{title}</h3><div className="comparison-card"><div className="comparison-head"><b>{home}</b><span>{mode === "raw" ? "Ham istatistik" : "Yakın maçlara daha fazla ağırlık"}</span><b>{away}</b></div>{fields.map(([label, key, format = number]) => <div className="comparison-row" key={key}><strong>{columns[0]?.sampleSize ? format(columns[0][mode]?.[key]) : "Veri yok"}</strong><span>{label}</span><strong>{columns[1]?.sampleSize ? format(columns[1][mode]?.[key]) : "Veri yok"}</strong></div>)}</div></section>;
  return <section className="historical-statistics">
    <div className="section-heading"><div><span className="eyebrow">GERÇEK GEÇMİŞ MAÇLAR</span><h2>Takım istatistikleri</h2></div><label>Hesaplama <select value={mode} onChange={event => setMode(event.target.value)}><option value="raw">Ham</option><option value="weighted">Ağırlıklı</option></select></label></div>
    <p className="muted-note">Yalnızca maç başlangıcından önce tamamlanmış sonuçlar. Kaynak: {profile.dataQuality?.sources?.join(", ") || "Veri yok"}. Örneklem: {profile.home.sampleSize} / {profile.away.sampleSize} maç.</p>
    <section className="detail-section"><h3>FORM</h3><div className="comparison-card"><div className="comparison-head"><b>{home}</b><span>G: Galibiyet · B: Beraberlik · M: Mağlubiyet</span><b>{away}</b></div>{[5, 10].map(size => <div className="comparison-row" key={size}><strong>{form(profile.home[`last${size}`])}</strong><span>Son {size} · en yeni önce</span><strong>{form(profile.away[`last${size}`])}</strong></div>)}</div></section>
    {rows("Form özeti", [["Galibiyet", "wins"], ["Beraberlik", "draws"], ["Mağlubiyet", "losses"], ["Galibiyet oranı", "winRate", percent], ["Beraberlik oranı", "drawRate", percent], ["Mağlubiyet oranı", "lossRate", percent], ["Maç başına puan", "pointsPerGame"]])}
    {rows("GOL ORTALAMALARI", [["Atılan gol (GF)", "goalsFor"], ["Yenilen gol (GA)", "goalsAgainst"], ["GF / maç", "goalsForPerMatch"], ["GA / maç", "goalsAgainstPerMatch"], ["Gol farkı / maç", "goalDifferencePerMatch"]])}
    {rows("İÇ / DIŞ SAHA", [["İç saha maç", "homeMatches"], ["İç saha galibiyet", "homeWins"], ["İç saha beraberlik", "homeDraws"], ["İç saha mağlubiyet", "homeLosses"], ["İç saha GF / maç", "homeGoalsForPerMatch"], ["İç saha GA / maç", "homeGoalsAgainstPerMatch"], ["Dış saha maç", "awayMatches"], ["Dış saha galibiyet", "awayWins"], ["Dış saha beraberlik", "awayDraws"], ["Dış saha mağlubiyet", "awayLosses"], ["Dış saha GF / maç", "awayGoalsForPerMatch"], ["Dış saha GA / maç", "awayGoalsAgainstPerMatch"]])}
    {rows("GOL İSTATİSTİKLERİ", [["0.5 Üst", "over05Rate", percent], ["1.5 Üst", "over15Rate", percent], ["2.5 Üst", "over25Rate", percent], ["3.5 Üst", "over35Rate", percent], ["2.5 Alt", "under25Rate", percent], ["BTTS / KG Var", "bttsRate", percent], ["KG Yok", "bttsNoRate", percent], ["Gol yememe (Clean Sheet)", "cleanSheetRate", percent], ["Gol atamama", "failedToScoreRate", percent]])}
    {rows("İLK YARI", [["İlk yarı verili maç", "firstHalfSample"], ["İlk yarı atılan gol", "firstHalfGoalsFor"], ["İlk yarı yenilen gol", "firstHalfGoalsAgainst"], ["İlk yarı 0.5 Üst", "firstHalfOver05Rate", percent]])}
    <section className="detail-section"><h3>H2H</h3>{profile.h2h ? <div className="probability-group">{[["Gerçek karşılaşma", "sampleSize"], ["Ev sahibi takım galibiyet", "homeWins"], ["Beraberlik", "draws"], ["Deplasman takım galibiyet", "awayWins"], ["Gol / maç", "goalsPerMatch"], ["2.5 Üst", "over25Rate", percent], ["BTTS", "bttsRate", percent]].map(([label, key, format = number]) => <div className="probability-row" key={key}><span>{label}</span><strong>{format(profile.h2h[key])}</strong></div>)}</div> : <p>Veri yok</p>}</section>
    <section className="detail-section"><h3>Provider xG</h3><div className="comparison-row"><strong>{number(statistics?.home?.expectedGoals)}</strong><span>Gerçek kaynak xG</span><strong>{number(statistics?.away?.expectedGoals)}</strong></div></section>
  </section>;
}
