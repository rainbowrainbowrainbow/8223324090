# Staff substitution bounded release review

The owner explicitly requested commit, push and deploy of the current implementation
on 2026-11-13, after the partial feature boundaries were disclosed. This supersedes
the earlier local-only delivery boundary, but does not authorize new CRM grants,
protected booking changes, real-data fixes, payouts, production fixtures or settings.

## Candidate and production identity

- Functional commit: `11cd1aef`.
- Integration merge: `f5688b65`, preserving the parallel Team Pulse release.
- Source branch: `codex/staff-substitution-release-20261113`.
- Destination: `codex/eventgenix-production`.
- Verified previous live/remote SHA: `481bf7135696e2caabf9f3edc222c4432e48329f`.
- Verified live version: `0.83.46`, Team Pulse and attendance.
- Target: next free patch `0.83.47`, subject to fresh drift checks.
- Railway project `bc28b46c-d4bc-491c-893a-d8401c633668`, environment
  `production` (`d9f9b984-d54d-4620-a8bf-c48882ad5158`), service `8223324090`
  (`3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`). No staged settings changes observed.

## Included behavior and exclusions

Release the implemented, guarded first version, not the universal target described
in the original design. The UI rejects unsupported HR partial/merge/retained-pay
transfers, booking and educational work, and projected greeting occurrences.
Task/lead identities use explicit user/staff links. Afisha uses canonical dated
roster and transactional assignment. Payroll consumes completed unique evidence.
No existing staff records, attendance, wages or reports are backfilled by migration.

The protected booking blocks and access grants are unchanged. Future unrelated
calendar changes do not consult substitution aliases; operators must resolve source
changes through the existing guarded workflow. Multi-source alias deduplication,
chained replacements and additional source-page/read-model integration remain
future work, not claims of this release.

## Validation before the production pipeline

- 71 focused contract, payroll and export-permission tests passed on Node 22.23.4.
- Eight real PostgreSQL transaction tests passed.
- Existing full HR disposable suite: all nine passed after shortening synthetic
  fixture names to normal printable width; queue idempotency assertions unchanged.
- Fully migrated application: passed fixed compensation of 750.37 UAH, unchanged
  permanent occupation, whole HR transfer/restore, procurement API/picker, task/lead
  linked-user transfer/restore and both Afisha animator slots with restore.
- Desktop/mobile shared-form browser proof from implementation remains applicable;
  no subsequent responsive styling changes were made.
- Stale export test now expects the existing additional writable-business guard.
  The runtime authorization implementation was not changed.
- The existing HR isolated runner now includes the substitution actual-app proof,
  so the existing CI HR job covers it without changing workflow configuration.
- Full `npm test`, exact production-push `CI` and `Runtime artifact smoke` are
  required by the production controller before deployment. Record their outcomes
  in the sanitized block manifest and final delivery report, not as assumed passes.

## Migration, QA and recovery boundary

Only `392_staff_substitutions.sql` is added: schema tables/indexes and immutable
history/source guards, no data backfill or delete. Idempotency was verified by
applying it twice to a disposable schema.

Production QA is public/read-only version, source SHA/branch, release markers and
asset/API authentication boundary verification. Authenticated live QA is blocked:
the mandated local credential file is absent. Do not obtain credentials elsewhere
or create production fixture staff, tasks, payroll, payments or bookings.

Recovery retains substitution ledger tables and all accepted evidence. Any rollback
of behavior is a reviewed forward-version patch based on the previous live source;
never drop tables or force-push. The repository helper rejects an older/same-version
upload. If accepted substitutions exist, assess their payroll/source guards before
disabling callers; do not silently erase or detach accounting history.

The release envelope permits only reviewed descendants of the prepared functional
candidate for version/cache/changelog and at most three scoped corrective attempts
within six hours of the owner's authorization. Stop on foreign live/remote drift,
unapproved Red scope, failed required CI, changed migration inventory or expiry.
