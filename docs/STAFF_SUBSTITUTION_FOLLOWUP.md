# Staff substitution follow-up

## Implementation

The deployed baseline is 0.83.48, `3f41bef21804f61ecb452961902be68e047603be`,
confirmed through the production branch and live version endpoint on 2026-11-13.
This follow-up is a local candidate in the existing isolated substitution worktree.
Migration numbers 393–400 are provisional for the deployed baseline. The
local HR Team and freelance candidates already use migration numbers 393–396.
Rebase onto the then-current production branch, assign available numbers and
rerun migrated-app and backup/recovery tests before seeking release approval.

The HR adapter supports transferring a daytime interval inside one ordinary
segment, including daytime animator work. It also supports moving an edge of
a break-free non-animator overnight shift if both resulting plans can represent
its timing using the existing single-overnight-segment rule. The original day must retain at least one segment. A whole
segment of a compound day keeps its recorded break. An arbitrary subinterval
requires a break-free source segment because the shift currently records break
duration without a start time. Both workers' existing attendance is checked
before any schedule write. The preview shows both resulting schedules and
requires independent choices for the original worker's pay and the executor's
compensation for the exact scope.

The original worker keeps the remainder of the plan. For the executor, the
adapter inserts the segment into a non-overlapping existing compatible day or
creates a day if there is no schedule entry. The existing HR plan writer,
schedule mirror, period locks and substitution ledger operate in the same
transaction. A temporary admission remains scoped to the substitution.
Cancellation restores the original plan and removes the transferred segment
or the newly created day. Migration 393 guards both plans and their segment roles
against bypass writes. It adds no backfill. It conservatively permits at most
one HR substitution touching a worker/day while a claim remains in force.

Allocation evidence for a partial shift must match the transferred segment,
profession and local times recorded in the finalized attendance plan.
Other base allocations remain in ordinary payroll. Existing whole-shift and
standalone records retain their completion contract. The current settlement
guard still applies to overtime, unresolved ordinary rates, whole-day rate
allocation and frozen periods.

## Assignment inventory

| Process | Canonical source | Integration status or dependency |
| --- | --- | --- |
| Standalone duties | Substitution ledger | Existing registry, preview, completion and payroll. |
| HR roster, staff schedule, workbook and Hermes scheduling | `hr_shifts`, `hr_shift_segments`, derived `staff_schedule` | Whole shift in production. Partial daytime, daytime animator and representable overnight edge transfers locally. HR and Staff reload the shared schedule after successful commands. |
| Tasks, recurring tasks, My Day, Board, requests and Work Queue task items | `tasks.owner_user_id`, `taskExecution` | Existing task integration for visible transferable instances. Templates, private tasks and recurring-rule ownership use separate contracts. |
| Procurement | `procurement_lists.assigned_to` → `staff.id` | Existing ledger adapter with the existing area gate. Warehouse item custody is a separate stock movement. |
| Leads | `leads.assigned_to` → `users.id` | Existing adapter with the linked-account requirement. The local alias guard rejects overlapping claims on a lead and its explicitly linked tasks. |
| Afisha | `afisha.line_id`, `second_line_id` and `afisha_birthday_slots` | Regular primary/second slots in production. The local picker filters by slot and provides the event's end time. Single and two-slot greetings use occurrence-specific assignment. Automatic occurrences move with the replacement or reject the scheduling write when the replacement is unavailable. |
| Park bookings, linked events and banquet members | Booking animator conflict checks, linked-booking contract, dated animator roster | Ordinary and active canonical banquet primary/activity members support primary and unambiguous second-animator slots locally. Legacy-only banquet links and ambiguous technical children remain outside the adapter. |
| Education lessons, recurring lessons and group teachers | Booking occurrence lesson metadata, `assertLessonTeacher`, `education_teacher_memberships`, `education_groups.teacher_id` | Local DAR lesson occurrence adapter and teacher-specific accruals. Group and series defaults stay intact. |
| HR onboarding mentor and generated learning tasks | `onboarding_progress.responsible_user_id`, `assignOnboardingResponsible`, `syncOnboardingTasks` | A current Park progress record and its generated tasks move through the existing assignment service in one transaction. Generated tasks cannot be separately claimed. |
| Inbox assignments and reply expectations | `conversations.assigned_to`, `reply_owner_user_id`, reply escalation task | The general assignee of open or pending Park conversations supports local substitution with existing Omni eligibility. An expected reply with an active escalation task supports a separate claim keyed by its outbound message. The reply owner, escalation task owner and audit history change atomically. |
| Chat tasks | `chat_tasks.assigned_to` → `users.id` | Direct tasks in an active Park booking channel support local substitution through the task creator or an existing chat-task manager who belongs to the channel. The replacement must already have business and channel access. |
| Meeting actions | `meeting_action_items.assigned_to`, `task_id`, generated `tasks` | A meeting creator can substitute a pending action in an active Park booking channel they belong to. The replacement must already have business and channel access. Converted actions use the linked task. |
| Support tickets | `support_tickets.assigned_to` | Legacy free-text field and no durable worker link. Requires scoped identity and a precise work item before exposing payable substitution. |
| Art Director content | `content_items.assigned_to` | Free-text assignee. A payable scope needs stable identity and business ownership separate from publisher/reviewer attribution. |
| Training courses and homework | `training_courses.instructor_id`, `training_assignments.assigned_to` | Course instructor is set from the course creator. Homework recipients are learners. A teaching shift requires a distinct delivery occurrence. |
| Finance report duty | `reports.assigned_to` → `accountants.id` | Requires an exact accounting workflow scope and durable worker mapping without transferring approval/payment authority. |

