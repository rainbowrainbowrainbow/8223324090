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
