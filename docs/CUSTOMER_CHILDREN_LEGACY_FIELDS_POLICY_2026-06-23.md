# Customer Children Legacy Fields Ownership Policy

Production impact: yes.

## Decision

`customer_children` is the canonical source of truth for customer children.

`customers.child_name` and `customers.child_birthday` are compatibility snapshots only. They may keep old APIs, exports, searches, reminders, and single-child placeholders working, but they must not be treated as a separate editable truth once canonical `children[]` exists.

## Ownership Rules

1. New multi-child write paths must write `customer_children`.
2. Legacy snapshot fields may contain only the first explicit child name/birthday needed for compatibility.
3. A legacy-only write must not overwrite or truncate canonical `customer_children`.
4. Birthday must be explicit `YYYY-MM-DD`; never infer birthday from age text, `age_snapshot`, or strings like `Саша 4 роки`.
5. Existing legacy values must remain available as fallback/audit data until the deprecated write path is intentionally retired.

## Allowed Writers

| Writer | Allowed legacy action | Required canonical action |
| --- | --- | --- |
| `routes/customers.js` customer create/update | Write `child_name` / `child_birthday` as first-child compatibility snapshot. | Save all submitted `children[]` through `replaceCustomerChildren` in the same customer transaction. Legacy-only payloads create/sync one canonical compatibility row. |
| `routes/leads.js` lead-to-customer sync | Write `child_name` only as first-child lead snapshot when the customer belongs to that lead or the snapshot is empty. | Save all lead `celebrants` through `replaceCustomerChildren` with `sourceKind = 'lead_celebrant'`. |
| `routes/bookings.js` booking customer create | Write `child_name` / `child_birthday` only when creating a brand-new customer from a booking payload. | Must not update an existing customer's canonical children from one booking legacy payload. Add canonical sync separately before broadening this path. |
| `services/maysternyaBookingWebhook.js` customer create | Write `child_name` / `child_birthday` only when creating a brand-new Maysternya customer from webhook payload. | Must not update an existing customer's canonical children from one webhook legacy payload. |
| `routes/customers.js` duplicate merge | Fill empty legacy snapshot fields from the duplicate customer only. | Move `customer_children` rows from duplicate to primary customer. |
| Read/search/export/scheduler services | Read legacy fields as fallback only. | Prefer canonical `customer_children` when available. |

## Forbidden Patterns

- Updating `customers.child_name` / `customers.child_birthday` without either canonical sync or a documented new-customer-only compatibility reason.
- Replacing canonical `customer_children` with one child because a legacy form submitted `childName`.
- Treating `customers.child_name` as full multi-child truth.
- Splitting ambiguous legacy text automatically unless the source is structured and safe.
- Creating a fake birthday from age.

## Deprecation Path

After production data stabilizes and ambiguous legacy rows are reviewed:

1. Keep returning `childName` / `childBirthday` in API responses for compatibility.
2. Make legacy write paths read-only snapshots generated from `customer_children`.
3. Remove direct user input into `childName` / `childBirthday` from new UI flows.
4. Keep inventory/manual-review artifacts available for audit before any later cleanup proposal.

## Current Guardrail

`services/customerChildren.js` exports `LEGACY_CHILD_FIELD_POLICY` and `buildLegacyChildSnapshot()`. Routes that need a compatibility snapshot should use the helper instead of hand-selecting the first child inline.
