# OMNI chat to lead progress

## OMNI-L1 — backend create/link contract

Status: complete locally; ready for OMNI-L2. Commit/push/deploy were intentionally not run because the L1 activator reserves them for L4/manual.

Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/omni-l1-chat-to-lead`

Branch: `codex/omni-l1-chat-to-lead`

Base SHA: `666c806a568602454bc8d523981ea5d1c7621156`

Commit SHA: none yet

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

### Notes for OMNI-L2

- Continue in this worktree/branch, not in the original dirty checkout.
- The L2 UI should call `POST /api/omni/conversations/:id/lead-assistant/create-lead` with a reviewed `draft`/`leadDraft` payload. That path does not call AI.
- For an existing explicit link or unique-source repeat, expect `created:false` and the linked lead in `lead`.
- The UI can pass `assignedTo`/`assigned_to` as a user id. If it does not, L1 maps `conversation.assigned_to` username/name to an active assignable lead owner when possible.
- Live QA is still deferred to L4/manual.

## OMNI-L2 — create a lead directly from the Omni chat

Status: complete locally on top of L1; ready for OMNI-L3. Commit/push/deploy were not run because this activator is still inside the planned pre-release implementation chain.

Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/omni-l1-chat-to-lead`

Branch: `codex/omni-l1-chat-to-lead`

Base SHA: `666c806a568602454bc8d523981ea5d1c7621156`

Commit SHA: none yet

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

### Notes for OMNI-L3

- The `AI-помічник` button is now a secondary mode. L3 can add a dedicated `Заповнити з чату AI` action that writes AI-proposed fields into the same manual draft instead of creating a lead directly.
- Keep the stale guard pattern from L2: capture `conversationId`, `businessContext`, `workspaceEpoch` and the draft key before async AI fill/create, then ignore late responses when the user switches chat/business.
- Live QA is still deferred to L4/manual.

## OMNI-L3 — AI draft preview fill

Status: complete locally on top of first released manual flow; ready for OMNI-L4/AI. Commit/push/deploy and live OpenAI calls were not run in this activator.

Worktree / branch:

- Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/omni-l1-chat-to-lead`
- Branch: `codex/omni-l1-chat-to-lead`
- Base release context: first manual release `v0.81.120` on this branch.

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

Notes for OMNI-L4/AI:

- Commit/push/CI/deploy/live QA remain pending by design.
- Live QA should use only test accounts and synthetic Omni conversations; do not send external messages.
- The L4/AI activator allows up to 5 live AI-preview requests through the existing OpenAI connection. Verify missing-key/provider error handling only if safe in the active environment; do not change secrets or env.
- Important scenarios: manual create still works; AI preview fills empty fields only; manual values are preserved; evidence/missing/conflicts render; stale preview after chat switch is ignored; outbound manager suggestions are not accepted as client facts.

## OMNI-L5 — WhatsApp in shared Omni inbox

Status: released to production through OMNI-L4/WhatsApp. Code, migration, CI, Railway deploy and live QA are complete. Real WhatsApp account activation remains ACTIVATION_PENDING until a concrete test WABA/number/secrets/subscription scope is provided and approved.

Worktree / branch:

- Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/omni-l1-chat-to-lead`
- Branch: `codex/omni-l1-chat-to-lead`
- Base SHA before L5: `bcf1bfac59812a254c3ac23b54abd48df7f792a3`
- L5 implementation commit SHA: `3b33ec209dcccb8bb7dd68b1fe3ec6760e47a31f`
- L4/WhatsApp release fix commit SHA: `a786c8d75ea567cc21093bb910a485be16c1b913`
- Production release branch: `codex/eventgenix-production`
- Production release version: `v0.81.122 — Omni: WhatsApp inbox`

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

- Commit/push: implementation `3b33ec209dcccb8bb7dd68b1fe3ec6760e47a31f`, release fix `a786c8d75ea567cc21093bb910a485be16c1b913`, pushed to `codex/eventgenix-production`.
- CI exact SHA: GitHub Actions run `34647934730` passed all jobs for `a786c8d75ea567cc21093bb910a485be16c1b913`.
- Railway deploy: production deployment `7ab9ddf9-5804-411c-b1a9-6674e42eaa96` completed through `npm run release:railway-up`.
- Version smoke: live `/api/version` returned `v0.81.122 — Omni: WhatsApp inbox @ a786c8d75ea5`, branch `codex/eventgenix-production`, deployment metadata `manifest`.
- Live QA: production health `200`; test-auth verify passed; `omni.html` exposes WhatsApp filter/channel surface; `/api/omni/accounts` exposes WhatsApp as `disconnected`, `sendCapable=false`, `receiveCapable=false`; `/api/omni/conversations?channel=whatsapp&limit=1` returned success with `0` conversations; unsigned `/api/omni/webhook/whatsapp` was blocked with `401`.
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
