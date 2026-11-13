# Universal staff substitution: implementation scope

Status: authorized local implementation; partial acceptance, NOT release-ready.
Owner approved RED-SUBSTITUTION-LOCAL-01 in this chat on 2026-11-13.
Audit date: 2026-11-13, Europe/Kyiv.
Base: production FETCH_HEAD `dd511e2f0da52da1401502991a68d476eee9ce44`.
Package baseline: 0.83.45. This is a source audit, not a live deployment assertion.
Worktree: `output/staff-substitution-20261113`, detached HEAD.

## Current local implementation

The shared aggregate, governed migration 392, authenticated API, HR/staff entry
points and payroll projection are implemented in this isolated worktree. No
commit, push, production migration, deployment or real-data mutation was made.
The design and acceptance matrix below describe the full target; they are not a
claim that every source and downstream surface is complete.

Implemented files:

- `services/staffSubstitutionContract.js`: explicit compensation/original-worker
  choices, Kyiv time validation, half-open overlaps, integer minor-unit arithmetic
  and fingerprinted previews.
- `services/staffSubstitutions.js`: atomic commands, version checks, exact request
  replay, period/staff/attendance/source locks, immutable events, closed/reviewed
  report and approved installment protection.
- `services/staffSubstitutionContext.js`: existing eligibility, scoped temporary
  admission, dated rate resolution, shifts/tasks/substitution conflicts, canonical
  roster booking/Afisha and teacher occurrence conflict reads.
- `services/staffSubstitutionSources.js`: standalone work; bounded whole HR shift;
  task reassignment through the existing service; Afisha primary/second slot
  through the canonical transactional updater; procurement and lead ownership.
- `services/staffSubstitutionPayroll.js`: approved actual quantities and frozen
  payable evidence; exact base-allocation claims, monthly norm validation,
  full-profession daily allocation protection and fail-closed reconciliation.
- `db/migrations/392_staff_substitutions.sql`: aggregate, events, request identities,
  unique source/base claims and source/segment mutation guards. No backfill.
- `routes/staff-substitutions.js`, `server.js`, `docs/API_SURFACE.md`: one API using
  existing capabilities and the Park-only business boundary; no grants added.
- `js/staff-substitution.js`, `hr.html`, `staff.html`: shared multi-step form,
  source picker, quote acknowledgement, history, pre-work rate revision,
  completion/cancellation and in-memory replay of an unconfirmed request.
- `services/payroll.js`, `js/hr-page.js`: payable substitution lines flow into the
  canonical calculator. Ledger/report/settlement totals retain cents and the
  payment dialog preserves the exact outstanding amount. Existing scheme-line
  calculations retain their historical whole-hryvnia rounding.
- `services/afishaTimeline.js`: an injected transaction client allows assignment
  and substitution evidence to commit or roll back together.
- New contract/payroll/PostgreSQL/browser tests, isolated runner mode and npm test
  registration. No dependency or lockfile change.

### Supported boundaries and remaining acceptance

