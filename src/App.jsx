import HistoricalStatistics from "./HistoricalStatistics.jsx";
import BacktestView from "./BacktestView.jsx";
import ForwardPerformance from "./ForwardPerformance.jsx";
import ModelSelector from "./ModelSelector.jsx";
import { MODEL40, MODEL41, modelLabel, modelCacheKey, selectModelAnalysis } from "./modelSelection.js";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import Monetization from "./Monetization.jsx";
import LegalCenter from "./LegalCenter.jsx";
import ZeusAssistant from "./ZeusAssistant.jsx";
import "./ZeusRedesign.css";
import { getCachedFrontendJson, readFrontendJson } from "./frontendApi.js";
import { dataQualityReasons, dataQualityText, marketMetrics, matchesMarketFilter, oneXTwoSummary } from "./predictionPresentation.js";

// Production'da (Vercel) frontend ve backend aynı origin'de çalışır; bu yüzden
// API istekleri göreli "/api/..." yoluyla gider (boş API_BASE). Geliştirmede ise
// yerel backend'e (localhost:3001) yönlendirilir. VITE_API_BASE_URL tanımlıysa o kullanılır.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? "http://localhost:3001" : "");
const NAV_ITEMS = [
  { id: "home", label: "Ana Sayfa", icon: "⌂" },
  { id: "matches", label: "Maçlar", icon: "▦" },
  { id: "predictions", label: "Tahminler", icon: "✦" },
  { id: "favorites", label: "Favoriler", icon: "♡" },
  { id: "more", label: "Diğer", icon: "⋯" },
];
const MARKET_GROUPS = [
  { id: "all", label: "Tümü" },
  { id: "1x2", label: "1X2" },
  { id: "double", label: "Çifte Şans" },
  { id: "goals", label: "Üst / Alt" },
  { id: "btts", label: "KG Var / Yok" },
  { id: "value", label: "Value Fırsatları" },
];

