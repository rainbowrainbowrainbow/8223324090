# Payroll installments activation evidence — 2026-08

This document is the repository audit trail for the payroll installments
activation that starts with payroll month `2026-08`.

It records the release evidence and rollback limits that must not remain only in
chat history. It does not contain production connection strings, staff IDs,
usernames, credentials, or other PII.

## Release identity

| Field | Value |
| --- | --- |
| Activation month | `2026-08` |
| Released version | `0.80.12` |
| Deployed commit | `870ac899ac00f8744874c23c29a338b490177a99` |
| Production branch | `codex/zrs-financial-integrity` |
| CI run | `30342496431` |
| Railway deployment | `1aac7c18-9dbe-4df4-b88d-4f14ebb09ab7` |
| Post-release audit decision | `stable` |

## Applied payroll migrations

The release evidence says migrations `302` through `306` were applied:

- `302_payroll_installments_foundation.sql`
- `303_payroll_zrs_canonical_type.sql`
- `304_payroll_finance_movements_workflow.sql`
- `305_payroll_kpi_bonus_adjustments.sql`
- `306_payroll_piece_scheme.sql`

## Production preflight evidence

The following aggregate facts were recorded before/around activation. Do not
backfill or rewrite these historical rows.

| Counter | Value | Classification / meaning |
| --- | ---: | --- |
| Legacy paid payroll reports | `0` | No historical `payroll_reports.status='paid'` rows needed classification as `legacy_accounted` in this evidence set. |
| Manual legacy salary Finance rows | `2` | `legacy_manual_salary_finance`: historical manual Finance rows, not canonical payroll movements and not verified payroll payment facts. |
| Legacy `advance` adjustments | `4` | Historical compatibility rows for ZRS naming transition. |
| Voided explicit ZRS records | `4` | `legacy_zrs_voided`: historical ZRS records already voided with explicit ZRS reason. |
| Unclassified legacy advance records | `0` | No remaining legacy `advance` rows without explicit ZRS classification in this evidence set. |
| Production data fix/backfill | `0` | No production data fix, destructive backfill, or legacy paid backfill was performed. |

Historical `paid` payroll reports, if encountered later, must remain
`legacy_accounted` only:

> Історично враховано; факт виплати користувачем не підтверджено

Do not infer actual payment date, actor, confirmer, or canonical payment
movement from legacy monthly status or manual Finance rows.

## Shadow comparison waiver

The shadow comparison returned no rows because `payroll_reports` history was
empty for the checked history set. The user explicitly allowed the 2026-08
release without shadow history.

This is a one-release waiver for activation `2026-08` only. It is not a global
bypass flag and must not weaken the fail-closed shadow comparison logic in code.
Future activations or payroll rewrites still require shadow comparison evidence
or a new explicit waiver.

## Post-release monitoring evidence

The recorded post-release audit decision for this release was `stable`.

The detailed JSON counter payload is not stored in this repository document.
Based on the recorded `stable` decision, no critical hold condition was reported
for:

- duplicate payment movements;
- duplicate Finance links;
- payroll movements without Finance;
- Finance payroll transactions without movement;
- payment/reversal amount mismatch;
- reversal without original payment;
- unresolved overpayment;
- mixed settlement models in activation month;
- P&L recognition month mismatch;
- cash-flow actual date mismatch.

If any future audit reports one of these conditions, treat it as a release hold
until explained or corrected through the canonical payroll workflow.

## Rollback matrix

| State | Allowed action | Forbidden action |
| --- | --- | --- |
| Before the first payroll payment movement exists for the activation month | Disable `PAYROLL_INSTALLMENTS_ACTIVATION_MONTH` and return to read-only historical behavior for the not-yet-used month. | Delete schema, delete generated history, or manually rewrite payroll rows. |
| After draft/approved installments exist but before payment movements | Hold payroll operations, investigate through read-only audits, and decide whether disabling activation is still safe for the affected month. | Direct `DELETE`, manual DB updates, or destructive backfill. |
| After the first payment movement exists | Use canonical reversal/correction rules only. Keep installment and movement history append-only. | Disable activation as if no history exists, delete movements, delete Finance links, or manually mutate payment facts. |
| Any historical manual Finance or legacy ZRS row | Display with derived classification only. Keep it separate from canonical payroll movement history. | Convert to payroll movement without evidence, invent payment facts, or backfill actor/date/confirmer. |

## Read-only verification commands

Use dedicated read-only production URLs only. Never use `DATABASE_URL` as a
fallback for production payroll audits.

```bash
npm run audit:payroll-activation-preflight -- --format json
npm run audit:payroll-activation-preflight -- --month 2026-08 --format json
node scripts/shadow-payroll-installment-comparison.js --activation-month 2026-08 --closed-months 3 --aggregate-only --format json
npm run audit:payroll-post-release -- --activation-month 2026-08 --format json
npm run version:smoke -- https://<crm-host>
```

Safety expectations:

- audit scripts must use `BEGIN READ ONLY`;
- write-like flags such as `--apply`, `--fix`, `--write`, `--backfill`,
  `--execute`, `--update`, and `--delete` must remain blocked;
- output must be aggregate-only and must not include PII or secrets.