| Area | Implemented behavior / limitation |
| --- | --- |
| Different permanent occupation | Existing active worker may perform a scoped role with explicit temporary admission; staff profession and CRM permissions stay unchanged. |
| Pay units | Hour, agreed fractional shift and fixed scope. Only approved actual work is payable; active work blocks final payroll. |
| Base replacement | Completed schema-v2 attendance allocations must match the work minutes. Monthly norms must be frozen/confirmed; per-day pay requires all base segments of that profession. No arbitrary partial allocation slicing. |
| Original worker | Standalone/task/Afisha/procurement/lead retain ordinary pay. Financial transfer is blocked unless an exact HR shift owns the base scope. |
| HR shift | Full single-role, single-segment transfer into an empty destination day; cancellation restores the original owner and schedule mirror. Retained-original pay, partial transfer, same-day merge and paid additional roles are explicitly blocked, not implemented. |
| Task | Canonical linked user identity and visibility/reassignment checks; private handoff remains unavailable. No independent account creation. |
| Afisha | Existing approved animator roster, exact event interval, primary/second slot and canonical conflict checks. Birthday occurrence reassignment remains unavailable. |
| Booking | No assignment adapter: protected booking mutation/refactoring requires a separately reviewed boundary. Protected source/renderer/manifest unchanged. |
| Education | No assignment/payroll adapter: current shared staff/payroll is Park-only. Do not bypass educational business membership or redirect its wages into Park. |
| Multi-source aliases | One source slot/date is unique. Linking a task, shift and booking as aliases of one earning is NOT implemented. |
| Schedule/report read models | Shared HR/staff workspace and canonical payroll lines are present. Per-cell badges, source-page entry points, attendance detail and schedule-workbook projections still need implementation/acceptance. |
| Concurrent calendar edits | Save rechecks current calendar conflicts; Afisha uses canonical conflict locks. Future unrelated booking edits do not consult this ledger. No claim of cross-source serialization or durable alias deduplication. |
| Corrections | Active pre-work rate revision and cancellation supported. Completed/paid history is frozen; adjustment and chained-replacement workflows remain unimplemented. |
| Browser evidence | Real Chromium clicks on production modal/JS/CSS with synthetic HTTP fixtures at 1280x900 and 390x844. This is not live-site or full HR-page browser acceptance. |

The partial/merge/retain HR workflows and source/read-model acceptance remain
ordinary authorized local implementation work. Their absence is an implementation
gap, not a request for repeated approval of this block. Do not deploy this partial
implementation or describe it as universal substitution.

## Audit before approval

Read the current repository rules, production runbook, migration governance and
protected timeline contract. Inspected the existing assignment, attendance and
payroll paths; ran the targeted baseline described below. This document is the
only tracked change at that earlier stage. Implementation began after the owner's
explicit approval; commit, push and deployment remain outside this block.

The starting checkout contains unrelated customer-performance and CI edits.
Preparation uses a separate clean worktree fetched from the production branch.

## Findings and reusable integration points

