# HR remaining-work readiness — 2026-10-23

Status: PREPARED; production integration and protected mutations NOT EXECUTED.

## Fresh facts

- Feature merge base: `49dc3ebb8a6bd08cd46143e1514d7f937d7b5520` (production Git v0.82.114).
- Live version: v0.82.112 / `303ef3921d176cdd74674d00c346a84ab3e6a560` on `codex/eventgenix-production`.
- Production CI run 39969447273 has a failed Education journey Chromium job. Live/remote are not converged. This blocks production promotion; it is not evidence of a live HR card failure.
- Previous feature `a8bd60e6f4452b8dccbf2c25b3eed3897c419403` passed 23/23 jobs in run 39968785722. A new exact-SHA run is needed after merging upstream. The merge retains upstream WebKit abort classification and the request quiet-window tracker, with 33 focused tests passing.
- At 2026-10-23T14:44:48Z the existing audit role completed REPEATABLE READ READ ONLY plus ROLLBACK. Counts: professions 35; checklist items 93; checklist progress 7; role assignments 264; staff 217; onboarding progress 7; templates 2; Park onboarding tasks 20. All checked invalid/orphan/foreign counters were zero; ten EXPLAIN checks passed. No grant, admin read or business write occurred.
- At 2026-10-23T14:45:38Z the existing isolated QA account business profile reported membership mode, one available business, Park default, single scope, canSwitchBusiness=false. No membership was activated. Historic fixture authorization is expired.

## Ready test/CI integration

The scoped feature diff adds browser synchronization regressions, records existing HR proof, and changes only the WebKit dependency mirror setup. It does not change application code, auth, data, schema or release markers. The only merge conflict was in education-close-teachers-browser.js; both independent synchronization and lifecycle-error checks were retained. No test assertion was removed.

Before production Git integration: live and remote must converge, exact candidate CI must succeed, current Railway identity must be independently established, and a bounded production-push authorization must be active. Test/docs/CI-only integration does not require an application deploy or version bump. Do not deploy unrelated upstream migrations to deliver this evidence.

## Protected ownership implementation

The six legacy tables still lack business/organization ownership columns. The existing Park-only owner decision supports the recovery lane; zero orphan counts are not a substitute for it.

Before editing schema or access contracts, obtain exact approval for additive nullable ownership columns and parent/child owner checks on hr_professions, hr_profession_checklist_items, hr_staff_profession_checklist_progress, staff_role_assignments, onboarding_templates and onboarding_progress. Registry IDs are BIGINT, resolved from active Park registry records; do not invent UUIDs or hardcode production identifiers. Inventory fingerprints must be private and freshly frozen before any backfill. The counts above are a preflight snapshot, not permission to mutate changed inventory.

Update readers and writers together in routes/hr.js, services/professionChecklists.js, services/professions.js, services/hrOnboarding.js and services/accountOnboarding.js. Preserve exact GET allowlists and field masks. Do not create account memberships, change capability semantics, copy payroll/training ownership, drop old uniqueness constraints or enable a second tenant in the legacy namespace. Add disposable PostgreSQL isolation, cross-parent, idempotency and rollback tests before release. A later NOT NULL or uniqueness cutover needs its own reviewed compatibility decision. No migration/backfill has been prepared or run under a generic closeout request.

## Protected live switching fixture

A fresh authenticated operator preflight must verify the isolated QA marker, no linked staff profile, active/default Park, existing inactive/non-default Dar membership, same active organization, active businesses, waiter/member roles and empty overrides. Save a private canonical before-state fingerprint. A mismatch means HOLD.

Only after a new exact permission: reactivate that one existing Dar membership via the normal authenticated membership API and audit event; max 30 minutes; Park remains default; single scope; no Dar HR/payroll rights. Run GET-only real Park to Dar to Park QA, stale cache and both delayed-response orders. In finally deactivate exactly that Dar membership via the normal authenticated DELETE; verify audit event, initial fingerprint and Park-only profile. No direct SQL, DB grants, real staff writes or expansion to another account.

## Honest completion boundary

Synthetic late-response proof already exists. Real switching was performed historically, but this new checklist/onboarding closeout has not rerun a two-business session. Do not label it complete until the fresh fixture is authorized, verified and retired. Do not conflate protected data-model hardening with the already-working live HR card.

## Local verification on merged production base

`npm test` completed with exit 0 on Node 22.23.1/npm 10.9.8 after the normal production merge. The 33 focused browser-sync/education-evidence tests also passed. Upstream journey Chromium artifact 12508697365 identifies `Requests did not settle before navigation`; it does not identify an application assertion failure. The feature request quiet-window/lifecycle fix addresses this boundary and still requires a new exact-SHA CI on the merged base.

## Later verification and effective mirror correction

During closeout, parallel production CI 39969447273 completed successfully after retry and live converged to v0.82.114 / 49dc3ebb8a6bd08cd46143e1514d7f937d7b5520. The complete read-only HR browser/API matrix passed again on that live SHA, including six GETs, Dar denials, private-field masks, Team/Today detail, Schedule and 403/500/offline Retry. Product mutations were intercepted; only authentication reached POST. One daily-login reward POST was blocked before the server. Deterministic Structure browser smoke also passed locally.

Fresh operator GETs verified the existing Codex/Smoke-marked, non-creator, unlinked test account; active/default Park; inactive/non-default Dar waiter membership in the same active organization; member organization role; empty overrides. Its private before-state receipt is outside Git. No membership activation occurred. A six-table key/link inventory was frozen read-only at 2026-10-23T15:01:04Z with the same counts; private row keys stay outside Git. No registry grant or schema/data mutation occurred.

Merged candidate eb7760a527fb130c24026b6c85c43de1c93f4f87 passed 22 jobs, but CI 39973150398 exhausted 25 minutes in hrLink WebKit dependency installation; that suite never ran. Its log explicitly shows `file:/etc/apt/apt-mirrors.txt` followed by Azure package downloads. Editing ubuntu.sources alone does not normalize this mirrorlist-backed runner. The scoped bootstrap now normalizes both the expected Ubuntu source file and its existing apt-mirrors.txt, retaining archive signatures, vendor sources, test commands and the original job timeout. Three new tests execute the actual YAML shell block against temporary apt fixtures, covering direct URLs, mirrorlists, idempotency, unchanged GPG/vendor configuration and failure when the expected source is absent. All seven synchronization/bootstrap tests passed on Node 22/npm 10. A new exact-SHA CI is required; the cancelled setup is not represented as a test pass.
