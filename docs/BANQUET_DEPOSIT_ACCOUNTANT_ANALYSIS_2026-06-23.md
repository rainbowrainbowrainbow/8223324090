# Banquet Deposit Accountant Handoff Analysis

- Date: 2026-06-23
- Scope: analysis only
- Production impact: yes
- Code changes in this pass: no
- Schema changes in this pass: no

## Reality Check

- Branch: `codex/timeline-leads-hardening`
- Upstream: `origin/codex/timeline-leads-hardening`, in sync according to `npm run version:current`
- Current version: `v0.77.9 - True Customer NPS`
- Worktree at analysis start: dirty with one untracked analysis task file, `docs/TASK-banquet-deposit-accountant-analysis-2026-06-23.md`
- Runtime check: failed locally because Node `24.13.0` and npm `11.6.2` are active; repository baseline requires Node `22.x` and npm `10.x`
- Verification status: static source analysis only. Do not treat this as runtime-verified until rerun on Node 22/npm 10.

## Request Summary

The requested product change is not just a UI column. It crosses sales funnel, banquet records, canonical tasks, accountant workflow, deposit data, and possibly finance.

Required behavior:

- Banquet records show whether a deposit was received.
- When a manager moves a lead/deal to `deposit_received`, the CRM automatically creates an accountant task to verify whether the deposit arrived.
- The accountant records client surname/name, deposit received date, celebration date, banquet number, amount, and method: card or cash.
- The saved deposit data stays with the banquet.

## Current Data Flow

### Lead

Source evidence:

- `routes/leads.js`
- `services/leadBookingLink.js`
- `js/leads-page.js`
- `tests/sales-funnel.test.js`
- `tests/lead-booking-link.test.js`

Current behavior:

- `pipeline_stage='deposit_received'` maps to `status='booked'`.
- `status='booked'` maps back to `pipeline_stage='deposit_received'`.
- `PATCH /api/leads/:id` locks the old lead row when a stage is provided, updates stage/status, and writes a lead interaction only if the old and new stage differ.
- After the update commits, any lead whose effective new stage is `deposit_received` calls `onDepositReceived(updatedLead, req.user)` as a non-blocking fire-and-forget hook.
- That hook currently creates art, kitchen, and admin tasks. It does not create an accountant verification task.
- The hook runs when the new stage is `deposit_received`, not only when the stage changed into `deposit_received`.
- Existing hook-created tasks do not pass `businessContext`, so they fall back to task default context. That is a risk for non-default business contexts.

### Booking

Source evidence:

- `routes/bookings.js`
- `services/booking.js`
- `db/migrations/077_finance_improvements.sql`

Current behavior:

- Bookings have `payment_method`.
- Migrations added `payment_status`, `paid_amount`, and `debt_notified_at`.
- `routes/finance.js` debt views use `payment_status` and `paid_amount`.
- `POST /api/finance/debts/:bookingId/mark-paid` updates `paid_amount` and `payment_status`.
- `routes/bookings.js` can patch `payment_method`, but there is no dedicated deposit confirmation API.
- `services/booking.js#mapBookingRow` exposes `paymentMethod`, but does not expose a canonical deposit object.

Conclusion:

- `paid_amount` and `payment_status` are debt/payment-progress fields, not safe canonical deposit confirmation fields.
- `payment_method` is reusable as a payment method vocabulary source, but not enough for deposit verification.

### Banquet Group

Source evidence:

- `routes/banquets.js`
- `services/banquetGroups.js`
- `db/migrations/265_banquet_groups.sql`

Current behavior:

- `banquet_groups` is a separate layer over bookings.
- A group has `id`, `business_context`, `primary_booking_id`, `customer_id`, `date`, `room`, `group_name`, `status`, `source`, and `meta`.
- `banquet_group_bookings` links bookings to a group with roles: `primary`, `kitchen`, `activity`, `service`, `manual`.
- Banquet routes can create groups, attach/detach bookings, create member bookings, and load a group by booking id.
- There is no deposit field or deposit table attached to banquet groups.

Conclusion:

- The strongest banquet-level identity is `banquet_groups.id` when a group exists.
- The fallback identity is the primary `bookings.id` (`BK-*`).
- Storing deposit data only on one booking row is ambiguous for multi-booking banquet groups unless the ownership rule is explicit.

### Banquet Summary / Deposit Read Model

Source evidence:

- `services/banquetSummary.js`
- `js/booking.js`
- `tests/booking-digest.test.js`
- `tests/booking-banquet-links.test.js`
- `tests/booking-summary-pdf.test.js`

Current behavior:

- `services/banquetSummary.js` reads explicit deposit markers from:
  - `extra_data.deposit`
  - `extra_data.banquetDeposit`
  - `extra_data.bookingDeposit`
  - `extra_data.bookingPayment.deposit`
  - `extra_data.payment.deposit`
  - direct `depositAmount` / `deposit_amount` style fields
