# Simultaneous Additional Profession Reporting

This document defines the reporting, export, traceability, and downstream-consumer contract for an
employee who performs one base profession and one explicitly paid additional profession at the same time.

## Canonical reporting model

Payroll responses and stored report breakdowns keep these facts separate:

| Field | Meaning |
| --- | --- |
| `physicalHours` / `physical_hours` | Actual presence counted once |
| `baseRoleHours` / `base_role_hours` | Compensated hours of the base profession |
| `additionalRoleHours` / `additional_role_hours` | Compensated hours of simultaneous paid roles |
| `additionalProfession` / `additional_profession` | Additional profession key when a scalar representation is unambiguous |
| `additionalRate` / `additional_rate` | Explicit profession hourly rate |
| `additionalMultiplier` / `additional_multiplier` | Versioned pay multiplier |
| `additionalAmount` / `additional_amount` | Total simultaneous-additional payroll amount |
| `additionalRoles` / `additional_roles` | Traceable per-allocation detail lines |

The UI must display:

> Оплачувані години професій можуть перевищувати фізичні години через одночасну роботу.

For a base interval `11:00–20:00` and an additional interval `11:30–20:00`, the report shows:

- 9 physical hours;
- 9 base-role hours;
- 8.5 additional-role hours;
- base pay according to the employee's current base scheme;
- additional pay as `8.5 × explicit profession rate × multiplier`.

Hourly, per-shift, and monthly base schemes remain unchanged. The additional amount is always a separate
hourly line and never falls back to a general staff hourly rate.

## Detailed additional line

Each `simultaneous_additional` line includes:

- profession key;
- minutes and hours;
- explicit rate and rate source;
- multiplier and amount;
- work date;
- attendance reference;
- segment and role references;
- policy version;
- human-readable calculation formula.

These references form the traceability chain:

`payroll additional line -> compensation snapshot -> attendance -> planned segment/paid role`.

Draft regeneration is idempotent. Approved or paid reports retain their saved breakdown and are not
recalculated after schedule or rate changes.

## CSV and Excel compatibility

Legacy CSV columns keep their original names and order. The following stable fields are appended:

- `physical_hours`;
- `base_role_hours`;
- `additional_role_hours`;
- `additional_profession`;
- `additional_rate`;
- `additional_multiplier`;
- `additional_amount`;
- `payroll_blocking_codes`;
- `payroll_blocking_details`;
- `additional_line_status`;
- `blocker_code`;
- `blocker_message`.

The Excel export contains a compatibility summary sheet and a separate `Additional lines` sheet with the
full traceability fields. A blocked role is exported even when no calculated additional line exists:
`additional_amount` remains `0` for compatibility, while `additional_line_status=blocked` and the blocker
code/message make the unresolved amount explicit. New export consumers should prefer these explicit fields
and must not derive physical hours by summing profession hours.

## Audit events

The audit stream uses explicit action names:

| Action | Trigger |
| --- | --- |
| `paid_role_assigned` | A schedule role becomes explicitly paid |
| `paid_role_removed` | An explicitly paid schedule role is removed |
| `compensation_snapshot_created` | Attendance receives its compensation snapshot |
| `compensation_snapshot_corrected` | A manual attendance correction changes the snapshot |
| `payroll_additional_line_generated` | Payroll generates a simultaneous additional line |
| `payroll_generation_blocked` | Payroll generation is rejected because a compensation issue remains |

Audit payloads include stable record references and policy metadata. Rate, multiplier, formula, and amount
fields are redacted from HR history responses when the current user does not have the existing payroll
access. HR salary and salary-reconciliation routes use an exact payroll-control role check; legacy role
expansion must not grant these responses to manager, HR, or security roles.

## Downstream schedule consumers

Schedule segment payloads expose:

- `countsAsPhysicalTime = true`;
- `physicalTimeSource = segment`.

Additional-role payloads expose:

- `countsAsPhysicalTime = false`.

Dashboard, Center, current-user payloads, Kleshnya chat, reports, and other schedule consumers may use
additional profession keys for display or grouping. They must not treat the role interval as another shift,
attendance interval, worked day, or physical-hour contribution.

## Warning and legacy behavior

- Missing or invalid compensation snapshot data blocks payroll commit and requires manual review.
- Paid additional minutes that round to a non-positive amount block generation with
  `PAYROLL_SIMULTANEOUS_ADDITIONAL_AMOUNT_NON_POSITIVE`; they are never presented as a valid zero payment.
- Legacy `additionalProfessionKeys` and existing additional-role rows remain unpaid.
- Old attendance records without a compensation snapshot use base-only behavior.
- Existing report and export columns remain available during the compatibility period.
- Stored freelance drafts stay outside active-staff salary rows. Reconciliation reports their count with
  `PAYROLL_FREELANCE_DRAFTS_EXCLUDED_FROM_ACTIVE_STAFF`; no historical draft is deleted or regenerated.
- `CHANGELOG.md` is updated only as part of the actual release.

## Read-only stored-draft audit

Operators can classify stored drafts without exposing names, rates, or amounts:

```powershell
$env:PAYROLL_FREELANCE_DRAFT_AUDIT_CONFIRM='READ_ONLY_PAYROLL_FREELANCE_DRAFT_AUDIT'
node scripts/audit-payroll-freelance-drafts.js 2026-05
```

The helper starts a `REPEATABLE READ READ ONLY` transaction, returns aggregate counts only, and rolls back.
