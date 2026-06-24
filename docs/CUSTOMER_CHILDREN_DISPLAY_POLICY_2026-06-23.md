# Customer Children Display And Placeholder Policy

Production impact: yes.

## Decision

`customer_children` remains the storage truth. Any `childName` / `childBirthday` field exposed to old APIs is a compatibility projection, not storage truth.

## Surface Rules

| Surface | Product rule | Reason |
| --- | --- | --- |
| `customers.child_name` / API `childName` | First child snapshot only. | Backward compatibility for old single-child consumers. |
| `customers.child_birthday` / API `childBirthday` | First explicit birthday snapshot only. | Backward compatibility; birthday is never inferred from age. |
| Customer card | Full children list. | Manager must see that all children are present. |
| Booking customer block / drawer | Compact joined child names. | Small UI surface, but must not imply only one child exists. |
| Banquet summary HTML/text/PDF | Full children list; `celebrant` remains first-child compatibility. | Printable banquet sheet must show all children while preserving old contract. |
| Bulk message `{childName}` | Compact joined child names. | Old placeholder name stays usable, but multiple children are visible. |
| Bulk message `{childBirthday}` | Compact joined explicit birthdays. | Lets birthday campaigns reference dates without inventing missing values. |
| Birthday reminders/greetings | One row per child birthday. | Reminders are birthday-specific, not customer-specific. |
| CSV/XLSX export | Compact joined child names and birthdays, labels in plural. | Export should not suggest data was truncated. |
| vCard `NOTE` | Compact joined names and birthdays. | vCard notes can hold multiple children. |
| vCard `BDAY` | First explicit birthday only. | vCard has one birthday field; full list remains in `NOTE`. |

## Forbidden Patterns

- Do not use first child as storage truth.
- Do not overwrite canonical `customer_children` from a single placeholder value.
- Do not generate a fake birthday from age.
- Do not label a compact list as singular `Ім'я дитини` / `ДН дитини`.

## Current Implementation Hooks

- `services/customerChildren.js` exports `CUSTOMER_CHILD_DISPLAY_POLICY`.
- Customer exports and bulk messages use `childNameDisplay` / `childBirthdayDisplay`.
- Birthday reminders query canonical `customer_children` first and fall back to legacy fields only when canonical birthday rows do not exist.
- Banquet summary exposes `customer.children`, `customer.childrenDisplay`, `celebrants`, and old `celebrant` for compatibility.