| Surface | Verified implementation | Consequence for substitution |
| --- | --- | --- |
| HR shifts | `routes/hr.js`, POST `/shifts/:id/replace`; `services/hrShiftSegments.js`, `validateHrShiftDayPlanProfessions` | Moves the complete shift to another worker; checks professions on the worker's card and rejects another shift on the same date. Not a universal or partial-work assignment. |
| Staff schedule | `routes/staff.js`, `/schedule/:id/replace` and `/replacement-clear`; `services/staffScheduleMutations.js` | Existing HR truth, schedule mirror, ordered staff locks, stale-write checks, audit and roster reconciliation must remain authoritative. Do not add a second schedule writer. |
| Shift segmentation | `services/hrShiftSegments.js`, `normalizeHrShiftDayPlan`, `saveHrShiftDayPlan`, `recordPaidRoleAuditEvents` | Reuse time segments and paid-role provenance. A same-day existing shift should be merged by explicit segment rules, not overwritten. |
| Worker eligibility | `services/staffOperationalFilters.js`, `services/professions.js` | Active status, termination date, pool eligibility and profession assignment are different checks. Selecting any occupation must not silently promote a worker, grant CRM access or bypass business scope. |
| Rates and daily exceptions | `services/hrPayrollConditions.js`, `getPayrollDayConditions`, `savePayrollDayException`; migration 374 | Already has `additional`/`base_replacement`, historical sources, version and request identity. Exception scope is staff + profession + date + purpose, not a specific job or interval. It only accepts hour/day overrides. Reusing it unchanged would affect unrelated work that day. |
| Profiles | `services/hrPayrollProfiles.js`; `services/payroll.js`, `resolveEffectivePayrollProfile` | Reuse dated profile resolution and source evidence. Standard pay must refer to the selected work profession, not the replacement worker's primary managerial wage. |
| Attendance | `services/hrAttendance.js`, compensation snapshot capture and allocation; `hr_time_records.compensation_snapshot` | Preserve actual work separately from scheduled work and frozen terms. A new planned assignment is not proof of attendance. |
| Payroll | `services/payrollConditionCalculation.js`, `calculateConditionSnapshots`; `services/payroll.js`; `services/payrollSettlement.js`; `routes/payroll.js` | Current grouping by profession/day and monthly unit checks cannot distinguish multiple one-off contracts with different rates. Fixed work requires an explicit source type; do not masquerade it as a daily rate or untracked bonus. |
| Period protection | `services/hrPayrollPeriod.js`; `services/attendanceWriteLock.js` | Reuse period/attendance locks. Closed periods, frozen attendance and existing settled lines must block silent rewriting. |
| Booking / animator | `services/booking.js`, roster/availability and `lockBookingConflictResources`; `routes/bookings.js` | Worker ID, roster line and booking identity are distinct. Resolve a dated canonical roster mapping; no display-name joins or protected mapping changes. |
| Afisha | `routes/afisha.js`; `services/afishaConflicts.js`, `assertAfishaLinesFree`; `services/afishaSchedule.js` | Main and second animator are separate source slots. Reuse booking + Afisha conflict locks and birthday-slot projection. |
| Education | `services/educationGroups.js`, `assertLessonTeacher`, `checkTeacher`; `services/educationSeriesTeacher.js`; `services/educationHrMembership.js` | Substitute a single lesson occurrence, not the permanent group teacher or whole series. Existing business membership and teacher eligibility remain required. |
| Tasks / My Day | `services/taskExecution.js`, `reassignTaskOwner`; `routes/tasks.js`; `routes/my-day.js` | Task owner is a user, not a staff ID. Resolve the existing explicit account/staff link, retain private-task handoff and actor scope, and use canonical reassignment/history. No automatic account creation. |
| Procurement | `routes/procurement.js`, procurement list `assigned_to` joins `staff.id` | Another direct staff assignment source. Link a bounded work item and preserve its own workflow. |
| Leads | `routes/leads.js`, lead `assigned_to` joins `users.id` | Account ownership is not itself paid work. Use a bounded substitution work item with a validated account link. Do not create an allowance for each lead read/update. |
| Reports | `routes/reports.js`, report `assigned_to` joins `accountants.id` | Accountant duty routing is a separate identity and financial workflow. This approval does not authorize changing report approval or payment authority. |
| Read models | `routes/center.js`, `services/hrMonthlyReportDetails.js`, `services/staffScheduleWorkbook.js`, payroll exports | Show shared substitution identity, source and status; consume existing projections, without creating additional payable lines. |

The last three ownership surfaces show why a generic `assigned_to` update is
unsafe. The adapter inventory is extensible, not a claim that every ownership
field in the repository represents a staff work assignment. Each newly discovered
assignable process needs a registered adapter and the same acceptance contract.
Training material authorship and chat attribution are not reassignment targets.

## Full target product contract

One shared action, labelled "Людина на заміну", opens the same form in supported
assignment surfaces. It also supports a standalone bounded work assignment when
there is no original employee or source slot.

1. Select an existing active worker in the authorized business. Do not filter by
   permanent occupation. Show unavailable candidates with a reason where the
   existing visibility policy permits it; never bypass termination or admissions.
2. Select the work profession from the canonical profession catalogue. A scoped
   temporary work-role approval is separate from `staff.role_type`, permanent
   professions and CRM roles. Show missing qualification/admission as a blocker;
   use the existing approval workflow, rather than automatically approving it.
3. Identify the source occurrence/slot, original worker if present, and date plus
   start/end/breaks or a dated work quantity and completion criterion. Date-only
   work must say that precise time conflicts cannot be checked.
4. Suggest the selected profession's dated standard conditions with source and
   version. Allow an explicit individual rate with a reason. Missing or ambiguous
   rates require a choice; never fall back to the worker's unrelated primary wage.
