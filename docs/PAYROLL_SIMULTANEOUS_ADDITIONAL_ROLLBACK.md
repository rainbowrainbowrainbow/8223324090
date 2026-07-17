# Simultaneous Additional Pay Rollback

This runbook disables new simultaneous paid-role writes without deleting the
additive schema or rewriting financial history.

## Rollback invariants

- Do not drop `hr_shift_segment_roles` compensation columns.
- Do not delete `hr_time_records.compensation_snapshot`.
- Do not recalculate approved or paid payroll reports.
- Do not delete or rewrite finance transactions or reversals.
- Existing `paid_hourly` role metadata remains readable and auditable.
- Legacy `unpaid` roles remain unpaid.

## 1. Disable new paid-role writes

The server accepts a new paid role only when its versioned compensation policy
is active for the target date. Retire the active policy in one transaction:

```sql
BEGIN;

UPDATE hr_compensation_policies
SET status = 'retired',
    updated_at = NOW()
WHERE policy_version = 'simultaneous-profession-pay-v1'
  AND status = 'active';

SELECT policy_version, compensation_mode, pay_multiplier, effective_from, status
FROM hr_compensation_policies
WHERE policy_version = 'simultaneous-profession-pay-v1';

COMMIT;
```

Expected result: the policy is `retired`. Staff and HR schedule writers then
fail closed for new `paid_hourly` writes with the existing stable policy error.
Unpaid and single-profession schedule writes continue to work.

If UI-only containment is required while a server rollback is being prepared,
deploy the previous UI version after retiring the policy. The database policy,
not hidden client state, remains the authoritative write guard.

## 2. Payroll behavior after rollback

- Keep approved and paid reports immutable.
- Keep saved draft reports readable with their stored breakdown.
- Regenerate only explicitly selected new draft reports after the policy has
  been retired.
- Base pay continues through the existing hourly, per-shift, or monthly scheme.
- New attendance without an active paid-role assignment remains base-only.
- Never rewrite a closed attendance compensation snapshot to remove an amount
  that was valid when captured.

If product policy requires base-only handling for a not-yet-approved draft,
void or regenerate that draft through the existing payroll workflow. Do not
update `breakdown_json` directly.

## 3. Verification

1. Confirm the policy row is `retired`.
2. Confirm a new paid-role save is rejected and an unpaid save still succeeds.
3. Confirm historical schedule reads still show saved paid-role metadata.
4. Confirm closed attendance snapshots are unchanged.
5. Confirm approved/paid payroll totals and finance transactions are unchanged.
6. Generate only a safe test draft and confirm no new additional line appears
   without a valid paid-role snapshot.

## 4. Code rollback

Revert the product release commit and deploy the resulting version from the
confirmed Railway source branch. Keep migrations 297-299 recorded and keep
their additive schema. After deploy:

```powershell
npm run version:smoke -- https://<live-crm-host>
npm run smoke:live -- https://<live-crm-host>
```

Do not run production payroll approve, pay, commit, or reversal actions as part
of rollback verification.
