"use strict";
// ZEUS Banko robot: a selective predictor. It only issues a pick when a
// logistic model trained on 2010-2021 public-domain results is at least as
// confident as the gate chosen on 2021-2023 validation data. The hit rates it
// advertises come from the locked 2023-2026 test period (see docs/banko-backtest.json)
// and from a rolling check on the current season, never from tuning data.
const path = require("node:path");
const fs = require("node:fs");
const { LEAGUES, fetchSeason, makeFeatures, teamRecord } = require("../scripts/buildHistoricalFeatureArchive");
const { similarTeam } = require("./localDayFixtures");
const { teamKey, normalizeStatus } = require("./fixtureNormalization");

const MODEL_PATH = path.join(__dirname, "..", "data", "banko-model.json");
const CURRENT_TTL_MS = 3 * 60 * 60 * 1000;
const PAST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEASONS_BACK = 3;
// OpenFootball current-season files can lag by weeks. Recent finished results
// from the live fixture providers fill that gap (only days strictly before the
// target day, so nothing from the target day can leak into its features).
const SUPPLEMENT_MAX_DAYS = 45;

const MARKET_INFO = {
  "1X": { label: "1X · Ev sahibi kaybetmez", short: "1X", hit: (h, a) => h >= a },
  "X2": { label: "X2 · Deplasman kaybetmez", short: "X2", hit: (h, a) => h <= a },
  "1": { label: "MS 1 · Ev sahibi kazanır", short: "MS 1", hit: (h, a) => h > a },
  "U4.5": { label: "4.5 Alt", short: "4.5 ALT", hit: (h, a) => h + a <= 4 },
  "O1.5": { label: "1.5 Üst", short: "1.5 ÜST", hit: (h, a) => h + a >= 2 },
};
const TIER_RANK = { banko: 2, strong: 1 };

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

function sigmoid(value) { return 1 / (1 + Math.exp(-value)); }

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

function scoreMarkets(model, features) {
  const vector = vectorize(model, features);
  return Object.entries(model.markets).map(([market, spec]) => {
    const probability = sigmoid(spec.intercept + spec.coef.reduce((sum, coef, index) => sum + coef * vector[index], 0));
    return { market, probability, gate: spec.gate, tier: spec.tier, selected: probability >= spec.gate, spec };
  });
}

function choosePick(scores) {
  return scores.filter(item => item.selected && TIER_RANK[item.tier])
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.spec.testHitRate - a.spec.testHitRate || b.probability - a.probability)[0] || null;
}

// Team histories for one league using only matches strictly before `beforeDate`.
function leagueState(matches, beforeDate) {
  const histories = new Map(), meetings = new Map(), league = [];
  const prior = matches.filter(match => match.date < beforeDate).sort((a, b) => a.date.localeCompare(b.date));
  for (const match of prior) {
    const home = { ...teamRecord(match, match.home, "home"), venue: "home" };
    const away = { ...teamRecord(match, match.away, "away"), venue: "away" };
    histories.set(match.home, [...(histories.get(match.home) || []), home]);
    histories.set(match.away, [...(histories.get(match.away) || []), away]);
    const pair = [match.home, match.away].sort().join("::");
    meetings.set(pair, [...(meetings.get(pair) || []), match]);
    league.push(match);
  }
  return { histories, meetings, league };
}

function featuresFor(state, home, away) {
  const pair = [home, away].sort().join("::");
  return makeFeatures({ home, away }, state.histories.get(home) || [], state.histories.get(away) || [], state.meetings.get(pair) || [], state.league);
}

function predictMatch(model, state, home, away) {
  const features = featuresFor(state, home, away);
  if ((features.home_last5_matches || 0) < model.minHistory || (features.away_last5_matches || 0) < model.minHistory) return { eligible: false, reason: "insufficient_history" };
  const scores = scoreMarkets(model, features);
  return { eligible: true, pick: choosePick(scores), scores };
}

class BankoRobot {
  constructor({ fetcher = fetchSeason, recentResults = null, now = () => Date.now(), modelFile = MODEL_PATH, leagues = Object.keys(LEAGUES) } = {}) {
    this.fetcher = fetcher; this.recentResults = recentResults; this.now = now; this.modelFile = modelFile; this.leagues = leagues;
    this.seasonCache = new Map(); this.dayCache = new Map(); this.resultCache = new Map();
  }

