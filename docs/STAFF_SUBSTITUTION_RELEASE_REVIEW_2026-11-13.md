# Staff substitution bounded release review

## Delivered release

- Production version: **0.83.48**, `Людина на заміну`.
- Released SHA: `3f41bef21804f61ecb452961902be68e047603be` on
  `codex/eventgenix-production`.
- Railway deployment: `1fbf828a-2c5c-487a-8afc-426ba42710a7`, **SUCCESS**.
- Migration log: `Migration applied: 392_staff_substitutions` at
  `2026-11-13T15:24:17Z`.
- [Exact-SHA CI](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/43450001816):
  all 13 jobs successful, including the full HR/payroll PostgreSQL and HR browser jobs.
- [Runtime artifact smoke](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/43450001879): successful.
- Full local `npm test`: successful, including 4,000 unit tests and 1,327 UI checks.
- Live version/source proof, both timeline contexts and service-worker markers:
  successful. Public QA at `2026-11-13T15:25:19Z` verified the substitution asset's
  normalized SHA-256 against the released source, both HR/staff HTML integrations,
  and HTTP 401 for the anonymous substitution catalog request.
- Authenticated live QA was **not run**: the mandated credential file was absent.
  No production fixture or real-business-data mutation was performed for QA.

This completion record is a documentation-only follow-up on the source branch;
the production release SHA above remains the immutable deployed reference.

Primary implementation files: `routes/staff-substitutions.js`,
`services/staffSubstitutionContract.js`, `services/staffSubstitutionContext.js`,
`services/staffSubstitutionSources.js`, `services/staffSubstitutionPayroll.js`,
`services/staffSubstitutions.js`, `db/migrations/392_staff_substitutions.sql`,
`js/staff-substitution.js`, `hr.html`, `staff.html`, `services/payroll.js`,
`js/hr-page.js`, `services/afishaTimeline.js`, `services/backupRecovery.js`,
plus focused tests, isolated-runner registration and release metadata.

Recommended next action: authorized authenticated production QA with a test account
and separately bounded disposable records. Adding the new substitution actual-app
suite to a CI mode that the workflow invokes remains follow-up work.

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
- First candidate: `0.83.47` (`a097f227`), pushed but not deployed because CI
  rejected attendance-only recovery with the new ledger dependency.
- Corrected target: next free patch `0.83.48`, subject to fresh drift checks.
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
- The `hr` isolated-runner mode now includes the substitution actual-app proof.
  Coverage correction: the current CI HR job invokes other isolated modes, so it
  does **not** execute this added suite. The new substitution PostgreSQL/actual-app
  scenarios passed locally; do not label them as CI or authenticated live evidence.
- Full `npm test`, exact production-push `CI` and `Runtime artifact smoke` are
  required by the production controller before deployment. Record their outcomes
  in the sanitized block manifest and final delivery report, not as assumed passes.

## Migration, QA and recovery boundary

The first exact-SHA CI found the new attendance foreign key correctly blocked
`attendance-v1` selective recovery. The correction preserves that rejection when
either the artifact or target contains any substitution evidence. An exception is
limited to the exact new foreign key with all four ledger tables empty on both
sides. Access-exclusive locks cover attendance and ledger tables through commit;
the target emptiness check requires READ COMMITTED visibility after lock acquisition.
No ledger table is deleted, restored or trigger-disabled by this exception. Unknown
dependencies still fail closed. Once substitutions exist, use reviewed full recovery
on an isolated matching schema, not an attendance-only production restore.

Regression coverage includes plain/encrypted empty-ledger recovery, an in-flight
first substitution writer, target-side evidence, artifact-side evidence and unchanged
attendance after rejection. Record the actual rerun outcome in release evidence.

Correction validation passed: 29 backup contract tests and both real PostgreSQL
recovery suites, including the new concurrent-writer regression and full recovery
into a separate fresh database. The first local startup timed out; the successful
rerun used only the disposable cluster with fsync/synchronous_commit disabled to
reduce Windows disk latency. This validates logical recovery and locking, not
crash durability. Standard PostgreSQL CI remains mandatory for the corrected SHA.

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
