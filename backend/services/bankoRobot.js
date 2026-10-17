"use strict";
// ZEUS Motor v2 (served through the Banko robot API).
//
// Every fixture of the day gets a prediction: 1X2 probabilities plus the single
// most likely market among double chance / goals markets, with a confidence tier
// whose hit rate was measured on a locked 2023-2026 test period the model never
// saw (docs/engine-v2-backtest.json). Features use only results from days
// strictly before the target day:
//   * form / home-away splits / H2H / league rates (same as the archive builder)
//   * Elo ratings per league (K=20, home advantage 60), frozen per day.
// History comes from OpenFootball (4 seasons) plus recent finished results from
// the live providers. Leagues outside the archive are built from provider results
// only; they have no long-term validation, so their tier is capped at "orta".
const path = require("node:path");
const fs = require("node:fs");
const { LEAGUES, fetchSeason, makeFeatures, teamRecord } = require("../scripts/buildHistoricalFeatureArchive");
const { fuzzyTeamKey } = require("./localDayFixtures");
const { teamKey, normalizeStatus } = require("./fixtureNormalization");

const MODEL_PATH = path.join(__dirname, "..", "data", "engine-v2.json");
const CURRENT_TTL_MS = 3 * 60 * 60 * 1000;
const PAST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEASONS_BACK = 3;
const SUPPLEMENT_DAYS = 75;
const CHECK_DAYS = 30;
const DYNAMIC_MIN_MATCHES = 30;

const MARKETS = {
  "1": { label: "MS 1 · Ev sahibi kazanır", short: "MS 1", hit: (h, a) => h > a },
  "X": { label: "MS X · Beraberlik", short: "MS X", hit: (h, a) => h === a },
  "2": { label: "MS 2 · Deplasman kazanır", short: "MS 2", hit: (h, a) => h < a },
  "1X": { label: "1X · Ev sahibi kaybetmez", short: "1X", hit: (h, a) => h >= a },
  "X2": { label: "X2 · Deplasman kaybetmez", short: "X2", hit: (h, a) => h <= a },
  "12": { label: "12 · Beraberlik olmaz", short: "12", hit: (h, a) => h !== a },
  "O1.5": { label: "1.5 Üst", short: "1.5 ÜST", hit: (h, a) => h + a >= 2 },
  "O2.5": { label: "2.5 Üst", short: "2.5 ÜST", hit: (h, a) => h + a >= 3 },
  "U2.5": { label: "2.5 Alt", short: "2.5 ALT", hit: (h, a) => h + a <= 2 },
  "U3.5": { label: "3.5 Alt", short: "3.5 ALT", hit: (h, a) => h + a <= 3 },
  "BTTS": { label: "Karşılıklı gol var", short: "KG VAR", hit: (h, a) => h > 0 && a > 0 },
  "NOBTTS": { label: "Karşılıklı gol yok", short: "KG YOK", hit: (h, a) => !(h > 0 && a > 0) },
};
const TIER_ORDER = ["banko", "guclu", "orta", "zayif"];
const TIER_LABEL = { banko: "BANKO", guclu: "GÜÇLÜ", orta: "ORTA", zayif: "ZAYIF" };

let cachedModel = null;
function loadModel(file = MODEL_PATH) {
  if (cachedModel && cachedModel.file === file) return cachedModel.model;
  const model = JSON.parse(fs.readFileSync(file, "utf8"));
  cachedModel = { file, model };
  return model;
}

