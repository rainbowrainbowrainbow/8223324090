# Staff deletion release review

Release candidate starts from production `a6e37b311202fbe7929118aa9c5c3c0422ab0211`
(0.83.40). The release contains the scoped Park staff deletion repair and card
menu changes documented in `STAFF_DELETE_BUSINESS_BOUNDARY_AUDIT_2026-11-12.md`.
No database migration or production data fix is proposed.

The candidate changes `.github/workflows/ci.yml` in exactly two places in the
existing `hr-payroll-postgres` job: a fresh disposable database test for FK,
rollback and race scenarios, and the isolated full-migration staff deletion
test. The exact reviewed diff is available in this worktree. The existing HR
browser job runs the new deletion and menu checks through `test:browser:hr-team`.
Neither workflow step modifies production data or provider configuration.

The production controller treats any `.github/workflows/` change as Red. Its
existing protected workflows are pinned to unrelated releases, and the generic
workflow rejects this candidate. Owner authorization is required before any
release of this CI change or implementation of a new controller exception.
Any proposed exception must bind the exact CI bytes, exact staff-release file
inventory, production target, and approved SHA; preserve all expiry, CI,
migration and drift guards; include regression tests for mismatches; and must
not reuse another workflow's unrelated exception or allow arbitrary CI changes.
The owner approved `RED-STAFF-RELEASE-CI` for this exact CI scope. The
`staff-deletion-ci` exception now pins the base SHA, prepared version, CI hash,
complete changed-file inventory, empty migration and QA scopes, and the prepared
release SHA. Controller tests reject path, hash, base, version, migration and
SHA drift. A separate Yellow authorization is still required for production.

Before any push or deployment, recheck the live SHA and production branch,
parallel deployments, next available patch version and target identity, then
prepare a separate bounded Yellow production authorization. No test account
credentials were available at the documented local path; authenticated live QA
cannot be claimed without resolving that separately. Do not use real staff data
or broaden access to work around this limitation.
