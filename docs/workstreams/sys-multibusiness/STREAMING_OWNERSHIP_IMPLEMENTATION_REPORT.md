# SYS-MB · Fresh streaming access and effective organization ownership

Historical checkpoint. The next profile/editor task is recorded in [PROFILE_UI_IMPLEMENTATION_REPORT.md](PROFILE_UI_IMPLEMENTATION_REPORT.md) and `PROFILE_UI_VERIFICATION.json`; use that checkpoint for the latest cumulative local handoff.

Date: 2026-09-12. Local implementation of the next task after the HTTP lifecycle checkpoint.

## Baseline and scope

- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.
- Branch: `codex/sys-mb-auth-p0-20260912`; base commit: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
- Version remains `0.81.132`. The cumulative P0, lifecycle and streaming/ownership changes are uncommitted and unreleased.
- Inputs: `P0_IMPLEMENTATION_REPORT.md`, `LIFECYCLE_IMPLEMENTATION_REPORT.md`, actual auth, WebSocket, organization and account/staff lifecycle callers, and repository instructions.
- This task changes local authorization and its tests. No new migration, dependency, lockfile, booking identity field priority, booking renderer, shared UI, secret or hosting setting was changed.
- Staff/HR files have only the ownership lock and error propagation needed to protect the same account-deactivation invariant. HR workflows, payroll rules and calculations are unchanged. Attendance event projection is implemented inside the shared WebSocket service.
- The main checkout and other worktrees were not modified. No commit, push, CI dispatch, deploy or production-data operation was performed. This report is not live-site QA evidence.

## Problems and decisions

The old WebSocket authenticated a global account once and retained that role snapshot for the life of the connection. Changing a business role, revoking membership or revoking account sessions did not update this snapshot. Generic and direct notifications bypassed business authorization. Omni additionally wrote directly to sockets through `getWSS()`.

Every outgoing delivery now verifies the original JWT and reloads the account/session from DB. Business events then load the membership for that event's exact business and apply its role and overrides. No permission cache survives a delivery. Session invalidation closes the connection with code 4001 on its next message/delivery; periodic heartbeat also checks idle accounts. A failed DB read denies delivery rather than reusing the previous user.

Inbound messages and outbound deliveries have separate ordered queues per socket. Authorization uses the same private JSON snapshot as the eventual packet, preventing producer mutation from authorizing one context while sending another. Date/channel subscriptions are checked again immediately before send. Public send helpers return `Promise<number>` and handle ordinary dispatch failures internally; existing callers may continue ignoring the result. No production caller depends on the former synchronous count.

Fresh authorization applies when the queued delivery is processed. Already-delivered frames cannot be recalled, and this patch does not claim an atomic distributed barrier between arbitrary concurrent DB changes and bytes already in flight.

## Event contracts and boundaries