function seasonOf(dateKey) {
  const [year, month] = dateKey.split("-").map(Number);
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
function previousSeason(season, back) {
  const start = Number(season.slice(0, 4)) - back;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
function shiftDate(dateKey, days) { return new Date(Date.parse(`${dateKey}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10); }
const sigmoid = value => 1 / (1 + Math.exp(-value));
// Yield to the event loop so HTTP requests keep being served during long work
// (Render's free instance has a fraction of one CPU).
const yieldToLoop = () => new Promise(resolve => setImmediate(resolve));

// Team-name normalisation is regex heavy; memoise it.
const keyMemo = new Map(), fuzzyMemo = new Map();
function cachedKey(name) { let value = keyMemo.get(name); if (value === undefined) { value = teamKey(name); if (keyMemo.size > 50_000) keyMemo.clear(); keyMemo.set(name, value); } return value; }
function cachedFuzzy(name) { let value = fuzzyMemo.get(name); if (value === undefined) { value = fuzzyTeamKey(name); if (fuzzyMemo.size > 50_000) fuzzyMemo.clear(); fuzzyMemo.set(name, value); } return value; }
function fuzzyMatch(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 4 && longer.includes(shorter);
}
// Per-league team index, rebuilt only when the league's match list grows.
const indexCache = new WeakMap();
function teamIndex(matches) {
  const hit = indexCache.get(matches);
  if (hit && hit.length === matches.length) return hit.index;
  const names = new Set();
  for (const match of matches) { names.add(match.home); names.add(match.away); }
  const byKey = new Map(), fuzzy = [];
  for (const name of names) { const key = cachedKey(name); if (!byKey.has(key)) byKey.set(key, name); fuzzy.push([cachedFuzzy(name), name]); }
  const index = { names, byKey, fuzzy };
  indexCache.set(matches, { length: matches.length, index });
  return index;
}

function vectorize(model, features) {
  return model.columns.map((column, index) => {
    const missing = column.endsWith("__missing");
    const name = missing ? column.slice(0, -"__missing".length) : column;
    const raw = features[name];
    const absent = raw === null || raw === undefined || !Number.isFinite(Number(raw));
    const value = missing ? (absent ? 1 : 0) : (absent ? model.medians[name] : Number(raw));
    return (value - model.mean[index]) / model.scale[index];
  });
}
const dot = (coef, vector) => coef.reduce((sum, value, index) => sum + value * vector[index], 0);

// Probabilities for every market from one feature vector.
function marketProbabilities(model, features) {
  const vector = vectorize(model, features);
  const logits = model.oneXTwo.coef.map((coef, k) => model.oneXTwo.intercept[k] + dot(coef, vector));
  const max = Math.max(...logits);
  const exp = logits.map(value => Math.exp(value - max));
  const total = exp.reduce((sum, value) => sum + value, 0);
  const [away, draw, home] = exp.map(value => value / total); // classes ["2","X","1"]
  const goal = Object.fromEntries(Object.entries(model.goals).map(([name, spec]) => [name, sigmoid(spec.intercept + dot(spec.coef, vector))]));
  return {
    "1": home, "X": draw, "2": away, "1X": home + draw, "X2": away + draw, "12": home + away,
    "O1.5": goal["O1.5"], "O2.5": goal["O2.5"], "U2.5": 1 - goal["O2.5"], "U3.5": goal["U3.5"], "BTTS": goal.BTTS, "NOBTTS": 1 - goal.BTTS,
  };
}

function tierFor(model, probability, validated) {
  const t = model.thresholds;
  const tier = t.banko != null && probability >= t.banko ? "banko" : t.guclu != null && probability >= t.guclu ? "guclu" : t.orta != null && probability >= t.orta ? "orta" : "zayif";
  return validated || TIER_ORDER.indexOf(tier) >= 2 ? tier : "orta";
}

// ---------- league state (team histories + Elo), strictly before `beforeDate` ----------
function eloMultiplier(goalDiff) { const gd = Math.abs(goalDiff); return gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8; }

function leagueState(matches, beforeDate, eloParams = { k: 20, home: 60, init: 1500 }) {
  const histories = new Map(), meetings = new Map(), league = [], elo = new Map();
  const prior = matches.filter(match => match.date < beforeDate).sort((a, b) => a.date.localeCompare(b.date));
  for (const match of prior) {
    const home = { ...teamRecord(match, match.home, "home"), venue: "home" };
    const away = { ...teamRecord(match, match.away, "away"), venue: "away" };
    if (!histories.has(match.home)) histories.set(match.home, []);
    if (!histories.has(match.away)) histories.set(match.away, []);
    histories.get(match.home).push(home); histories.get(match.away).push(away);
    const pair = match.home < match.away ? `${match.home}::${match.away}` : `${match.away}::${match.home}`;
    if (!meetings.has(pair)) meetings.set(pair, []);
    meetings.get(pair).push(match);
    league.push(match);
    // Elo: a day's matches never see each other's results because they are all < beforeDate
    // and the target day is excluded; updating sequentially inside a past day is harmless.
    const h = elo.get(match.home) ?? eloParams.init, a = elo.get(match.away) ?? eloParams.init;
    const expected = 1 / (1 + 10 ** ((a - h - eloParams.home) / 400));
    const score = match.homeGoals > match.awayGoals ? 1 : match.homeGoals === match.awayGoals ? 0.5 : 0;
    const delta = eloParams.k * eloMultiplier(match.homeGoals - match.awayGoals) * (score - expected);
    elo.set(match.home, h + delta); elo.set(match.away, a - delta);
  }
  return { histories, meetings, league, elo, eloParams };
}

function featuresFor(state, home, away) {
  const pair = home < away ? `${home}::${away}` : `${away}::${home}`;
  const features = makeFeatures({ home, away }, state.histories.get(home) || [], state.histories.get(away) || [], state.meetings.get(pair) || [], state.league);
  const eh = state.elo.get(home) ?? state.eloParams.init, ea = state.elo.get(away) ?? state.eloParams.init;
  return { ...features, elo_home: eh, elo_away: ea, elo_diff: eh - ea + state.eloParams.home };
}

function predictMatch(model, state, home, away, { validated = true } = {}) {
  const features = featuresFor(state, home, away);
  if ((features.home_last5_matches || 0) < model.minHistory || (features.away_last5_matches || 0) < model.minHistory) return { eligible: false, reason: "insufficient_history" };
  const probabilities = marketProbabilities(model, features);
  const best = model.candidates.map(market => ({ market, probability: probabilities[market] })).sort((a, b) => b.probability - a.probability)[0];
  const ms = ["1", "X", "2"].map(market => ({ market, probability: probabilities[market] })).sort((a, b) => b.probability - a.probability)[0];
  return { eligible: true, probabilities, best, ms, tier: tierFor(model, best.probability, validated) };
}

class BankoRobot {
  constructor({ fetcher = fetchSeason, recentResults = null, now = () => Date.now(), modelFile = MODEL_PATH, leagues = Object.keys(LEAGUES), cacheFile = null } = {}) {
    this.fetcher = fetcher; this.recentResults = recentResults; this.now = now; this.modelFile = modelFile; this.leagues = leagues;
    this.seasonCache = new Map(); this.dayCache = new Map(); this.resultCache = new Map(); this.cacheFile = cacheFile;
    this.loadDayCache();
  }

  model() { return loadModel(this.modelFile); }

  // Finished provider days survive restarts (Render restarts wipe memory, not always the disk).
  loadDayCache() {
    if (!this.cacheFile) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.cacheFile, "utf8"));
      for (const [day, matches] of Object.entries(saved || {})) if (Array.isArray(matches)) this.dayCache.set(day, { at: this.now(), matches, settled: true });
    } catch { /* first start or unreadable cache: rebuild from providers */ }
  }
  saveDayCache() {
    if (!this.cacheFile) return;
    try {
      const today = new Date(this.now()).toISOString().slice(0, 10);
      const settled = Object.fromEntries([...this.dayCache].filter(([day, value]) => value.matches && day < shiftDate(today, -1)).map(([day, value]) => [day, value.matches]));
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFileSync(`${this.cacheFile}.tmp`, JSON.stringify(settled)); fs.renameSync(`${this.cacheFile}.tmp`, this.cacheFile);
    } catch (error) { console.warn(JSON.stringify({ type: "ENGINE_CACHE_SAVE_FAILED", error: error.message })); }
  }

  async resultsForDay(day) {
    const hit = this.dayCache.get(day);
    const today = new Date(this.now()).toISOString().slice(0, 10);
    const settledDay = day < shiftDate(today, -1);
    if (hit?.matches && (hit.settled && settledDay)) return hit.matches;
    const ttl = settledDay ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
    if (hit?.matches && this.now() - hit.at < ttl) return hit.matches;
    if (hit?.pending) return hit.pending;
    const pending = Promise.resolve().then(() => this.recentResults(day)).then(list => {
      const matches = (Array.isArray(list) ? list : []).filter(match => normalizeStatus(match?.fixture?.status?.short) === "FINISHED"
        && Number.isInteger(match?.goals?.home) && Number.isInteger(match?.goals?.away))
        .map(match => ({ date: String(match.fixture.date || day).slice(0, 10), home: match.teams?.home?.name, away: match.teams?.away?.name, homeGoals: match.goals.home, awayGoals: match.goals.away, league: match.league?.name || "", country: match.league?.country || "" }))
        .filter(match => match.home && match.away);
      this.dayCache.set(day, { at: this.now(), matches, settled: settledDay && matches.length > 0 });
      return matches;
    }).catch(() => { this.dayCache.set(day, { at: this.now(), matches: hit?.matches || [] }); return hit?.matches || []; });
    this.dayCache.set(day, { ...(hit || {}), pending });
    return pending;
  }

  async season(league, season, current) {
    const key = `${league}|${season}`;
    const hit = this.seasonCache.get(key);
    const ttl = current ? CURRENT_TTL_MS : PAST_TTL_MS;
    if (hit?.matches && this.now() - hit.at < ttl) return hit.matches;
    if (hit?.pending) return hit.pending;
    const pending = Promise.resolve(this.fetcher(league, season)).then(result => {
      const matches = result?.status === "downloaded" ? result.matches : (hit?.matches || []);
      this.seasonCache.set(key, { at: this.now(), matches });
      return matches;
    }).catch(() => { this.seasonCache.set(key, { at: this.now(), matches: hit?.matches || [] }); return hit?.matches || []; });
    this.seasonCache.set(key, { ...(hit || {}), pending });
    return pending;
  }

  async leagueMatches(league, dateKey) {
    const current = seasonOf(dateKey);
    const seasons = [current, ...Array.from({ length: SEASONS_BACK }, (_, index) => previousSeason(current, index + 1))];
    const lists = await Promise.all(seasons.map((season, index) => this.season(league, season, index === 0)));
    const seen = new Set();
    return lists.flat().filter(match => { const key = `${match.date}|${match.home}|${match.away}`; if (seen.has(key)) return false; seen.add(key); return true; });
  }

  // Map name: archive league -> matches; plus dynamic provider leagues ("dyn:<country>|<league>").
  async history(dateKey) {
    const entries = [];
    for (let index = 0; index < this.leagues.length; index += 6) {
      const batch = this.leagues.slice(index, index + 6);
      entries.push(...await Promise.all(batch.map(async league => [league, await this.leagueMatches(league, dateKey)])));
    }
    const history = new Map(entries.filter(([, matches]) => matches.length).map(([league, matches]) => [league, [...matches]]));
    this.lastSupplement = await this.supplement(history, dateKey);
    return history;
  }

  async supplement(history, dateKey) {
    if (!this.recentResults) return { days: 0, added: 0, dynamicLeagues: 0 };
    const lastArchive = new Map([...history].map(([league, matches]) => [league, matches.reduce((max, match) => match.date > max ? match.date : max, "")]));
    const archiveLeagues = new Map(history);
    let added = 0;
    const dynamic = new Map();
    for (let offset = SUPPLEMENT_DAYS; offset >= 1; offset -= 3) {
      const days = [offset, offset - 1, offset - 2].filter(value => value >= 1).map(value => shiftDate(dateKey, -value));
      const lists = await Promise.all(days.map(day => this.resultsForDay(day)));
      await yieldToLoop();
      for (const match of lists.flat()) {
        if (!match.date || match.date >= dateKey) continue;
        const resolved = BankoRobot.resolve(archiveLeagues, match.home, match.away);
        if (resolved) {
          if (match.date <= lastArchive.get(resolved.league)) continue;
          const list = history.get(resolved.league);
          if (list.some(item => item.home === resolved.home && item.away === resolved.away && Math.abs(Date.parse(item.date) - Date.parse(match.date)) <= 2 * 86_400_000)) continue;
          list.push({ date: match.date, home: resolved.home, away: resolved.away, homeGoals: match.homeGoals, awayGoals: match.awayGoals, league: resolved.league, source: "live-provider" });
          added += 1;
        } else {
          const key = `dyn:${match.country}|${match.league}`;
          const list = dynamic.get(key) || [];
          if (!list.some(item => item.home === match.home && item.away === match.away && item.date === match.date)) list.push({ ...match, source: "live-provider" });
          dynamic.set(key, list);
        }
      }
    }
    let dynamicLeagues = 0;
    for (const [key, list] of dynamic) if (list.length >= DYNAMIC_MIN_MATCHES) { history.set(key, list); dynamicLeagues += 1; }
    this.saveDayCache();
    return { days: SUPPLEMENT_DAYS, added, dynamicLeagues };
  }

  // Find league + history team names for a fixture. Archive leagues first (fuzzy
  // names), then dynamic provider leagues (exact provider names, same league).
  static resolve(historyByLeague, homeName, awayName, leagueName = null, country = null) {
    if (!homeName || !awayName) return null;
    const homeKey = cachedKey(homeName), awayKey = cachedKey(awayName);
    const homeFuzzy = cachedFuzzy(homeName), awayFuzzy = cachedFuzzy(awayName);
    let best = null;
    for (const [league, matches] of historyByLeague) {
      const dynamicLeague = league.startsWith("dyn:");
      if (dynamicLeague && leagueName && league !== `dyn:${country || ""}|${leagueName}`) continue;
      const index = teamIndex(matches);
      const find = (name, key, fuzzy) => {
        if (index.names.has(name)) return name;
        if (index.byKey.has(key)) return index.byKey.get(key);
        if (dynamicLeague) return null;
        const found = index.fuzzy.find(([candidate]) => fuzzyMatch(candidate, fuzzy));
        return found ? found[1] : null;
      };
      const home = find(homeName, homeKey, homeFuzzy);
      if (!home) continue;
      const away = find(awayName, awayKey, awayFuzzy);
      if (!away || home === away) continue;
      const exact = Number(cachedKey(home) === homeKey) + Number(cachedKey(away) === awayKey) + (dynamicLeague ? 0 : 0.5);
      if (!best || exact > best.exact) best = { league, home, away, exact, validated: !dynamicLeague };
    }
    return best;
  }

  async cachedPicks(dateKey, loadDayMatches, todayKey) {
    const ttl = dateKey >= todayKey ? 10 * 60 * 1000 : 6 * 60 * 60 * 1000;
    const hit = this.resultCache.get(dateKey);
    if (hit?.value && this.now() - hit.at < ttl) return hit.value;
    if (hit?.pending) return hit.pending;
    const pending = (async () => this.picksForDay(dateKey, await loadDayMatches(dateKey)))().then(value => {
      this.resultCache.set(dateKey, { at: this.now(), value });
      while (this.resultCache.size > 20) this.resultCache.delete(this.resultCache.keys().next().value);
      return value;
    }).catch(error => { if (hit?.value) { this.resultCache.set(dateKey, hit); return hit.value; } this.resultCache.delete(dateKey); throw error; });
    this.resultCache.set(dateKey, { ...(hit || {}), pending });
    return pending;
  }

  async picksForDay(dateKey, dayMatches) {
    const model = this.model();
    const history = await this.history(dateKey);
    const states = new Map();
    const predictions = [];
    let covered = 0;
    for (const [position, match] of dayMatches.entries()) {
      if (position % 10 === 0) await yieldToLoop();
      const resolved = BankoRobot.resolve(history, match?.teams?.home?.name, match?.teams?.away?.name, match?.league?.name, match?.league?.country);
      if (!resolved) { predictions.push(noPrediction(match, "Bu takımlar için yeterli geçmiş maç verisi bulunamadı.")); continue; }
      covered += 1;
      if (!states.has(resolved.league)) states.set(resolved.league, leagueState(history.get(resolved.league), dateKey, model.elo));
      const result = predictMatch(model, states.get(resolved.league), resolved.home, resolved.away, { validated: resolved.validated });
      if (!result.eligible) { predictions.push(noPrediction(match, "Takımlardan birinin son 3 maçı bulunamadı.")); continue; }
      predictions.push(toPrediction(model, match, result, resolved));
    }
    const sortKey = kickoff => /^\d{4}-\d{2}-\d{2}$/.test(String(kickoff || "")) ? `${kickoff}T23:59:59Z` : String(kickoff || "9999");
    const ranked = predictions.filter(item => item.available)
      .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || b.probability - a.probability);
    const picks = ranked.filter(item => item.tier === "banko" || item.tier === "guclu").sort((a, b) => sortKey(a.kickoff).localeCompare(sortKey(b.kickoff)));
    const settled = picks.filter(pick => pick.result === "hit" || pick.result === "miss");
    const settledAll = predictions.filter(item => item.result === "hit" || item.result === "miss");
    return {
      date: dateKey,
      picks,
      predictions: ranked.concat(predictions.filter(item => !item.available)),
      summary: {
        fixtures: dayMatches.length, covered, predicted: ranked.length, picks: picks.length, settled: settled.length, hits: settled.filter(pick => pick.result === "hit").length,
        allSettled: settledAll.length, allHits: settledAll.filter(item => item.result === "hit").length,
        byTier: Object.fromEntries(TIER_ORDER.map(tier => [tier, ranked.filter(item => item.tier === tier).length])),
      },
      seasonCheck: await this.forwardCheck(dateKey, history),
      dataFreshness: { supplementedResults: this.lastSupplement?.added || 0, dynamicLeagues: this.lastSupplement?.dynamicLeagues || 0, leaguesWithHistory: history.size },
      generatedAt: new Date(this.now()).toISOString(),
      model: modelSummary(model),
    };
  }

  // Genuinely out-of-sample rolling check: every finished match in the last
  // CHECK_DAYS days is predicted from strictly earlier matches only.
  async forwardCheck(dateKey, history, days = CHECK_DAYS) {
    const model = this.model();
    const from = shiftDate(dateKey, -days);
    const perTier = Object.fromEntries(TIER_ORDER.map(tier => [tier, { picks: 0, hits: 0 }]));
    let picks = 0, hits = 0;
    for (const [league, matches] of history) {
      await yieldToLoop();
      const validated = !league.startsWith("dyn:");
      const targets = matches.filter(match => match.date >= from && match.date < dateKey);
      const byDate = new Map();
      for (const match of targets) byDate.set(match.date, [...(byDate.get(match.date) || []), match]);
      for (const [date, list] of byDate) {
        const state = leagueState(matches, date, model.elo);
        for (const match of list) {
          const result = predictMatch(model, state, match.home, match.away, { validated });
          if (!result.eligible) continue;
          const hit = MARKETS[result.best.market].hit(match.homeGoals, match.awayGoals);
          picks += 1; hits += Number(hit);
          perTier[result.tier].picks += 1; perTier[result.tier].hits += Number(hit);
        }
      }
    }
    return { from, to: shiftDate(dateKey, -1), picks, hits, hitRate: picks ? hits / picks : null, perTier };
  }
}

function settle(market, match) {
  const status = normalizeStatus(match?.fixture?.status?.short);
  const home = match?.goals?.home, away = match?.goals?.away;
  const scored = Number.isFinite(home) && Number.isFinite(away);
  const result = status === "FINISHED" && scored ? (MARKETS[market].hit(home, away) ? "hit" : "miss")
    : status === "LIVE" ? "live" : ["POSTPONED", "CANCELLED"].includes(status) ? "void" : "pending";
  return { status, score: scored ? { home, away } : null, elapsed: match?.fixture?.status?.elapsed ?? null, result };
}

function baseInfo(match) {
  return {
    fixtureId: match?.fixture?.id ?? null, kickoff: match?.fixture?.date ?? null,
    league: match?.league?.name || "", home: match?.teams?.home?.name, away: match?.teams?.away?.name,
  };
}

function noPrediction(match, reason) {
  return { ...baseInfo(match), available: false, reason, ...settle("1X", match), result: "none" };
}

const pct = value => Math.round(value * 1000) / 10;

function toPrediction(model, match, result, resolved) {
  const info = MARKETS[result.best.market];
  const tierStats = model.tiers[result.tier] || {};
  return {
    ...baseInfo(match), league: match?.league?.name || resolved.league, available: true, validated: resolved.validated,
    market: result.best.market, label: info.label, short: info.short, probability: pct(result.best.probability),
    tier: result.tier, tierLabel: TIER_LABEL[result.tier],
    tierHitRate: tierStats.hitRate != null ? pct(tierStats.hitRate) : null, tierPicks: tierStats.picks || 0,
    ms: { market: result.ms.market, probability: pct(result.ms.probability) },
    oneXTwo: { home: pct(result.probabilities["1"]), draw: pct(result.probabilities.X), away: pct(result.probabilities["2"]) },
    goals: { over25: pct(result.probabilities["O2.5"]), btts: pct(result.probabilities.BTTS) },
    ...settle(result.best.market, match),
    msResult: settle(result.ms.market, match).result,
  };
}

function modelSummary(model) {
  return { version: model.version, tiers: model.tiers, thresholds: model.thresholds, testPeriod: model.testPeriod, msBands: model.msBands };
}

module.exports = { BankoRobot, MARKETS, seasonOf, previousSeason, vectorize, marketProbabilities, leagueState, featuresFor, predictMatch, tierFor, settle };
