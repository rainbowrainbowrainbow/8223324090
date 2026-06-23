# TASK: Banquet Deposit Accountant Handoff Analysis

- Status: ready for Codex analysis
- Task type: analysis only, no production code changes
- Execution mode: discovery -> impact map -> implementation task breakdown
- Date: 2026-06-23
- Target repo: Event Genix CRM
- Production impact: yes

## Mission

Analyze the full deposit confirmation flow for banquet deals before implementation.

The requested product behavior:

1. Banquet records must clearly show whether the deposit has been received.
2. When a manager moves a lead/deal to the `deposit_received` stage, the CRM must automatically create a task for the accountant to verify the deposit.
3. The accountant must be able to record and save with the banquet:
   - client surname and first name;
   - deposit received date;
   - celebration/event date;
   - banquet number;
   - deposit amount;
   - payment method: card or cash.
4. After this analysis, create separate implementation tasks for the feature. Do not implement the feature in this analysis pass.

## Non-Goals For This Analysis

- Do not add database migrations.
- Do not edit production code.
- Do not change finance transaction behavior.
- Do not deploy.
- Do not create, push, or merge commits unless explicitly asked after the analysis.
- Do not auto-record money into `finance_transactions` without a separate approved implementation task.

## Mandatory Startup

Run and record:

```bash
git status --short --branch
npm run check:runtime
npm run version:current
```

Read first:

- `AGENTS.md`
- `README.md`
- `DB_MIGRATION_GOVERNANCE.md`
- `docs/SMART_TASK_SCHEDULING_ANALYSIS_2026-05-20.md`
- `docs/TASK-smart-task-scheduling-personal-tasker-current-live-plus-0.1.md`
- `docs/ai-context/workflows/task-lifecycle.md`
- `docs/ai-context/workflows/lead-to-booking-flow.md`
- `docs/ai-context/entities/task.md`
- `docs/ai-context/pages/finance.md`

## Current Evidence To Verify

Use this as a starting map, not as a final conclusion.

Lead/deal stage:

- `routes/leads.js` maps `deposit_received` to `status='booked'`.
- `routes/leads.js` calls `onDepositReceived(updatedLead, req.user)` after PATCH when the new stage is `deposit_received`.
- Existing `onDepositReceived` creates art, kitchen, and admin tasks. It does not appear to create a dedicated accountant verification task.
- `js/leads-page.js` shows a success notification for `deposit_received` saying tasks were created automatically.

Canonical tasks:

- `routes/tasks.js` and `services/kleshnya.js` are the canonical task creation path.
- `services/taskScheduling.js` already exists and should be reused for any due date/scheduling behavior.
- `db/migrations/189_task_smart_scheduling.sql` already added task schedule metadata.
- Tasks support typed ownership via `tasks.owner_user_id`, legacy display owner fields, `owner_role`, `source_type`, `source_id`, `source_entity_type`, and `source_entity_id`.

Banquet/booking/deposit:

- `routes/bookings.js` writes bookings and already persists `payment_method`.
- Migrations added `bookings.payment_status` and `bookings.paid_amount`, but analysis must confirm whether they are still mapped, exposed, and safe to use for deposit confirmation.
- `services/banquetSummary.js` already reads explicit deposit markers from `extra_data.deposit`, `extra_data.banquetDeposit`, `extra_data.bookingDeposit`, and related fields.
- `services/banquetSummary.js` intentionally warns when `paid_amount` exists without an explicit deposit marker, so `paid_amount` must not be blindly treated as deposit.
- `js/booking.js` has a detail warning helper that detects deposit markers in booking `extraData`, but this is not a full accountant confirmation workflow.
- `routes/banquets.js` and `services/banquetGroups.js` own banquet group read/write flow over bookings.

Finance/accountant:

- Finance routes and pages are privileged for `creator`, `director`, and `accountant`.
- There is existing report/accountant handoff work and accountant role metadata. Reuse role and task patterns instead of creating a separate handoff system.

## Analysis Questions To Answer

Data truth:

- Should the canonical deposit truth live on `bookings`, `banquet_groups`, a new `banquet_deposits`/`booking_deposits` table, or structured `bookings.extra_data.banquetDeposit`?
- If a banquet group has multiple bookings, which record owns the deposit: primary booking, group record, kitchen booking, or dedicated deposit record?
- Is "banquet number" the `banquet_groups.id`, the primary `bookings.id` (`BK-*`), or a separate human-visible number?
- Does "deposit received" mean manager-reported, accountant-verified, or both as separate states?
- Are `payment_status` and `paid_amount` still part of the current booking API contract, or are they legacy debt fields only?

Task automation:

- Should the accountant task be created only when the stage changes from a non-deposit stage to `deposit_received`, or every time the lead is PATCHed with that stage?
- What should make the task idempotent: `source_type/source_id`, `source_entity_type/source_entity_id`, a unique task key in `control_meta`, or a future table constraint?
- How should the task be assigned: `owner_role='accountant'`, first active accountant user, on-duty accountant from `accountants`, or unassigned with finance visibility?
- What schedule/deadline should the accountant task get: immediate, same day, before event date, or no exact time?
- What should happen if the lead has no linked `booking_id` or no banquet group yet?

Accountant confirmation UX:

- Where should the accountant complete confirmation: task detail modal, finance page, banquet/booking detail, or a focused handoff form opened from the task?
- Which fields are required before the task can be completed?
- Should completion update the banquet deposit record automatically?
- Should editing a confirmed deposit require role restrictions or a new audit event?

Finance boundary:

- Should deposit confirmation only store banquet evidence, or also create/update `finance_transactions`?
- If finance transaction creation is required later, what prevents duplicate income rows?
- How should cash vs card map to existing finance `payment_method` values?
- Should the deposit affect debt views (`payment_status`, `paid_amount`, amount due) immediately?

Access and audit:

- Which roles can view deposit status on banquet records?
- Which roles can create, edit, confirm, or correct deposit information?
- What history should be written: task action history, booking history, lead interaction, finance audit, or all of them?
- How are corrections represented without losing the original accountant confirmation?

## Source Areas To Inspect

Backend:

- `routes/leads.js`
- `services/leadBookingLink.js`
- `routes/tasks.js`
- `services/kleshnya.js`
- `services/taskScheduling.js`
- `services/taskExecution.js`
- `services/taskActionHistory.js`
- `services/taskPolicy.js`
- `routes/bookings.js`
- `services/booking.js`
- `routes/banquets.js`
- `services/banquetGroups.js`
- `services/banquetSummary.js`
- `routes/finance.js`
- `services/scheduler.js`
- `services/eventBus.js`

Database/migrations:

- `db/index.js`
- `db/migrations/077_finance_improvements.sql`
- `db/migrations/081_sync_lead_status_pipeline.sql`
- `db/migrations/174_task_execution_truth_v2.sql`
- `db/migrations/189_task_smart_scheduling.sql`
- `db/migrations/208_report_accountant_handoff_task.sql`
- `db/migrations/237_tasks_business_context_scope.sql`
- `db/migrations/261_leads_customer_card_canonical_customers.sql`
- `db/migrations/265_banquet_groups.sql`

Frontend:

- `js/leads-page.js`
- `leads.html`
- `js/tasks-page.js`
- `tasks.html`
- `js/booking.js`
- `index.html`
- `booking-summary.html`
- `js/finance-page.js`
- `finance.html`
- `js/auth.js`
- `js/components/sidebar.js`

Tests:

- `tests/sales-funnel.test.js`
- `tests/lead-booking-link.test.js`
- `tests/task-scheduling.test.js`
- `tests/task-decomposition.test.js`
- `tests/booking-banquet-links.test.js`
- `tests/booking-digest.test.js`
- `tests/booking-summary-pdf.test.js`
- `tests/booking-confirmation.test.js`
- `tests/booking-visibility.test.js`
- `tests/finance.test.js`
- `tests/route-smoke.test.js`
- `tests/ui-check.js`

## Required Analysis Output

Create an analysis document, suggested path:

```text
docs/BANQUET_DEPOSIT_ACCOUNTANT_ANALYSIS_2026-06-23.md
```

It must include:

- reality check: branch, worktree, runtime, version command result;
- current data model map for lead, booking, banquet group, task, finance transaction;
- current deposit-related fields and where they are read/written;
- exact lead `deposit_received` execution flow;
- current task creation and assignment options for accountant work;
- risks around duplicate tasks, missing bookings, business context, permissions, and finance duplication;
- 2-3 data model options with pros/cons;
- recommended MVP approach;
- protected changes requiring explicit confirmation;
- implementation task breakdown;
- verification plan.

## Expected Implementation Task Breakdown After Analysis

The analysis should create separate implementation tasks, not code:

1. Data model and migration task for canonical banquet deposit confirmation.
2. Backend API/service task for saving accountant-confirmed deposit data with audit.
3. Lead stage hook task for idempotent accountant task creation on `deposit_received`.
4. Accountant task UX task for capturing required deposit fields.
5. Banquet record/UI task for showing deposit received status/column.
6. Banquet summary/PDF task if deposit output must change.
7. Test task covering lead stage, task creation, deposit persistence, access, and duplicate prevention.
8. Release/version/changelog task if the feature becomes user-visible in production.

## Recommended Acceptance Criteria For The Future Feature

These are not for this analysis pass, but the analysis should validate or adjust them.

- Moving a linked lead from `deal` to `deposit_received` creates exactly one active accountant verification task.
- Re-saving the same lead stage does not create duplicate accountant tasks.
- The task includes client name, event date, banquet/booking number, expected context, and a direct route to the source record.
- Accountant cannot complete the verification without amount, received date, payment method, and banquet/booking link.
- Confirmed deposit is visible on the banquet record as received.
- Banquet summary uses the explicit confirmed deposit source, not generic `paid_amount`.
- Card/cash values are normalized and display in Ukrainian labels.
- Missing booking/banquet link creates a safe actionable warning instead of silently saving incomplete deposit truth.
- Finance transactions are not duplicated.

## Verification Plan For This Analysis Task

Run at minimum:

```bash
npm run check:runtime
node --test tests/sales-funnel.test.js
node --test tests/lead-booking-link.test.js
node --test tests/booking-digest.test.js
node --test tests/booking-banquet-links.test.js
```

If the analysis only edits documentation, also run:

```bash
git diff -- docs/TASK-banquet-deposit-accountant-analysis-2026-06-23.md docs/BANQUET_DEPOSIT_ACCOUNTANT_ANALYSIS_2026-06-23.md
```

Do not claim PostgreSQL-backed API/integration verification unless a configured local app/database was actually used.
