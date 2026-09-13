# D05 — Local containment of chat HTTP, AI and WebSocket recipients

Date: 2026-09-12. Branch: `codex/sys-mb-auth-p0-20260912`.
Base: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
Status: **HTTP_ENGINE_WS_RECIPIENTS_CONTAINED_LOCAL / WHOLE_DOMAIN_NOT_MIGRATED**.
No commit, push, deploy, live/production operation, provider call, schema or
ownership assignment. Parent task owns the cumulative verification manifest and
the shared surface descriptors. This report does not certify other D05 patches.

## Reproduced problem and smallest fix

General chat records/channels and Kleshnya sessions/transcripts have no durable
business owner. A valid membership principal could reach existing shared reads,
transcript writes and AI helpers. The module registry's unavailable label did not
contain these router namespaces. A missing service actor also defaulted into the
legacy AI/skill path. Expected behavior for unsupported memberships is explicit
unavailability before any domain SQL, channel provisioning, transcript/history,
upload, provider or AI operation.

New actual-router HTTP tests with real `buildMembershipAccess` +
`applyMembershipAccess` principals reproduced five failing test cases before the
patch: membership/general routes returned HTTP 200 instead of 403; the same
session retained access after fixture cutover; aggregate access stayed open; the
engine did not produce unavailable results for untrusted actors. Three existing
behavior controls passed. This is a local synthetic reproduction, not a live
cross-business disclosure claim.

Minimal runtime scope: **4 files**. The first HTTP/engine increment was three
files, 14 insertions / 1 deletion; the final increment changes only the unowned
channel and account-transcript branches in the existing recipient policy.

| File / anchor | Change |
| --- | --- |
| `routes/chat.js`, router-level auth/role middleware | Run `requireLegacyBusinessSurface('chat')` after existing JWT and role guards. Every REST route is covered, including channels, provisioning, direct IDs, upload, assistant transcript and reply. |
| `routes/kleshnya.js`, local `authenticateToken` wrapper | Wrap the imported JWT middleware with the Kleshnya legacy-surface check. All 16 existing JWT routes retain their original handlers. Custom-secret bridge route definitions are untouched. |
| `services/kleshnya-chat.js:generateChatResponse` | Check `legacyBusinessSurfaceAccess({user:actor},'kleshnya')` before text handling, data reads or AI/skills. Return existing `message`/`suggestions` shape plus `available:false` and a stable code. Missing or unresolved actors cannot manufacture Park access. |
| `services/websocketEventAccess.js:canReceiveLegacyAccountSurface`, `canReceiveChannel`, `ACCOUNT_TRANSCRIPT_EVENTS` | Reload the explicit stored `users.default_business_context` by fresh account ID, reject missing/invalid values, resolve membership from current SQL, and check the existing legacy policy with that server-selected context. Unowned channel joins/typing/broadcasts/direct notifications and username-addressed transcripts require pre-cutover Park. Valid booking-linked channel guards remain unchanged. |

The existing helper permits only a server-resolved, single pre-cutover Park
compatibility principal; membership Park/Dar/custom, MD/CRM compatibility,
aggregate, inactive, revoked and unresolved principals are unavailable. This
contains old namespaces without assigning any historical record to Park. The
shared helper's three new surface descriptors are the parent task's edit in
`services/legacyBusinessSurface.js`.

The first WebSocket red run reproduced four failing tests: general channel
membership and username delivery alone allowed unsupported recipients. Review
then found a second issue: `loadAuthenticatedUserAccess` normalizes a missing
stored default. An actual Park-only account/socket/PG reproduction confirmed that
`users.default_business_context = NULL` still received a chat message through the
initial guard (dispatch count 1, expected 0). The final helper reads the raw
stored value instead of trusting either normalized profile alias. Event payloads
cannot choose this context. A stale/conflicting profile default cannot supersede
the explicit DB value.

This is recipient containment, not a channel ownership migration. Sockets do not
have a cabinet selector; the helper uses the stored account default and does not
infer which browser cabinet is open. No edit to `services/websocket.js`, protocol,
auth profile, booking/Omni/task/presence/attendance semantics or protected provider
bridge was made by this increment.

## Verification actually executed

Runtime: Node **22.23.1**, npm **10.9.8**. New test file:
`tests/d05-chat-ai-containment.test.js`.
Real PostgreSQL/socket run: WSL Node **22.22.2**, local PostgreSQL **16.15**.

