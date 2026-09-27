# Lead workspace UI contract

This contract covers LEAD-UI-1 viewing/navigation and the LEAD-UI-2 shared editor
of the unified lead card. `leads.html`, `js/leads-page.js`, and `css/pages-leads.css` own one
`#leadWorkspace`. The existing
workspace API and [Omni link contract](OMNI_LEAD_CONVERSATION_LINKS.md) remain the
data sources. LEAD-UI-2 implementation/verification status is recorded in its
[handoff](LEAD_UI_2_HANDOFF_2026-09-27.md). The local steps must not be released
individually before the agreed delivery task.

Implementation base: `6f17cd90f3157cba57806d710a9bed607b40ccde` (production
v0.82.30). LEAD-UI-1 reuses the existing clean worktree
`C:\Users\Plotva\.codex\worktrees\omni-close-1\EventGenix` on
`codex/lead-unified-card`; it does not restore files from an older release.

## Entry points and navigation

| Entry point | Target / handler | Mode and side effects |
| --- | --- | --- |
| Table primary action | `openLeadWorkspace(id, { tab: 'overview' })`; visible label `Відкрити лід` (`Відкрити заявку` for Maysternya) | Overview; read only |
| Kanban card body | The same opener without an explicit tab | Overview on first entry; preserves the tab if the same card is already open; action controls must not trigger the card handler |
| Legacy `Кейс` caller | The same opener | Overview on first entry; read only |
| Legacy `Деталі` / pencil view entry | `openLeadDetails(id)` delegates to the opener with `tab: 'details'` | Lead data; read only, never `editLead` |
| Explicit `Редагувати` | `editLead(id)` opens the shared editor in the workspace Details host | Explicit editing; existing save API; creation uses the same form in its modal host |
| Omni lead action | `/sales-funnel?lead=<id>` with the current Omni business context, including the legacy `leadUrl` helper | Same workspace, not a second lead view |
| Customer hub / linked lead | Lead workspace URL, including `leadCrmLinkForCustomer`, with explicit customer business context | Same workspace; opening it must not ensure/create a customer |
| Task source/context link | `taskDetailContract` lead URL uses `lead` and the task's business context; old `?open=<id>` URLs remain readable | Same workspace; change only lead navigation, never task permissions or other source destinations |
| Direct URL, reload, Back/Forward | Parse `lead` (legacy `leadId` and `open` accepted) and `leadTab` | Restore the same lead, business context, and tab |
| Hero `Комунікації` | `setLeadWorkspaceTab('communications')` | In-card navigation only |
| `Відкрити Instagram/Telegram/...` | Existing resolver-selected Omni URL | Open exact available confirmed conversation; no phone/name search |

`openLeadWorkspace(id, { tab, pushState })` is the shared entry point.
`setLeadWorkspaceTab(tab, options)` changes the selected tab of the loaded card.
The four tab keys are `overview`, `details`, `communications`, and `history`.
Unknown or missing tab keys select `overview` on initial entry. Refreshing the
same card after an explicit operation should preserve its selected tab.

The canonical URL carries `lead=<positive integer>`, `leadTab=<tab key>`, and the
current `businessContext`, including the default business when the workspace
updates its URL. Keep existing page filters and use the existing
`CrmBusinessContext` runtime. New URLs use `lead`; closing removes `lead`, legacy
`leadId`/`open`, and `leadTab`, so a stale alias cannot reopen the card on reload. Popstate restores
state without pushing another history entry. Navigation away to Omni followed by
Back must restore the selected lead/tab even when the list page excludes that
lead through filters or pagination. A history entry for a different explicit
business context reloads through the existing context runtime after the editable
surface guard accepts navigation. Cancelling that guard restores the current
workspace URL.

## Content inventory

The following is the preservation matrix for the existing workspace and editor.
Relocating a section is allowed; dropping its data or silently merging distinct
sources is not. The hero contains the common identity/status and one set of
call/channel/communications actions. Customer actions and the explicit edit
button live in Details; the overview action strip does not duplicate them.