function formatTime(date) { return date ? new Date(date).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "--:--"; }
function formatDate(date) { return date ? new Date(date).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }) : "--"; }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function parseDateKey(value) { const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? null : date; }
function todayKey() { return dateKey(new Date()); }
function initialSelectedDate() {
  const today = new Date();
  const value = new URLSearchParams(window.location.search).get("date");
  const parsed = value ? parseDateKey(value) : null;
  if (!parsed) return dateKey(today);
  const difference = Math.round((parsed - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  return difference >= -7 && difference <= 7 ? dateKey(parsed) : dateKey(today);
}
function pct(value) { if (value == null || value === "") return "—"; const number = Number(value); return Number.isFinite(number) ? `${number.toFixed(2)}%` : "—"; }
function fairOdds(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? (100 / number).toFixed(2) : "—"; }
function getStatus(match) { const status = match?.fixture?.status ?? match?.status; const short = typeof status === "string" ? status : status?.short; return ["1H", "2H", "HT", "ET", "P", "LIVE", "IN_PLAY", "PAUSED"].includes(short) ? "live" : ["FINISHED", "FT", "AET", "PEN"].includes(short) ? "finished" : "upcoming"; }
function getTeams(match) { return { home: match?.teams?.home?.name || "Ev sahibi", away: match?.teams?.away?.name || "Deplasman" }; }
function initialFavoriteState() { try { const saved = JSON.parse(localStorage.getItem("futbol-analiz-favorites")) || {}; return { matches: Array.isArray(saved.matches) ? saved.matches.map(String) : [], teams: [], leagues: [], savedMatches: saved.savedMatches || {} }; } catch { return { matches: [], teams: [], leagues: [], savedMatches: {} }; } }
function archivedAnalysis(record) {
  const s = record.snapshot;
  if (!s?.fixtureId || !s.prediction || !s.probabilities) return null;
  return { success: true, archived: true, predictionEligible: s.prediction.market !== "NO BET" && s.prediction.market !== "NO_BET", fixture: { id: String(s.fixtureId), date: s.kickoff, league: s.league, country: s.country, home: s.homeTeam, away: s.awayTeam, sourceProviders: s.sourceProviders }, model: { version: s.modelVersion, confidence: s.confidence }, dataQuality: s.dataQuality, markets: s.probabilities, recommendation: { bestMarket: s.prediction }, sourceMetadata: s.sourceMetadata, homeForm: s.form?.home, awayForm: s.form?.away, statistics: s.statistics, expectedGoals: s.expectedGoals };
}

function App() {
  const analysisRequest = useRef(0);
  const detailCache = useRef(new Map());
  const previousViewRef = useRef("home");
  const scrollPositionRef = useRef(0);
  const [activeView, setActiveView] = useState("home");
  const [moreOpen, setMoreOpen] = useState(false);
  const [matches, setMatches] = useState([]);
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);
  const matchesDate = useRef(selectedDate);
  const fixtureCache = useRef(new Map());
  const fixtureRequests = useRef(new Map());
  const [bestPredictions, setBestPredictions] = useState([]);
  const [performance, setPerformance] = useState(null);
  const [providerStatus, setProviderStatus] = useState([]);
  const [analysisCache, setAnalysisCache] = useState({});
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [error, setError] = useState("");
  const [fixtureWarning, setFixtureWarning] = useState("");
  const [search, setSearch] = useState("");
  const [league, setLeague] = useState("Tümü");
  const [market, setMarket] = useState("all");
  const [minConfidence, setMinConfidence] = useState("0");
  const [favorites, setFavorites] = useState(initialFavoriteState);
  const [openLeagues, setOpenLeagues] = useState({});

  useEffect(() => { try { localStorage.setItem("futbol-analiz-favorites", JSON.stringify(favorites)); } catch { /* Storage can be disabled in private browsing. */ } }, [favorites]);
  useEffect(() => {
    let cancelled = false;
    async function loadMatches() {
      try {
        setLoading(true); setError(""); setFixtureWarning("");
        const url = `${API_BASE}/api/football-test?date=${selectedDate}`;
        const stored = getCachedFrontendJson(url);
        const cached = fixtureCache.current.get(selectedDate) || (stored && { matches: stored.data.matches, savedAt: stored.savedAt, stale: stored.data.stale });
        if (cached?.matches?.length) {
          setMatches(cached.matches);
          setLoading(false);
          if (cached.stale) setFixtureWarning("Veri kaynağı geçici olarak sınırlandı; son alınan gerçek maçlar gösteriliyor.");
        } else if (matchesDate.current !== selectedDate) {
          setMatches([]);
        }
        matchesDate.current = selectedDate;
        if (cached && Date.now() - cached.savedAt < 60_000) {
          setMatches(cached.matches);
          return;
        }
        // StrictMode replays effects. Both subscribers must use the same request:
        // discarding the first response and issuing another can hit the API's 429 guard.
        let request = fixtureRequests.current.get(selectedDate);
        if (!request) {
          request = (async () => {
            const data = await readFrontendJson(`${API_BASE}/api/football-test?date=${selectedDate}`);
            if (!Array.isArray(data.matches)) throw new Error("Maç listesi geçersiz biçimde döndü.");
            if (data.date && data.date !== selectedDate) throw new Error("Maç listesinin tarihi seçili tarihle eşleşmiyor.");
            // The API owns the date/timezone selection; retain every returned fixture.
            const previous = fixtureCache.current.get(selectedDate);
            if (!data.matches.length && previous?.matches.length) return { matches: previous.matches, stale: true };
            if (data.matches.length) fixtureCache.current.set(selectedDate, { matches: data.matches, savedAt: Date.now(), stale: data.stale });
            return { matches: data.matches, stale: data.stale };
          })();
          fixtureRequests.current.set(selectedDate, request);
          const clearRequest = () => fixtureRequests.current.delete(selectedDate);
          request.then(clearRequest, clearRequest);
        }
        const result = await request;
        if (!cancelled) {
          setMatches(result.matches);
          if (result.stale) setFixtureWarning("Veri kaynağı geçici olarak sınırlandı; son alınan gerçek maçlar gösteriliyor.");
        }
      } catch (loadError) { if (!cancelled) {
        if (fixtureCache.current.get(selectedDate)?.matches.length) setFixtureWarning("Veri kaynağı geçici olarak sınırlandı; son alınan gerçek maçlar gösteriliyor.");
        else setError(loadError.message || "Veri sağlayıcısına ulaşılamıyor.");
      } }
      finally { if (!cancelled) setLoading(false); }
    }
    loadMatches();
    return () => { cancelled = true; };
  }, [selectedDate]);

  useEffect(() => {
    let cancelled = false; setBestPredictions([]);
    readFrontendJson(`${API_BASE}/api/best-predictions?date=${selectedDate}`)
      .then((data) => { if (cancelled) return; const results = (data?.results || []).filter(item => item.eligible === true).sort((a, b) => (b.predictionScore ?? 0) - (a.predictionScore ?? 0)); setBestPredictions(results);
        setAnalysisCache(current => { const next = { ...current }; for (const item of data?.assessments || []) { const id = String(item.fixture.id); if (next[id] && !next[id].summaryOnly) continue; const bestMarket = item.status === "PREDICTION" ? item.recommendation?.bestMarket : null; next[id] = bestMarket ? { summaryOnly: true, fixture: item.fixture, predictionEligible: true, dataQuality: item.dataQuality, model: { version: "ZEUS AI", confidence: item.confidence }, recommendation: { bestMarket }, markets: { [bestMarket.market]: bestMarket } } : { summaryOnly: true, fixture: item.fixture, predictionEligible: false, dataQuality: item.dataQuality }; } return next; });
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedDate]);

  // Performance/archive data is global dashboard state; fetch once per app session.
  // Refetching on every tab switch created avoidable concurrent requests and HTTP 429s.
  useEffect(() => {
    let cancelled = false;
    readFrontendJson(`${API_BASE}/api/archive/performance`)
      .then(data => { if (cancelled || !data.success) return; setPerformance(data); setAnalysisCache(current => { const next = { ...current }; for (const record of data.history || []) { const restored = archivedAnalysis(record); if (restored && (!next[restored.fixture.id] || next[restored.fixture.id].summaryOnly)) next[restored.fixture.id] = restored; } return next; }); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    readFrontendJson(`${API_BASE}/api/providers/status`)
      .then((data) => setProviderStatus(Array.isArray(data?.providers) ? data.providers : []))
      .catch((providerError) => console.error("PROVIDERS:", providerError));
  }, []);

  useEffect(() => {
    window.history.replaceState({}, "", `${window.location.pathname}?date=${selectedDate}`);
  }, [selectedDate]);

  function changeDate(value) {
    const next = parseDateKey(value);
    if (!next) return;
    const today = parseDateKey(todayKey());
    const difference = Math.round((next - today) / 86400000);
    if (difference < -7 || difference > 7) return;
    setSelectedDate(dateKey(next));
    setSearch("");
    setLeague("Tümü");
    setOpenLeagues({});
    setAnalysis(null);
    setError("");
  }

  async function openAnalysis(match) {
    const fixtureId = String(match?.fixture?.id || "");
    if (!fixtureId) return;
    if (activeView !== "match-detail") { previousViewRef.current = activeView; scrollPositionRef.current = window.scrollY; }
    setSelectedMatch(match); setActiveView("match-detail"); setError("");
    const requestId = ++analysisRequest.current;
    try {
      setAnalysis(null); setAnalysisLoading(true);
      const data = await readFrontendJson(`${API_BASE}/api/analyze/${encodeURIComponent(fixtureId)}`);
      if (requestId !== analysisRequest.current) return;
      detailCache.current.clear();
      for (const version of [MODEL40, MODEL41]) if (data.models?.[version]) detailCache.current.set(modelCacheKey(fixtureId, version, data.cache), data.models[version]);
      setAnalysisCache((current) => ({ ...current, [fixtureId]: data.models?.[MODEL40] || data }));
      setAnalysis(data.models ? { ...data, models: Object.fromEntries([MODEL40, MODEL41].map(version => [version, detailCache.current.get(modelCacheKey(fixtureId, version, data.cache)) || null])) } : data);
    } catch (analysisError) { if (requestId === analysisRequest.current) { const cached = analysisCache[fixtureId]; if (cached?.archived) setAnalysis(cached); setError(analysisError.message === "Bu maç için yeterli istatistik bulunamadı." ? analysisError.message : "Veri sağlayıcısına ulaşılamıyor."); } }
    finally { if (requestId === analysisRequest.current) setAnalysisLoading(false); }
  }

  function toggleFavorite(match, type = "matches") {
    const id = String(type === "matches" ? match?.fixture?.id || "" : type === "teams" ? match?.teams?.home?.id || "" : match?.league?.id || "");
    if (!id) return;
    setFavorites(current => { const removing = current[type].includes(id); const savedMatches = { ...current.savedMatches }; if (type === "matches") { if (removing) delete savedMatches[id]; else savedMatches[id] = match; } return { ...current, savedMatches, [type]: removing ? current[type].filter(item => item !== id) : [...current[type], id] }; });
  }

  const sortedMatches = useMemo(() => [...matches].sort((a, b) => (Date.parse(a?.fixture?.date) || 0) - (Date.parse(b?.fixture?.date) || 0)), [matches]);
  const liveMatches = useMemo(() => sortedMatches.filter((match) => getStatus(match) === "live"), [sortedMatches]);
  const leagues = useMemo(() => ["Tümü", ...new Set(sortedMatches.map((match) => match?.league?.name).filter(Boolean))], [sortedMatches]);
  const filteredMatches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query && league === "Tümü") return sortedMatches;
    return sortedMatches.filter((match) => {
      const { home, away } = getTeams(match);
      const matchesSearch = !query || `${home} ${away} ${match?.league?.name || ""}`.toLowerCase().includes(query);
      const matchesLeague = league === "Tümü" || match?.league?.name === league;
      return matchesSearch && matchesLeague;
    });
  }, [league, matches, search]);
  const groupedMatches = useMemo(() => filteredMatches.reduce((groups, match) => { const name = match?.league?.name || "Diğer Ligler"; groups[name] = groups[name] || []; groups[name].push(match); return groups; }, Object.create(null)), [filteredMatches]);
  const favoriteMatches = useMemo(() => favorites.matches.map(id => matches.find(match => String(match.fixture?.id) === id) || favorites.savedMatches[id]).filter(Boolean), [favorites, matches]);
  const predictionMatches = useMemo(() => [...new Map([...matches, ...Object.values(analysisCache).filter(item => item.fixture?.id).map(item => bestPredictionToMatch(item))].map(match => [String(match.fixture.id), match])).values()], [matches, analysisCache]);
  const stats = { leagues: new Set(matches.map((match) => match?.league?.id).filter(Boolean)).size, teams: new Set(matches.flatMap((match) => [match?.teams?.home?.id, match?.teams?.away?.id]).filter(Boolean)).size };

  function navigateTo(view) {
    if (view === "matches" && activeView !== "matches") {
      setSearch("");
      setLeague("Tümü");
      setOpenLeagues({});
    }
    scrollPositionRef.current = 0;
    setActiveView(view);
    setAnalysis(null);
  }

  useEffect(() => {
    if (activeView === "match-detail") return;
    const target = scrollPositionRef.current;
    const frame = requestAnimationFrame(() => window.scrollTo(0, target));
    return () => cancelAnimationFrame(frame);
  }, [activeView]);

  function renderView() {
    if (activeView === "match-detail") return <MatchDetailV2 analysis={analysis} match={selectedMatch} loading={analysisLoading} onBack={() => setActiveView(previousViewRef.current)} onFavorite={toggleFavorite} favoriteIds={favorites.matches} />;
    if (activeView === "predictions") return <PredictionsViewV2 matches={predictionMatches} onFavorite={toggleFavorite} favoriteIds={favorites.matches} analysisCache={analysisCache} market={market} setMarket={setMarket} minConfidence={minConfidence} setMinConfidence={setMinConfidence} onOpen={openAnalysis} />;
    if (activeView === "matches") return <MatchesView selectedDate={selectedDate} groups={groupedMatches} openLeagues={openLeagues} setOpenLeagues={setOpenLeagues} search={search} setSearch={setSearch} league={league} setLeague={setLeague} leagues={leagues} onOpen={openAnalysis} onFavorite={toggleFavorite} favoriteIds={favorites.matches} loading={loading} analysisCache={analysisCache} />;
    if (activeView === "live") return <LiveView matches={liveMatches} onOpen={openAnalysis} analysisCache={analysisCache} />;
    if (activeView === "favorites") return <FavoritesView matches={favoriteMatches} onOpen={openAnalysis} onFavorite={toggleFavorite} favoriteIds={favorites.matches} />;
    if (activeView === "legal") return <LegalCenter />;
    if (activeView === "performance") return <div className="view-stack"><ForwardPerformance apiBase={API_BASE} /><BacktestView apiBase={API_BASE} /><ArchivePerformanceView performance={performance} /></div>;
    return <HomeView matches={sortedMatches} selectedDate={selectedDate} bestPredictions={bestPredictions} performance={performance} providerStatus={providerStatus} loading={loading} analysisCache={analysisCache} stats={stats} onOpen={openAnalysis} onFavorite={toggleFavorite} onShowMatches={() => setActiveView("matches")} favoriteIds={favorites.matches} />;
  }

  return <div className="app-shell">
    <header className="topbar"><div className="brand-mark"><span className="brand-ball">⚽</span><span>ZEUS <b>AI</b></span></div><div className="topbar-actions"><span className="today">{new Date().toLocaleDateString("tr-TR", { weekday: "short", day: "numeric", month: "short" })}</span><button className="icon-button" type="button" aria-label="Bildirimler">♢<i /></button></div></header>
    <main className="page-content"><DateSelector selectedDate={selectedDate} onChange={changeDate} />{fixtureWarning && <p className="muted-note" role="status">{fixtureWarning}</p>}{error && <div className="error-banner">{error}</div>}{renderView()}</main>
    <ZeusAssistant matches={matches} predictions={bestPredictions} performance={performance} />
    <nav className="bottom-nav" aria-label="Ana navigasyon">{NAV_ITEMS.map((item) => item.id === "more" ? <button key={item.id} type="button" aria-expanded={moreOpen} className={moreOpen || ["live", "performance", "legal"].includes(activeView) ? "nav-item active" : "nav-item"} onClick={() => setMoreOpen(open => !open)}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button> : <button key={item.id} type="button" className={activeView === item.id ? "nav-item active" : "nav-item"} onClick={() => { setMoreOpen(false); navigateTo(item.id); }}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>)}{moreOpen && <div className="nav-more-menu"><button type="button" onClick={() => { setMoreOpen(false); navigateTo("live"); }}>● Canlı maçlar</button><button type="button" onClick={() => { setMoreOpen(false); navigateTo("performance"); }}>▥ Performans ve istatistik</button><button type="button" onClick={() => { setMoreOpen(false); navigateTo("legal"); }}>ⓘ Gizlilik ve kullanım</button></div>}</nav>
  </div>;
}

function SectionHeading({ eyebrow, title, action }) { return <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action}</div>; }
function DateSelector({ selectedDate, onChange }) {
  const today = new Date();
  const selected = parseDateKey(selectedDate);
  const selectedOffset = selected ? Math.round((selected - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000) : 0;
  const dates = Array.from({ length: 15 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7 + index);
    return { key: dateKey(date), date, offset: index - 7 };
  });
  return <section className="date-selector"><div className="date-nav"><button type="button" disabled={selectedOffset <= -7} onClick={() => onChange(dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + selectedOffset - 1)))}>← Önceki Gün</button><button className="today-button" type="button" onClick={() => onChange(dateKey(today))}>BUGÜN</button><button type="button" disabled={selectedOffset >= 7} onClick={() => onChange(dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + selectedOffset + 1)))}>Sonraki Gün →</button></div><div className="date-strip" role="tablist" aria-label="Gün seçici">{dates.map(({ key, date, offset }) => <button key={key} className={selectedDate === key ? "date-item selected" : "date-item"} type="button" role="tab" aria-selected={selectedDate === key} onClick={() => onChange(key)}><small>{offset === 0 ? "BUGÜN" : date.toLocaleDateString("tr-TR", { weekday: "short" })}</small><strong>{date.toLocaleDateString("tr-TR", { day: "numeric", month: "short" })}</strong></button>)}</div></section>;
}
function EmptyState({ icon = "◌", title, text }) { return <div className="empty-state"><span>{icon}</span><strong>{title}</strong><p>{text}</p></div>; }
function ConfidenceBadge({ confidence }) { const value = confidence == null ? NaN : Number(confidence); if (!Number.isFinite(value)) return <span className="confidence muted">ANALİZ BEKLİYOR</span>; const tone = value >= 75 ? "high" : value >= 60 ? "medium" : "low"; return <span className={`confidence ${tone}`}>{tone === "high" ? "YÜKSEK" : tone === "medium" ? "ORTA" : "DÜŞÜK"} %{value}</span>; }
function DataQualityBadge({ quality, label }) { const value = quality == null ? NaN : Number(quality); if (!Number.isFinite(value)) return <span className="quality-badge pending">VERİ BEKLENİYOR</span>; const tone = value >= 75 ? "high" : value >= 60 ? "medium" : value >= 40 ? "weak" : "low"; return <span className={`quality-badge ${tone}`}>{value < 40 ? "⚠ YETERSİZ VERİ" : dataQualityText(value)} · {value}/100</span>; }

