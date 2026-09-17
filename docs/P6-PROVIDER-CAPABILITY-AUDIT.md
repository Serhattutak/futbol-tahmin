# P6 Provider Capability Audit

## Scope And Evidence

This is a read-only audit. No provider API request was made. Adapter capability is verified from the repository code. Provider capability is documented only where supported by current code or official source material reviewed on 2026-09-16. API-Football's official documentation page was not independently retrievable in this audit (HTTP 403), so its provider-level entries below are limited to the application's existing endpoint usage and must be reconfirmed against the account's official plan.

Providers: API-Football, OpenFootball `football.json`, and TheSportsDB. Flashscore and SofaScore are not providers in this application. No scraping, browser automation, bot bypass, or anti-bot circumvention is permitted.

Legend: `Yes` = available and connected in the current adapter/path; `Partial` = limited scope or only available outside the P5 adapter interface; `No` = not implemented/verified; `Plan-dependent` = the application requests it but account entitlement must be checked.

## Capability Matrix

| Capability | API-Football | OpenFootball | TheSportsDB |
| --- | --- | --- | --- |
| Fixtures | Yes, primary adapter | Yes, eight configured leagues | Yes, day/event adapter |
| Fixture status | Yes | Partial: `FT` when score exists, otherwise `NS` | Partial: score presence maps to `FT`/`NS` |
| Final result | Yes | Yes where dataset score exists | Yes where event scores exist |
| Team information | Yes | Partial: name and generated local ID | Partial: name and generated local ID |
| Team form | Yes in existing server path | Partial: module implements it; P5 adapter does not expose it | No |
| H2H | Yes in existing server path | No | No |
| League standings | Yes in existing server path | No | No |
| xG | Plan/league-dependent via existing fixture-statistics path | No | No |
| Shots | Plan/league-dependent via existing fixture-statistics path | No | No |
| Possession | Plan/league-dependent via existing fixture-statistics path | No | No |
| Player statistics | Not used by current adapter/server | No | Not implemented or verified in current adapter |
| Bookmaker odds | Plan-dependent via existing odds path | No | No |
| BTTS data | Derived from verified final score; odds only API-Football path | Derived from final score | Derived from final score |
| Over/Under data | Derived from verified final score; odds only API-Football path | Derived from final score | Derived from final score |
| Historical fixtures | Plan-dependent; no bulk audit request made | Yes for published seasons/leagues | Not verified in current adapter |
| Live fixtures | Plan-dependent; no polling added | No live feed | Premium live scores are documented; current adapter does not use them |

## Canonical Mapping

`multiProviderRegistry.js` currently canonicalizes fixture-level fields: provider, provider fixture ID, canonical fixture ID, league, season, kickoff, home/away teams, status, optional result, source list, and `dataConflict`.

| Canonical Field | API-Football | OpenFootball | TheSportsDB |
| --- | --- | --- | --- |
| Provider/providerFixtureId | Yes | Yes, deterministic local ID | Yes, prefixed event ID |
| Canonical team identity | Normalized team name | Normalized team name | Normalized team name |
| League/season/kickoff | Yes | Yes for configured dataset | League/date; season is not mapped |
| Fixture status/result | Yes | Derived from published score | Derived from event scores |
| Form/H2H/standings/odds/statistics canonical objects | Not yet canonicalized | Not yet canonicalized | Not yet canonicalized |

The prediction model is provider-agnostic: `predictionModel.js` receives normalized form/statistical values from `server.js`, not raw provider payloads. Full provider-neutral analysis is not yet achieved because only API-Football is wired for the required pre-match form, H2H, standings, odds, and statistics capabilities.

## Fallback Matrix

| Condition | Current Registry Behavior |
| --- | --- |
| Primary fixture data available | Return API-Football canonical fixtures; do not call fallback providers |
| `no_data` / empty fixture result | Try the next enabled fixture provider |
| `timeout_network` | Mark provider unavailable and try next provider |
| `quota` | Mark provider unavailable and try next provider; API-Football budget remains authoritative |
| `authentication` | Mark unavailable and try next provider |
| `provider_unavailable` | Mark unavailable and try next provider |
| Invalid/unexpected response | Mark provider unavailable; next provider may be tried |
| `dataConflict` | Do not silently merge; retain conflict-marked canonical fixtures |

Fallback is currently fixture-scoped. A successful fixture fallback must not be treated as form, H2H, standings, odds, or statistics fallback.

## Result Verification Matrix

| Source Situation | Canonical Status | Archive Performance |
| --- | --- | --- |
| No completed real result | `unavailable` | Excluded |
| One provider real completed result | `unverified` | Excluded |
| Two or more matching real results | `verified` | Eligible |
| Conflicting real scorelines | `conflict`; no selected result | Excluded |

The reconciliation helper supports verified/conflict classification. Current P4 settlement obtains one API-Football result per pending record, so produced settlements remain `unverified` until a second compatible result adapter is connected. Snapshot data remains immutable; settlement is stored separately.

## Quota, Access, And License Notes

- API-Football: API key required by this application. Its effective free/paid quota is account-plan dependent and was not asserted without accessible official documentation. The local `API_FOOTBALL_DAILY_BUDGET` defaults to 100 and is enforced before upstream calls.
- OpenFootball: official repository documentation states raw JSON access needs no API key, latest-season datasets update daily, and the dataset/schema/scripts are public domain (CC0-1.0). Coverage and freshness are limited to its published data and the eight leagues configured in this project.
- TheSportsDB: official site documents a free JSON API and a premium tier with a dedicated production key and V2 features including two-minute live scores. This application uses the public `123` development key fallback when no server-side key is configured; no numeric rate limit was asserted because none was verified in this audit.

## Missing Capabilities And Risks

- H2H, standings, odds, xG, shots, possession, and player statistics have no current multi-provider reconciliation path.
- OpenFootball and TheSportsDB fixture IDs cannot be passed into the current API-Football analysis endpoint; fixture fallback does not yet guarantee a complete analysis fallback.
- Normalized-name team matching can collide for similarly named clubs; a licensed provider cross-reference or maintained alias table is needed before high-confidence cross-provider settlement.
- Status mapping in OpenFootball/TheSportsDB is simplified and not a live-state taxonomy.
- Provider status is process-local and operational metadata, not a health guarantee.

## Prediction And Performance Impact

Model 4.0 weights are unchanged. `dataConflict` and missing provider capabilities should reduce usable data quality when full canonical analysis is introduced; they must never be filled with synthetic values. Archive performance remains conservative: no unverified or conflicting result contributes to accuracy.

## Recommended Next Provider

Add a licensed, documented football data provider with pre-match fixtures, team form, H2H, standings, odds, and result access under one contract. Before integration, confirm API terms, data rights, production limits, webhook/polling rules, and the availability of stable team/fixture IDs. Implement its adapter with canonical form, standings, odds, statistics, and result objects before enabling it for prediction or verification.