| Area / fields | Workspace destination | Rules / existing source |
| --- | --- | --- |
| Client name, phone, Instagram value | Name/phone in Hero and Details; Instagram presence label in Hero/table and stored value in a Details disclosure | `workspace.lead`; escape values; label the stored Instagram value as unverified, never invent `@username` or rewrite the stored value |
| Pipeline stage, aggregate status, lead type; Maysternya topic/session/bot cue | Hero; Overview stage control | Keep current canonical stage/status semantics and business-specific wording; hide implementation labels such as `canonical: pipeline_stage` |
| Event urgency, overdue task count, waiting reply and reply SLA | Hero / Overview | Existing urgency and confirmed-conversation projections; no writes or new SLA calculation policy |
| Assigned manager, source, desired date, program/session type | Details | Existing lead projection and source label helpers |
| Desired-date guest details: children, adults, total | Details; existing editor retained | Preserve `eventPreference` semantics and guest-summary handling; zero and missing must not be confused |
| Multiple celebrants/children, names, birthdays/ages | Details | Keep the existing lead/customer child-source precedence and formatters |
| Lead notes / Maysternya request message | Details | Preserve lead notes independently from customer notes and event preferences |
| Quality category, closing reason, creation/update/last-contact timestamps | Details | Existing workspace lead projection; empty fields remain explicitly empty |
| Linked customer name/phone, children, visit/session count, total spent, last visit, visible notes | Details | `workspace.customer`; preserve current notes visibility/deduplication policy; linking is explicit |
| Inbound data: business, external ID, event type/ID, booking ID, inquiry ID, email, topic, message, session type, page, contact channels, UTM | Details, secondary request/source section | Retain the existing inbound section and escaped values; technical IDs are context, never the main navigation UI |
| Related bookings/events or Maysternya sessions: program/category, date/time, status, price, timeline link | Overview | Existing `workspace.bookings`; first three rows visible, remaining rows in native `details`/`summary`; preserve every available record and canonical timeline URL |
| Next actions/tasks: title, status, priority, deadline, task link | Overview | Existing `workspace.tasks`; first three rows visible, remaining rows in native disclosure; preserve exact task targeting and all available rows |
| Notes and interaction history: kind, text, author, time | History | Existing merged/deduplicated interaction-row helpers; maintain distinction from editable note fields |
| Confirmed conversations: actual channel, account name, display name, last activity/message, reply/SLA cues, origin/primary flags | Communications | Existing `conversationContext.confirmedLinks`; no independent matching/selection logic |
| Unconfirmed suggestions, link chooser, unavailable/empty state | Communications | Existing resolver result; suggestions require explicit manager confirmation |
| Create/edit lead fields and hidden handoff state | One `#leadEditorForm`, mounted in Details for edit or the create modal for create | Keep create flow, quality-category reasons, collaboration-task workflow, customer handoff, and Maysternya behavior |

Existing `#customerCardModal` markup and associated handlers are not proven unused.
Do not delete them as cleanup during this step. Keep distinct customer and lead
data ownership when LEAD-UI-2 traces the remaining callers.

## Action boundaries

| Action | Owner / behavior |
| --- | --- |
| Call | One hero `tel:` link; never duplicate it in the action strip |
| Open exact conversation | One hero channel action plus the contextual conversation-row action; same Omni resolver URL |
| View communications | Switch tab; does not open Omni, send, mark read, create a conversation, or link one |
| Open customer | Details action and Overview's linked customer name; navigate only when an existing customer ID is available; legacy opener without a customer opens Details with an explanation, never calls `ensureLeadCustomerForBooking` |
| Create customer | Explicit Details `Створити клієнта` action; guarded existing ensure operation, duplicate-click protection, refresh the same card only if it remains current |
| Link/change customer | Explicit Details `Прив’язати клієнта` / `Змінити клієнта` chooser; existing permissions and API |
| Link conversation / make primary | Existing explicit POST endpoints from the Omni contract; preserve historical origin |
| Edit lead | Explicit Details button mounts the shared editor inside Details; do not open a second edit modal |
| Move stage / classify type / collaboration | Existing business rules, reasons, and task workflow; navigation does not run them |
| Callback / task completion / open exact task | Existing guarded manager actions; exact task targeting unchanged |
| Open/convert/confirm booking; Maysternya create/open session and follow-up tasks | Existing helpers and checks; no booking contract changes and no alternate detail renderer |

Keep `ensureLeadCustomerForBooking` and its booking/conversion callers unchanged.
An unavailable action should explain the missing relation or permission in plain
language, rather than showing `exact booking`, `exact task`, or internal status
codes as its explanation.

