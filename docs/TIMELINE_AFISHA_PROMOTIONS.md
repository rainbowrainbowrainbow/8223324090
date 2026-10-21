# Timeline Afisha flags and promotion periods

## Afisha follow-up (local implementation)

Migration `384_afisha_promotion_and_second_line.sql` adds nullable `promotion_id`
and `second_line_id` to the existing Afisha record. The original `line_id` remains
the first animator assignment. One Afisha record is rendered in the upper Afisha
summary, on the persistent Afisha time row, and on each of up to two animator
rows. Linked records also appear inside their promotion band. Archiving a
promotion keeps its Afisha records visible.

`POST /api/afisha/timeline` creates a one-off or regular event with optional
`promotionId` and `lineIds` (zero to two). `PATCH /api/afisha/:id/timeline`
changes the promotion and assignments using `expectedPromotionId` and
`expectedLineIds` for conflict detection. Both operations validate Park context,
existing date-specific animator lines, and an active promotion covering the
event date; the record and history write share one transaction. A linked event
cannot move outside its promotion dates until it is unlinked or the promotion
dates change. Automatic distribution retains manual assignments and adds only
one animator to unassigned events; reset clears both assignment fields.

This follow-up has not been released to production. PostgreSQL integration
requires the disposable local database fixture described below. The separate
`tests/browser/timeline-afisha-dual-browser-smoke.js` uses mock API responses to
check real desktop, week, and mobile rendering without a database.

Follow-up verification on 2026-10-21: the PostgreSQL integration suite passed
all 8 subtests against a fresh UTF-8 PostgreSQL 18.6 cluster bound to
`127.0.0.1`; the fixture applied migration 384 twice and removed its test
database. The existing timeline marketing browser smoke also passed against
real local routes and that isolated PostgreSQL cluster using Chrome, covering
day/week layouts, mouse/touch drag, promotion edits, and mobile layout. The
cluster was stopped and its temporary files removed after the run. The new
Afisha dual-row browser smoke passed separately with mocked API responses.
The final integration pass also checked that legacy date edits clear both
animator assignments and automatic distribution preserves two manual ones.
The repository's full `npm test` passed after the final legacy-route and
auto-distribution safeguards. Targeted tests, real PostgreSQL/browser smoke,
the migration check, and the protected-surface check also passed.
No production database or deployment was touched.

Local implementation on `codex/timeline-afisha-promotions`, based on
`origin/codex/eventgenix-production` at `35e520584cde0fa73796f8f0b7b6d6a4df8db563`.
Production impact: yes. The initial implementation was local-only. On 2026-10-19
the owner subsequently authorized commit, push and deployment of this feature.
Release preparation follows `docs/CODEX_PRODUCTION_AUTONOMY.md`; production QA is
read-only and migration 383 is additive. No real business records are mutated.
The owner approved `LOCAL-PROMOTIONS-SCHEMA` for the additive local migration
and disposable PostgreSQL verification.

## Implementation

- `js/timeline-afisha.js`: compact accessible flags, collision lanes below
  booking cards, details and move dialog, pointer/touch movement, stale request
  protection through existing timeline tokens and business context.
- `js/timeline-promotions.js`: informational period bands, neutral overlap
  shading, date selection, Monday–Sunday shortcut, mouse/touch and keyboard
  movement/resizing, edit/archive form, independent load retry and conflict UI.
- `js/timeline-marketing.js`: shared escaped text, calendar-date arithmetic,
  authenticated requests and existing Escape/focus modal lifecycle.
- `js/timeline.js`, `index.html`, `css/timeline.css`: integration into existing
  day and vertically stacked multi-day views. Booking identity, detail openers
  and protected manifest are unchanged. Booking card heights are preserved when
  an assigned flag adds space below the card.
- `services/afishaSchedule.js`, `routes/afisha.js`: transactional schedule-only
  update and existing history log.
- `services/timelinePromotions.js`, `routes/timeline-resources.js`: per-business
  persistence with existing context and settings capabilities.
- `db/migrations/383_timeline_promotions.sql`: additive table, date checks and
  partial business/date index for active rows. No startup bootstrap changes.
- `package.json`, `tests/timeline-marketing*.test.js`,
  `tests/integration/timeline-marketing-postgres.test.js`,
  `tests/helpers/timeline-marketing-fixture.js`,
  `tests/browser/timeline-marketing-browser-smoke.js`: targeted checks.
  The existing room-summary browser fixture exports shared utilities and uses
  the current capability catalog, without changing production permissions.
- `docs/API_SURFACE.md`: route ownership descriptions.

## API contract

`PATCH /api/afisha/:id/schedule` accepts `date`, `time`, `expectedDate`,
`expectedTime` and returns `{ success: true, item }`. Expected fields are checked
under a row lock; concurrent changes return 409. New times use five-minute steps.
The existing original-time limits remain 90 minutes for templates and 120 minutes
otherwise. Regular/template events cannot change dates; birthday events cannot
move. A date change clears `line_id`. Other event fields and linked tasks are
untouched. Legacy Afisha remains owned by `event_genix`; other contexts cannot
mutate it using this endpoint.

