# OMNI chat to lead progress

## OMNI-TD1 — baseline sync and documentation refresh

Status: complete as docs-only synchronization. No version bump, code change, commit, push, deploy, secret change or real provider activation was performed in this task.

Worktree / branch:

- Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/omni-l1-chat-to-lead`
- Branch: `codex/omni-l1-chat-to-lead`
- Before sync: `743818bcafccce0f7cda3ee0f261a0db3743b606`
- Fast-forward target: `origin/codex/eventgenix-production` at `6047facd84b66f8a9b35030d2a2580919368a089`
- Current package marker after sync: `v0.81.128 — Мультибізнес foundation`
- Current live production proof during TD1: `v0.81.124 — PARK/DAR каса та знижки`, SHA `ec57e5c9d31461d3c4eec03f4bc943f3f2561cd4`, branch `codex/eventgenix-production`, Railway deployment `4895dbf1-a4c0-4655-8243-71fe3c3e9849`

Read-only evidence captured during TD1:

- `git status --short --branch` in the Omni worktree was clean before sync and clean after the fast-forward.
- `git merge-base --is-ancestor HEAD origin/codex/eventgenix-production` passed before sync; `git merge --ff-only origin/codex/eventgenix-production` advanced the worktree without merge commits.
- GitHub Actions: manual release CI `34640743048` passed for `f06524029975ad70d1d7d0ec8d1bd97ebbc1b71b`; AI release CI `34643662228` passed for `bcf1bfac59812a254c3ac23b54abd48df7f792a3`; WhatsApp release fix CI `34647934730` passed for `a786c8d75ea567cc21093bb910a485be16c1b913`; WhatsApp evidence CI `34651007895` passed for `743818bcafccce0f7cda3ee0f261a0db3743b606`.
- Railway deployment list: manual `v0.81.120` deployment `664200c1-7ccf-4d1a-bd22-0709a65c0404`; AI `v0.81.121` deployment `51ce85b1-c994-4f91-a86c-ffffd3cd3ef5`; WhatsApp code `v0.81.122` deployment `7ab9ddf9-5804-411c-b1a9-6674e42eaa96`; WhatsApp evidence `v0.81.123` deployment `905d7e33-9b40-4760-8260-3da8d0c15b50`; current live `v0.81.124` deployment `4895dbf1-a4c0-4655-8243-71fe3c3e9849`.
- Live read-only QA: `/api/version` returned `200` with `v0.81.124`, commit `ec57e5c9d31461d3c4eec03f4bc943f3f2561cd4`, branch `codex/eventgenix-production`; `/api/health` returned `200 ok`; `/omni.html` returned `200` and static HTML.
- Later remote markers `v0.81.126` and `v0.81.127` have failed CI runs `34682309700` and `34682664033`; `v0.81.128` CI run `34683044223` was still in progress during TD1. TD1 records them as remote branch state, not live production proof.

Updated documents:

- `docs/OMNI_CHAT_TO_LEAD_AUDIT_AND_STORIES_2026-09-11.md`
- `docs/OMNI_CHAT_TO_LEAD_PROGRESS_2026-09-11.md`

Notes:

- WhatsApp remains `ACTIVATION_PENDING` for the real account. No real WhatsApp number, Meta subscription, production secret, env var or external message was changed.
- The main checkout is dirty and behind/ahead; it was inspected only to avoid touching unrelated work. All TD1 edits are in the clean Omni worktree.

## OMNI-L1 — backend create/link contract

Status: released to production through OMNI-L4/manual as part of `v0.81.120 — Omni: ручне створення ліда`.

Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/omni-l1-chat-to-lead`

Branch: `codex/omni-l1-chat-to-lead`

Base SHA: `666c806a568602454bc8d523981ea5d1c7621156`

Implementation commit SHA: `237cf26375840c4690d80fe02db24c3543a8646d`

Release commit SHA: `f06524029975ad70d1d7d0ec8d1bd97ebbc1b71b`

Plan copy: `docs/OMNI_CHAT_TO_LEAD_AUDIT_AND_STORIES_2026-09-11.md`