5. Require explicit replacement-worker compensation: `additional` retains their
   ordinary pay; `replace_base` supersedes only named ordinary allocations for the
   same work scope. Neither choice may be preselected silently.
6. Independently require an original-worker treatment: `retain` or
   `transfer_unworked_scope`. Display their before/after schedule and pay effect.
   Retain already earned/approved work. A transfer identifies the exact unworked
   allocation being removed; it is not an automatic absence, penalty or deduction.
   If the original worker is absent, this field is explicitly not applicable.
7. Show estimated amount, rate source, affected base allocations, overlap reasons,
   qualification blockers, original-worker effect and history impact before Save.
   Acknowledgement is tied to this exact preview version.

For an existing source, original-worker treatment and replacement-worker pay mode
are independent axes. Treating them as one toggle would create ambiguous double
pay or unintended loss of pay. Retaining both ordinary wages is allowed only when
the preview explicitly shows that outcome and the operator confirms it.

### Payment units and historical evidence

- `hour`: eligible minutes minus explicitly allocated unpaid breaks, divided by
  60, times the agreed hourly rate. Preview uses planned minutes; final amount uses
  approved actual minutes. Save both quantities and amounts with provenance.
- `shift`: rate times explicitly approved shift units. One identified source shift
  is one unit even when split into multiple schedule segments. Partial shifts need
  an explicitly approved fraction; never infer another full unit per segment.
- `fixed`: one agreed amount for the identified work scope, quantity 1. Record
  descriptive workload separately. Completion/approval releases it once; missing
  clock events must not cause repeated payment or fabricated attendance.
- Use exact decimal/minor-unit arithmetic and round each canonical payable line
  once to two decimal places. The UI displays the server calculation.
- Ordinary monthly/per-shift base replacement needs an explicit denominator and
  covered allocation. Use a frozen approved monthly norm or agreed shift fraction.
  Missing evidence blocks `replace_base`; do not assume a monthly rate / 30.
- Freeze rate, unit, source profile/version, selected profession label, quantity,
  formula, rule version, currency and amount at agreement and at completion.
  Catalogue or profile edits cannot recalculate accepted historical amounts.
- A legitimate later correction creates a new revision and an explicit adjustment
  through existing open-period controls. Never rewrite a paid report snapshot.

## Shared technical design

### Aggregate and source adapters

Proposed new owner: `services/staffSubstitutions.js`, supported by
`services/staffSubstitutionSources.js` and `services/staffSubstitutionPreview.js`.
The current implementation uses `staffSubstitutionContract.js` for preview rules;
the architecture below remains the broader target, including pending source links.

The aggregate has a durable substitution ID, business context, original and
replacement staff IDs, profession, state, version, reason and actor metadata.
Versioned child records hold work scope, compensation terms, preview evidence,
original-worker decision and before/after effects. Maintain append-only revisions
and events; use a locked current-version pointer for concurrent commands.

Each adapter implements `loadScope`, `resolveStaffIdentity`, `checkEligibility`,
`listCommitments`, `applyAssignment`, `restoreAssignment` and `project`. Adapters
map a stable `(business, sourceType, sourceId, occurrenceKey, slotKey)` to one
canonical work scope. Client-provided table names, SQL or arbitrary owner fields
are forbidden. Source existence, ownership and business are checked server-side.

The same work can be visible as a task, shift, attendance entry and booking.
These are aliases of one work scope, not four separately billable substitutions.
Explicit alias links prevent duplicate earnings; never deduplicate by matching
names or roughly similar timestamps. Standalone assignments get their own scope.

Proposed durable tables (new governed schema migration; number allocated only
when implementation starts): `staff_substitutions`,
`staff_substitution_revisions`, `staff_substitution_source_links`,
`staff_substitution_events`, and a unique payable-source linkage to the canonical
payroll ledger. Add database-enforced unique request identities and source claims.
No migration backfills or rewrites existing schedules, rates or payroll reports.
Do not add bootstrap tables to `db/index.js`.