The HTTP harness mounts the actual Express routers and uses the actual membership
principal builder plus existing role middleware. JWT verification/session storage
and domain SQL/providers are substituted; therefore the same-session cutover test
proves fresh principal consumption at this boundary, **not** a new real-JWT/PG
revocation certificate. Outbound network in loaded modules is rejected; loopback
HTTP is the only network exercised. Denials assert zero domain SQL, service,
history, upload, bridge and AI/provider calls.

| Run | Result | Evidence under `.codex-temp/sys-mb-d05/` |
| --- | --- | --- |
| New tests before runtime edits | **RED: 5 fail, 3 pass**; expected behavioral failures | `chat-ai-red.log` |
| Same tests after minimal guards | **8/8 PASS**, no skip | `chat-ai-green.log` |
| Ten-file affected sweep | **68/68 PASS**, no skip; includes the same eight new tests | `chat-ai-regression-initial.log` |
| Existing route smoke | **103/103 PASS**, no skip; existing valid compatibility fixtures unchanged | `chat-ai-route-smoke.log` |
| Additional callers/source sweep | **60 PASS / 6 FAIL**; six unrelated startup fixture failures below | `chat-ai-callers.log` |
| Four new WS tests before recipient guards | **RED: 4 fail**, expected behavioral failures | `ws-containment-red.log` |
| Initial recipient guard, before stored-default correction | **45/45 PASS**, superseded by final run below | `ws-containment-green.log` |
| Initial actual PG sweep | **15 PASS / 6 FAIL** including parent; five timeline positives had stale empty module fixtures; no stored-default reproduction with the initial Park+Dar account | `ws-postgres-default-red.log` |
| Corrected fixtures, Park-only NULL-default reproduction | **RED: 19 PASS / 2 FAIL** including parent; only the new stored-default scenario failed, chat dispatch 1 instead of 0 | `ws-postgres-default-repro.log` |
| Final WS event policy + actual socket/mock-DB suite | **45/45 PASS**, no skip; 21 event-policy tests + 24 socket tests | `ws-containment-final.log` |
| Final actual socket/PG regression + D05 cases | **21/21 PASS**, no skip; 20 scenarios plus parent | `ws-postgres-final.log` |
| Scoped `git diff --check` | PASS, no whitespace errors; ordinary LF/CRLF warnings only | Tool output; no generated runtime changes |

Ten-file command:

```powershell
node --test tests/chat-channel-provisioning.test.js tests/chat-membership-guards.test.js tests/chat-poll-authz.test.js tests/chat-reminders.test.js tests/chat-upload-route.test.js tests/chat-task-authz.test.js tests/chat-render-safety.test.js tests/reporting-visibility-scope.test.js tests/operational-business-context.test.js tests/d05-chat-ai-containment.test.js
```

Additional command:

```powershell
node --test tests/dashboard-assistant.test.js tests/hr-shift-segments-routes.test.js tests/staff-timeline-roster.test.js tests/openclaw-bridge-stale-messages-hardening.test.js tests/telegram-startup-skip.test.js
```

The HTTP/engine increment needed no existing fixture edits. Its checks include two organizations,
different business roles, custom context, same fixture session after cutover/revoke,
auth/role preservation, all existing JWT Kleshnya routes, legacy Park positive
responses, and preserved custom-secret bridge authentication. The 68-pass sweep
already includes the eight new checks; do not add them again when counting unique
test results. Live QA was not run by this subtask.

Final WS commands:

```powershell
node --test tests/websocket-event-access.test.js tests/websocket-membership.test.js
wsl -d Ubuntu -u postgres -- env BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST=1 node --test '/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-auth-p0-20260912/tests/integration/multibusiness-streaming-ownership-postgres.test.js'
```

The PG suite uses actual JWT/account refresh, membership SQL, WebSocket dispatch,
loopback HTTP and a random fixture-owned database. Existing cleanup closes sockets
and pools, drops only that database, then asserts its name is absent from
`pg_database`. It does not use `DATABASE_URL`, production credentials or providers.

The two added PG scenarios cover an already joined socket across Park cutover,
role change, revoked memberships, inactive organization/business, all three
transcript event types, direct mentions, repeated join/typing denial, raw
NULL/empty/aggregate/foreign stored defaults, and a single account with different
Park/Dar roles plus a custom business in a second organization. The same JWT
connection stays open while availability changes. Existing actual session
revocation, booking links/previews, task privacy/observer SQL, Omni permission,
presence and owner-invariant tests also pass.

