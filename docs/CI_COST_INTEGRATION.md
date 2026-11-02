# CI cost integration — 2026-11-02

Candidate worktree: `D:\Codex\EventGenix\ci-cost-integration`.
Feature branch: `codex/ci-cost-integration-20261102`.
Base: `b8e842cf4053713c0006f9e96c56ab55cef317b6`.
Local evidence: `D:\Codex\EventGenix\ci-integration-evidence`.

## Scope and retained checks

This candidate combines the previously verified test-script deduplication,
education shard runner, explicit artifact retention and settings-readiness test
fix. No product, dependency, lockfile, production setting or release version changes.
Pending Hermes and PDFKit work remains in its original worktrees.

- All 424 original explicitly registered `.test.js` files remain in `npm test`.
  Six duplicate file invocations are removed, and one new runner test is added:
  430 invocations / 424 unique files becomes 425 / 425. Dynamic checks are excluded
  from this count and remain unchanged.
- All 15 required education suite/browser pairs run in five serial groups. Each
  pair still uses the native disposable PostgreSQL isolation, cleanup, deadline
  and source-bound proof validation. Failed or uncertain execution stops its
  group; later cases are NOT_RUN, never silently passed or retried.
- Eight noneducation jobs retain their names and commands. Expanded jobs decrease
  from 23 to 13. Node 22/npm 10, fail-fast false and strict education artifact
  uploads remain. The 95-minute group timeout accommodates four native 20-minute
  deadlines plus setup; it is not a runtime forecast.
- Five upload definitions now explicitly retain evidence for 14 days. Existing
  explicit retention stays unchanged. No remote evidence is deleted.
- The acceptance test waits for asynchronously initialized settings before clicking
  the System tab. Existing permission, persistence and API-denial assertions stay.
- Windows tests can use the existing `GIT_BASH_PATH` override.

## Verification and expected benefit

The prior preparation recorded 5,535 passing TAP executions across a completed
prefix and resumed commands, not one uninterrupted green npm test. The acceptance
fix passed 11/11 real local PostgreSQL/Chrome cases with controlled hydration
delay. These are historical supporting results, not hosted results for this SHA.

Current integrated candidate: 294 focused tests pass, zero failures/skips;
actionlint 1.7.12 passes (ShellCheck and Pyflakes are not run); Node 22 runtime,
protected-surface guard, changed-JavaScript syntax and whitespace checks pass.
The full hosted baseline and all five real education groups must pass at the
published exact SHA before this candidate is considered ready for integration.
See the external evidence report for the actual run, artifacts and conclusion.

Model from successful historical run 40118259177: education 3,686 to 2,907 summed
job-seconds, potentially avoiding 779 seconds (13.0 runner-minutes). This is a
setup-sharing estimate, not measured billing, achieved savings or Railway savings.
New hosted timings must be reported separately because source, runner and cache
conditions differ.

## Activation and rollback

1. Publish this feature branch once and verify its exact-SHA push CI: eight
   existing noneducation jobs plus five education groups, all required pairs and
   successful evidence uploads. Do not open another workflow-triggering PR merely
   to duplicate that run.
2. Review actual failures and artifacts before any integration. Production branch
   merge/push and Railway deployment remain separate authorized stages.
3. Before future integration, check any externally configured required check names:
   the education job names change. Repository settings must not be changed without
   the separate approval required by AGENTS.md.
4. Before merge, leaving the candidate unmerged rolls back exposure. After an
   authorized merge, use a normal revert commit on an authorized branch; never
   force-push or delete evidence. Restoring the old matrix returns to 23 jobs and
   the earlier retention configuration. Product/database rollback is not involved.

The linked preparation documents describe their original local stage. This file
and the current external report supersede their candidate-status statements.