### Commands, concurrency and conflicts

Proposed API: preview, create, revise, confirm-work, cancel and read/history under
`/api/staff-substitutions`. Route naming is a proposal, not a shipped API.
Reuse existing action capabilities for source edits and payroll inspection/editing;
require both when a command changes both. Do not extend grants or business access.
Rate and history responses must honor existing compensation redaction.

Preview is read-only and returns a deterministic input fingerprint, source and
assignment versions, rate versions, warnings, blockers, effects and estimate.
Create/revise takes `expectedVersion`, the preview fingerprint and a request key.
Repeat of the same key/payload returns the original outcome; same key with a
different payload returns conflict. A different key must still respect active
source-claim and payable-source uniqueness.

The implementation must use a single transaction/client for assignment, schedule
projection, substitution revision, audit and payable provenance. Refactor existing
route-local transactions into reusable services where needed; never nest API calls
or independently commit a task reassignment before a substitution succeeds.
Establish one deterministic lock order compatible with existing period, staff,
attendance and booking resource locks, and exercise reverse-order concurrent
requests in PostgreSQL tests before accepting it. Revalidate the source, both
workers, admission, conflicts and rate versions under those locks.

Check intervals as half-open `[start, end)`; adjacent work is not a conflict.
Handle midnight and adjacent dates explicitly. Store business-local dates,
timezone `Europe/Kyiv`, unambiguous instants and offsets; reject ambiguous/nonexistent
DST times until the user specifies a valid instant. Split reporting by business
date without charging a fixed scope or shift twice.

Commitments include existing schedules, booking/Afisha work, education occurrences,
timed tasks and active substitutions. Deduplicate alias projections. Preview
classifies warnings versus blockers. Exclusive simultaneous work and incompatible
business scopes block; an explicitly permitted simultaneous additional role may
warn and require reason/acknowledgement. Recheck after preview so race conditions
cannot approve two workers for the same exclusive source slot.

### Lifecycle and downstream projections

Draft -> active -> completed, with cancellation/supersession recorded as new
events. Only approved completion/attendance is payable. Keep planned and earned
amounts separately visible. Cancellation before work restores only the affected
source/segments if their versions still match. Chained A -> B -> C replacements
restore a verified previous revision, not blindly `original_staff_id`.

After work has started, cancellation cannot erase earned minutes or silently
restore historical attendance. Closed/settled periods block mutation and require
the existing explicit adjustment workflow. Source deletion, cancellation,
rescheduling and ordinary reassignment must also consult substitution claims;
otherwise the feature can be bypassed through the old endpoints. Source changes
produce a stale preview or a revision, never an orphan earning.

Schedule, attendance, HR detail, payroll breakdown/export and relevant source
detail show one substitution ID, original/replacement worker, role, scope, status
and links to history. Payroll consumes unique approved payable evidence once,
regardless of how many surfaces show the work. Fixed work uses the same canonical
calculator/settlement flow with an explicit fixed-work source.

## Full implementation sequence and acceptance targets

| Package | Files / scope | Exit evidence |
| --- | --- | --- |
| Shared core | New substitution services, route and governed schema; `server.js` route registration using existing middleware patterns | Validation, role eligibility, source existence, preview version, idempotency and concurrent source claims tested against disposable PostgreSQL |
| HR adapter | `routes/hr.js`, `routes/staff.js`, `services/hrShiftSegments.js`, `services/staffScheduleMutations.js`, `services/professions.js` | Whole/partial shift transfer, same-day disjoint segments, cancellation, chained replacements and no permanent profession mutation |
| Pay adapter | `services/hrPayrollConditions.js`, `services/hrAttendance.js`, `services/payrollConditionCalculation.js`, `services/payroll.js`, `services/payrollSettlement.js`, `routes/payroll.js` | Three units, both pay modes, original-worker effect, frozen terms, unique payable source and closed-period protection |
| Shared form / read models | New `js/staff-substitution.js`; `js/api.js`, HR/staff page entry points, corresponding HTML/CSS, HR reports and schedule workbook | One form, server preview, all UI states, keyboard/focus/ARIA, mobile clicks and reviewed screenshots |
| Source adapters | Booking/roster, Afisha slots, one education lesson, task/My Day, procurement, bounded lead work | Same command and history contract per adapter; canonical identity and existing capability checks preserved |
| Regression / release preparation | New targeted unit/PostgreSQL/browser tests; existing payroll/HR/My Day suites and repository guards | Local evidence only under this approval; commits, CI push and deployment need subsequent explicit authorization |

