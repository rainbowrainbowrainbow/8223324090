# Telegram CRM pilot

## Scope and identity

The pilot uses the existing Second Brain bot. Only Telegram users 674972415,
606680445 and 622480549 enter its isolated CRM lane. They do not gain notes,
model-session or other tool access. The corresponding existing CRM accounts were
verified with the owner: Sergey (4), Natalia (3), Zhenya (13).

`telegram_crm_bindings` is the only CRM access identity. Legacy `users.telegram_chat_id`
and `staff.telegram_id` retain their notification meaning. Username matching cannot
grant this integration access. The seeding operator writes **proposed** IDs only.

An authenticated account starts a 10-minute one-time link. First onboarding of an
admin-preassigned, never-connected binding (version 1) needs no second password.
Replacement and reconnect require password re-entry, including after revocation.
Telegram claims the link with its real private-chat sender. The original browser
must explicitly confirm the discovered ID using a separate in-memory proof. Starting
a replacement leaves the old identity valid until confirmation. Disconnect requires
password re-entry, increments the binding version and cancels pending drafts.

The bot authenticates its transport with the existing Hermes service key; every
task operation additionally resolves the human's current binding and actual CRM
business membership/module/action policy. It never uses a machine account's role.
Never pass sender headers from text or model output. Event timestamps and draft
binding versions prevent old commands crossing a new binding.

## User flow

Optional first-login prompt links to `/profile?tab=settings#telegram-crm`. Skipping
does not affect CRM access. The profile shows connection state, copyable ID and
username, with connect/change/disconnect actions. Proposed IDs are visibly unverified.
The password and browser proof are not stored in browser storage or URLs. Returning
to the original visible CRM tab checks the pending link once, without background
polling or automatic confirmation. A manual retry remains available.

- `/tasks` or `мої задачі`: today's active My Day tasks in Europe/Kyiv; executor,
  author or participant, with roles. Tomorrow and Other date buttons navigate dates;
  additional pages remain within that date. Past overdue work is not mixed into today.
- `/tasks completed`: completed tasks scheduled for today.
- `/tasks business=event_genix from=2026-11-01 to=2026-11-30`: optional business/date
  filters; pagination keeps the filters. Actual CRM visibility always applies.
- `/newtask`: guided title, description, business, eligible pilot assignee and optional
  deadline. Dates use Europe/Kyiv. Ambiguous daylight-saving times require clarification.
- `/crm cancel`: abandon the wizard/cancel its current server draft.
- Only the explicit **Create** button commits the displayed immutable preview.

While the creation wizard is active, private text goes to that user's CRM draft,
not to notes. After preview the notes owner's ordinary messages again use the
existing notes lane. Other pilot participants remain restricted to CRM commands.
An overlong description cannot be confirmed from a truncated preview: shorten it
and restart. No model calls or background CRM polling are added.

## Storage and recovery

CRM stores one immutable draft per sender binding version + Telegram update ID and
one receipt per committed operation. The canonical task writer, receipt and audit
commit in one transaction. A repeated confirmation returns that receipt; it never
creates another task. Receipts require current task visibility. Task authorship is
the human account; `source_module=telegram_crm` and operation metadata identify the
integration. Tasks are not copied into the note graph.

Second Brain keeps a separate private `runtime_dir/crm/crm.sqlite3` inbox and response
outbox, with per-user conversations and 20-minute wizard expiry. Each pilot user has
an independent asynchronous worker. A CRM POST timeout triggers one receipt check
using the original operation ID. Unknown results are reported with a Check result
button. Neither notes nor nightly processing block this lane.
Polling explicitly subscribes to `callback_query` as well as dispatcher update types:
CRM buttons are handled outside the dispatcher, so auto-discovery alone misses them.

Delayed private responses recheck the binding before delivery. Owner diagnostics
contain only an error code, update ID and diagnostic UUID, never another person's
task text or credentials. Alerts are durable and coalesced per error code for
15 minutes. Delivered local updates are scrubbed and responses retained for seven
days; server receipts remain canonical.

## Operator rollout and shutdown

1. Deploy the reviewed additive migration 410 and account UI with the settings row
   absent/off. Preserve all existing notification destinations and roles.
2. Run `node scripts/telegram-crm-pilot.js seed --bot=<verified-bot-username> --apply`
   in the exact production **database** service environment. It checks all three
   IDs, usernames and names, and never overwrites a confirmed identity.
3. Provision Second Brain's `CRM_ENABLED`, `CRM_BASE_URL`, `CRM_SERVICE_KEY` only
   under the separate approval required for production environment changes.
   Transfer the existing credential through process stdin/SSH; never logs/git/chat.
4. Enable `read` through the bounded operator. The owner connects Telegram in their
   own CRM browser and verifies their task list. Do not simulate their confirmation.
5. Enable `write` only after the read check, then run explicitly marked, registered
   disposable QA on the owner's account. No peer tasks/messages without separate consent.
6. Record exact deployed SHAs, verified bindings, QA IDs and exact cleanup evidence.

`node scripts/telegram-crm-pilot.js off --apply` disables the integration without
stopping CRM or the notes bot. Account disconnect still works. `read --apply` keeps
viewing while preventing new task creation. Already committed tasks/receipts remain.
Keep additive tables when rolling back code; disable first. A bot environment change
also requires a service restart, preserving the existing queue/vault.

## Validation and browser guidance

`npm run test:telegram-crm` covers transport/auth guards; the existing My Day isolated
PostgreSQL CI mode also runs `telegram-crm-fullstack.integration.test.js` through the
real server and canonical task writer. The opt-in identity PostgreSQL suite exercises
concurrent linking, revoke/commit ordering and idempotency with fault injection.
`tests/browser/telegram-crm-profile.spec.js` exercises mobile/keyboard flow and skip.
`CRM_PILOT_BROWSER_MODULE` can point to an external Playwright installation for the
actual-app profile test; absence is reported as skipped, never as browser proof.

Modern Web Guidance `forms`, `accessible-error-announcement`, and `accessibility`
informed native forms, labels, current-password autofill, 48px targets, no raw HTML
insertion, visible focus and status announcements. `:user-invalid` is widely
available (Chrome/Edge119, Firefox88, Safari16.5); ARIA starts false and is updated
on validation. Clipboard rejection falls back to selecting the read-only ID. No
custom modal/focus trap or experimental UI dependency is required.