function MatchCard({ match, analysis, summary, onOpen, onFavorite, favoriteIds = [], featured = false }) {
  const { home, away } = getTeams(match); const fixtureId = match?.fixture?.id;
  const bestMarket = summary?.prediction || analysis?.recommendation?.bestMarket;
  const prediction = analysis?.predictionEligible === false ? "Yetersiz Veri / Tahmin Yok" : bestMarket?.market || (analysis?.prediction === "1" ? home : analysis?.prediction === "2" ? away : analysis?.prediction === "X" ? "Beraberlik" : "Analiz bekliyor");
  const quality = summary?.dataQuality?.score ?? analysis?.dataQuality?.score;
  const qualityLabel = summary?.dataQualityLabel || analysis?.dataQualityLabel;
  const bookmakerOdds = summary?.bookmakerOdds ?? analysis?.recommendation?.bookmakerOdds;
  const value = summary?.value ?? analysis?.recommendation?.value;
  const missing = summary?.dataQuality?.missing || analysis?.dataQuality?.missing || [];
  const sources = analysis?.fixture?.sourceProviders || analysis?.sourceMetadata?.providers || match?.providers || (match?.provider ? [match.provider] : []);
  const oneXTwo = oneXTwoSummary(summary?.predictions || analysis?.predictions);
  const expectedGoals = summary?.expectedGoals || analysis?.expectedGoals;
  return <article className={featured ? "match-card featured-card" : "match-card"}>
    <div className="card-meta"><span className="league-pill">{match?.league?.name || "Lig"}</span><span>{formatDate(match?.fixture?.date)} · {formatTime(match?.fixture?.date)}</span></div>
    <div className="teams-row"><div className="team-name"><span className="team-crest">{home.slice(0, 1)}</span><strong>{home}</strong></div><span className="versus">{getStatus(match) === "finished" ? `${match.goals?.home ?? "—"} - ${match.goals?.away ?? "—"}` : "VS"}</span><div className="team-name away"><strong>{away}</strong><span className="team-crest">{away.slice(0, 1)}</span></div></div>
    <div className="prediction-strip"><div><span className="field-label">EN GÜÇLÜ TAHMİN</span><strong>{prediction}</strong><small>Olasılık (Probability): {pct(bestMarket?.probability)}</small></div><div><span className="field-label">MODEL GÜVENİ</span><ConfidenceBadge confidence={summary?.confidence ?? analysis?.model?.confidence} /></div></div>
    {oneXTwo && <div className="one-x-two-strip" aria-label="1X2 tahmin olasılıkları"><div><span>1 · {home}</span><b>{pct(oneXTwo.home)}</b></div><div><span>X · Beraberlik</span><b>{pct(oneXTwo.draw)}</b></div><div><span>2 · {away}</span><b>{pct(oneXTwo.away)}</b></div></div>}
    {Number.isFinite(Number(expectedGoals?.home)) && Number.isFinite(Number(expectedGoals?.away)) && <div className="expected-goals-line"><span>Model gol beklentisi</span><b>{home} {Number(expectedGoals.home).toFixed(2)} – {Number(expectedGoals.away).toFixed(2)} {away}</b></div>}
    <div className="quality-line"><DataQualityBadge quality={quality} label={qualityLabel} /><span>Kaynak: <b>{sources.length ? sources.join(", ") : "—"}</b></span><span>Oran: <b>{Number.isFinite(bookmakerOdds) ? Number(bookmakerOdds).toFixed(2) : "—"}</b></span><span>Value: <b>{Number.isFinite(value) ? `${value > 0 ? "+" : ""}${Number(value).toFixed(1)}%` : "—"}</b></span></div>
    {match?.dataConflict && <div className="quality-note">Veri uyuşmazlığı: kaynak kayıtları otomatik birleştirilmedi.</div>}
    {quality < 40 && missing.length > 0 && <div className="quality-note">Bu maç için yeterli istatistik bulunamadı.</div>}
    <div className="card-footer"><div className="market-mini"><span>Model adil oran</span><b>{bestMarket?.fairOdds ? Number(bestMarket.fairOdds).toFixed(2) : analysis?.predictions ? fairOdds(analysis.predictions.homeWin) : "—"}</b></div><button className={favoriteIds.includes(String(fixtureId)) ? "favorite-button saved" : "favorite-button"} type="button" aria-label={favoriteIds.includes(String(fixtureId)) ? "Maçı favorilerden çıkar" : "Maçı favorilere ekle"} aria-pressed={favoriteIds.includes(String(fixtureId))} onClick={() => onFavorite?.(match)}>♥</button><button className="primary-button compact" type="button" onClick={() => onOpen(match)}>Detaylı analiz <span>→</span></button></div>
  </article>;
}