Report accountant-duty reassignment and payment approval changes are excluded
because they are separate financial authority changes. If an adapter requires
changing protected booking identity, renderer ownership, the protected manifest,
CRM role grants or business access, stop and present that exact separate scope.
Do not claim all-process completion until each registered adapter passes the same
contract and any excluded source is clearly marked unavailable in the UI.

## Acceptance matrix

Use synthetic workers and future disposable dates. The illustrative manager
Vitalina -> administrator case is a fixture, not permission to mutate a real person.

| Case | Required result |
| --- | --- |
| Manager temporarily covers administrator | Selectable regardless of primary job; required admission is explicit; permanent profession and CRM permissions unchanged |
| Hourly 09:00-13:30, 30-minute unpaid break, 200 UAH/h | Preview 4 hours / 800 UAH; actual 3 hours => final 600 UAH, both snapshots retained |
| One approved shift at 1,200 UAH | One 1,200 UAH payable source even if the shift has multiple segments |
| Fixed agreed scope at 750 UAH | 750 UAH once after approved completion; no fabricated clock record |
| Same role, same day, two contracts at 200 and 250 UAH/h | Distinct source terms remain distinct, no whole-day exception leakage |
| Additional versus base replacement | Additional preserves named ordinary earnings; replacement removes only explicitly covered base evidence |
| Original retain versus transfer | Preview explains both workers' pay and schedule; worked original scope cannot silently disappear |
| Monthly ordinary pay | Frozen confirmed norm required to replace a fraction; missing norm blocks rather than assuming a day rate |
| Double click, retried request, new key for same source | Exactly one active exclusive claim and one payable source |
| Task + shift + booking represent one work item | Multiple projection links, one earning |
| Parallel create / edit / cancel / close period | One valid winner or clean conflict; no partially committed assignment or audit |
| Stale rate, source, staff status or admission | Re-preview required; no silent changed-price save |
| Overlap, adjacency, overnight, DST and date-only workload | Correct blocking/warnings; no false adjacency conflict; explicit limits for un-timed work |
| No linked user for a task candidate | Show blocker; never equate staff ID with user ID or create an account |
| Single lesson replacement | Group teacher and unrelated series occurrences unchanged; existing membership check retained |
| Afisha second slot and birthday projections | Check the correct source slot against booking and Afisha conflicts |
| Scope change / source cancel after agreement | Version conflict or audited revision; no orphan or duplicate earning |
| Rate catalogue changed after completion | Historical rate, formula and amount unchanged in payroll and export |
| Cancel A -> B -> C chain | Restore only the verified previous scope, respecting subsequent source edits |
| Closed/paid report | No historical snapshot rewrite; explicit adjustment route required |
| Unauthorized or cross-business API access | Existing permissions/redaction enforced on preview, history and mutation |
| Desktop/mobile, loading/error/empty/retry and keyboard | Shared form remains usable; real clicks and reviewed screenshots required |

## Verification actually performed

Runtime: Node 22.23.4 / npm 10.9.9, using the existing installation under
`D:/Codex/EventGenix/runtime/node-v22.23.4-win-x64`.

- `npm run check:runtime`: passed.
- `npm run version:current`: source 0.83.45, detached clean baseline.
- `node --test tests/hr-shift-segments-service.test.js tests/hr-shift-segments-routes.test.js tests/payroll-profession-allocation.test.js tests/staff-schedule-mutations.test.js`:
  109 passed, 0 failed, 0 skipped.
