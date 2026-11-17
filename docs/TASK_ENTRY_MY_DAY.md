# Task entry through My Day

## Contract

The CRM owns task destinations. A task opens at `/profile?tab=myday&open=<positive-safe-integer>`.
Supported intent fields are `businessContext`, `mode=edit`, and the existing focus `date`.
`js/task-links.js` provides the shared server/browser contract. Browser templates with fixed
destinations use this same URL format. No Hermes call is needed to resolve or open a task.

`/tasks` remains the separate Task Center workspace. Opening an individual task there uses
the My Day destination. Task links to source entities remain source-entity links.

Before static file serving, `middleware/taskLinkRedirect.js` accepts existing `/tasks`,
`/tasks.html`, and `/tasks/` links containing `open`, `highlight`, or `taskId`. It sends a
302 with `Cache-Control: no-store`, retaining only supported intent fields. The profile
destination does not match this middleware, so it cannot create a redirect loop.
An invalid legacy ID reaches the explicit invalid-link state. Bare Task Center URLs do
not redirect. HTTP methods other than GET/HEAD are unaffected.

## Entry inventory

| Source | Implementation | Verification |
| --- | --- | --- |
| Active Telegram CRM task receipts | `services/telegramCrmTasks.js` | Fullstack Telegram integration, shared URL tests |
| Existing Hermes consumer adapter | `services/hermesTaskMapper.js` | Mapper and route contracts |
| Notification outbox and old explicit task URLs | `services/notificationOutbox.js` | Outbox contracts, legacy link matrix |
| Control completion alerts | `services/taskControlCompletionInbox.js` | PostgreSQL My Day and control browser suite |
| Work queue and reply escalation tasks | `services/workQueue.js` | Work queue tests |
| Booking-linked task fallback | `services/bookingVisibility.js` | Booking visibility tests; booking source routes unchanged |
| Omni assistant task links | `services/omniLeadAssistant.js` | Unit suite and shared destination contract |
| Search results | `routes/search.js`, `js/search.js` | Unit suite, legacy `highlight` browser case |
| Dashboard recommendations, triage and team widgets | `routes/dashboard.js`, `js/dashboard-page.js` | Hydration and work queue tests |
| Assistant and chat task results | `js/assistant-foundation.js`, `js/chat-page.js` | Source/behavior checks, substitution browser test |
| Task-created alert and profile success actions | `js/alerts.js`, `js/profile-page.js` | UI checks and actual-app browser suite |
| Task Center and shared open calls | `js/task-detail-drawer.js` | Controller tests and legacy actual-app navigation |
| My Day card open/edit and bookmarked task | `js/profile-page.js`, `js/profile-my-day.js` | Chromium/WebKit actual-app task entry matrix |

## Details and operations

The existing native My Day dialog loads the task directly from the scoped Tasks API,
independently of the board's current time window or projection. It unwraps the existing
task response and uses the server's `drawer.actions` contract to show operations.
Missing action metadata fails closed. API authorization remains authoritative.

Editing reuses `updateCabinetTaskFields` with the loaded task, preserving fields that
are absent from the visible board. Completion reuses `setCabinetTaskStatus` and the
canonical completion endpoint. Rescheduling uses the existing deadline conversion and
reschedule endpoint. There is no separate business-policy implementation or dependency
on Task Center's page script. Existing server dependency and terminal-state checks apply.

The dialog stays in My Day, provides explicit load/access/invalid-link errors and retry,
prevents duplicate submissions, and guards dirty edits and in-flight writes on dismissal.
History, reload, close, direct edit intent, and task changes are handled in the profile.

## Login intent

Only the already-supported My Day task return intent is extended. It retains a sanitized
business context and `mode=edit` in addition to task/date. Task intents use tab-local
session storage, are account-bound when captured for an authenticated account, expire
through the existing TTL, and are consumed once. Legacy shared task intents are not
restored in browsers with session storage. Other return routes retain their existing
behavior. External origins, unknown parameters, arbitrary next/return URLs and opaque
origins are rejected or omitted. Tokens, sessions, grants, roles and business access
policies are unchanged.

The owner's launch authorization explicitly includes this narrow navigation-intent
change. It does not authorize any other authentication or production action.