  async resultsForDay(day) {
    const hit = this.dayCache.get(day);
    const settledDay = day < shiftDate(new Date(this.now()).toISOString().slice(0, 10), -1);
    const ttl = settledDay ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
    if (hit?.matches && this.now() - hit.at < ttl) return hit.matches;
    if (hit?.pending) return hit.pending;
    const pending = Promise.resolve().then(() => this.recentResults(day)).then(list => {
      const matches = (Array.isArray(list) ? list : []).filter(match => normalizeStatus(match?.fixture?.status?.short) === "FINISHED"
        && Number.isInteger(match?.goals?.home) && Number.isInteger(match?.goals?.away));
      this.dayCache.set(day, { at: this.now(), matches });
      return matches;
    }).catch(() => { this.dayCache.set(day, { at: this.now(), matches: hit?.matches || [] }); return hit?.matches || []; });
    this.dayCache.set(day, { ...(hit || {}), pending });
    return pending;
  }

  async supplement(history, dateKey) {
    if (!this.recentResults) return { days: 0, added: 0 };
    const days = [];
    for (let offset = SUPPLEMENT_MAX_DAYS; offset >= 1; offset -= 1) days.push(shiftDate(dateKey, -offset));
    const lastArchive = new Map([...history].map(([league, matches]) => [league, matches.reduce((max, match) => match.date > max ? match.date : max, "")]));
    const earliestGap = [...lastArchive.values()].reduce((min, value) => value < min ? value : min, dateKey);
    const needed = days.filter(day => day > earliestGap);
    let added = 0;
    for (let index = 0; index < needed.length; index += 2) {
      const lists = await Promise.all(needed.slice(index, index + 2).map(day => this.resultsForDay(day).then(matches => [day, matches])));
      for (const [, matches] of lists) {
        for (const match of matches) {
          const kickoffDay = String(match?.fixture?.date || "").slice(0, 10);
          const resolved = BankoRobot.resolve(history, match?.teams?.home?.name, match?.teams?.away?.name);
          if (!resolved || !kickoffDay || kickoffDay >= dateKey || kickoffDay <= lastArchive.get(resolved.league)) continue;
          const list = history.get(resolved.league);
          if (list.some(item => item.home === resolved.home && item.away === resolved.away && Math.abs(Date.parse(item.date) - Date.parse(kickoffDay)) <= 2 * 86_400_000)) continue;
          list.push({ date: kickoffDay, home: resolved.home, away: resolved.away, homeGoals: match.goals.home, awayGoals: match.goals.away, league: resolved.league, source: "live-provider" });
          added += 1;
        }
      }
    }
    return { days: needed.length, added };
  }

  model() { return loadModel(this.modelFile); }

  async season(league, season, current) {
    const key = `${league}|${season}`;
    const hit = this.seasonCache.get(key);
    const ttl = current ? CURRENT_TTL_MS : PAST_TTL_MS;
    if (hit && this.now() - hit.at < ttl) return hit.matches;
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

  // Find the archive league + archive team names for a provider fixture.
  static resolve(historyByLeague, homeName, awayName) {
    let best = null;
    for (const [league, matches] of historyByLeague) {
      const teams = [...new Set(matches.flatMap(match => [match.home, match.away]))];
      const find = name => teams.find(team => teamKey(team) === teamKey(name)) || teams.find(team => similarTeam(team, name));
      const home = find(homeName), away = find(awayName);
      if (!home || !away || home === away) continue;
      const exact = Number(teamKey(home) === teamKey(homeName)) + Number(teamKey(away) === teamKey(awayName));
      if (!best || exact > best.exact) best = { league, home, away, exact };
    }
    return best;
  }

  // Cached wrapper: today refreshes every 10 minutes (live scores settle picks),
  // other days every 6 hours.
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
    const picks = [];
    let covered = 0, eligible = 0;
    for (const match of dayMatches) {
      const resolved = BankoRobot.resolve(history, match?.teams?.home?.name, match?.teams?.away?.name);
      if (!resolved) continue;
      covered += 1;
      if (!states.has(resolved.league)) states.set(resolved.league, leagueState(history.get(resolved.league), dateKey));
      const result = predictMatch(model, states.get(resolved.league), resolved.home, resolved.away);
      if (!result.eligible) continue;
      eligible += 1;
      if (!result.pick) continue;
      picks.push(toPick(match, result.pick, resolved));
    }
    const sortKey = kickoff => /^\d{4}-\d{2}-\d{2}$/.test(String(kickoff)) ? `${kickoff}T23:59:59Z` : String(kickoff);
    picks.sort((a, b) => sortKey(a.kickoff).localeCompare(sortKey(b.kickoff)));
    const settled = picks.filter(pick => pick.result === "hit" || pick.result === "miss");
    return {
      date: dateKey,
      picks,
      summary: { fixtures: dayMatches.length, covered, eligible, picks: picks.length, settled: settled.length, hits: settled.filter(pick => pick.result === "hit").length },
      seasonCheck: await this.seasonCheck(dateKey, history),
      dataFreshness: { supplementedResults: this.lastSupplement?.added || 0, leaguesWithHistory: history.size },
      generatedAt: new Date(this.now()).toISOString(),
      model: modelSummary(model),
    };
  }

