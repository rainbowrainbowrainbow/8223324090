# Banquet Deposit Data Safety Inventory

Date: 2026-06-23
Production impact: yes
Scope: read-only inventory before introducing canonical banquet deposit storage.

## Goal

Find every existing deposit-like source before migration so old deposit information is not lost or silently reinterpreted.

## Read-Only Report

Use this report against the target database before writing the migration:

```bash
psql "$DATABASE_URL" -f docs/BANQUET_DEPOSIT_INVENTORY_READONLY_2026-06-23.sql
```

The report has no `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, or `CREATE` statements. It returns:

- `booking_id`
- `business_context`
- `customer_id`
- `date`
- `group_link` from `banquet_group_bookings` / `banquet_groups`, legacy `booking_banquet_links`, and `bookings.linked_to`
- `deposit_json` with all explicit deposit-like fields found on the booking
- `payment_method`
- `payment_status`
- `paid_amount`
- `payment_context`
- `copy_disposition`

## Current Source Map

| Source | Current evidence | Meaning for migration |
| --- | --- | --- |
| `bookings.extra_data.deposit` | Read by `services/banquetSummary.js` as an explicit deposit candidate. | Copy to canonical deposit row and preserve original JSON/source path. |
| `bookings.extra_data.banquetDeposit` | Read by `services/banquetSummary.js`; used in tests as current compatibility source. | Copy to canonical deposit row and preserve original JSON/source path. |
| `bookings.extra_data.bookingDeposit` | Read by `services/banquetSummary.js`. | Copy to canonical deposit row and preserve original JSON/source path. |
| `bookings.extra_data.bookingPayment.deposit` | Read by `services/banquetSummary.js`. | Copy to canonical deposit row and preserve original JSON/source path. |
| `bookings.extra_data.payment.deposit` | Read by `services/banquetSummary.js`. | Copy to canonical deposit row and preserve original JSON/source path. |
| `bookings.depositAmount` / `bookings.deposit_amount` if direct columns exist | Supported defensively by `services/banquetSummary.js`; no direct booking deposit columns were found in current migrations/init code. | Report if present through `to_jsonb(bookings)`; copy only as explicit deposit data, preserving source path. |
| `bookings.extra_data.depositAmount`, `deposit_amount`, `banquetDepositAmount`, `banquet_deposit_amount` | Supported by `services/banquetSummary.js` as explicit amount-style deposit markers. | Copy to canonical deposit row with original JSON/source path. |
| `bookings.payment_method` | Added as a generic booking payment method field; can help normalize method labels. | Context only unless paired with explicit deposit data. Do not create a deposit row from this alone. |
| `bookings.payment_status` | Added by finance debt migration `077_finance_improvements.sql`; used by debt views. | Report only unless paired with explicit deposit data. Do not treat as deposit truth. |
| `bookings.paid_amount` | Added by finance debt migration `077_finance_improvements.sql`; used by `/api/finance/debts` and scheduler debt notifications. | Report/warning only. Never copy into deposit by itself. |

## Copy Rules

1. Copy explicit deposit JSON into canonical deposit storage.
2. Preserve original source path in the canonical row, for example `extra_data.banquetDeposit`.
3. Preserve the full original JSON fragment in `source_payload` / equivalent migration metadata.
4. Normalize only derived fields needed by the app: amount, payment method, payment status, note, received date if present.
5. If several explicit deposit markers exist on one booking, use the same priority as `services/banquetSummary.js`:
   - `extra_data.deposit`
   - `extra_data.banquetDeposit`
   - `extra_data.bookingDeposit`
   - `extra_data.bookingPayment.deposit`
   - `extra_data.payment.deposit`
   - direct booking amount fields
   - root `extra_data.depositAmount` style fields
6. Keep all non-selected explicit markers in `source_payload` or a migration warning report. Do not discard them.
7. If explicit deposit JSON exists but has no parseable amount, still preserve it. Either allow a legacy incomplete canonical row or write it to a migration warning table/report before enforcing strict accountant-created records.
8. `paid_amount` alone is not a deposit. It must produce `report_only_paid_amount_or_payment_status`, not a canonical deposit row.
9. `payment_status` alone is not a deposit. It must produce `report_only_paid_amount_or_payment_status`, not a canonical deposit row.
10. `payment_method` alone is not a deposit. It can be carried as context only when an explicit deposit marker exists.

## Data To Keep Separate

- `paid_amount` remains finance/debt progress.
- `payment_status` remains finance/debt status.
- `payment_method` remains generic booking payment context unless the explicit deposit marker uses it.
- No migration should write to `finance_transactions` for MVP deposit backfill.

## Required Migration Behavior

- Additive schema only.
- No destructive updates.
- No deletion or rewrite of `bookings.extra_data`.
- Backfill from explicit deposit markers only.
- Keep raw legacy JSON in the canonical deposit row or in migration metadata.
- Produce a warning/report for rows where `paid_amount > 0` or `payment_status != 'pending'` exists without explicit deposit JSON.

## Verification Before Task 2

Run the inventory SQL on the exact database that will be migrated and save/export the result. Minimum checks:

- Count rows with `copy_explicit_deposit_json`.
- Count rows with `report_only_paid_amount_or_payment_status`.
- Confirm no row with only `paid_amount` is planned for copy.
- Confirm every copied row has a preserved `deposit_json` source payload.
- Confirm banquet group links resolve for grouped banquet bookings.