Fixture changes are explicit: prior positive unowned channel/transcript controls
now use pre-cutover Park; four mock socket users have their intended stored
defaults; the PG Park/Dar businesses explicitly enable `timeline`, which D03 now
requires. No expectation was relaxed to accept a denied valid legacy control.
`tests/websocket-event-access.test.js` preserves specialized policy checks and
adds four D05 cases; the existing socket suite retains all 24 expectations.
The initial and final runs overlap and must not be added as distinct tests.

### Extra startup suite — NOT_BASELINE_PREEXISTING_MOCK_DRIFT

All six failures in `chat-ai-callers.log` are
`tests/telegram-startup-skip.test.js`, error:
`Unexpected require in startup test: ./services/omni-health`.
Both `server.js` and this test are unchanged from HEAD (`git diff --quiet` exit 0),
and HEAD already registers `recheckActiveOmniConnections`. The startup VM stubs
Kleshnya engine loading; it does not execute the changed runtime files. Its
unhandled pre-existing import is unrelated to the new containment. No server or
Telegram fixture was edited to silence it. The parent task will report the actual
required baseline result separately; this additional suite is not called green.

## Explicit residuals: this does not close the whole chat domain

| Path / exact anchor | Remaining behavior and next scope |
| --- | --- |
| Durable channel/transcript ownership | The formerly open WS recipient branches are now contained and locally verified above. Channels/transcripts still lack business ownership; do not reopen them for membership businesses until a reviewed owner/migration policy and cabinet-aware routing contract exist. Booking-linked channels retain their independent canonical booking checks. |
| `routes/kleshnya.js:/pending-messages`, `/sync-chat`, `/webhook`; `services/kleshnya-bridge.js` | Custom-secret bridge remains enabled when configured. Pending pickup reads/updates global transcript rows; sync-chat can write/read username history before calling the engine; webhook persists replies. Engine now returns unavailable for its null actor, but does not undo these bridge-side accesses. These protected integration contracts need their own identity/ownership decision; no blanket JWT conversion or secret change here. |
| `services/kleshnya-bridge.js:processStaleMessages`; `server.js` OpenClaw registration | Conditional stale fallback still reads history, clears generating state and writes assistant/session rows around the guarded engine call. Missing actor produces an unavailable message and zero engine data/AI work, but the background transcript writer remains. Do not claim the whole bridge is paused. |
| `services/chatService.js`, chat bot/background producers and existing push delivery | Direct service reads/writes and push producers do not pass through the new REST guard. Their general WS recipients now pass the fresh guard, but this does not prevent actorless transcript/channel processing or non-WS push. Existing channel membership/personal-account storage remains the authority until a reviewed ownership migration or exact provider containment covers these consumers. No public-asset/storage ownership change was made. |
| Frontend unavailable UX | APIs return stable unavailable errors. A dedicated chat/assistant empty-state/browser review was not implemented or executed here; UI/session cache behavior is not certified by HTTP tests. Shared menu/router/theme remains unchanged. |

Next action: review the remaining exact background/provider contracts, obtain
the applicable domain scope and complete local executable denial/retry checks.
Do not mark D05 globally complete, reopen chat for memberships, infer an owner,
or remove compatibility because the HTTP/engine subset passes.

## Frozen source hashes

| File | SHA256 |
| --- | --- |
| `routes/chat.js` | `1852A3EE20A94C1AC399511A34EC187BCFB65537E1722FF2BAE92F046F3A00E7` |
| `routes/kleshnya.js` | `B6E68348F2D3BD24BA8B736867749143E14E3964DCE8EE845305CF8B8637317F` |
| `services/kleshnya-chat.js` | `5633F2F23CFCC75C61D11963BF4696C2A1BDA1684D1762F6926E6DB8C510274F` |
| `tests/d05-chat-ai-containment.test.js` | `128937286086898AA4D1044B2E53FF5B506B5B2315F680C1A2CF1314619E0E9F` |
| `services/websocketEventAccess.js` | `92302714E91F53B4EA41A588BE25B0404976250E59DF37876B5CE5698C812A8A` |
| `tests/websocket-event-access.test.js` | `BC52E91007DEED2B232AF0D260EEFD364811136488464D8C321E698FE8475AC5` |
| `tests/websocket-membership.test.js` | `F26C55B7028F58564ECEB59BB414A53C43F8DDF2BA859EF3ED54F5621B762EFF` |
| `tests/integration/multibusiness-streaming-ownership-postgres.test.js` | `53EE81D7542177514BF61E22291B8478A9C23018B80134F2094B3DACDA1072B6` |