### Changes

- `services/omniLeadAssistant.js`
  - Added a reviewed draft path for `createLeadFromConversation` so OMNI-L2 can create a lead from a manual drawer payload without invoking AI.
  - Preserved the old AI-approved path by allowing `analysis.lead` to continue feeding the same writer.
  - Added allowlisted draft normalization for `eventPreference`, adults/children counts, manager notes, celebrants, program id and `assignedTo`.
  - Preserved manager notes in lead notes instead of dropping `lead.notes`.
  - Resolves the Omni conversation assignee username/name to an active lead assignee user id using the existing lead assignee role set.
  - Serializes create/link by locking the conversation row with `FOR UPDATE`.
  - Handles `idx_leads_business_external_id` unique-source races with `ON CONFLICT ... DO NOTHING` and returns the existing lead with `created:false`.
  - Saves `lead_event_preferences` in the same transaction when the reviewed draft has event preference data.
  - Keeps lead insert and conversation meta link in one transaction, so link failure rolls back the lead insert.

- `routes/omnichannel.js`
  - The create-lead endpoint now requires the same lead-create role surface (`manager`/`marketer`) in addition to the existing Omni page/business checks.
  - Added response shaping for users without `view_revenue`, redacting budget/potential-value fields from the create response.
  - Accepts `draft`, `leadDraft` or `lead` for the new manual path; keeps the old `analysis` path; only falls back to analyze when neither draft nor analysis is supplied.

- `tests/omni-lead-assistant.test.js`
  - Added behavior coverage for manual draft create, owner mapping, event preference save, unique-source race idempotency and transaction rollback on link failure.

### Verification

- `npm run check:runtime` — passed, Node 22.23.1 / npm 10.9.8.
- `node --test tests/omni-lead-assistant.test.js` — passed, 9/9.
- `node --test tests/omni-lead-assistant-materials.test.js tests/omni-case-link.test.js tests/omni-workspace-behavior.test.js` — passed, 35/35.
- `npm run test:ui` — passed, 1312/1312.
- `npm run check:syntax` — passed after rerun with sandbox escalation; 1136 files.
- `node --test tests/manage-settings-system-surfaces.test.js tests/omni-completion.test.js tests/omni-hardening.test.js` — passed, 36/36.
- `node --test tests/route-smoke.test.js` — passed, 101/101.
- `git diff --check` — passed; only existing CRLF conversion warnings from Git were printed.

### Release evidence

- L1 and L2 were released together by OMNI-L4/manual.
- CI exact SHA: GitHub Actions run `34640743048` passed for `f06524029975ad70d1d7d0ec8d1bd97ebbc1b71b`.
- Railway deploy: production deployment `664200c1-7ccf-4d1a-bd22-0709a65c0404`, message `Release v0.81.120 Omni: ручне створення ліда (f0652402; codex/eventgenix-production)`.
- Current live read-only proof on 12.09.2026 shows a later deployed SHA `ec57e5c9d31461d3c4eec03f4bc943f3f2561cd4` that descends from this release.

## OMNI-L2 — create a lead directly from the Omni chat