## Safety and accessibility invariants

- Opening, loading, changing tabs, retrying a read, reload, Back, and Forward make
  no lead/customer/conversation writes. An explicit mutation control is required.
- All four tabs consume the same loaded workspace object and business context.
  Responses for an earlier lead, closed card, or previous business are discarded.
- Retain resolver availability checks: an unavailable primary/origin is not
  silently replaced, and approximate matches never auto-open or auto-link.
- Use `tablist`, `tab`, `tabpanel`, `aria-selected`, `aria-controls`, and roving
  tab stops. Arrow/Home/End navigation switches tabs; Tab/Shift+Tab reach controls.
  Hidden panels must not retain focusable visible content.
- Opening focuses the workspace; closing returns focus to the invoking control
  when it still exists. Preserve Esc/backdrop close behavior and shared
  `UnsafeDismissGuard` for any currently open editable surface.
- Retain loading, empty, error, disabled and retry states. A failed read must not
  display another lead's old data under the new title or enable its actions.
- Lists, card controls and tabs must remain usable at small widths; horizontal
  tab scrolling is acceptable without horizontal page overflow.
- Keep the fixed workspace/backdrop outside the transformed main page container.
  Workspace body content must not flex-shrink into overlapping sections. Put
  lead-specific styles in `css/pages-leads.css`, preserving governance limits and
  using scoped theme overrides compatible with global light/dark tokens.
- No database, role/access, integration, migration, provider-call, booking or
  timeline contract changes belong to LEAD-UI-1.

## Verification and handoff

Record commands and actual outcomes in the task handoff. This contract is not
evidence that a test passed. Verify entry points, canonical/legacy URLs, history,
focus, business isolation, stale responses, channel navigation, and that reads
produce no mutation requests. Use Node 22/npm 10 and isolated fixtures for local
behavior/browser checks; production verification for this step is read only.
Actual local evidence and screenshot paths are recorded in the
[LEAD-UI-1 handoff](LEAD_UI_1_HANDOFF_2026-09-27.md); its statuses distinguish
passed local checks, delivery outside this task, and deferred owner manual QA.

## Shared editor contract (LEAD-UI-2)

One `#leadEditorForm` moves between `#leadCreateEditorHost` in the creation modal
and `#leadWorkspaceEditorHost` in Details. Do not clone its field IDs, validators,
submit handler, or payload builder. Moving the node preserves listeners and a
draft; detach it before replacing a parent with `innerHTML`, then remount it.
The create modal remains a creation surface, not a second lead editor.

Editing resolves the record by ID and business through the existing workspace
GET, rather than requiring the record to be in the current `leadsData` page.
There is no general `GET /api/leads/:id` endpoint. The workspace's lead projection
contains the editable name/contact/source, assigned manager, pipeline/type,
desired date/preferences, celebrants, and lead notes. Keep an editor baseline
separate from the subsequently refreshed list/workspace display.

| Save concern | Preservation rule |
| --- | --- |
| API boundary | Create uses `POST /api/leads`; edit uses `PATCH /api/leads/:id`, scoped to the captured editor business/lead. Existing backend rules and permission checks remain owners |
| Partial update | Omitted PATCH properties preserve values; unchanged fields must be omitted. Opening and cancelling never write |
| Pipeline and type | An explicit `lead_type` applies its workflow rule even if unchanged; omit unchanged type/stage to avoid unintentional resets or hooks |
| Date and guests | `eventPreference: null` clears the preference; legacy `event_date` also opts into preference normalization. A date/count edit sends a complete intended preference, retaining its separate `notes`; unchanged hidden preferences must be omitted |
| Missing/zero | Preserve explicit zero counts; do not substitute celebrant count for an explicitly entered zero. Validate guest counts before sending |
| Notes | Lead notes, customer notes, and preference notes are different fields. Preserve untouched raw data; do not strip or replace Maysternya notes through the park guest-summary formatter |
| Hidden fields / legacy select options | Do not convert a value absent from the current source/assignee options into a clearing PATCH. Keep hidden Maysternya celebrants/counts and other untouched fields |
| Celebrants | Keep all entries and existing validation/source ordering. Send the edited list only when intentionally changed, retaining the backend's linked-customer child synchronization |
| Omni and booking identity | Contact edits do not send `source_channel`, external/raw source IDs, conversation origin/primary, program/booking IDs, or any unrelated contract fields |
| Type reasons | Preserve reason collection for applicable classifications and existing quality-category workflow. Cancelling a reason dialog retains the editor draft |
| Collaboration | Existing collaboration endpoint owns atomic task/type creation. Subsequent contact PATCH remains separate; after a successful workflow step, retain that result so retrying a later failed PATCH does not create another task |
| Creation | Preserve stage locks/customer handoff, default assignee, lost-stage reason, deposit confirmation, and Maysternya behavior. Reuse the same validators and save pipeline |

