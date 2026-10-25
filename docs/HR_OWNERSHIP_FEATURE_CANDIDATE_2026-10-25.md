# Park HR ownership feature candidate — 2026-10-25

Status: PREPARED FOR FEATURE CI. This is not a production cutover approval.

- Feature branch: `codex/hr-tenant-ownership-20261023`.
- Confirmed production base and live: `34293c9b1e52ac1e3b4f9bde6262276e0bf0e19b`, v0.82.117, `codex/eventgenix-production`.
- Existing ownership implementation/rehearsal commits remain in history and include the confirmed production base.
- New functional commit: `91b31eeb123fff1325d4440722eac831ea583996` — receipted ownership maintenance/recovery, focused tests and redacted operator runbooks.
- Candidate release version: v0.82.118, «HR Парку: ізоляція професій та онбордингу». Version/cache/changelog synchronization is a separate commit. The final release SHA and exact CI result are reported after feature push, not asserted in advance here.

## Scope

Six-table explicit ownership foundation (migration 387), owned Park reads/writers already staged on this feature, bounded library-only attribution/recovery and an explicit maintenance path in the canonical release helper. No new HR GET/prefix allowlist, account permission or membership grant. Pure release changes outside HR are generated version/cache markers.

Migration SHA-256 remains `0b5f3cd7fbc80dd966f3f7a6f2dc890b011ed1b7165536f766c821f5fe4d2a97`. Installing the migration alone never attributes legacy rows. Deploying owned readers before the separately approved attribution/writer handoff is unsafe.

## Evidence available before CI

Prior full local baseline passed. Final focused version/release-tooling suite passed 131/131; ownership plan/operator unit tests passed 12/12. Disposable operator/recovery suite passed 14/14, including a separate audit-role login connection in REPEATABLE READ READ ONLY. A prior full-app-schema rehearsal passed 20/20 before the final recovery additions. The new full-schema recovery path must pass the normal CI PostgreSQL lane; the cold Windows startup diagnostic is not a substitute for CI.

The last aggregate production audit returned preparation GO with 408 target rows and no conflicting owner signals, and its temporary SELECT lease was retired. It is historical evidence at candidate time; do not reuse it as fresh production attribution authorization. No current lease, membership change or production write is created by this candidate task.

## Required CI

All jobs of the exact-SHA CI workflow must succeed, including Fast baseline, Omni browser regression, HR Team browser smoke, HR/payroll PostgreSQL and the current education/certificate/My Day jobs. Fix a related failure; do not remove or skip assertions to obtain green. The release helper rechecks the exact workflow and does not accept incomplete or unknown evidence.

## Open production gates

1. Review the final candidate SHA and green feature CI, recheck live/remote/source identity and free release markers immediately before integration.
2. Obtain a new exact bounded authorization for attribution/schema application, writer shutdown/restart, production integration/deploy and narrowly scoped recovery. Existing audit/local-helper approvals grant none of these actions. Any missing registry SELECT needs a new explicit audit lease; retired leases cannot be reused.
3. Repeat fresh read-only staff/profession/onboarding ownership and frozen inventory checks; mixed owner, new inventory or unknown provenance means HOLD. Preserve all private structural IDs/receipts outside Git.
4. Review all external writers and the concrete recovery plan before any shutdown, including unknown upload/image identity and private receipt storage failure. Those states cause HOLD; they do not permit a guessed deployment or blind retry.
5. Prepare/pin both clean release and rollback artifacts with fresh CI and manifest proof before stopping writers. Use only `release:railway-up` with explicit `RELEASE_DEPLOY_BRANCH=codex/eventgenix-production`.
6. After a separately authorized release, verify exact live SHA/version/branch and safe test-account GET QA, including payroll masking, errors/retry, Team/Today/Schedule, checklist/onboarding isolation and business cache/races. Real Dar -> Park live evidence remains separate from synthetic coverage; no fixture activation is authorized here.

Current feature task allows scoped feature commits/push and CI only. No production branch push, service stop/deploy, DB grants/DML/DDL or membership mutation occurs in this stage.
