# SYS-MB final acceptance

## Production readiness checkpoint — 2026-09-22 21:05 UTC

Current live SHA and remote production branch remain `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79 / v0.82.11`; no new product runtime diff awaits deploy. Read-only live management shows one organization with four businesses, while the current API can bootstrap only the first organization; the local two-organization test inserts its second fixture directly through SQL. A live owner workflow for a second organization and its first business is therefore not accepted. The enabled scheduler inventory includes an unpaused monthly reset, so the relevant longest cycle must be classified before the observation window can be bounded. See [PRODUCTION_READINESS_20260923.md](asset-close-01/PRODUCTION_READINESS_20260923.md). `startUtc=null`, `PASS_MEASURED=false`, `GLOBAL_MODEL_COMPLETE=false`.

## Live role QA update — 2026-09-22

The owner-approved `SYS-MB-CLOSE-03-LIVE-ROLE-QA-20260922` proved Maysternya/CRM manager/admin/animator profile isolation and immediate same-JWT revoke for the registered smoke account. Cleanup verified zero active temporary grants while retaining two inactive audit-backed membership rows. This supersedes only the earlier role/revoke `NOT_TESTABLE` statement below. Two-organization and independent worker-browser acceptance, complete telemetry coverage, the enabled-cycle bound, 14 complete UTC days and 30 real operations on five days per business remain HOLD. Observation has not started. See [ROLE_QA_REPORT.md](asset-close-01/ROLE_QA_REPORT.md).

Status: **HOLD — INSTRUMENTED / NOT_STARTED / NOT_MEASURED**.

## Current checkpoint — 2026-09-22

The historical 2026-09-13 evidence below is retained as a dated snapshot. It is no longer the current live state. CRM and Maysternya cutovers and the nine-catalog ownership apply have durable receipts, and the four broken catalog image references have been repaired and browser-verified. Current live `/api/version`: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`, branch `codex/eventgenix-production`, `v0.82.11 — Tasker + My Day UX`.

The exact `SYS-MB-CLOSE-03-TELEMETRY-READ-20260922` block granted only 15 read-only telemetry columns to the dedicated audit role. The current-SHA collector ran and reconciled runtime counts without known loss. Its one-day initial lookback is not the exit-gate observation window: `startUtc=null`; ten required context/entry-family pairs had no observed activity; real five-day traffic and the longest enabled cycle are unproven. Separate manager/admin/worker and same-JWT revoke live QA also remain unproven. The exact access and collector evidence are in [TELEMETRY_READ_GRANT_REPORT.md](asset-close-01/TELEMETRY_READ_GRANT_REPORT.md); current status is in [OBSERVATION_START.md](close-02/OBSERVATION_START.md).

`PASS_MEASURED=false`; `GLOBAL_MODEL_COMPLETE=false`. Legacy operational authorization has not been removed, and deprecated columns have not been dropped. The active narrow telemetry SELECT grant must be revoked after the gate or if observation is abandoned.

## Historical checkpoint — 2026-09-13

Observed at: `2026-09-13T12:04:56Z` (read-only evidence refresh).

## Live release evidence

| Item | Actual value |
| --- | --- |
| Live URL | `https://8223324090-production.up.railway.app` |
| Version | `0.81.153` |
| Label | `Рішення щодо legacy-матеріалів Design Board` |
| Live SHA | `4214598e263057b1cb1524d7fb84f328031d288d` |
| Live branch | `codex/eventgenix-production` |
| Deployment metadata | complete, manifest-backed |
| Railway target | `fortunate-appreciation / production / 8223324090` |
| Candidate containing telemetry | `e33a69c8dd9d1d6d98501ad5387cbe00e10b011c` (local only) |
| Migration 363 on live source | absent |

The live source does not contain `363_multibusiness_cutover_journal_telemetry.sql`; no production schema, cutover journal or compatibility telemetry from SYS-MB-FINISH-02 is deployed.

## Exit-gate measurement

| Predicate | Actual state |
| --- | --- |
| Maysternya membership cutover with exact live proof, QA and cleanup | NOT_RUN |
| CRM membership cutover with exact live proof, QA and cleanup | NOT_RUN |
| Approved restricted mapping for either business | UNPOPULATED |
| Independent read-only production preflight | NOT_COLLECTED (`MULTIBUSINESS_AUDIT_DATABASE_URL` unavailable) |
| Durable telemetry over HTTP/profile, services, alternate auth, WebSocket, providers/public, jobs/retries and operator entrypoints | NOT_INSTRUMENTED on live |
| Observation start/end UTC | `null` / `null` |
| Complete consecutive days | `null`; window has not started and no zero-usage interval is measured |
| Minimum required window | 14 complete UTC days, plus longest enabled scheduler/retry/retention cycle and 24 hours |
| Remaining time | **NOT_STARTED — cannot calculate a UTC end time** |
| PASS_MEASURED | false |

No missing observation is interpreted as zero. The 14-day clock starts only after both independent cutovers, exact live evidence, live QA, fixture cleanup and complete durable instrumentation. Any later auth/ownership/entrypoint change or collection gap restarts the affected window.

## Final decision

`GLOBAL_MODEL_COMPLETE=false`.

No compatibility authorization was removed, no response compatibility or technical platform-creator function was changed, and no deprecated database column was removed. No production push, deploy, migration, mapping apply, QA fixture or cleanup occurred in this task.

A final release manifest and auth-release authorization are intentionally not requested: the required `PASS_MEASURED` predicate is false. Before a future final release, complete the two separately authorized MD/CRM cutovers, publish the durable telemetry candidate, and collect exit-gate evidence without gaps.


