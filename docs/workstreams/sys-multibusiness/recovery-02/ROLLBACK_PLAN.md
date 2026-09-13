# SYS-MB RECOVER-02 rollback plan

## Before applying MD/CRM mapping

- Preserve current live SHA from `/api/version`.
- Preserve private preflight snapshot and DB fingerprint.
- Preserve approved mapping hashes and source snapshot hash.
- Confirm journal rows for target contexts are either absent/prepared for the exact source or already applied for the same source.

## Code/schema rollback

Migrations 364 and 365 are additive. Normal rollback is forward rollback:

1. Deploy a follow-up release that stops reading the new columns or apply endpoint path.
2. Leave evidence columns/tables in place.
3. Do not drop deprecated columns/tables without a separate cleanup authorization.

## Mapping rollback

A generic flip back to compatibility is not safe because it can restore legacy/global-role authority. Use a forward rollback package that:

1. Locks the target organization and business rows.
2. Verifies the original receipt hash and approved rollback reference.
3. Deactivates or adjusts only target MD/CRM memberships created by the receipt.
4. Leaves Park/Dar/defaults unchanged.
5. Writes a new receipt and before/after access matrix.
6. Re-runs same-JWT revoke and foreign-business denial tests.

## Production stop conditions

Stop the release/apply if any of these occur:

- Candidate is not descendant of the current live production SHA.
- Protected workflow manifest includes any Red path outside SYS-MB allowlist.
- Migration set differs from the signed manifest.
- Refreshed DB fingerprint differs from the approved preflight and no reviewed mapping update exists.
- Public catalog token verification fails for a preserved token.
- Park/Dar access matrix changes outside target MD/CRM cutover.
- Telemetry shows allowed legacy/unknown/missing-context authority during exit gate.
