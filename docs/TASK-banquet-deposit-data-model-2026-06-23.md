# TASK: Banquet Deposit Data Model

- Status: proposed after analysis
- Type: implementation task
- Production impact: yes
- Requires explicit confirmation: yes, database schema migration

## Goal

Create the canonical storage model for accountant-confirmed banquet deposits.

## Recommended Scope

- Add a migration for `banquet_deposits`.
- Link deposits to `business_context`, `banquet_group_id`, `primary_booking_id`, `lead_id`, `customer_id`, and `accountant_task_id`.
- Store required confirmation fields:
  - client name snapshot;
  - deposit received date;
  - event date;
  - banquet number snapshot;
  - amount;
  - payment method: `cash` or `card`;
  - status and actor audit fields.
- Add indexes for business/date/status and booking/group lookup.
- Add a unique active idempotency key so one banquet/lead handoff cannot create duplicate active deposit workflows.

## Non-Goals

- Do not write finance transactions.
- Do not backfill old `paid_amount` rows.
- Do not delete or rewrite existing booking/banquet rows.

## Acceptance Criteria

- Migration follows `DB_MIGRATION_GOVERNANCE.md`.
- `paid_amount` remains debt/payment progress, not deposit truth.
- New table is additive and rollback notes are explicit.
- Missing booking/group can be represented safely as `needs_booking_link`.

## Verification

```bash
npm run check:runtime
npm run check:migrations
npm run check:db-startup-surface
```