Status: released to production through OMNI-L4/manual as part of `v0.81.120 — Omni: ручне створення ліда`.

Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/omni-l1-chat-to-lead`

Branch: `codex/omni-l1-chat-to-lead`

Base SHA: `666c806a568602454bc8d523981ea5d1c7621156`

Implementation commit SHA: `237cf26375840c4690d80fe02db24c3543a8646d`

Release commit SHA: `f06524029975ad70d1d7d0ec8d1bd97ebbc1b71b`

### Changes

- `omni.html`
  - Added the primary header action `Створити лід`; when the conversation already has an exact linked lead, the same action becomes `Відкрити лід`.
  - Added an editable `Чернетка ліда з діалогу` drawer with manager-reviewed fields for client identity, contact, source, event type/date, children/adults count, age, program preferences and notes.
  - The manual drawer saves through the L1 `draft` path and never sends an `analysis` payload or starts AI.
  - Kept the old AI assistant as a secondary `AI-помічник` mode. Opening it no longer auto-runs analysis; the manager must explicitly click `Оновити аналіз`.
  - Stored draft/pending/result state by `businessContext:conversationId`, preserved manual edits on refresh/switch, and rejected stale create results after switching chats or business context.
  - Preserved existing status, assignee, reply-waiting, close/reopen and AI controls while improving labels for status/responsible/lead actions.
  - Added mobile and dark-mode styling for the lead draft form.

- `tests/omni-workspace-behavior.test.js`
  - Added coverage that opening the manual lead draft does not call AI analysis, settings or create endpoints.
  - Added coverage that manual create sends a reviewed `draft` payload without `analysis` and marks the conversation as linked on success.
  - Added stale-result coverage so a create response from chat A cannot update chat B after navigation.

### Verification

- `npm run check:runtime` — passed, Node 22.23.1 / npm 10.9.8.
- `node --test tests/omni-workspace-behavior.test.js` — passed after sandbox escalation for the canonical runner; 32/32. A same-process fallback `node tests/omni-workspace-behavior.test.js` also passed, 32/32.
- `node --test tests/omni-lead-assistant.test.js tests/omni-lead-assistant-materials.test.js tests/omni-case-link.test.js tests/omni-workspace-behavior.test.js` — passed after sandbox escalation; 47/47.
- `npm run test:ui` — passed, 1312/1312.
- `npm run check:syntax` — passed after sandbox escalation; 1136 files.
- `git diff --check` — passed; only Git CRLF conversion warnings were printed.

### Release evidence

- L1 and L2 were released together by OMNI-L4/manual.
- CI exact SHA: GitHub Actions run `34640743048` passed for `f06524029975ad70d1d7d0ec8d1bd97ebbc1b71b`.
- Railway deploy: production deployment `664200c1-7ccf-4d1a-bd22-0709a65c0404`, message `Release v0.81.120 Omni: ручне створення ліда (f0652402; codex/eventgenix-production)`.
- Live QA artifact for the original manual release is not separately present in this progress file, but current read-only live QA confirms `/omni.html` is reachable and the later live deployment includes this release by ancestry.

## OMNI-L3 — AI draft preview fill

Status: released to production through OMNI-L4/AI as `v0.81.121 — Omni: AI-заповнення ліда`.

Worktree / branch:

- Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/omni-l1-chat-to-lead`
- Branch: `codex/omni-l1-chat-to-lead`
- Base release context: first manual release `v0.81.120` on this branch.
- Release commit SHA: `bcf1bfac59812a254c3ac23b54abd48df7f792a3`

Implemented:

- Added `POST /api/omni/conversations/:id/lead-assistant/preview-draft` as a preview-only route guarded by Omni access, manager/marketer role gate and write-rate limiter.
- Added direct OpenAI Responses adapter for Omni chat-to-lead draft preview in `services/omniLeadAssistant.js`.
- Added a latest-window conversation reader for this preview path, avoiding the old first-120-message risk in the legacy analyze path.
- Added strict JSON schema request, timeout handling, missing-key/provider errors and server-side validation of AI output.
- Server validation accepts a non-null AI field only when it has inbound/customer message evidence from the returned snapshot. Outbound manager suggestions and unsupported message ids are rejected and surfaced as warnings/missing fields.
- Added `Заповнити з чату AI` button to the existing reviewed lead draft drawer. AI fill updates only empty fields and preserves existing/manual field values. It does not call create-lead, analyze, send, task, customer or conversation mutation endpoints.
- Added preview summary in the drawer: applied fields, missing fields, conflicts and provider model.
- Updated provider diagnostics and `docs/AI_PROVIDER_CONTRACT.md` to record this as a narrow direct OpenAI preview rail, without changing the old OpenRouter Omni lead assistant text rail.

Changed files:

