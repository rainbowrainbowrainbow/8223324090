# Customer Children Data Safety Inventory

Date: 2026-06-23

Production impact: yes. This is an analysis/reporting artifact only. It does not change schema or data.

## Goal

Before adding canonical `customer_children`, preserve every existing child-like signal and identify incomplete or truncated records:

- customers that have only legacy `child_name` / `child_birthday`;
- linked leads that already have multiple `celebrants`;
- legacy lead customer-card rows that only captured `children_count`;
- bookings that link to a customer and may contain child-like data in `extra_data`;
- suspicious text such as `Саша 4 роки`, comma-separated names, missing birthday, or birthday without name.

## Source Map

| Source | Current shape | Meaning | Data-safety note |
| --- | --- | --- | --- |
| `customers.child_name` | `VARCHAR(200)` | Current single child display/storage field. | Can contain a real name, a name + age text, or possibly multiple names. Do not overwrite or delete during migration. |
| `customers.child_birthday` | `DATE` | Current single child birthday. | Valid birthday source only when explicitly present. Never infer from age. |
| `leads.celebrants` | `JSONB[]` | Explicit list captured by lead forms/Omni. Items can contain `name`, `age`, `birthday`, `notes`, `source`. | Best existing multi-child source. Copy each item to canonical children when linked to a customer. Preserve original JSON. |
| `leads.children_count` | `INTEGER` | Count of children for an event/lead. | Count only. Do not create child rows from count alone. |
| `leads.child_age` | `INTEGER` | Legacy single age field. | Age only. Can become `age_snapshot` only when tied to a child row; never becomes birthday. |
| `leads.raw_payload` | `JSONB` | Imported/Omni/external payload. | Treat as evidence. Report child-like keys, but do not auto-copy unknown shapes without an explicit parser. |
| `customer_cards.children_count` | `INTEGER` | Legacy lead customer card count. | Count only. Use for review/warnings, not child rows. |
| `bookings.kids_count` | `INTEGER` | Booking guest/count operational field. | Count only. Not a list of children. |
| `bookings.extra_data` | `JSONB` | Booking-specific payloads. | Report child-like JSON only. Copy only explicit child arrays/objects after manual rule approval. |
| Booking customer payload | request body `customer.childName`, `customer.childBirthday` | Booking routes can create a customer with single child fields. | This is a write path into `customers.child_name/child_birthday`, not a separate booking child store. |

No direct `bookings.child_name` / `bookings.child_birthday` schema was found in current migrations/startup. The service layer may read those names from in-memory objects for compatibility, but PostgreSQL storage currently routes child identity through customers or generic booking JSON.

## Known Truncation Points

- `routes/leads.js` has `leadCustomerChildName()`, which normalizes `leads.celebrants` and returns only the first non-empty child name.
- Lead-to-customer creation/update stores only `customers.child_name`; it does not preserve all lead celebrants in customer storage.
- `POST /api/leads/:id/card` and deal-stage customer creation use the same first-child snapshot path.
- `routes/customers.js` normalizes only `childName` / `childBirthday` and maps only `childName` / `childBirthday` back to the UI.
- Booking routes create customers with only `customer.childName` / `customer.childBirthday`.
- Lead UI text input parses children line-by-line. If a manager enters three children on one line, the parser treats that line as one child-like record.

## Read-only Report

Run:

```bash
psql "$DATABASE_URL" -f docs/CUSTOMER_CHILDREN_INVENTORY_READONLY_2026-06-23.sql
```

The report is wrapped in `START TRANSACTION READ ONLY` and ends with `ROLLBACK`.

Main output fields:

- `customer_id`
- `business_context`
- `customer_name`
- `phone`
- `instagram`
- `legacy_customer_lead_id`
- `child_name`
- `child_birthday`
- `lead_ids`
- `booking_ids`
- `max_lead_celebrants_count`
- `max_customer_card_children_count`
- `max_booking_kids_count`
- `suspected_multi_child_text`
- `suspected_age_in_name`
- `birthday_missing`
- `birthday_without_name`
- `linked_lead_multiple_celebrants_but_customer_single_field`
- `legacy_card_count_gt_one_but_customer_single_field`
- `any_lead_raw_payload_has_child_refs`
- `any_booking_extra_data_has_child_refs`
- `issue_codes`
- `lead_context_json`
- `customer_cards_json`
- `booking_context_json`

## Suspicious Cases The Report Flags

- `linked_lead_multiple_celebrants_but_customer_single_field`: linked lead has multiple `celebrants`, but customer has only one legacy `child_name`.
- `suspected_multi_child_text`: `child_name` contains delimiters/new lines that may indicate several children.
- `suspected_age_in_name`: `child_name` contains an age-like token such as `4 роки`.
- `birthday_missing`: `child_name` exists but `child_birthday` is empty.
- `birthday_without_name`: `child_birthday` exists but `child_name` is empty.
- `legacy_card_count_gt_one_but_customer_single_field`: old customer card says more than one child, but customer can only store one name.
- `lead_raw_payload_has_child_refs`: external payload has child-like keys and needs review.
- `booking_extra_data_has_child_refs`: booking JSON has child-like keys and needs review.

## Copy Rules For Future Backfill

1. `leads.celebrants[]` linked to a customer is the strongest existing multi-child source.
   - Create one canonical child row per celebrant.
   - Copy explicit `name`, `birthday`, `age` as `age_snapshot`, `notes`, and `source`.
   - Preserve the original celebrant object in `source_payload`.

2. `customers.child_name` / `customers.child_birthday` becomes one legacy canonical child row when no equivalent lead celebrant already covers it.
   - Preserve both original fields in `source_payload`.
   - `child_birthday` is copied only if explicitly present.

3. Text such as `Саша 4 роки` is not a birthday.
   - If the age pattern is clear, store `age_snapshot = 4`.
   - Store the safest parsed name only if unambiguous; otherwise keep original text as the display/name and mark `needs_review`.
   - Always keep `birthday = null` unless an explicit date exists.

4. Ambiguous multi-text in `child_name` is review-first.
   - Do not split automatically unless a later task defines safe delimiters and review rules.
   - Preserve original `child_name` in `source_payload`.

5. `leads.children_count`, `customer_cards.children_count`, and `bookings.kids_count` are counts only.
   - Do not create named child rows from count alone.
   - Use these values for warnings, review queues, and completeness checks.

6. `leads.child_age` is an age snapshot only.
   - It can be copied to `age_snapshot` only when there is a matching child row.
   - It must not generate a fake birthday.

7. `bookings.extra_data` and `leads.raw_payload` are evidence, not automatic truth.
   - Copy only explicit child arrays/objects after a parser is intentionally implemented.
   - Preserve original JSON for audit.

8. Existing legacy fields remain in place through the migration.
   - No destructive updates to `customers.child_name`, `customers.child_birthday`, `leads.celebrants`, `customer_cards`, `bookings.kids_count`, or JSON payloads.

## Next Implementation Implication

The future `customer_children` table should allow safe backfill from incomplete historical data:

- `name` should tolerate null or a review marker for birthday-only records, or the migration must route those rows to a review report instead of forcing a fake name.
- `birthday` must be nullable.
- `age_snapshot` should be nullable.
- `source_kind`, `source_payload`, and `meta.needs_review` are required for auditability.