The save lock covers preparation dialogs as well as the network request: set it
before the first asynchronous reason/workflow step. Capture the editor generation,
record and business so an old load/save cannot close, reset, or populate a newer
editor. A failure leaves the entered draft and a useful error. A successful save
updates the current card/list without clearing filters or position; distinguish
a persisted lead from a later refresh failure.

If a new editor opens while an earlier save's list refresh is finishing, release
the old global lock and reconcile actions against the current editor/read-only
state. Never reset the new draft, and do not leave its Save button disabled after
the earlier operation finishes.

This is protection against duplicate clicks during an active preparation/request;
it does not promise exactly-once creation after transport loss, reload, or an
unknown server outcome. No new server idempotency key was added. The existing
collaboration task/type transaction and a later contact PATCH remain separate
commits; preserve and explain a known successful first step instead of claiming
the entire edit is atomic.

Register `UnsafeDismissGuard` on the shared editor form with a current draft
comparison, not on an empty hidden modal. Tab changes retain the same draft.
Close, Cancel, Esc, Back, another lead, and another business must consult the same
guard. A declined discard restores the current URL and preserves the draft.
Explicitly include the embedded editor in the active-editable-surface check;
testing only `.lead-modal-overlay.active` misses it. Mark clean after successful
save or confirmed discard, never after a failed save. Do not add autosave.
The native `beforeunload` guard also covers an active save, including a pristine
customer-prefilled create form. Browsers control whether their native warning is
shown; this is not proof the server request was cancelled. After list repaint,
workspace dismissal must fall back to the current lead's visible opener or the
search control when its original focus target was replaced.

Record LEAD-UI-2 implementation and actual verification evidence in its
[handoff](LEAD_UI_2_HANDOFF_2026-09-27.md). Task-1 evidence alone does not certify
the later editor change. Its final local baseline and real-API browser run passed,
with the handoff distinguishing captured artifacts from final manually reviewed
editor screenshots; production delivery and owner manual QA remain separate.
Keep native UI transitions and wait for finite
animations before screenshot geometry/contrast checks.

Owner manual tests 3-8 remain **pending** after LEAD-UI-1: manual lead/link/reload;
two channels and primary change preserving origin; duplicate submit; two leads
in one conversation; actually closed/unavailable/cross-business conversations
with filters/pagination; desktop/mobile/390x420 and keyboard/history/drafts.
LEAD-UI-4 must remind the owner and report their results separately from automated
tests. The later failed-send and 390x420 investigations are recorded separately in
the [LEAD-UI-3 handoff](LEAD_UI_3_HANDOFF_2026-09-27.md), with actual evidence and
verification status rather than assumptions about provider restrictions.

## Communication and responsive verification (LEAD-UI-3)

Keep the existing conversation-context resolution and write endpoints. Viewing a
closed accessible conversation must not reopen it. An unavailable selected
primary/origin must not silently select an alternative. Suggestions remain
unconfirmed until an explicit manager action.

Message acceptance, delivery, and reading are distinct states. Show persisted
failure details through the existing escaped-text renderer; do not infer the
cause or a reply-window duration from the channel, CRM conversation status, or
numeric error code alone. Reading delivery evidence must not retry, reconcile,
mark read, or contact the provider.

A restored composer draft does not imply that message history has loaded.
Browser checks must wait for the selected conversation's loaded history or its
explicit error state before testing scroll/geometry. Keep the layout and hit-test
assertions after synchronization. Compact action menus must remain inside the
conversation panel and their actions reachable at native browser zoom; container
clipping must not hide otherwise enabled actions.