- `services/omniLeadAssistant.js`
- `routes/omnichannel.js`
- `omni.html`
- `services/ai-config.js`
- `docs/AI_PROVIDER_CONTRACT.md`
- `tests/omni-lead-assistant.test.js`
- `tests/omni-workspace-behavior.test.js`

Verification performed:

- `npm run check:runtime` — passed: Node 22.23.1 / npm 10.9.8.
- `node --check services/omniLeadAssistant.js` — passed.
- `node --check routes/omnichannel.js` — passed.
- `node --check services/ai-config.js` — passed.
- `node tests/omni-lead-assistant.test.js` — passed, 11/11.
- `node tests/omni-workspace-behavior.test.js` — passed, 34/34.
- `npm run check:api-surface` — passed.
- `npm run check:static-surface` — passed.
- `npm run check:syntax` — first sandbox attempt failed with `spawnSync ... EPERM`; rerun outside sandbox passed: JavaScript syntax check passed for 1136 files.

OMNI-L4/AI release evidence:

- Commit/push: `bcf1bfac59812a254c3ac23b54abd48df7f792a3`, pushed to `codex/eventgenix-production`.
- CI exact SHA: GitHub Actions run `34643662228` passed for `bcf1bfac59812a254c3ac23b54abd48df7f792a3`.
- Railway deploy: production deployment `51ce85b1-c994-4f91-a86c-ffffd3cd3ef5`, message `Release v0.81.121 Omni: AI-заповнення ліда (bcf1bfac; codex/eventgenix-production)`.
- Live QA artifact for the original AI release is not separately present in this progress file. Current read-only live QA confirms `/api/version`, `/api/health` and `/omni.html` on the later live deployment; no live AI-preview request was run during TD1.

## OMNI-L5 — WhatsApp in shared Omni inbox

Status: released to production through OMNI-L4/WhatsApp. Code, migration, CI, Railway deploy and live QA are complete. Real WhatsApp account activation remains ACTIVATION_PENDING until a concrete test WABA/number/secrets/subscription scope is provided and approved.

Worktree / branch:

- Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/omni-l1-chat-to-lead`
- Branch: `codex/omni-l1-chat-to-lead`
- Base SHA before L5: `bcf1bfac59812a254c3ac23b54abd48df7f792a3`
- L5 implementation commit SHA: `3b33ec209dcccb8bb7dd68b1fe3ec6760e47a31f`
- L4/WhatsApp release fix commit SHA: `a786c8d75ea567cc21093bb910a485be16c1b913`
- L4/WhatsApp evidence release commit SHA: `743818bcafccce0f7cda3ee0f261a0db3743b606`
- Production release branch: `codex/eventgenix-production`
- Production release versions: `v0.81.122 — Omni: WhatsApp inbox`; `v0.81.123 — Omni: докази релізу WhatsApp`

Implemented:

- Added `whatsapp` as a first-class Omni channel through the existing account connection registry, shared inbox filters, conversation visuals, send truth and lead/AI draft flows.
- Added official WhatsApp Business Platform / Cloud API text-send adapter in `services/omni-whatsapp.js`, using existing encrypted connection/runtime config boundaries and no new dependencies.
- Added 24-hour WhatsApp customer-care-window guard for manual free-form replies. Closed-window sends are blocked before DB insert/provider call with a clear `WHATSAPP_REPLY_WINDOW_CLOSED` send truth.
- Added dedicated `/api/omni/webhook/whatsapp` GET verification and POST webhook route with raw-body HMAC `X-Hub-Signature-256`, object check, WABA ID and Phone Number ID match before any CRM write.
- Added WhatsApp webhook normalizer for inbound text/buttons/interactive/contact/location/media captions and lifecycle receipts (`sent`, `delivered`, `read`, `failed`). Receipts update provider lifecycle and do not create inbound messages.
- Added raw-body capture for WhatsApp in both `server.js` and `services/omni-webhook-payload.js`.
- Added minimal governed migration `db/migrations/356_omni_whatsapp_channel.sql` to replace the `conversations.channel` CHECK constraint with a list that includes `whatsapp`. No rows are inserted, updated, deleted or backfilled.
- Added UI channel filter/button/name/badge/avatar support for WhatsApp in `omni.html`. Existing manual lead create and AI draft preview use the shared L1–L3 drawer automatically for WhatsApp conversations.
- Added regression coverage for signed WhatsApp webhooks, account mismatch ignore-before-persistence, normalizer message/receipt mapping, WhatsApp send truth provider references, closed reply window blocking, channel migration and UI filter wiring.

Changed files:

- `server.js`
- `routes/omnichannel.js`
- `services/omni-accounts.js`
- `services/omni-hub.js`
- `services/omni-normalizer.js`
- `services/omni-webhook-payload.js`
- `services/omni-whatsapp.js`
- `omni.html`
- `db/migrations/356_omni_whatsapp_channel.sql`
- `tests/omni-provider-lifecycle.test.js`
- `tests/omni-send-truth.test.js`
- `tests/omni-workspace-behavior.test.js`

Verification performed:

- `node --check services/omni-normalizer.js routes/omnichannel.js services/omni-accounts.js services/omni-whatsapp.js tests/omni-provider-lifecycle.test.js tests/omni-send-truth.test.js tests/omni-workspace-behavior.test.js` — passed.
- `node --test tests/omni-provider-lifecycle.test.js tests/omni-send-truth.test.js tests/omni-workspace-behavior.test.js tests/omni-lead-assistant.test.js tests/omni-case-link.test.js` — first sandbox run failed with Windows `spawn EPERM`; rerun outside sandbox passed, 102/102.
- `npm run check:migrations` — passed after adding required `-- OPERATOR_APPROVAL: required` governance header for the CHECK-constraint replacement.
- `npm run check:syntax` — first sandbox run failed with `spawnSync ... EPERM`; rerun outside sandbox passed, 1137 files.
- `npm run check:runtime` — passed, Node 22.23.1 / npm 10.9.8.
- `npm run check:api-surface` — passed.
- `npm run check:static-surface` — passed.

OMNI-L4/WhatsApp release evidence:

- Commit/push: implementation `3b33ec209dcccb8bb7dd68b1fe3ec6760e47a31f`, release fix `a786c8d75ea567cc21093bb910a485be16c1b913`, evidence release `743818bcafccce0f7cda3ee0f261a0db3743b606`, pushed to `codex/eventgenix-production`.
- CI exact SHA: GitHub Actions run `34647934730` passed all jobs for `a786c8d75ea567cc21093bb910a485be16c1b913`; GitHub Actions run `34651007895` passed all jobs for evidence release `743818bcafccce0f7cda3ee0f261a0db3743b606`.
- Railway deploy: production deployment `7ab9ddf9-5804-411c-b1a9-6674e42eaa96` completed through `npm run release:railway-up`.
- Railway evidence deploy: production deployment `905d7e33-9b40-4760-8260-3da8d0c15b50`, message `Release v0.81.123 Omni: докази релізу WhatsApp (743818bc; codex/eventgenix-production)`.
- Version smoke: live `/api/version` returned `v0.81.122 — Omni: WhatsApp inbox @ a786c8d75ea5`, branch `codex/eventgenix-production`, deployment metadata `manifest`.
- Live QA: production health `200`; test-auth verify passed; `omni.html` exposes WhatsApp filter/channel surface; `/api/omni/accounts` exposes WhatsApp as `disconnected`, `sendCapable=false`, `receiveCapable=false`; `/api/omni/conversations?channel=whatsapp&limit=1` returned success with `0` conversations; unsigned `/api/omni/webhook/whatsapp` was blocked with `401`.
- TD1 current live read-only proof: live now runs later `v0.81.124` at `ec57e5c9d31461d3c4eec03f4bc943f3f2561cd4`, branch `codex/eventgenix-production`; `/api/health` returned `200 ok`; `/omni.html` returned `200`. WhatsApp remains intentionally disconnected unless a real activation packet is supplied and approved.
- CI issue fixed before deploy: initial Fast baseline failed because `omni.html` exceeded theme-surface debt budget by WhatsApp-specific duplicate colors. Fixed by reusing the existing green channel style for WhatsApp avatar/badge/dot; no product logic changed.

ACTIVATION_PENDING for real WhatsApp account:

- No real WhatsApp secrets, env vars, Meta subscriptions, business settings or numbers were changed.
- No external WhatsApp messages were sent.
- Live production status is intentionally truthful: WhatsApp code is present, but the channel is not connected to a real account yet.
- To move from `ACTIVATION_PENDING` to `LIVE_CONNECTED`, provide and approve a scoped test activation packet:
  - business context to bind (`event_genix`, `maysternya_doli`, `dar`, or another supported context);
  - Meta WABA ID;
  - WhatsApp Phone Number ID;
  - permanent/system-user WhatsApp access token;
  - Meta app secret for `X-Hub-Signature-256` verification;
  - webhook verify token;
  - optional display phone number/account name for admins;
  - exact public callback URL: `https://8223324090-production.up.railway.app/api/omni/webhook/whatsapp`;
  - explicit approval to set/rotate production secrets and subscribe Meta Webhooks to WhatsApp `messages`;
  - one safe test recipient/number and approved test message text for the control exchange.