| Surface | Current local contract | Status |
|---|---|---|
| Booking, banquet, line and roster events | Fresh account + event-business membership, existing timeline access and booking visibility. Existing minimal payload, booking identity and previous-booking audiences retained. Generic booking/line/banquet delivery remains forbidden. | SUPPORTED |
| Task assigned/schedule-changed/slot-missed | Resolve canonical `tasks.id` and its business in DB, then reuse SQL owner/observer/department/privacy policy with that business role. Missing/orphaned context, conflicting hints or unavailable record deny delivery. No context is guessed for scheduling notifications. | SUPPORTED |
| Booking-linked chat channels | Recheck current channel membership/archive status, then either durable booking link and current booking/business visibility. Conflicting/missing links deny. | SUPPORTED |
| Booking previews in chat | Check the referenced booking even in general channels; direct and embedded metadata previews are covered. `chat_tasks` IDs are not confused with canonical task IDs. | SUPPORTED |
| General/room/DM/assistant channels | Recheck active session and current channel membership. No business ownership is inferred from channel slug, line, username or default context. | NOT_MIGRATED for business ownership |
| Omni | Shared dispatcher replaces direct socket access. Always requires fresh `/omni` capability in the event business. Existing `{type,data:{businessContext,conversationId}}` envelope retained. | SUPPORTED |
| Presence | After bootstrap, recipient and subject must share an active organization membership. Only an empty organization registry preserves pre-bootstrap compatibility. | SUPPORTED at organization boundary |
| Attendance | Resolve explicit/durable time-record context and require `hr.today.view` in that business. Every dispatch emits only `{date}` as an invalidation; the existing HR listener ignores record fields and reloads authorized HTTP data. No staff name, compensation snapshot, IP, user-agent or notes reach the wire. | SUPPORTED invalidation; HR domain migration NOT_MIGRATED |
| Guardian mood / empty alerts | Exact inert mood fields and `alerts:[],count:0` only. Nonempty unscoped alerts and Guardian details without a usable current channel are denied. | SUPPORTED inert events; ambiguous payloads BLOCKED |
| Personal Kleshnya transcripts | Only username-addressed delivery, with a freshly loaded account and current username. These transcripts remain account-owned and are not partitioned by business. | NOT_MIGRATED for business ownership |
| Unknown event types | Denied until an explicit access contract is added. | BLOCKED by policy |

The current dashboard producer already returns empty alert collections; this report does not claim it currently broadcasts operational stock/lead data. Channel and transcript compatibility are explicit remaining boundaries, not evidence of complete cross-business isolation.

## Last effective owner

Organization demotion and account deactivation now cooperate through one transaction advisory lock:

`BEGIN → organization-ownership advisory lock → existing user/staff/organization row locks → authorization and invariant → changes/audit → COMMIT`.

The shared guard checks every active organization affected by the exact set of accounts being disabled. It counts only active owner memberships whose account is active, excluding the entire target batch. Losing the last effective owner returns `409 organization_last_owner`; the surrounding transaction rolls back. Organization lifecycle and first bootstrap take the same lock before their existing locks, preventing races between owner discovery/promotion/demotion and account deactivation.

| Runtime writer | Integration |
|---|---|
| `PATCH /api/users/:id/active` | Ownership lock before account row lock; invariant before disabling user/sessions. |
| `PUT /api/staff/:id` when inactive | Ownership lock before staff update; canonical linked-account guard; 409 propagated after rollback. |
| `DELETE /api/staff/:id` soft archive | Same ordering and shared guard. |
| `POST /api/hr/staff/:id/offboarding` | Same ordering and shared guard. |
| `PUT /api/hr/staff/:id/status` | Same ordering and shared guard. |
| Organization lifecycle and bootstrap | Same global lock before organization/bootstrap locks. |

No other live `users.is_active=false` writer or live user DELETE/TRUNCATE route was found. Historical migration 187 is unchanged. This is an application-writer invariant, not a DB trigger: arbitrary SQL, future writers that omit the guard and historical migrations are not covered. The global lock serializes rare access-lifecycle mutations; normal booking/business requests do not acquire it.

## Files

| Area | Files |
|---|---|
| Fresh streaming and policy | `services/websocket.js`, new `services/websocketEventAccess.js`, `services/omni-hub.js` |
| Ownership invariant and cooperating transactions | New `services/organizationOwnership.js`, `services/organizationLifecycle.js`, `services/staffLifecycle.js`, `routes/organizations.js`, `routes/users.js`, `routes/staff.js`, `routes/hr.js` |
| Focused tests | New `tests/organization-ownership.test.js`, new `tests/websocket-event-access.test.js`, `tests/websocket-membership.test.js`, `tests/organization-lifecycle.test.js`, `tests/omni-hardening.test.js` |
| Real PostgreSQL / HTTP / sockets | New `tests/integration/multibusiness-streaming-ownership-postgres.test.js` |
| Existing test fixtures | `tests/auth-account-lifecycle.test.js`, `tests/route-smoke.test.js`, three Omni unit fixture files and two Omni integration fixture files; only their newly required DB/dispatch interfaces were adapted. Assertions were not removed. |
| Test registration and evidence | `package.json`, this report and `STREAMING_OWNERSHIP_VERIFICATION.json`; previous report marked historical. |

