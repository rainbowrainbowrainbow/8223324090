# PARK/DAR Follow-up Progress

Updated: 2026-09-05. Production impact: no (local work only).

- Owner task: `01a072bb-bfb0-7b43-8f2c-e5cf1a4fd4be`.
- Coordinator: `01a072bc-ab26-7281-86d3-1b157579fc10`.
- Worktree: `C:/Users/Plotva/.codex/worktrees/0eb7/EventGenix`.
- Branch: `codex/park-dar-cashier-followup-20260905`.
- Base/HEAD: `9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5`; no commit/push/deploy.
- Authorization: owner explicitly allowed `PARK-DAR-REUSABLE-TEST-DAY-LOCAL`.
- Runtime: Node 22.23.1 / npm 10.9.8, existing installed dependencies via NODE_PATH.

## Current checkpoint

PD1 complete and preserved: durable submitted payload/key, next customer, empty
cart/discount reset, same-origin Web Locks and stale-tab protection, previous
pending receipt recovery. Canonical single-tab browser PASS; dedicated synthetic-
auth two-tab browser PASS. Combined canonical-auth two-tab acceptance remains for
coordinated R7B integration; no auth code changed.

PD2 complete and preserved: full wrapped selected names, theme-safe arrows and
summary columns sized to the card, explicit label/value gaps and right-aligned
amounts. The original 1152px spacing regression failed before the fix. Final
16/16 layout cases PASS across 1152/960/1440/390, light/dark, ordinary/long amounts.
Native browser zoom 125/150 remains NOT VERIFIED; reduced viewports are separately
identified evidence, not a claim of native zoom.

PD3 implemented locally: additive migration 352, two endpoints, owner-only exact
Shared Test lifecycle `draining -> closed -> resumed`, register-wide admission
stop, canonical close, explicit fresh CLOSED/empty-queue resume. Physical locks,
exact composite FK, one active stop, immutable history and cycle-bound replay
protect concurrent/repeated requests. Stop/resume issue provider GETs only and
never change acceptance flags. Global OFF remains OFF. Accepted checks continue
through the existing worker; new blocker-producing operations honor the stop.

PD4 complete locally: targeted 154/154, full npm test (UI 1310/1310), old cashier/
next-customer/layout browser smokes and new stop/resume browser smoke PASS. Two
sequential DB/mock cycles preserve both history rows, reject unsafe resume and
stale cycle replay, finish accepted pending work, and end with zero active shifts,
queue jobs and unknown operations. Exact matrix and limitations are in the report.

PD5 ready for coordinator review: scoped binary patch, per-file hashes and evidence
inventory in `output/park-dar-followup.patch` and
`output/park-dar-review-manifest.json`. Current local changes are not live.
Historical 18:36 UTC production/R7B observations remain reference only; release
preparation must refresh them and check migration 352 for collisions.

Coordinator R1/R2 corrections: webhook lookup admission now shares the physical lock
and rechecks scope; lifecycle checks reload current actor authority through the
canonical helper with a transaction-held user lock. Both findings have explicit
before-fix failure evidence, deterministic PG regressions and refreshed test logs.
The old 29-file bundle is superseded by the 31-file final review manifest.

## Review and evidence

- `docs/integrations/checkbox/FOLLOWUP_ACCEPTANCE_20260905.md`
- `docs/integrations/checkbox/REUSABLE_TEST_DAY_LOCAL_ACCEPTANCE_20260905.md`
- `docs/integrations/checkbox/SHARED_TEST_END_OF_DAY_PROPOSAL.md` (accepted contract)
- `output/park-dar-pd3-*.log`
- `output/catalog-sale-local-qa-report.json`
- `output/playwright/park-dar/test-day/` and `summary-layout/`

The complete owned path inventory is the review manifest. Migration/services/routes,
UI, tests, the package test script and scoped docs changed. No dependencies,
lockfile, permissions, authentication, secrets, production settings, release/cache
markers or protected booking manifest changed. No production DB, Railway or real
Checkbox calls were used. Final independent proof uses task-owned review container
`eventgenix-pd3-review-test-0eb7`, port15440 / `eventgenix_pd3_review_test`; earlier
runs used `eventgenix-park-dar-followup-test-0eb7`, port15439. Both containers are
stopped after QA without removal. The canonical runner resets disposable fixture
schema on teardown; history is verified before cleanup and preserved in evidence,
not as post-run DB rows. This corrects the earlier retained-data wording.

Next checkpoint: coordinator review, then the concrete
`PARK-DAR-REUSABLE-TEST-DAY-RELEASE-PREP` checkpoint in the PD3 acceptance report.
The subsequent isolated release candidate and concrete delivery proposal are
documented in `integrations/checkbox/REUSABLE_TEST_DAY_RELEASE_PREP_20260906.md`.
This copy accompanies that candidate; the original 91-hash LOCAL freeze is unchanged.
No further implementation permission is needed for this completed local block;
commit, push, deploy and real fiscal QA remain separately unapproved.