function bestPredictionToMatch(item) {
  return {
    fixture: { id: item.fixture?.id, date: item.fixture?.date },
    league: { name: item.fixture?.league, country: item.fixture?.country },
    teams: { home: item.fixture?.home, away: item.fixture?.away },
  };
}

function PerformanceCard({ performance }) {
  const archive = performance?.archive || performance; const completed = archive?.verified || 0;
  return <section className="performance-card"><div><span className="eyebrow">📊 MODEL PERFORMANSI</span><h3>{completed ? `Son ${Math.min(completed, 100)} gerçek sonuç` : "Henüz yeterli tamamlanmış tahmin bulunmuyor."}</h3><p>{completed ? "Tamamlanmış gerçek fixture sonuçlarından hesaplanır." : "Arşivde sonuçlanan tahminler oluştuğunda performans burada hesaplanacak."}</p></div><strong>{completed && Number.isFinite(archive.successRate) ? `%${archive.successRate}` : "—"}</strong></section>;
}

function HomeView({ loading, matches, selectedDate, bestPredictions, analysisCache, onOpen, onFavorite, onShowMatches, favoriteIds }) {
  const strongest = bestPredictions
    .filter((item) => item.eligible === true && Number.isFinite(Number(item.dataQuality?.score)) && Number(item.dataQuality.score) >= 45 && Number.isFinite(Number(item.confidence)) && Number(item.confidence) >= 50 && item.prediction?.market && !["NO_BET", "NO BET"].includes(item.prediction.market))
    .slice(0, 3);
  const bestById = new Map(bestPredictions.map((item) => [String(item.fixture?.id), item]));
  const selectedLabel = formatDate(parseDateKey(selectedDate));

  return <div className="view-stack home-view">
    <section className="home-simple-hero">
      <span className="eyebrow accent">ZEUS AI · MAÇ ANALİZİ</span>
      <h1>Futbolu <em>veriyle</em> yorumla.</h1>
      <p>Günün maçları, model olasılıkları ve veri kalitesi tek ekranda. Tahmin yalnızca gerçek analiz verisi mevcut olduğunda gösterilir.</p>
      <div className="home-hero-meta"><span>{selectedLabel}</span><span>{loading ? "Maçlar yükleniyor…" : `${matches.length} maç listelendi`}</span></div>
    </section>

    <section className="home-quick-actions" aria-label="Hızlı erişim">
      <button type="button" className="home-quick-action primary" onClick={onShowMatches}><span className="home-quick-icon">▦</span><span><strong>Bugünün tüm maçları</strong><small>{loading ? "Fikstür yükleniyor…" : `${matches.length} karşılaşma · tarih ve lig filtresi`}</small></span><b>→</b></button>
      <div className="home-quick-stats"><div><strong>{new Set(matches.map(match => match?.league?.id).filter(Boolean)).size}</strong><span>Lig</span></div><div><strong>{new Set(matches.flatMap(match => [match?.teams?.home?.id, match?.teams?.away?.id]).filter(Boolean)).size}</strong><span>Takım</span></div><div><strong>{strongest.length}</strong><span>Doğrulanmış seçim</span></div></div>
    </section>
    <section className="home-section">
      <SectionHeading eyebrow="GERÇEK VERİ" title="Tahminler" action={<span className="home-section-note">{strongest.length} uygun maç</span>} />
      <div className="card-list">
        {strongest.length ? strongest.map((item) => <MatchCard key={item.fixture?.id} match={bestPredictionToMatch(item)} summary={item} onOpen={onOpen} onFavorite={onFavorite} favoriteIds={favoriteIds} featured />) : <EmptyState icon="✦" title="Şimdilik doğrulanabilir seçim yok" text="Sadece veri kalitesi ve model koşullarını karşılayan gerçek maç analizleri burada gösterilir. Uygun maç yoksa sistem tahmin uydurmaz." />}
      </div>
    </section>

    <Monetization showRewarded />

    <section className="home-section home-all-matches">
      <div className="home-all-matches-copy">
        <strong>Diğer maçları mı arıyorsun?</strong>
        <span>Fikstürü aç, tarih ve liglere göre filtrele.</span>
      </div>
      <button className="primary-button compact" type="button" onClick={onShowMatches}>Tüm maçları gör <span>→</span></button>
    </section>

    <p className="home-disclaimer">Gösterilen yüzdeler model tahmin olasılıklarıdır; garanti değildir. Eksik veya doğrulanamayan olasılıklar gizlenir. “Model güveni”, maçın kazanılma olasılığıyla aynı şey değildir.</p>
  </div>;
}