- It intentionally warns with `deposit_not_specified` when no explicit deposit marker exists.
- It intentionally warns with `paid_amount_not_used_as_deposit` when `paid_amount > 0` exists without an explicit deposit marker.
- `js/booking.js` has a detail warning helper that checks for deposit markers in `extraData`, but there is no accountant confirmation workflow.

Conclusion:

- The code already protects against treating generic `paid_amount` as deposit.
- Existing summary code can consume a structured deposit marker, but this marker is not currently managed by a canonical accountant flow.

### Tasks

Source evidence:

- `routes/tasks.js`
- `services/kleshnya.js`
- `services/taskDuplicatePolicy.js`
- `services/taskScheduling.js`
- `services/taskActionHistory.js`
- `db/migrations/174_task_execution_truth_v2.sql`
- `db/migrations/189_task_smart_scheduling.sql`
- `db/migrations/237_tasks_business_context_scope.sql`

Current behavior:

- Canonical task creation path is `kleshnya.createTask`.
- `POST /api/tasks` also routes through `kleshnya.createTask`.
- Tasks support:
  - `business_context`
  - `owner_user_id`
  - legacy `assigned_to` / `owner`
  - `created_by_user_id`
  - `source_type`
  - `source_id`
  - `source_entity_type`
  - `source_entity_id`
  - `owner_role`
  - `control_meta`
  - smart scheduling fields
- Active duplicate detection already uses title, date, category, subcategory, owner, business context, and a source/entity anchor.
- The duplicate policy includes `owner_user_id`, so changing the target accountant can still create a duplicate unless a stronger idempotency key exists outside the task duplicate signature.
- Task action history is available for durable execution history.

Conclusion:

- Do not create a new task system.
- Use canonical tasks.
- For deposit handoff, a separate deposit/handoff record should own idempotency and store the task id. Do not rely only on `duplicateMode: 'skip'`.

### Accountant / Finance

Source evidence:

- `routes/finance.js`
- `routes/reports.js`
- `config/roles.js`
- `middleware/auth.js`
- `js/auth.js`
- `js/components/sidebar.js`
- `tests/reporting-visibility-scope.test.js`
- `tests/ui-check.js`

Current behavior:

- Finance access is intentionally limited to `creator`, `director`, and `accountant`.
- Accountant role belongs to finance department and has task visibility `department`.
- Reports already have a task-backed accountant handoff pattern:
  - create a task through `kleshnya.createTask`
  - set `owner_user_id` to reviewer when possible
  - use `source_type: 'report'`
  - use `duplicateMode: 'skip'`
  - store the task id back on the report entity
- There is also an old `accountants` table for report bot/on-duty accountant flow. It is not the same as `users`, but some report flows resolve an accountant reviewer/user.

Conclusion:

- The report approval flow is the best implementation pattern to reuse.
- `owner_role='accountant'` alone should not be treated as enough. Assign a typed `owner_user_id` when possible, or add an explicit finance queue rule.

## Data Model Options

### Option A: Store Deposit In `bookings.extra_data.banquetDeposit`

Pros:

- Fastest implementation.
- No migration required.
- `services/banquetSummary.js` already reads this structure.
- Works as a compatibility bridge.

Cons:

- Weak audit and weak queryability.
- Harder to enforce required fields and status transitions.
- Harder to prevent duplicate accountant confirmations.
- Ambiguous for banquet groups with several bookings.
- Role-based edit/correction rules become route-specific custom code.

Fit:

- Acceptable only as a temporary compatibility write target after canonical deposit data exists.

### Option B: Add Deposit Columns To `bookings` Or `banquet_groups`

Pros:

- Simple to display.
- Easy to query/filter.
- Banquet group columns would match the user's "saved with banquet" language.

Cons:

- Schema change is protected and needs explicit confirmation.
- Columns alone do not model audit/corrections well.
- `bookings` is ambiguous for multi-booking banquets.
- `banquet_groups` does not always exist for legacy/single booking flows.
- Future finance transaction linkage would add more nullable columns.

Fit:

- Better than JSON-only for display, but still weak for accountant verification lifecycle.

### Option C: Add Canonical `banquet_deposits` Table

Recommended.

Pros:

- Clear source of truth.
- Can link to `business_context`, `banquet_group_id`, `primary_booking_id`, `lead_id`, `customer_id`, and `task_id`.
- Can store accountant verification status, verified actor, correction metadata, and future finance transaction link.
- Can enforce idempotency with a unique active key.
- Can drive banquet UI, task UX, and summary from one canonical source.
- Keeps `paid_amount/payment_status` debt logic separate.

Cons:

- Requires schema migration and explicit confirmation.
- Requires service/API layer.
- Requires a read projection back into banquet summary and UI.

Fit:

- Best MVP that does not create hard-to-remove debt.

## Recommended MVP

Implement a canonical deposit confirmation model around a new table, likely `banquet_deposits`.

Suggested fields:

- `id`
- `business_context`
- `banquet_group_id` nullable FK to `banquet_groups(id)`
- `primary_booking_id` nullable FK to `bookings(id)`
- `lead_id` nullable FK to `leads(id)`
- `customer_id` nullable FK to `customers(id)`
- `accountant_task_id` nullable FK to `tasks(id)`
- `client_name_snapshot`
- `event_date`
- `banquet_number_snapshot`
- `amount`
- `payment_method` constrained to `cash`, `card`
- `status` constrained to `manager_reported`, `needs_booking_link`, `accountant_verified`, `corrected`, `cancelled`
- `manager_reported_at`
- `manager_reported_by_user_id`
- `verified_at`
- `verified_by_user_id`
- `corrected_at`
- `corrected_by_user_id`
- `finance_transaction_id` nullable, reserved for a future finance task
- `meta JSONB`
- `created_at`
- `updated_at`

Recommended source-of-truth rules:

- If a banquet group exists, `banquet_group_id` owns the deposit.
- If no banquet group exists, use `primary_booking_id` and allow later reconciliation to a group.
- `banquet_number_snapshot` should display `banquet_group_id` when available, else `primary_booking_id`.
- `paid_amount` must not be used as deposit unless a future migration explicitly converts it into deposit records with operator approval.
- The deposit summary compatibility object can be generated from `banquet_deposits` into the API response or mirrored into `bookings.extra_data.banquetDeposit` only as a compatibility layer.

## Recommended Flow

1. Manager changes lead to `deposit_received`.
2. Backend checks old stage and new stage.
3. If this is the first transition into `deposit_received`, create or load a deposit handoff record.
4. Resolve linked booking and banquet group:
   - if linked booking/group exists, attach them;
   - if not, mark the handoff `needs_booking_link`.
5. Resolve accountant assignee:
   - prefer configured workflow/on-duty accountant user if available;
   - fallback to first active user with role `accountant`;
   - if no user exists, leave unassigned but set explicit `owner_role='accountant'` and surface warning.
6. Create one canonical task and store its id on `banquet_deposits.accountant_task_id`.
7. Accountant opens the task and fills required confirmation fields.
8. Backend validates required fields and saves deposit confirmation.
9. Completion writes:
   - deposit row update;
   - task action/history event;
   - booking/banquet history or deposit audit event;
   - optional lead interaction.
10. Banquet UI and summary read deposit state from the canonical deposit service.

## Key Risks

- Duplicate tasks if the hook fires repeatedly or accountant owner changes.
- Wrong business context because current `onDepositReceived` task creation does not pass `businessContext`.
- Missing `booking_id` on lead when moved to `deposit_received`.
- Banquet group may not exist yet even when a booking exists.
- Accountant role visibility may not show unassigned `owner_role='accountant'` tasks as expected.
- Generic finance/debt fields could be confused with explicit deposit truth.
- Existing booking create/update can create full-price finance transactions for confirmed bookings, so deposit finance writes need a separate duplicate-safe design.
- Fire-and-forget hooks can fail without failing the lead stage update.
- Mojibake exists in some legacy UI strings; new visible strings must be written cleanly in Ukrainian during implementation.

## Protected Changes Requiring Explicit Confirmation

- New `banquet_deposits` table or any new schema migration.
- Any backfill from `paid_amount` or `extra_data.banquetDeposit`.
- Any write to `finance_transactions`.
- Any change to auth/role visibility.
- Any production deployment or environment configuration change.

## Implementation Task Output

Created task files:

- `docs/TASK-banquet-deposit-data-model-2026-06-23.md`
- `docs/TASK-banquet-deposit-backend-api-2026-06-23.md`
- `docs/TASK-banquet-deposit-lead-hook-2026-06-23.md`
- `docs/TASK-banquet-deposit-accountant-ux-2026-06-23.md`
- `docs/TASK-banquet-deposit-banquet-ui-2026-06-23.md`
- `docs/TASK-banquet-deposit-summary-pdf-2026-06-23.md`
- `docs/TASK-banquet-deposit-tests-2026-06-23.md`
- `docs/TASK-banquet-deposit-release-2026-06-23.md`

## Verification Plan

Before implementation:

```bash
npm run check:runtime
node --test tests/sales-funnel.test.js
node --test tests/lead-booking-link.test.js
node --test tests/booking-digest.test.js
node --test tests/booking-banquet-links.test.js
```

After implementation:

```bash
npm run check:runtime
npm run check:migrations
node --test tests/sales-funnel.test.js
node --test tests/lead-booking-link.test.js
node --test tests/task-scheduling.test.js
node --test tests/booking-digest.test.js
node --test tests/booking-banquet-links.test.js
node --test tests/booking-summary-pdf.test.js
npm run test:ui
npm test
```

If backend deposit APIs touch PostgreSQL-backed behavior beyond static unit tests, also run a configured live app/database API test pass. Do not claim it unless actually run on Node 22/npm 10.