## Verification

`tests/task-links.test.js` covers canonical fields, invalid IDs, all legacy path/parameter
aliases, temporary uncached redirects, bare Task Center navigation, external URLs,
tab/account isolation and one-time login intent consumption. It is included in the
existing explicit unit list.

The existing `my-day-browser` isolated PostgreSQL suite includes
`tests/browser/task-entry-checks.js`. It exercises real UI login from an old URL, direct
details outside the current date range, aliases, reload/history, edit/save/reschedule,
failed then successful completion, invalid/missing/forbidden details, network retry,
390/1440-pixel screenshots and no Hermes requests. It runs Chromium in existing CI.
Set `TASK_ENTRY_BROWSER_ENGINES=chromium,webkit` locally for both installed engines.
`TASK_ENTRY_ONLY=1` runs only that matrix in the same disposable actual-app runner;
it is a diagnostic mode, not a substitute for the full default browser suite.

The WebKit matrix records and narrowly excludes its global timer's cancelled-fetch
`/api/my-day/timer due to access control checks.` page error during forced navigation;
other page errors remain fatal. HTTP error/network-abort fixtures test the error UI;
normal reads and writes use the actual local application and PostgreSQL. The matrix
does not claim to replace task-access policy integration tests.

The actual Telegram messages reported by the owner were not supplied; their precise
URL difference remains unverified. Real iPhone + Telegram webview testing remains a
separate device check. Browser WebKit coverage is not a claim of physical iPhone QA.

## Applied Modern Web Guidance

- [dialog](https://github.com/GoogleChrome/modern-web-guidance-src/blob/main/guides/ui-components/dialog/guide.md):
  "Use `dialog.showModal()` when opening from script." The existing native modal keeps
  native focus containment/Escape; its cancel handler protects unsaved edits. No custom
  focus trap or `closedby` dependency is introduced. Scroll containment remains progressive
  enhancement with a scrollable bounded dialog on Safari.
- [accessibility](https://github.com/GoogleChrome/modern-web-guidance-src/blob/main/guides/accessibility/accessibility/guide.md):
  "Explicitly associate `<label>` with its control via `for`/`id`." Edit and date controls
  have visible labels, error/guard announcements and 44-pixel action targets. Close does
  not shrink into wrapped text at phone widths. Screenshots require visual review.
- [validate-origins](https://github.com/GoogleChrome/modern-web-guidance-src/blob/main/guides/security/validate-origins/guide.md):
  The guide's URL fallback rejects opaque origins before comparing parsed origins.
  Task navigation uses the broadly supported `URL` parser, explicit origin equality and
  a small intent allowlist, without requiring the newer Origin API on older browsers.

## Нотатки до майбутнього релізу

- Посилання на задачі з бота, сповіщень, пошуку та робочих віджетів відкривають «Мій день».
- Старі посилання з уже надісланих повідомлень також ведуть до потрібної задачі.
- Редагування, перенесення й виконання доступні в діалозі «Мого дня» за чинними правами.
- Повторний вхід зберігає конкретну задачу та дозволений бізнес-контекст.
- Основний сценарій працює без Hermes. Центр задач залишається окремою сторінкою.

## Separate production checklist

1. Recheck live/remote production SHA/version, parallel releases and this candidate's
   ancestry/merge conflicts. Refresh affected checks and exact-SHA CI after any drift.
2. Select the next free patch and inspect the release helper's same-version guard.
   Prepare version/cache/changelog metadata in the release task, not this feature task.
3. Compare migrations from live to candidate. This feature adds none. Classify any
   inherited changes and obtain required bounded authorization under current rules.
4. Prepare the documented release authorization/controller manifest for the verified
   production branch and Railway project/environment/service. No release is authorized here.
5. Deploy only through the repository release helper after exact-SHA CI. Verify live
   version/branch/SHA, then read-only navigation with approved test accounts.
6. Test an old and a new Telegram button on an actual iPhone, login/reload, task ID,
   My Day actions and close/Back. Any disposable production writes need their own scope.
7. Rollback planning must retain this task's schema-free nature and consider migrations
   inherited from other releases. Never force-push shared history or use a destructive
   rollback. Fix-forward or deploy the documented compatible previous SHA through the helper.