function PerformanceView({ performance }) {
  const hasCompleted = Boolean(performance?.completed);
  const marketEntries = Object.entries(performance?.marketPerformance || {});
  const confidenceEntries = Object.entries(performance?.confidencePerformance || {});
  return <div className="view-stack"><SectionHeading eyebrow="GERÇEK SONUÇLAR" title="📊 Tahmin Performansı" action={<span className="date-chip">Model {performance?.modelVersions?.join(", ") || "3.0"}</span>} />{!hasCompleted ? <EmptyState icon="📊" title="Henüz yeterli geçmiş veri yok" text="Tamamlanan ve gerçek sonucu API-Football'dan doğrulanan tahminler geldikçe performans burada hesaplanacak." /> : <><div className="performance-summary"><Metric label="Toplam tahmin" value={performance.completed} /><Metric label="Başarılı" value={performance.successful} /><Metric label="Başarısız" value={performance.failed} /><Metric label="Başarı oranı" value={`%${performance.successRate}`} /></div><section className="performance-section"><SectionHeading eyebrow="MARKET BAZLI" title="Market performansı" />{marketEntries.map(([market, stats]) => <PerformanceBar key={market} label={market} stats={stats} />)}</section><section className="performance-section"><SectionHeading eyebrow="KALİBRASYON" title="Güven vs başarı" />{confidenceEntries.map(([group, stats]) => <PerformanceBar key={group} label={`Güven ${group}`} stats={stats} />)}</section><section className="performance-section"><SectionHeading eyebrow="VALUE" title="Pozitif value performansı" />{performance.valuePerformance.total ? <PerformanceBar label="Pozitif value" stats={performance.valuePerformance} /> : <p className="muted-note">Gerçek bookmaker oranı bulunan value tahmini henüz yok.</p>}</section><section className="performance-section"><SectionHeading eyebrow="SON DÖNEM" title="Son 10 / 50 / 100" />{[10, 50, 100].map((limit) => <PerformanceBar key={limit} label={`Son ${limit} tahmin`} stats={performance.recent?.[limit]} />)}</section><section className="performance-section"><SectionHeading eyebrow="GEÇMİŞ TAHMİNLER" title="Son kayıtlar" />{performance.history?.length ? <div className="history-table">{performance.history.slice(0, 20).map((record) => <div className="history-row" key={`${record.fixtureId}-${record.market}`}><span>{formatDate(record.date)}</span><span>{record.homeTeam || record.home} - {record.awayTeam || record.away}</span><strong>{record.market}</strong><span>%{record.confidence}</span><span>{record.result || "Bekliyor"}</span><b className={record.status === "won" ? "success" : record.status === "lost" ? "failure" : "pending"}>{record.status === "won" ? "✓ Başarılı" : record.status === "lost" ? "✕ Başarısız" : record.status === "no_data" ? "Veri yok" : "Bekliyor"}</b></div>)}</div> : <p className="muted-note">Henüz kayıt yok.</p>}</section></> }</div>;
}

function PerformanceBar({ label, stats = {} }) { return <div className="performance-bar"><div><span>{label}</span><small>{stats.successful || 0}/{stats.total || 0} başarılı</small></div><strong>{Number.isFinite(stats.successRate) ? `%${stats.successRate}` : "—"}</strong></div>; }

function PredictionsView({ matches, analysisCache, market, setMarket, minConfidence, setMinConfidence, onOpen }) { const visible = matches.filter((match) => { const data = analysisCache[match.fixture?.id]; if (!data && market !== "all") return false; return !data || Number(data.model?.confidence || 0) >= Number(minConfidence); }); return <div className="view-stack"><SectionHeading eyebrow="AI MOTORU" title="Tahmin merkezinde" action={<span className="live-dot-label">● CANLI VERİ</span>} /><div className="filter-scroll">{MARKET_GROUPS.map((item) => <button key={item.id} className={market === item.id ? "filter-chip selected" : "filter-chip"} type="button" onClick={() => setMarket(item.id)}>{item.label}</button>)}</div><div className="filter-row"><label>Minimum güven <select value={minConfidence} onChange={(event) => setMinConfidence(event.target.value)}><option value="0">Tümü</option><option value="60">%60+</option><option value="75">%75+</option></select></label><span>{visible.length} maç</span></div>{visible.length ? <div className="card-list">{visible.map((match) => <MatchCard key={match.fixture?.id} match={match} analysis={analysisCache[match.fixture?.id]} onOpen={onOpen} onFavorite={onFavorite} favoriteIds={favoriteIds} />)}</div> : <EmptyState icon="✦" title="Tahminleri görmek için maç seç" text="Maç detayını açtığında model tüm marketleri hesaplar." />}<HistoryPanel /></div>; }