  // Rolling, genuinely out-of-sample check on the current season (model trained
  // on <= 2021): every finished archive match in the last `days` days is
  // predicted from strictly earlier matches only.
  async seasonCheck(dateKey, history, days = 60) {
    const model = this.model();
    const from = shiftDate(dateKey, -days);
    const perMarket = {};
    let picks = 0, hits = 0;
    for (const matches of history.values()) {
      const targets = matches.filter(match => match.date >= from && match.date < dateKey);
      const byDate = new Map();
      for (const match of targets) byDate.set(match.date, [...(byDate.get(match.date) || []), match]);
      for (const [date, list] of byDate) {
        const state = leagueState(matches, date);
        for (const match of list) {
          const result = predictMatch(model, state, match.home, match.away);
          if (!result.eligible || !result.pick) continue;
          const hit = MARKET_INFO[result.pick.market].hit(match.homeGoals, match.awayGoals);
          picks += 1; hits += Number(hit);
          const bucket = perMarket[result.pick.market] || (perMarket[result.pick.market] = { picks: 0, hits: 0 });
          bucket.picks += 1; bucket.hits += Number(hit);
        }
      }
    }
    return { from, to: shiftDate(dateKey, -1), picks, hits, hitRate: picks ? hits / picks : null, perMarket };
  }
}

function shiftDate(dateKey, days) { return new Date(Date.parse(`${dateKey}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10); }

function toPick(match, pick, resolved) {
  const info = MARKET_INFO[pick.market];
  const status = normalizeStatus(match?.fixture?.status?.short);
  const home = match?.goals?.home, away = match?.goals?.away;
  const scored = Number.isFinite(home) && Number.isFinite(away);
  const result = status === "FINISHED" && scored ? (info.hit(home, away) ? "hit" : "miss")
    : status === "LIVE" ? "live" : ["POSTPONED", "CANCELLED"].includes(status) ? "void" : "pending";
  return {
    fixtureId: match?.fixture?.id ?? null,
    kickoff: match?.fixture?.date ?? null,
    league: match?.league?.name || resolved.league,
    home: match?.teams?.home?.name, away: match?.teams?.away?.name,
    market: pick.market, label: info.label, short: info.short, tier: pick.tier,
    probability: Math.round(pick.probability * 1000) / 10,
    historicalHitRate: Math.round(pick.spec.testHitRate * 1000) / 10,
    historicalPicks: pick.spec.testPicks,
    status, score: scored ? { home, away } : null, elapsed: match?.fixture?.status?.elapsed ?? null, result,
  };
}

function modelSummary(model) {
  return {
    version: model.version,
    markets: Object.fromEntries(Object.entries(model.markets).map(([market, spec]) => [market, {
      label: MARKET_INFO[market]?.label || market, tier: spec.tier,
      testHitRate: spec.testHitRate, testPicks: spec.testPicks, testWilson95: spec.testWilson95, testBaseRate: spec.testBaseRate, testPeriod: spec.testPeriod,
    }])),
  };
}

module.exports = { BankoRobot, MARKET_INFO, seasonOf, previousSeason, vectorize, scoreMarkets, choosePick, leagueState, predictMatch, toPick };