The inventory records source paths present in this revision. Operational ownership
that also grants visibility must continue to use the source's existing access
rules, including authorization for the replacement worker.

## Remaining implementation

For whole and partial HR shift transfers, the two pay choices are independent.
Retaining the original worker's pay preserves the agreed value of the transferred
minutes using their dated hourly base conditions. Completion releases the frozen
amount as a separate base-pay line without recording attendance for those minutes.
Reducing their planned pay produces no retained line. The executor's additional
mode preserves attendance-based pay plus one agreed premium. Base replacement
consumes only verified allocations for the transferred work. The preview shows
both schedules, transferred minutes and planned ordinary amounts when calculable.
Overnight splits with
a separately dated remainder and arbitrary slices with breaks or simultaneous
roles need explicit day offsets and break/role allocation. Daytime animator
transfers use the dated roster and reject any existing booking or Afisha slot
outside the resulting coverage. Overnight animator assignments and banquet
or two-slot Afisha birthday transfers remain unsupported. Pre-payroll corrections
after completion need a separately traceable adjustment path. Dashboard,
workbook, source-page and employee-facing read models still need substitution
provenance. The remaining adapters in the inventory need scope and lifecycle
tests, including cross-source duplicates. Authenticated live QA requires the
test credentials file and an appropriately scoped production authorization.

## Park animator booking integration

`RED-SUBSTITUTION-BANQUET-LOCAL-04` extends the same adapter to an active
canonical banquet primary or activity member with a resolvable animator
slot. The claim uses the member booking ID and slot, not the group ID.
The adapter locks the group before its booking rows, updates only animator
assignment fields and advances the group's existing optimistic version.
The canonical editor can continue to use group and booking detail endpoints.
The booking and banquet guards protect active claims against cancelling,
detaching, reclassifying or moving the relevant relationship. Compatibility
links inside the same canonical group are supported. Independent members
retain independent claims. A conflict with the former animator's calendar
blocks restoration before changes or history are written.

Local block RED-SUBSTITUTION-BOOKING-LOCAL-02 covers the original booking and
its optional unambiguous second-animator child. The adapter takes the ordinary
booking edit/visibility decisions and dated line locks, uses the booking
conflict validator, and modifies only animator assignment fields and their
display metadata. It retains the booking IDs, room, price, customer, payments,
and linked record identity. The existing timeline/detail code reads the updated
assignment. Post-commit notifications use the existing booking visibility
audience. The six manifest hashes continue to cover their original code blocks.

The booking and its second-animator child use the root booking ID plus slot for
the claim. The booking source is the only new payable substitution path for
tasks explicitly linked to bookings. Existing task claims block an additional
booking claim, while task ownership and normal task work remain separate.
Compensation can be additional or replace the replacement worker's exact
ordinary attendance allocation. The latter requires a matching scheduled
segment before agreement and a finalized allocation with the booking's
start/end, profession, date and no overtime. Other ordinary allocations stay payable.
The original worker's ordinary pay is retained. The replacement needs an
eligible dated animator window.
Active claims protect source rescheduling, reassignment, cancellation and
destructive deletion. Operators resolve the substitution first. A completed
claim keeps its historical amount and lets later booking changes proceed, but
another claim cannot pay the same booking/slot again.