function MatchesView({ selectedDate, groups, openLeagues, setOpenLeagues, search, setSearch, league, setLeague, leagues, onOpen, onFavorite, favoriteIds, loading, analysisCache }) { return <div className="view-stack"><SectionHeading eyebrow="FİKSTÜR" title="Günün maçları" action={<span className="date-chip">{formatDate(parseDateKey(selectedDate))}</span>} /><div className="toolbar"><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Takım veya lig ara" /></div><select value={league} onChange={(event) => setLeague(event.target.value)}>{leagues.map((item) => <option key={item}>{item}</option>)}</select></div>{loading ? <EmptyState title="Maçlar yükleniyor" text="API-Football fikstürü getiriliyor." /> : Object.keys(groups).length ? Object.entries(groups).map(([name, leagueMatches]) => <section className="league-group" key={name}><button className="league-heading" type="button" onClick={() => setOpenLeagues((current) => ({ ...current, [name]: current[name] === false }))}><span><b>{name}</b><small>{leagueMatches[0]?.league?.country || "Uluslararası"} · {leagueMatches.length} maç</small></span><span>{openLeagues[name] === false ? "+" : "−"}</span></button>{openLeagues[name] !== false && <div className="league-matches">{leagueMatches.map((match) => <MatchRow key={match.fixture?.id} match={match} analysis={analysisCache[match.fixture?.id]} onOpen={onOpen} onFavorite={onFavorite} favoriteIds={favoriteIds} />)}</div>}</section>) : <EmptyState title="Maç bulunamadı" text="Filtreleri değiştirerek tekrar deneyin." />}</div>; }
function MatchRow({ match, analysis, onOpen, onFavorite, favoriteIds }) {
  const { home, away } = getTeams(match);
  const bestMarket = analysis?.recommendation?.bestMarket;
  const predictionLabel = analysis?.predictionEligible === false ? "Yetersiz veri" : bestMarket?.market || "—";
  const confidence = analysis?.model?.confidence;
  return <button className="match-row" type="button" onClick={() => onOpen(match)}><span className="row-time">{formatTime(match?.fixture?.date)}</span><span className="row-teams"><b>{home}</b><b>{away}</b></span><span className="row-prediction">{predictionLabel === "—" ? "AI" : Number.isFinite(confidence) ? `%${confidence}` : "AI"}<br /><strong>{predictionLabel}</strong></span><span className={favoriteIds.includes(String(match?.fixture?.id)) ? "row-heart saved" : "row-heart"} onClick={(event) => { event.stopPropagation(); onFavorite(match); }}>♥</span><span className="row-arrow">›</span></button>;
}
function LiveView({ matches, onOpen, analysisCache }) { return <div className="view-stack"><SectionHeading eyebrow="CANLI MERKEZİ" title="Şu an oynananlar" action={<span className="live-dot-label">● LIVE</span>} />{matches.length ? <div className="card-list">{matches.map((match) => { const analysis = analysisCache[match.fixture?.id]; const bestMarket = analysis?.recommendation?.bestMarket; const predictionLabel = analysis?.predictionEligible === false ? "Yetersiz veri" : bestMarket?.market; return <article className="live-card" key={match.fixture?.id} onClick={() => onOpen(match)}><div className="live-minute"><span>● CANLI</span><strong>{match.fixture?.status?.elapsed || "--"}'</strong></div><div className="live-teams"><b>{getTeams(match).home}</b><strong>{match.goals?.home ?? "—"} : {match.goals?.away ?? "—"}</strong><b>{getTeams(match).away}</b></div><small>{match?.league?.name}</small>{predictionLabel && <div className="prediction-strip"><div><span className="field-label">EN GÜÇLÜ TAHMİN</span><strong>{predictionLabel}</strong></div><div><span className="field-label">MODEL GÜVENİ</span><ConfidenceBadge confidence={analysis?.model?.confidence} /></div></div>}</article>; })}</div> : <EmptyState icon="●" title="Şu an canlı maç yok" text="Canlı karşılaşmalar başladığında burada görünecek." />}</div>; }
function FavoritesView({ matches, onOpen, onFavorite, favoriteIds }) { return <div className="view-stack"><SectionHeading eyebrow="KİŞİSEL LİSTEN" title="Favoriler" action={<span className="date-chip">Local kayıt</span>} />{matches.length ? <div className="card-list">{matches.map((match) => <MatchCard key={match.fixture?.id} match={match} onOpen={onOpen} onFavorite={onFavorite} favoriteIds={favoriteIds} />)}</div> : <EmptyState icon="♡" title="Listen henüz boş" text="Maç kartlarındaki kalp ikonuyla favori maçlarını kaydet." />}<div className="favorite-note"><strong>Takım ve lig favorileri</strong><p>Hesap sistemi geldiğinde favori tercihleriniz hesabınızla senkronize edilebilir.</p></div></div>; }
function HistoryPanel() { return <section className="history-panel"><div><span className="eyebrow">GEÇMİŞ TAHMİNLER</span><h3>Model performansı</h3><p>Sonuçlar maçlar tamamlandığında otomatik değerlendirilecek.</p></div><div className="history-empty"><b>—</b><span>Henüz sonuç yok</span></div></section>; }

function MatchDetail({ analysis, match, loading, onBack, onFavorite, favoriteIds }) {
  const fixture = analysis?.fixture; const home = fixture?.home?.name || getTeams(match).home; const away = fixture?.away?.name || getTeams(match).away; const predictions = analysis?.predictions || {};
  const rows = [["1", predictions.homeWin], ["X", predictions.draw], ["2", predictions.awayWin], ["1X", predictions.doubleChance1X], ["X2", predictions.doubleChanceX2], ["12", predictions.doubleChance12], ["Üst 1.5", predictions.over15], ["Alt 1.5", predictions.under15], ["Üst 2.5", predictions.over25], ["Alt 2.5", predictions.under25], ["Üst 3.5", predictions.over35], ["Alt 3.5", predictions.under35], ["KG Var", predictions.bttsYes], ["KG Yok", predictions.bttsNo]];
  const mainKey = analysis?.prediction === "1" ? "homeWin" : analysis?.prediction === "2" ? "awayWin" : "draw";
  return <div className="view-stack detail-view"><button className="back-button" type="button" onClick={onBack}>← Geri dön</button>{loading ? <div className="analysis-loading"><span className="loading-ring" /><h2>ZEUS ONE BETTING analizi hazırlanıyor</h2><p>AI Powered Football Predictions; form, H2H ve gol istatistiklerini birleştiriyor.</p></div> : analysis ? <><section className="detail-hero"><div className="detail-league">{fixture.league} · {fixture.country}</div><div className="detail-teams"><div><span className="big-crest">{home.slice(0, 1)}</span><strong>{home}</strong></div><span className="detail-vs">VS<br /><small>{formatTime(fixture.date)}</small></span><div><span className="big-crest">{away.slice(0, 1)}</span><strong>{away}</strong></div></div><button className={favoriteIds.includes(String(fixture.id)) ? "favorite-button saved large" : "favorite-button large"} type="button" onClick={() => onFavorite?.(match)}>♥</button></section><section className="best-pick"><div className="best-pick-head"><span className="eyebrow accent">✦ EN MANTIKLI TAHMİN</span><ConfidenceBadge confidence={analysis.model?.confidence} /></div><h2>{analysis.prediction === "1" ? "Ev sahibi kazanır" : analysis.prediction === "2" ? "Deplasman kazanır" : "Beraberlik"}</h2><div className="pick-metrics"><Metric label="Model" value={pct(predictions[mainKey])} /><Metric label="Adil oran" value={fairOdds(predictions[mainKey])} /><Metric label="Bahis oranı" value="—" /><Metric label="Value" value="—" /></div><p className="muted-note">Gerçek bookmaker oranı bu veri kaynağında bulunmadığı için oran ve value hesaplanmadı.</p></section><section className="detail-section"><SectionHeading eyebrow="MARKETLER" title="Tahmin tablosu" /><div className="market-table"><div className="table-head"><span>Market</span><span>Model</span><span>Oran</span><span>Adil</span><span>Value</span></div>{rows.map(([label, value]) => <div className="table-row" key={label}><span>{label}</span><strong>{pct(value)}</strong><span>—</span><span>{fairOdds(value)}</span><span>—</span></div>)}</div></section><TeamStats analysis={analysis} home={home} away={away} /><DataSources /></> : <EmptyState title="Analiz bulunamadı" text="ZEUS ONE BETTING bu maç için veri alamadı." />}</div>;
}
function Metric({ label, value }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function TeamStats({ analysis, home, away }) { const homeForm = analysis.homeForm || {}; const awayForm = analysis.awayForm || {}; const homeStats = analysis.statistics?.home || {}; const awayStats = analysis.statistics?.away || {}; const rows = [["Son 5 maç", homeForm.form?.slice(0, 5).join(" ") || "—", awayForm.form?.slice(0, 5).join(" ") || "—"], ["Son 10 maç", homeForm.form?.join(" ") || "—", awayForm.form?.join(" ") || "—"], ["Gol ortalaması", homeForm.averageGoalsFor?.toFixed?.(2) || "—", awayForm.averageGoalsFor?.toFixed?.(2) || "—"], ["Yenilen gol", homeForm.averageGoalsAgainst?.toFixed?.(2) || "—", awayForm.averageGoalsAgainst?.toFixed?.(2) || "—"], ["İsabetli şut", homeStats.shotsOnTarget?.toFixed?.(1) || "—", awayStats.shotsOnTarget?.toFixed?.(1) || "—"]]; return <section className="detail-section"><SectionHeading eyebrow="VERİ ODAĞI" title="Takım karşılaştırması" /><div className="comparison-card"><div className="comparison-head"><b>{home}</b><span>Ev sahibi · Deplasman</span><b>{away}</b></div>{rows.map(([label, homeValue, awayValue]) => <div className="comparison-row" key={label}><strong>{homeValue}</strong><span>{label}</span><strong>{awayValue}</strong></div>)}<div className="form-legend"><span><i className="win" /> W galibiyet</span><span><i className="draw" /> D beraberlik</span><span><i className="loss" /> L mağlubiyet</span></div></div><div className="xg-grid"><Metric label={`${home} beklenen gol`} value={`${analysis.expectedGoals?.home ?? "—"} gol`} /><Metric label={`${away} beklenen gol`} value={`${analysis.expectedGoals?.away ?? "—"} gol`} /><Metric label="Tahmini skor" value={`${analysis.estimatedScore?.home ?? "—"} - ${analysis.estimatedScore?.away ?? "—"}`} /></div></section>; }
function DataSources({ analysis }) { const names = { "api-football": "API-Football", openfootball: "OpenFootball", sportmonks: "Sportmonks", "football-data": "football-data.org", thesportsdb: "TheSportsDB" }; const sources = [...new Set(analysis?.fixture?.sourceProviders || analysis?.sourceMetadata?.providers || [])]; return <section className="detail-section"><SectionHeading eyebrow="ŞEFFAFLIK" title="Veri Kaynakları" /><div className="source-list">{sources.length ? sources.map(source => <span key={source}>{names[source] || source}</span>) : <span>Kaynak bilgisi bulunamadı.</span>}</div></section>; }
function ModelMarkets({ analysis }) {
  const groups = [["1X2", ["1", "X", "2"]], ["Double Chance", ["1X", "X2", "12"]], ["Over/Under", ["Üst 1.5", "Alt 1.5", "Üst 2.5", "Alt 2.5", "Üst 3.5", "Alt 3.5"]], ["BTTS", ["KG Var", "KG Yok"]]];
  return <section className="detail-section"><SectionHeading eyebrow={modelLabel(analysis)} title="Market olasılıkları" />{groups.map(([title, keys]) => <div className="probability-group" key={title}><h3>{title}</h3>{keys.map(key => <div className="probability-row" key={key}><span>{key}</span><strong>{pct(analysis.markets?.[key]?.probability)}</strong></div>)}</div>)}<div className="probability-group"><h3>DNB · Beraberlikte iade</h3><div className="probability-row"><span>Ev sahibi</span><strong>{pct(analysis.dnb?.home)}</strong></div><div className="probability-row"><span>Deplasman</span><strong>{pct(analysis.dnb?.away)}</strong></div>{!analysis.dnb && <p className="muted-note">Bu analizde DNB verisi bulunmuyor.</p>}</div></section>;
}

const MARKET_SECTIONS = [["1X2", ["1", "X", "2"]], ["Çifte Şans", ["1X", "X2", "12"]], ["Üst / Alt", ["Üst 1.5", "Alt 1.5", "Üst 2.5", "Alt 2.5", "Üst 3.5", "Alt 3.5"]], ["KG Var / Yok", ["KG Var", "KG Yok"]]];

function ValueLabel({ value }) { if (!Number.isFinite(value)) return <span className="metric-muted">Oran bulunamadı</span>; return <span className={value > 0 ? "value-positive" : value < 0 ? "value-negative" : "metric-muted"}>{value > 0 ? "+" : ""}{value.toFixed(2)}%</span>; }

function MarketOfferRow({ label, market }) {
  const offers = Array.isArray(market?.bookmakerOffers) ? market.bookmakerOffers : [];
  if (!offers.length) return <div className="offer-empty"><b>{label}</b><span>Oran bulunamadı</span></div>;
  return offers.map((offer, index) => {
    const metrics = marketMetrics(market.probability, offer.odd);
    return <div className="offer-row" key={`${label}-${offer.bookmaker || "unknown"}-${index}`}><div><b>{label}</b><small>{offer.bookmaker || "Bookmaker adı yok"} · {offer.market || "Market adı yok"} · {offer.outcome || "Outcome yok"}</small></div><span>{Number(offer.odd).toFixed(2)}</span><span>{pct(market.probability)}</span><span>{metrics.fairOdds?.toFixed(2) || "—"}</span><span>{metrics.impliedProbability ? `%${metrics.impliedProbability.toFixed(2)}` : "—"}</span><ValueLabel value={metrics.value} /></div>;
  });
}

function DataQualityPanel({ dataQuality, modelVersion = "ZEUS AI" }) { const reasons = dataQualityReasons(dataQuality); return <section className="detail-section data-quality-panel"><SectionHeading eyebrow={`İSTATİSTİKSEL MODEL · ${modelVersion}`} title={dataQualityText(dataQuality?.score)} action={<DataQualityBadge quality={dataQuality?.score} label={dataQualityText(dataQuality?.score)} />} /><p>{reasons.length ? reasons.join(" · ") : dataQuality?.missing?.length ? "Bu maç için yeterli istatistik bulunamadı." : "Kalite puanı mevcut model girdilerine dayanır."}</p></section>; }

function MatchNarrative({ analysis, home, away }) {
  if (!analysis || analysis.archived) return null;
  const lines = [];
  const homeForm = analysis.homeForm5 || analysis.homeForm;
  const awayForm = analysis.awayForm5 || analysis.awayForm;
  const homePpg = Number(homeForm?.pointsPerGame);
  const awayPpg = Number(awayForm?.pointsPerGame);
  if (Number.isFinite(homePpg) && Number.isFinite(awayPpg)) {
    if (homePpg > awayPpg + 0.25) lines.push({ kind: "positive", text: `${home}, mevcut form örnekleminde maç başına puan bakımından önde (${homePpg.toFixed(2)} / ${awayPpg.toFixed(2)}).` });
    else if (awayPpg > homePpg + 0.25) lines.push({ kind: "risk", text: `${away}, mevcut form örnekleminde maç başına puan bakımından önde (${awayPpg.toFixed(2)} / ${homePpg.toFixed(2)}).` });
    else lines.push({ kind: "neutral", text: "Son form puanları birbirine yakın; belirgin form üstünlüğü yok." });
  }
  const homeXg = Number(analysis.expectedGoals?.home);
  const awayXg = Number(analysis.expectedGoals?.away);
  if (Number.isFinite(homeXg) && Number.isFinite(awayXg)) {
    const stronger = homeXg > awayXg + 0.2 ? home : awayXg > homeXg + 0.2 ? away : null;
    lines.push({ kind: stronger ? "positive" : "neutral", text: `Model gol beklentisi: ${home} ${homeXg.toFixed(2)} – ${awayXg.toFixed(2)} ${away}. Bu değer doğrudan sağlayıcı xG'si değil, model tahminidir.` });
  }
  const standingsHome = Number(analysis.standings?.home?.rank);
  const standingsAway = Number(analysis.standings?.away?.rank);
  if (Number.isFinite(standingsHome) && Number.isFinite(standingsAway)) {
    lines.push({ kind: "neutral", text: `Lig sıralaması: ${home} ${standingsHome}. sıra, ${away} ${standingsAway}. sıra.` });
  }
  const h2h = analysis.h2h;
  if (Number(h2h?.count) >= 3) {
    lines.push({ kind: "neutral", text: `Karşılıklı maç örneklemi: ${h2h.count} maç. Ev sahibi galibiyeti: ${h2h.homeWins ?? "—"}, beraberlik: ${h2h.draws ?? "—"}, deplasman galibiyeti: ${h2h.awayWins ?? "—"}.` });
  }
  const oddsCount = Object.keys(analysis.bookmakerOdds || {}).length;
  if (oddsCount > 0) {
    const agreement = analysis.sourceAgreement?.status;
    lines.push({ kind: agreement === "low" ? "risk" : "neutral", text: agreement === "low" ? "Model ile mevcut piyasa olasılıkları arasında belirgin fark var; bu fark tek başına değerli bahis kanıtı değildir." : "Gerçek piyasa oranları bulundu; karar öncesi oran zamanı ve marj etkisi kontrol edilmeli." });
  } else {
    lines.push({ kind: "risk", text: "Bu analizde doğrulanmış bookmaker oranı bulunmadığından değer avantajı hesaplanamıyor." });
  }
  const quality = Number(analysis.dataQuality?.score);
  if (Number.isFinite(quality) && quality < 60) lines.push({ kind: "risk", text: "Veri kalitesi sınırlı. Tahmin güveni düşürülmeli; sistemin PAS seçeneğini değerlendirmesi gerekir." });
  if (!analysis.dataAvailability?.injuries || !analysis.dataAvailability?.lineups) {
    lines.push({ kind: "risk", text: "Sakatlık, cezalı oyuncu ve kesin ilk 11 bilgisi bağlı veri kaynaklarında doğrulanmadı; bu başlıklarda varsayım yapılmadı." });
  }
  if (!lines.length) lines.push({ kind: "neutral", text: "Bu maç için açıklanabilir ek sinyal üretmeye yetecek veri bulunamadı." });
  return <section className="detail-section match-narrative">
    <SectionHeading eyebrow="ZEUS AI · MAÇIN GEREKÇESİ" title="Bu tahmin neden çıktı?" />
    <p className="muted-note">Aşağıdaki yorum, maç öncesi istatistiklerden türetilmiştir. Doğrulanmamış haber veya kadro bilgisi gerçekmiş gibi sunulmaz.</p>
    <ul className="narrative-list">{lines.map((line, index) => <li className={`narrative-${line.kind}`} key={index}>{line.text}</li>)}</ul>
  </section>;
}

function MatchNewsPanel({ context, loading }) {
  const articles = Array.isArray(context?.articles) ? context.articles : [];
  return <section className="detail-section match-news-panel">
    <SectionHeading eyebrow="DIŞ KAYNAK · ESPN" title="Takım haberleri ve son gelişmeler" />
    {loading ? <p className="muted-note" role="status">Takımlarla ilişkili haberler kontrol ediliyor…</p>
      : articles.length ? <div className="news-list">{articles.map((article, index) => {
        const text = `${article.headline || ""} ${article.description || ""}`;
        const injuryRelated = /injur|injured|suspend|suspension|ruled out|doubtful|fitness|sakat|ceza|kadro dışı|oynamayacak/i.test(text);
        return <article className="news-item" key={article.url || `${article.headline}-${index}`}>
          <div className="news-item-meta"><span>{injuryRelated ? "Sakatlık / kadro haberi olabilir" : "Takım haberi"}</span>{article.published && <time dateTime={article.published}>{new Date(article.published).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time>}</div>
          <h3>{article.headline}</h3>
          {article.description && <p>{article.description}</p>}
          {article.url && <a href={article.url} target="_blank" rel="noreferrer">Kaynağı aç ↗</a>}
        </article>;
      })}</div>
      : <p className="muted-note">{context?.available ? "ESPN'de bu iki takımla doğrudan eşleşen güncel haber bulunamadı." : "Bu lig için haber verisi alınamadı. Sakatlık veya ilk 11 bilgisi doğrulanmış kabul edilmiyor."}</p>}
    <p className="muted-note">Haber başlığı tek başına oyuncunun maçta kesin oynayıp oynamayacağını kanıtlamaz. Resmî kadro ve sakatlık teyidi ayrı değerlendirilmelidir.</p>
  </section>;
}

function MatchDetailV2({ analysis: response, match, loading, onBack, onFavorite, favoriteIds }) {
  const analysis = selectModelAnalysis(response);
  const fixture = analysis?.fixture; const home = fixture?.home?.name || getTeams(match).home; const away = fixture?.away?.name || getTeams(match).away;
  const best = analysis?.recommendation?.bestMarket;
  const [newsContext, setNewsContext] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  useEffect(() => {
    if (!fixture?.id) { setNewsContext(null); return undefined; }
    let cancelled = false;
    setNewsLoading(true);
    readFrontendJson(`${API_BASE}/api/match-context/${encodeURIComponent(fixture.id)}`)
      .then(data => { if (!cancelled) setNewsContext(data?.context || null); })
      .catch(() => { if (!cancelled) setNewsContext({ provider: "ESPN", available: false, reason: "provider_unavailable", articles: [] }); })
      .finally(() => { if (!cancelled) setNewsLoading(false); });
    return () => { cancelled = true; };
  }, [fixture?.id]);
  return <div className="view-stack detail-view"><button className="back-button" type="button" onClick={onBack}>← Geri dön</button>{loading ? <div className="analysis-loading" role="status"><span className="loading-ring" /><h2>Analiz hazırlanıyor</h2><p>Gerçek geçmiş maçlar ve mevcut istatistikler değerlendiriliyor.</p></div> : analysis ? <><ModelSelector response={response} selected={analysis.modelVersion || MODEL40} /><section className="detail-hero"><div className="detail-league">{fixture.league} · {formatDate(fixture.date)} · {formatTime(fixture.date)}</div><div className="detail-teams"><div><span className="big-crest">{home.slice(0, 1)}</span><strong>{home}</strong></div><span className="detail-vs">VS</span><div><span className="big-crest">{away.slice(0, 1)}</span><strong>{away}</strong></div></div><button className={favoriteIds.includes(String(fixture.id)) ? "favorite-button saved large" : "favorite-button large"} aria-label="Favori durumunu değiştir" aria-pressed={favoriteIds.includes(String(fixture.id))} type="button" onClick={() => onFavorite?.(match)}>♥</button></section>{analysis.archived && <p className="muted-note">Kayıtlı maç öncesi tahmin gösteriliyor.</p>}<MatchNarrative analysis={analysis} home={home} away={away} /><MatchNewsPanel context={newsContext} loading={newsLoading} /><DataQualityPanel dataQuality={analysis.dataQuality} modelVersion="ZEUS AI" />{analysis.predictionEligible === false ? <EmptyState title="Yetersiz Veri / Tahmin Yok" text="Bu maç için yeterli istatistik bulunamadı." /> : <section className="best-pick"><span className="eyebrow">EN GÜÇLÜ TAHMİN</span><h2>{best?.market || "Analiz henüz hazır değil."}</h2><div className="pick-metrics"><Metric label="Tahmin olasılığı" value={pct(best?.probability)} /><Metric label="Model güveni" value={pct(analysis.model?.confidence)} /><Metric label="Data Quality" value={analysis.dataQuality?.score == null ? "—" : `${analysis.dataQuality.score}/100`} /></div></section>}<ModelMarkets analysis={analysis} /><section className="detail-section"><SectionHeading eyebrow="GERÇEK ORANLAR" title="Bookmaker karşılaştırması" /><div className="offer-table"><div className="offer-head"><span>Market / Kaynak</span><span>Oran</span><span>Model</span><span>Adil</span><span>İma</span><span>Value</span></div>{MARKET_SECTIONS.map(([title, markets]) => <section className="offer-section" key={title}><h3>{title}</h3>{markets.map(name => <MarketOfferRow key={name} label={name} market={analysis.markets?.[name]} />)}</section>)}</div></section><HistoricalStatistics profile={analysis.statisticsProfile} home={home} away={away} statistics={analysis.statistics} /><TeamStats analysis={analysis} home={home} away={away} /><DataSources analysis={analysis} /></> : <EmptyState title="Analiz henüz hazır değil." text="Maçı yeniden açarak tekrar deneyebilirsiniz." />}</div>;
}

function PredictionsViewV2({ onFavorite, favoriteIds, matches, analysisCache, market, setMarket, minConfidence, setMinConfidence, onOpen }) {
  const visible = matches.filter((match) => { const data = analysisCache[match.fixture?.id]; return data?.predictionEligible === true && Number(data.model?.confidence || 0) >= Number(minConfidence) && matchesMarketFilter(data, market); });
  return <div className="view-stack"><SectionHeading eyebrow="İSTATİSTİKSEL MODEL" title="Tahmin merkezi" action={<span className="live-dot-label">VERİ ODAKLI</span>} /><div className="filter-scroll">{MARKET_GROUPS.map((item) => <button key={item.id} className={market === item.id ? "filter-chip selected" : "filter-chip"} type="button" onClick={() => setMarket(item.id)}>{item.label}</button>)}</div><div className="filter-row"><label>Minimum güven <select value={minConfidence} onChange={(event) => setMinConfidence(event.target.value)}><option value="0">Tümü</option><option value="60">%60+</option><option value="75">%75+</option></select></label><span>{visible.length} analiz</span></div>{visible.length ? <div className="card-list">{visible.map((match) => <MatchCard key={match.fixture?.id} match={match} analysis={analysisCache[match.fixture?.id]} onOpen={onOpen} onFavorite={onFavorite} favoriteIds={favoriteIds} />)}</div> : <EmptyState icon="✦" title="Bu filtre için analiz yok" text="Gerçek analizler ve kayıtlı tahminler burada gösterilir." />}</div>;
}

function ArchivePerformanceView({ performance }) {
  const archive = performance?.archive || performance; const completed = archive?.verified || 0;
  return <div className="view-stack"><SectionHeading eyebrow="GERÇEK SONUÇLAR" title="Tahmin Performansı" action={<span className="date-chip">ZEUS AI</span>} />{!completed ? <EmptyState icon="📊" title="Henüz yeterli tamamlanmış tahmin bulunmuyor." text="Yalnızca arşivdeki tamamlanmış gerçek fixture sonuçları performansa dahil edilir." /> : <><div className="performance-summary"><Metric label="Toplam doğrulanmış tahmin" value={completed} /><Metric label="Başarılı" value={archive.successful} /><Metric label="Başarısız" value={archive.failed} /><Metric label="Başarı oranı" value={Number.isFinite(archive.successRate) ? `%${archive.successRate}` : "—"} /></div><section className="detail-section"><SectionHeading eyebrow="DOĞRULANMIŞ SONUÇLAR" title="Market bazlı sonuçlar" />{Object.entries(archive.marketPerformance || {}).map(([name, metrics]) => <div className="probability-row" key={name}><span>{name} · {metrics.total ?? 0} sonuç</span><strong>{metrics.total > 0 && Number.isFinite(metrics.accuracy) ? pct(metrics.accuracy * 100) : "—"}</strong></div>)}</section><p className="muted-note">Yalnızca doğrulanmış sonuçlar kullanılır.</p></>}</div>;
}

export default App;