`GET /api/timeline/promotions?from=YYYY-MM-DD&to=YYYY-MM-DD` returns
`{ context, promotions }`, including active rows intersecting the inclusive range.
`POST /api/timeline/promotions` creates a period. `PATCH /api/timeline/promotions/:id`
accepts editable fields and required `version`; stale versions return 409.
Archiving uses `{ version, is_active: false }`, with no physical deletion.
Fields: `title`, `description`, `color_key` (amber/violet/green/blue), `starts_on`,
`ends_on`, `is_active`. Business ownership and author cannot be reassigned through
the request body. Mutations and history writes share one transaction.

Read access follows the current timeline context. Writes require the existing
settings/manage_settings capability; aggregate scope remains read-only. Dates
travel as calendar strings, with no UTC conversion of business days. Promotions
never change booking prices, payments or reservation availability.

## Local verification

Runtime: Node 22.23.1 / npm 10.9.8. Dependencies come from the unchanged lockfile.

The PostgreSQL fixture refuses production and non-loopback servers, creates a
random owned database, applies migrations 383 and 384 twice, tests the real routers and
SQL, then drops that database. It supplies a test authenticated principal while
retaining the real capability and business guards. The browser loads the actual
application HTML/CSS/JS; only unrelated APIs are mocked. New feature requests
reach the real local Express routers and PostgreSQL.

Commands (set `TIMELINE_MARKETING_TEST_DATABASE_URL` to an isolated local
PostgreSQL administrator connection before integration/browser checks):

```text
npm run test:timeline-marketing
npm run test:integration:timeline-marketing
npm run test:browser:timeline-marketing
node tests/browser/timeline-room-summary-browser-smoke.js
node --test tests/timeline-lifecycle.test.js tests/timeline-week-parity.test.js tests/timeline-resources.test.js
npm run check:syntax
npm run check:migrations
npm run check:timeline-protected-surface
npm run test:ui
npm test
```

Browser dependencies are reused from the existing local Playwright installation
through `NODE_PATH`; no dependency or lockfile changes are necessary.

Evidence is stored locally under `output/`: `marketing-targeted.txt`,
`marketing-postgres.txt`, `marketing-browser.txt`, `room-summary-browser.txt`,
`test-ui.txt`, `npm-test.txt`. Screenshots under `output/playwright/`:
`timeline-marketing-day.png`, `timeline-marketing-week.png`,
`timeline-marketing-mobile.png`, `timeline-marketing-dark.png`.

Browser coverage includes flag collision geometry, day/week visibility, details,
dialog move, mouse/touch drag, date move clearing the line, promotion date brush,
whole-band move, mouse/keyboard edge resize, neutral overlaps, reload persistence,
archive, narrow-screen dialog sizing and Escape/focus return. Domain/UI/PostgreSQL
tests cover schedule limits, real optimistic concurrency, transactional rollback,
business isolation, permissions, stale responses, errors/retry, draft preservation,
read-only views, leap dates and DST boundaries.

Recorded results on 2026-10-19:

| Check | Result |
| --- | --- |
| Marketing domain/UI tests | 15 passed, 0 failed |
| PostgreSQL integration | 7 passed, 0 failed; migration applied twice |
| Lifecycle/week/resource regression | 202 passed, 0 failed |
| Timeline regression matrix plus initial marketing tests | 33 passed, 0 failed |
| Marketing Chromium smoke | Passed, including touch emulation and screenshots |
| Existing room-summary Chromium smoke | Passed |
| `check:timeline-protected-surface` | Passed, 6 protected blocks, manifest unchanged |
| `check:migrations` | Passed, 375 files; existing legacy gaps/duplicate 026 warnings |
| `check:syntax` | Passed; subsequently edited modules also passed `node --check` |
| `check:api-surface`, `git diff --check` | Passed |
| `test:ui` | Passed |
| `npm test` | Passed (exit 0), including 3894 unit tests and 15 marketing tests |

The last geometry adjustment pins the original top/height of neighboring booking
cards and keeps birthday greetings in the first annotation row without inherited
centering transforms. It was checked with syntax,
targeted tests and the real-browser collision assertions after the full run.

The isolated PostgreSQL server was stopped after verification. Feature test
databases were removed by fixture cleanup; no application database was used.

## Release considerations

The release must apply migration 383 before exposing the promotion UI. Until then, a missing-table
error is local to the promotions panel and does not stop bookings. Follow the
repository release/version procedure at release time. No real customer data or external
notifications were used.

Browser QA uses Chromium and emulated touch. Physical iOS/Safari and Android
devices and the full production login/session flow were not exercised by the
feature fixture. Existing room-view Afisha visibility rules remain in force.