The verification manifest records exact incremental filenames and SHA-256 hashes for all cumulative changed source/test files, including the preceding P0/lifecycle work.

## Verification

- Focused WebSocket/policy/owner/lifecycle/Omni tests: **87/87 PASS**, no skips.
- Actual local PostgreSQL suites: **47/47 PASS**, no skips: membership 14, lifecycle 14, streaming/ownership 19. Counts include the three parent tests.
- Real sockets prove different Park/Dar roles on the same connection, subsequent role/membership/organization changes, session revoke, account disable, missing-schema denial, task privacy/observer/department SQL, channel revocation/archive, both booking link styles, cross-business previews, presence and Omni page permissions.
- Real concurrent HTTP requests prove disable versus demotion, disable versus successor promotion and existing owner-demotion/bootstrap concurrency. Bulk coverage calls the canonical guard in a real SQL transaction; it does not invent a bulk HTTP endpoint.
- Test databases are randomly named, local and disposable. Existing migrations 204/357 are applied only there. `DATABASE_URL` is never a fallback. Independent cleanup found **0 test databases and 0 test connections** remaining.
- Windows: Node 22.23.1 / npm 10.9.8; local WSL: Node 22.22.2 / PostgreSQL 16.
- Full `npm test`: **PASS, exit 0**. Unit **2836/2836**, My Day **337/337**, UI/static **1312/1312**, loader **4/4**; zero failures/skips. Runtime/version/access/ownership/migration/syntax and protected timeline checks passed. The first run exposed one legacy route-smoke fixture without an organization registry; its explicit empty-registry response was added and the final full run passed. Both attempt logs are retained.
- New unit files are registered in the existing `test:unit` CI command. PostgreSQL suites remain explicit operator-run checks, not newly configured CI jobs.
- Raw local logs are retained under ignored `.codex-temp/sys-mb-streaming-ownership/`; portable results are recorded in the documentation manifest. Fixture PASS is not live PASS.

```powershell
npm test
node --test tests/websocket-membership.test.js tests/websocket-event-access.test.js tests/organization-ownership.test.js tests/organization-lifecycle.test.js tests/business-membership-organization-guards.test.js tests/omni-hardening.test.js
wsl -d Ubuntu -u postgres -- env BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST=1 node --test '/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-auth-p0-20260912/tests/integration/multibusiness-streaming-ownership-postgres.test.js'
```

## Remaining work and handoff

1. **Next implementation: login/refresh/profile and membership UI parity.** `/auth/refresh` still returns the global profile; `js/api.js` may merge it into current user state. Align `routes/auth.js`, `js/api.js`, `js/auth.js` and `js/account-access-editor.js` with the membership-backed business profile. Preserve existing sidebar design/routes; do not let global `users` context editing replace membership authority. Verify different business roles, default changes, multiple organizations, revocation and refresh/relogin without stale UI grants.
2. **Domain isolation remains incomplete.** General chat, personal AI transcripts, compatibility MD/CRM, module/branding metadata and broader operational SQL boundaries still need their accepted domain work. Existing aggregate reads with mixed role/override sets stay conservatively denied. This patch does not remove compatibility or claim HR/Telegram/payment integration cutover.
3. **Controlled live QA fixtures and delivery remain separate.** No production test identities or business records were created. Before release, integrate the complete isolated patch onto a fresh confirmed production base; review auth-sensitive changes, run exact-candidate CI and the explicit PostgreSQL suites, and use a current bounded release authorization. Only then execute the approved fixture runbook and record exact live SHA evidence.

Status: **READY_LOCAL_STREAMING_OWNERSHIP_REVIEW**. The prior streaming snapshot and cooperating account-deactivation gaps are addressed locally. Full SaaS multi-business completion, production release and live acceptance are not claimed.