- Evidence: `output/substitution-baseline.log` in this worktree (ignored output).

These 109 tests establish the pre-change baseline. The shell initially exposed
Node 24 without npm; no result from that runtime is counted. No dependencies were
installed.

Implementation evidence (Node 22.23.4 / npm 10.9.9):

- Pure contract, frozen payroll evidence, cents propagation/payment-dialog and
  profession regression tests: 65 passed, zero failed/skipped.
  `output/substitution-tests.log`.
- Eight disposable PostgreSQL transaction tests passed: request replay and races,
  rollback, stale versions/previews, closed/approved-installment periods, immutable
  events, source/segment guards, one-time base claims and changed-snapshot detection.
  Migration is applied twice to verify idempotency. Evidence:
  `output/substitution-postgres.log`.
- Full migrated local application test passed using default services and
  authenticated API: manager temporarily covers reception; independent occupation
  unchanged; completed fixed pay reaches canonical payroll; whole HR transfer and
  cancellation restore the schedule; procurement picker, reassignment and
  cancellation work through the API; task/lead canonical account reassignment and
  cancellation are exercised against the migrated database. The fixed payment
  uses 750.37 UAH to prove cents survive the actual payroll read model. Evidence:
  `output/substitution-actual-app.log`.
- Browser fixture test passed desktop/mobile creation, mandatory explicit pay
  choice, lost-response replay with identical request/payload, focus restoration
  and no horizontal page overflow. Screenshots in `output/substitution-browser/`
  were visually reviewed. Evidence: `output/substitution-browser.log`.
- `npm test` reached the explicit unit suite: 3,982 passed, three failed because
  Git Bash was not discovered. Setting the existing local `GIT_BASH_PATH` and
  rerunning `tests/browser-smoke-sync.test.js` passed all seven. This is a targeted
  repair of the test environment, not a clean single-run `npm test` claim.
- The subsequent `test:my-day`, `test:crm-automation`, `test:ui`, `test:sys-mb` and
  `test:timeline-marketing` stages passed separately. API surface, migration and
  protected timeline checks passed. Evidence: `output/substitution-remaining-checks.log`.
- Wider payroll file selection: 217 passed / one failed. The failure is a stale
  source-text assertion in `payroll-hr-export-permissions.test.js` for
  `StaffState.canExportSchedule`; both that test and `js/staff-page.js` are unchanged
  from HEAD. Evidence: `output/substitution-payroll-regression.log`.
- Full existing HR disposable suite: eight passed / one failed. PDF automation
  returned `HR_ATTENDANCE_DOCUMENT_TEXT_OVERFLOW: Text does not fit: employeeName`.
  The temporary diagnostic assertion was removed. This gate remains unresolved;
  it is not counted as a pass. Evidence: `output/substitution-hr-fullstack.log`.
- No remote CI, deploy or live QA ran. All database writes were to a new local
  loopback PostgreSQL 17 disposable database, never the production connection.

Remaining release risk: partial feature acceptance above, unproven Afisha
end-to-end adapter cases and full source-page integration, plus the two wider
test failures. Complete those local acceptance gaps before proposing a release.

## Approval boundary

RED-SUBSTITUTION-LOCAL-01 authorizes local implementation and synthetic isolated
testing of the shared mechanism above, including scoped temporary work-role
handling, new additive schema files and compensation calculation/projection changes.
It does not authorize application of migrations to production, real staff/data
mutation, historical payroll rewrites, money transfers, new CRM permissions,
protected booking contract changes, commits, pushes or deployment.

This boundary follows AGENTS.md: "payments, invoices, billing, or payroll" is Red
and "Stop with an exact blocker before a Red action". The owner supplied the exact
local block approval. Rollback for this local block
is withdrawal of only its own reviewed local implementation diff; retain all
unrelated changes and leave production untouched. Production rollout must receive
its own bounded authorization and migration/release proof later.