The owner specified in this chat that educational substitution pay belongs
separately to DAR, for teachers only. The canonical context key is `dar`.
The worker selector must use `listTeachers('dar')` and preserve current teacher
eligibility through `assertLessonTeacher`. A Park staff record or a matching
display name alone does not establish DAR teacher eligibility.

The DAR education schedule provides teacher substitutions, dated standard
rates per teacher and a separate period accrual report. An individual rate
requires an explicit reason. Each completed lesson adds one DAR accrual in
UAH from the frozen completion. The Park payroll loader continues to include
only `event_genix` rows. DAR accruals support hourly and fixed per-lesson
pay and do not generate payout installments.

The lesson adapter updates a single dated occurrence and its existing lesson
metadata aliases under the canonical teacher conflict locks. Group and series
defaults stay intact. The database guards lesson identity, timing, assignments
and cancellation while a substitution is active. An existing attendance journal
prevents creating, revising or cancelling a substitution for that lesson.
The DAR entry point requires existing business, timeline and payroll access.

The local DAR change was authorized under RED-SUBSTITUTION-DAR-LOCAL-03.
The occurrence is uniquely claimed across dates, and the existing booking
alias guard rejects substitutions on booking-derived tasks. History records
occurrence identity, dates, teacher assignment and agreed terms.

Onboarding uses the existing reassignment function in a caller-owned
transaction for the exact progress record, generated tasks and audit history.
Reply handoff changes only the reply owner and escalation task identified by
the current outbound anchor. A later message can have a separate claim.
Direct chat tasks require an active channel linked to a Park booking and
existing member access. Chat message-derived tasks, DMs and channels without
an unambiguous business link need additional scope. Direct meeting actions use one payable claim. Conversion locks the action row,
keeps task creation and linking atomic, rejects conversion during an active
claim, and skips actions already completed through substitution. Legacy
text fields on support and content records need validated worker IDs and
business ownership.

## Acceptance still outstanding

- HR: retained pay under daily or monthly guarantees needs an explicit
  allocation rule. Post-midnight segments on a separate date, simultaneous
  roles, arbitrary breaks and chained reversals remain open.
- Sources: Park legacy-only banquet links and ambiguous linked bookings,
  reply expectations pending escalation,
  other chat tasks, meeting actions without a scoped Park channel, free-text support/content
  assignees, training delivery occurrences and report work. The inventory above names the canonical
  dependency for each. Protected booking changes and accounting authority are
  outside the currently approved local scope.
- Read models: workbook, employee and source-page substitution provenance,
  beyond existing history and payroll lines. No production verification has
  been authorized for this local follow-up.

## Decisions before expanding protected booking and pay scopes


- Legacy banquet links: reconcile each reviewed booking to canonical group
  membership, or add a protected legacy adapter that only accepts an explicit
  stable booking/child pair with matching program, time, role and line IDs.
  Leave ambiguous historical records for manual review under either option.
- Per-exit pay retention: preserve the full exit once if the worker loses all
  paid work, or introduce a proportional policy based on the frozen planned
  minutes per day. A partial transfer must never produce a second full exit.
- Monthly retention: preserve the guaranteed monthly amount, or use the
  transferred minutes divided by the frozen approved monthly norm and retain
  that proportional value. Existing historical amounts remain frozen.

## Afisha occurrence scheduling

The claim key combines the event, occurrence and animator position. The day
and week views, booking conflict check and HR roster checks use each slot’s
assigned lines. Park schedule mutations share a transaction lock by date.
Migration 409 validates the final schedule before commit, records a move as an
append-only substitution revision, and rejects unavailable replacement windows,
occupied assignments or already started attendance. Completion pins the agreed
slot time and amount. Historical event-wide greeting claims remain supported.

## Local verification

- The fully migrated app verified mentor reassignment together with generated
  tasks, safe restoration, alias denial and one completion calculation. A
  fixed single Afisha greeting used its 15-minute occurrence and rejected a
  timing change while active. An Omni conversation retained its message history
  while the assignment moved and restored through the canonical inbox service.
- The migrated PostgreSQL app verified direct Park meeting action assignment,
  creator and channel scope, restoration, a race between conversion and
  agreement, two concurrent conversion requests, and one 750.37 UAH accrual.
  The full backup restored into a separate clean PostgreSQL database with
  migration 408 applied.