- Activation QA checklist after credentials exist:
  - verify `GET /api/omni/accounts` changes WhatsApp from `disconnected` to connected/send/receive capable only for the intended business context;
  - verify Meta GET webhook challenge with the provided verify token;
  - send one signed synthetic WhatsApp webhook payload and confirm mismatched WABA/Phone Number ID is ignored before persistence;
  - receive one real inbound test message from the approved test number;
  - send one manual reply only inside the 24-hour customer-care window;
  - verify receipts update provider lifecycle without creating inbound messages;
  - create one test lead from the WhatsApp test conversation through the shared reviewed draft flow;
  - keep evidence redacted and do not expose tokens, app secret, phone ownership data or recipient details in logs/docs.

## OMNI-TD5 — WhatsApp controlled activation readiness

Status: released to production through OMNI-TD6 as part of `v0.81.131 — Omni: техборг чат-лід`. Real WhatsApp account activation remains `ACTIVATION_PENDING`.

Implemented:

- Added a read-only WhatsApp activation preflight to account status. It reports only required configuration categories as `present` or `missing`: WABA ID, Phone Number ID, access token, Meta app secret, webhook verify token and callback URL.
- Kept WhatsApp `disconnected`, `sendCapable=false` and `receiveCapable=false` while any required preflight category is missing.
- Added Omni account-status UI chips for the WhatsApp activation preflight, including the connection modal.
- Tightened the WhatsApp webhook guard so unsigned or wrongly signed POST requests return `401` and do not persist inbound messages or receipts.
- Added fixture coverage for challenge verification, unsigned POST rejection, account mismatch before persistence, receipts and redacted preflight serialization.
- Added operator runbook: `docs/integrations/whatsapp/ACTIVATION_RUNBOOK.md`.

Activation boundaries:

- No real WABA number was connected.
- No production secrets, env vars, Meta subscriptions or provider settings were changed.
- No WhatsApp messages were sent.
- The runbook documents the controlled inbound/outbound activation scenario, but executing it requires a separate scoped approval with test WABA/number/secrets and a safe test recipient.

## OMNI-TD6 — technical debt package release

Status: released to production as `v0.81.131 — Omni: техборг чат-лід`.

Production impact: yes. This release shipped the completed OMNI-TD1–TD5 package to the confirmed production branch and Railway production service. Real WhatsApp number activation was not performed.

Worktree / branch:

- Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/omni-l1-chat-to-lead`
- Source work branch: `codex/omni-l1-chat-to-lead`
- Production release branch: `codex/eventgenix-production`
- Implementation commit SHA after rebase: `3f79791739a331c8c9d50e75279f5335fc70596f`
- Release/version commit SHA: `2fe83e7e5d071b1c9d9611537d698e88d117b4e2`
- Release version: `0.81.131`
- Release label: `Omni: техборг чат-лід`

Released package:

- OMNI-TD1 documentation/baseline synchronization.
- OMNI-TD2 single reviewed-draft path for creating leads from Omni, with the legacy AI helper transferring into the editable draft instead of creating directly.
- OMNI-TD3 shared latest-message window for Omni AI/analyze/follow-up/helper paths, with preview separated from business writes.
- OMNI-TD4 explicit new-opportunity lead flow for repeat events in the same chat, with idempotent replay protection.
- OMNI-TD5 WhatsApp controlled-activation readiness: redacted preflight, runbook, fixture coverage and truthful disconnected status until complete config exists.

Verification before release:

- `node --test tests/omni-lead-assistant.test.js tests/omni-lead-assistant-materials.test.js tests/omni-case-link.test.js tests/omni-workspace-behavior.test.js tests/omni-provider-lifecycle.test.js tests/omni-send-truth.test.js` — passed, 116/116.
- `npm run check:theme-surface` — passed after moving the WhatsApp activation preflight styles from inline `omni.html` into `css/omni-workspace.css`.
- `npm test` — passed: runtime/version/access/auth/static/CSS/theme/API/storage/service-worker/scheduler/DB/timeline/migration/syntax checks, 337 unit tests, and UI smoke 1312/1312.
- `git diff --check` — passed.

CI and deploy evidence:

- Pushed exact release SHA `2fe83e7e5d071b1c9d9611537d698e88d117b4e2` to `codex/eventgenix-production`.
- GitHub Actions CI run `34684959841` passed all jobs for `2fe83e7e5d071b1c9d9611537d698e88d117b4e2`.
- Railway deploy completed through `node scripts/railway-release-up.js --branch codex/eventgenix-production --commit 2fe83e7e5d071b1c9d9611537d698e88d117b4e2`.
- Railway production deployment id: `c25dbf4d-c94e-418b-92e0-0eb05b4ddd65`.
- Railway image digest: `sha256:b716214f6e141e9a886e99ce55c16e7b195eff083ed274052d59ee5912a224e7`.
- Version smoke: live `/api/version` returned `v0.81.131 — Omni: техборг чат-лід @ 2fe83e7e5d07`, branch `codex/eventgenix-production`, deployment metadata `manifest`.

Live QA:

- Read-only public QA: `/api/version` returned exact SHA `2fe83e7e5d071b1c9d9611537d698e88d117b4e2`; `/api/health` returned `status=ok`, `database=connected`; `/omni.html` returned `200` and included `AI-помічник`, `Закрити діалог` and `Створити лід для нової події`.
- Authenticated live smoke with test account passed: `/api/version`, `/api/health`, `/api/ready`, `/api/health/deep`, bookings, lines and leads smoke checks.
- WhatsApp live status remained truthful: `/api/omni/accounts` returned WhatsApp `disconnected`, `sendCapable=false`, `receiveCapable=false`, with redacted activation preflight present and one missing category. Unsigned `POST /api/omni/webhook/whatsapp` returned `401`.
- Synthetic Omni QA used only conversation `#5`, selected because read-only DB metadata showed `codex` in `external_id` for `event_genix` and not in message text. No real customer dialogue was used for lead creation.
- AI-preview QA: `POST /api/omni/conversations/5/lead-assistant/preview-draft?businessContext=event_genix` succeeded and returned a non-empty reviewed draft preview. This was one OpenAI preview call.
- Manual reviewed-draft QA: `POST /api/omni/conversations/5/lead-assistant/create-lead?businessContext=event_genix` with an explicit synthetic new-opportunity draft created test lead `#130`.
- Idempotency QA: replaying the same synthetic new-opportunity draft returned `created=false` and the same test lead `#130`, confirming no duplicate lead for the same draft replay.

Boundaries preserved:

- No real WhatsApp number was connected.
- No Meta subscription, production secret, production env var or provider setting was changed.
- No external WhatsApp messages were sent.
- Live QA used test credentials and a synthetic Codex Omni conversation only.
