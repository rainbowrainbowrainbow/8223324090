# Live Multi-Segment QA

`npm run qa:live:multi-segment -- https://<crm-host>` is the controlled end-to-end acceptance runner for the normalized HR day plan.

## Safety contract

- The runner requires `LIVE_MULTI_SEGMENT_QA_CONFIRM=I_CONFIRM_LIVE_MULTI_SEGMENT_QA`.
- `LIVE_MULTI_SEGMENT_QA_RUN_ID` is mandatory, unique, and limited to 8-64 letters, digits, `_`, or `-`.
- Credentials must be supplied through `LIVE_MULTI_SEGMENT_QA_TOKEN` or `LIVE_MULTI_SEGMENT_QA_USER` plus `LIVE_MULTI_SEGMENT_QA_PASS`.
- The authenticated operator must have the `creator` or `director` role.
- Fixture mutations are refused unless the staff name contains both the exact run ID and one of `QA`, `Test`, `Smoke`, or `Disposable`.
- The default fixture Monday is the first Monday at least 120 days ahead. An explicit `LIVE_MULTI_SEGMENT_QA_SOURCE_MONDAY` must be a Monday 30-400 days in the future.
- The runner never calls booking mutation, finance mutation, payroll generation, payroll approval, or payment endpoints.
- Payroll is read only through `/api/payroll/preview`.

Do not paste credentials or tokens into shell history, CI logs, release notes, screenshots, or chat. Load the EventGenix QA credentials from the approved local secret source before running the command.

## Required environment

```powershell
$env:LIVE_MULTI_SEGMENT_QA_CONFIRM = 'I_CONFIRM_LIVE_MULTI_SEGMENT_QA'
$env:LIVE_MULTI_SEGMENT_QA_RUN_ID = 'qa_release_20260714_01'
$env:LIVE_MULTI_SEGMENT_QA_USER = '<loaded-locally>'
$env:LIVE_MULTI_SEGMENT_QA_PASS = '<loaded-locally>'
npm run qa:live:multi-segment -- https://<crm-host>
```

Use a different run ID for every attempt. A bearer token may replace the username/password pair through `LIVE_MULTI_SEGMENT_QA_TOKEN`.

## Assertions

The runner creates one disposable staff member qualified for `reception`, `manager`, and `animator`, then verifies:

- `09:00-13:00 reception` plus `15:00-20:00 manager`;
- a 30-minute break on the manager segment, producing 510 planned minutes;
- one distinct headcount row;
- stable segment IDs after refresh and canonical update;
- `409 HR_SHIFT_PLAN_STALE` for the stale writer;
- exact copy-week dates and new copied segment IDs;
- animator availability only in the two real windows, not in the `13:00-15:00` gap;
- one attendance row with 240 reception minutes and 270 manager minutes;
- hourly payroll preview with two profession breakdown rows and no additional-role double pay;
- day-rate preview applied once;
- Reports-compatible planned hours equal Staff Schedule planned minutes.

## Cleanup

Cleanup runs from `finally` through a creator/director-only HR helper and is transactional:

- attendance/check-in fixtures are removed;
- HR shifts and Staff Schedule mirrors are removed;
- generated timeline lines are reconciled;
- the disposable staff member is soft-archived;
- a separate read-only status request confirms zero fixture rows and an inactive staff card.

The cleanup report contains only the run ID, numeric fixture IDs, counts, archive state, and errors. It never contains credentials, bearer tokens, staff names, or SQL parameters.

If cleanup cannot be confirmed, the command exits with an error and prints the known fixture IDs. Treat this as a release blocker and clean up through the same QA helper after restoring API access. Never delete bookings or finance records as part of this cleanup.

## Release usage

Run only after the release candidate containing the QA helper is deployed. Use a unique run ID and the deployed CRM URL. Record the command result and cleanup confirmation in the release notes; do not record credentials. This runner is not part of normal CI because it intentionally creates disposable live data.