- The migrated PostgreSQL app verified atomic reply and escalation transfer,
  a rejected direct owner edit, restoration, and a new claim for the next
  message in the same conversation. It verified the Park chat task's
  membership requirement, rejected direct owner edits, restored the owner,
  and recorded confirmed completion after the normal task closure. The full
  backup restored into a separate clean PostgreSQL database with migrations
  406 and 407 applied.


- Park banquet: the fully migrated app verified activity-slot discovery,
  second-animator replacement and restoration, a refreshed group version,
  consistent membership, canonical cancellation and legacy link guards,
  transactional history and an atomic refusal when restoration conflicts.
  Primary-slot completion on the same banquet produced one payroll line.
  Chromium exercised the shared picker and confirmation at 390 px with
  synthetic responses. The confirmation screenshot was reviewed. Full v2
  backup and recovery passed with migration 402 applied.

- Pay options: the migrated app previewed all four HR combinations. It kept
  one 100 UAH retained-pay line for the original worker after a rate change,
  and paid the executor 100 UAH from attendance plus a single 125.37 UAH
  premium. Completion without finalized attendance was rejected. Existing
  base-replacement cases still remove only the agreed attendance allocation.
  The isolated suite and 96 focused HR, payroll and contract tests passed.

- Node 22.23.4 and npm 10.9.9. There were 69 focused substitution and HR
  tests and eight PostgreSQL transaction scenarios with successful results.
- The isolated fully migrated app covered source selection, whole-shift rate
  revision, partial transfer into an existing or new day, overlap rejection,
  source-write guards, cancellation, ordinary attendance and settlement.
  The unrelated manager allocation was rejected as a claim, and the reception
  substitution produced one 450 UAH line.
- Chromium exercised real clicks in the shared form on desktop and at 390 px
  with synthetic API responses. The mobile form and the before-save schedule
  summary were visually reviewed. The full migrated-app suite runs separately
  and is registered in the local GitHub CI workflow definition.
- The migration and all six protected timeline block checks passed. The
  disposable local PostgreSQL cluster used fsync and synchronous_commit off
  for Windows disk performance.
- Full v2 backup and recovery into a separate clean PostgreSQL database passed
  with the new migration present.
- Full `npm test` passed on the second run, including 4,001 unit tests and 1,327
  UI checks. The first run exposed a schedule event registration incompatible
  with the existing minimal window fixture. The registration now follows the
  Staff page's existing optional event pattern, and the 60 targeted schedule and
  substitution tests passed before the full rerun.
- The Park booking integration passed on the fully migrated local app. The
  cases covered stale previews after a calendar change, concurrent claim
  attempts, the primary and second slots, the existing detail endpoint, guarded
  rescheduling and cancellation, access denial, task alias blocking, rate
  revision, restoration, and one 750.37 UAH payroll line after completion.
  Full v2 recovery also passed with the booking migration present. Chromium
  exercised the second-slot picker, populated time fields and agreement at
  390 px with synthetic responses.
- Follow-up booking base replacement passed against the fully migrated app.
  A nine-hour animator day with an eight-hour segment and one booked hour
  retained 800 UAH ordinary pay and produced one 200 UAH substitution line.
  The eight-hour allocation was rejected as a replacement target. Before
  attendance completion the base-allocation picker was empty. The latest
  focused run passed 49 substitution, payroll and HR segment tests.
- DAR used synthetic records in the fully migrated local app. The checks
  covered dated rates, teacher membership, overlap and stale previews,
  one-occurrence edits and restoration, guarded lesson and series cancellation,
  idempotent completion, and one 325.50 UAH DAR accrual with no Park entry.
  Chromium exercised the DAR form on fixture responses and the accruals report
  on the actual app at 390 px. The screenshots were reviewed. The full v2
  backup restored into a separate clean PostgreSQL database.
- The overnight and animator follow-up passed focused HR and substitution
  tests, migration governance, protected timeline checks and desktop/mobile
  browser clicks. The 390 px preview with the two schedules and transferred
  minutes was visually reviewed. The migrated app verified the night schedule
  and restoration, animator roster windows and cancellation guard, and one
  winner for concurrent lead and task claims.
- The isolated education suite passed all 18 server scenarios and 11 extended
  scenarios. The affected Chromium test now leaves loopback asset traffic
  unintercepted and waits for the actual controls after navigation commits.
