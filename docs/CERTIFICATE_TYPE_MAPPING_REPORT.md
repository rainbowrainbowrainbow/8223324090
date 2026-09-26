# Certificate type mapping report

## Read-only inventory

An aggregate-only audit ran on 2026-09-26 at 08:29 UTC through
`PRODUCTION_READONLY_DATABASE_URL`. The transaction was explicitly read-only.
No certificate codes, recipient values, or raw custom type labels were selected
or printed.
`priorVersionRollback` is `null` before the new column exists.

| Existing label category | Count | Migration code |
| --- | ---: | --- |
| Exact normalized `на одноразовий вхід` | 484 | `one_time_admission` |
| Exact normalized `абонемент` | 3 | `subscription` |
| Other labels containing `абонемент` | 0 | `verification_only` |
| Empty labels | 0 | `verification_only` |
| Other unmapped labels | 431 | `verification_only` |
| **Total** | **918** | |

The first category matches the previous redemption rule: trim and Ukrainian
case normalization followed by exact equality. The subscription category is
the exact existing form preset and has no redemption action. No other legacy
label is inferred to be one-time admission or subscription.

## Migration and compatibility

Migration `370_certificate_stable_type_code.sql` adds `certificates.type_code`
with three allowed values. It changes no label, status, expiry, used timestamp,
or history row. New single and batch issuance writes a code. Old clients that
omit the new field get the safe database default `verification_only`; the
current single-issue API recognizes only the two exact legacy preset labels.
Editing `type_text` does not edit `type_code`. Redemption checks the code only.
Subscriptions and unknown legacy types remain verification-only; this release
does not deduct subscription visits.

Before applying the migration to production, rerun
`node scripts/audit-certificate-types.js` and compare aggregate counts. A new
unmapped category requires review, not automatic reassignment.

## Rollback plan

1. Keep the additive `type_code` column and its data. The previous application
   version ignores the extra column and can read existing records.
2. Before reverting to the previous application binary, run the read-only
   audit again. `priorVersionRollback.unsafeGrants` counts rows with a
   non-one-time code but the old canonical one-time display label. **Do not
   run the old binary when this count is nonzero**: its text-based rule would
   grant redemption. Use a type-code-aware repair release instead.
3. `priorVersionRollback.safeDenials` counts one-time rows whose labels have
   changed. The old binary would reject their redemption. This is a safe
   denial, but operators must expect it if the old binary is used. Do not
   rewrite original labels to force a rollback.
4. During an old-binary rollback, old issue clients can create canonical
   one-time labels that the old binary redeems while the new database column
   defaults to `verification_only`. Audit and explicitly review these rows
   before returning to the type-code-aware application.
5. Drop the column only in a separate approved cleanup after all application
   versions stop reading it and the mapping has been archived.

The isolated PostgreSQL 16 check applied the migration twice to legacy
fixtures, verified labels/statuses/expiry stayed intact, changed display
labels, reapplied the migration, and confirmed the codes were unchanged. It
also verified the conservative column default for an old-client insert. The
PostgreSQL integration test covers both eligibility directions after label
edits and verifies that the rollback counts detect both outcomes.

## Production release evidence (2026-09-26)

Release `0.82.16` at `ab9b3f46d1ff4bd5fa47aec2b7c3c56d7757d641`
applied migration 370. A post-release aggregate-only read-only audit at
08:52 UTC found the same 918 records and category counts listed above.
`priorVersionRollback.unsafeGrants` and `.safeDenials` were both zero.
No certificate QA records were created during this release check.
