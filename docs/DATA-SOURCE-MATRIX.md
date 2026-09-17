# Data Source Matrix

| Field | API-Football | OpenFootball | TheSportsDB | Production Use |
| --- | --- | --- | --- | --- |
| Fixtures / kickoff / fixture status | Primary | Fallback, configured leagues | Fallback event feed | Canonical registry |
| Final result | Primary | Published score when available | Event score when available | Settlement reconciliation where stored provider IDs exist |
| Team name / provider ID | Yes | Generated provider ID | Generated provider ID | Canonical normalized team ID |
| Team form | Yes | Module support only | Not supported | API-Football analysis path |
| H2H | Yes | Not supported | Not supported | API-Football analysis path |
| Standings | Yes | Not supported | Not supported | API-Football analysis path |
| xG / shots / possession / cards | Plan and league dependent | Not supported | Not supported in adapter | API-Football statistics path |
| Bookmaker odds | Plan dependent | Not supported | Not supported | API-Football odds path |

Unsupported fields remain absent. The system never substitutes `0`, generated odds, generated results, or synthetic fixtures.

## Result Verification

The archive stores the provider fixture IDs available at prediction time. Settlement asks only those known providers. One completed score is `unverified`; two matching scores are `verified`; different scores are `conflict` with no selected final score. Performance accepts verified records only.