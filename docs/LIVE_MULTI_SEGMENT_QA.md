# Live Multi-Segment QA

`npm run qa:live:multi-segment -- https://<crm-host>` is the controlled end-to-end acceptance runner for the normalized HR day plan.

The runner verifies the active `simultaneous-profession-pay-v1` contract with
`effectiveFrom = 2026-07-18`.

## Safety contract

- The runner requires `LIVE_MULTI_SEGMENT_QA_CONFIRM=I_CONFIRM_LIVE_MULTI_SEGMENT_QA`.
- `LIVE_MULTI_SEGMENT_QA_RUN_ID` is mandatory, unique, and limited to 8-64 letters, digits, `_`, or `-`.
- Credentials must be supplied through `LIVE_MULTI_SEGMENT_QA_USER` plus `LIVE_MULTI_SEGMENT_QA_PASS`. Bearer-token mode is intentionally refused so the runner cannot bypass creator/director authorization with a generic key.
- The authenticated operator must have the `creator` or `director` role.
- Fixture mutations are refused unless the staff name contains both the exact run ID and one of `QA`, `Test`, `Smoke`, or `Disposable`.
- The default fixture Monday is the first Monday at least 120 days ahead. An explicit `LIVE_MULTI_SEGMENT_QA_SOURCE_MONDAY` must be a Monday 30-400 days in the future.
- The runner never calls booking mutation, finance mutation, payroll generation, payroll approval, or payment endpoints.
- Payroll is read only through `/api/payroll/preview`. Cleanup proof must include `financialProofVersion`, zero protected payroll/payment/finance counters, and zero active disposable payroll configuration.

Do not paste credentials or tokens into shell history, CI logs, release notes, screenshots, or chat. Load the EventGenix QA credentials from the approved local secret source before running the command.

## Required environment

```powershell
$env:LIVE_MULTI_SEGMENT_QA_CONFIRM = 'I_CONFIRM_LIVE_MULTI_SEGMENT_QA'
$env:LIVE_MULTI_SEGMENT_QA_RUN_ID = 'qa_release_20260714_01'
$env:LIVE_MULTI_SEGMENT_QA_USER = '<loaded-locally>'
$env:LIVE_MULTI_SEGMENT_QA_PASS = '<loaded-locally>'
npm run qa:live:multi-segment -- https://<crm-host>
```

Use a different run ID for every attempt. `LIVE_MULTI_SEGMENT_QA_TOKEN` is intentionally rejected; the runner must prove creator/director authorization through the normal login flow.

## Assertions

The business case starts as overlapping role windows: `11:00-20:00 wardrobe` plus
`11:30-20:00 cleaner`. The valid saved day plan represents that simultaneous work as adjacent
physical segments with the second profession attached as a paid role.

Single-scheme mode creates one disposable staff member with an explicit active payroll scheme selected by `LIVE_MULTI_SEGMENT_QA_SCHEME` (`hourly`, `per_shift`, `monthly_fixed`, `hybrid`, `percent`, or `manual`) and qualified for `wardrobe` (Гардеробник) and `cleaner` (Господарочка залу), explicitly marks both QA-only role assignments as active and approved, then verifies:

- `11:00-11:30 wardrobe`;
- `11:30-20:00 wardrobe` plus the explicitly paid simultaneous `cleaner` role;
- 540 non-overlapping physical minutes;
- one distinct headcount row;
- stable segment IDs after save/reload;
- one attendance row with 540 physical wardrobe minutes;
- an immutable compensation snapshot with 510 paid cleaner minutes;
- hourly payroll preview with 9 wardrobe hours and 8.5 cleaner role-hours;
- 9 physical hours rather than 17.5 physical hours;
- supported schemes (`hourly`, `per_shift`, `monthly_fixed`) show separate role amounts calculated from the explicit primary scheme and additional profession snapshot rate;
- unsupported schemes (`hybrid`, `percent`, `manual`) show `PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED` with 510 unresolved additional minutes and no successful additional-pay line;
- Reports-compatible planned hours equal 9 physical Staff Schedule hours.

## Cleanup

Cleanup runs from `finally` through a creator/director-only HR helper and is transactional:

- attendance/check-in fixtures are removed;
- HR shifts and Staff Schedule mirrors are removed;
- generated timeline lines are reconciled;
- active disposable payroll configuration is deactivated;
- the disposable staff member is soft-archived;
- a separate read-only status request confirms zero fixture rows, zero protected payroll/payment/finance counters, zero active disposable payroll configuration, and an inactive staff card.

The console cleanup report contains only the run ID, aggregate operational counts, aggregate financial/configuration counts, archive state, and a redacted error marker. It never contains credentials, bearer tokens, staff names, staff IDs, fixture IDs, rates, amounts, finance IDs, or SQL parameters.

If cleanup cannot be confirmed, the command exits with an error and prints aggregate counters only. Treat this as a release blocker and clean up through the same QA helper after restoring API access. If a protected financial counter is non-zero, the helper returns `LIVE_QA_FINANCIAL_SIDE_EFFECTS_DETECTED` before deleting anything; investigate it as a reconciliation incident. Never delete bookings or finance records as part of this cleanup.

## Payroll scheme matrix mode

For final release proof, run matrix mode after deploy:

```powershell
$env:LIVE_MULTI_SEGMENT_QA_CONFIRM = 'I_CONFIRM_LIVE_MULTI_SEGMENT_QA'
$env:LIVE_MULTI_SEGMENT_QA_RUN_ID = 'qa_release_YYYYMMDD_01'
$env:LIVE_MULTI_SEGMENT_QA_USER = '<loaded-locally>'
$env:LIVE_MULTI_SEGMENT_QA_PASS = '<loaded-locally>'
npm run qa:live:multi-segment -- --matrix https://<crm-host>
```

Matrix mode runs six isolated child scenarios in this order: `hourly`, `per_shift`, `monthly_fixed`, `hybrid`, `percent`, `manual`. Each scenario receives a unique derived run ID, a separate future Monday, a separate disposable staff member, and its own `finally` cleanup. If any cleanup is not confirmed, matrix mode stops before starting the next scenario.

## Release usage

Run only after the release candidate containing the QA helper is deployed. Use a unique run ID and the deployed CRM URL. Record the command result and cleanup confirmation in the release notes; do not record credentials. This runner is not part of normal CI because it intentionally creates disposable live data.
