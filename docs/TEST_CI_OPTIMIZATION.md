# Test and CI optimization preparation — 2026-11-02

Historical preparation record. For the integrated candidate and activation scope,
see [CI_COST_INTEGRATION.md](CI_COST_INTEGRATION.md).

Worktree: `D:\Codex\EventGenix\test-ci-optimization`, branch
`codex/test-ci-optimization`, base `b8e842cf4053713c0006f9e96c56ab55cef317b6`.
Evidence: `D:\Codex\EventGenix\test-ci-evidence`.
No release, push, production change, paid API call or remote artifact deletion.

## Implemented locally

`package.json` removes six exact repeat file executions from the aggregate
`npm test` graph. Their test bodies and surviving domain gates are preserved:

| File | Surviving gate | Removed repeat |
|---|---|---|
| isolated-postgres-test-flow.test.js | test:db-flow-contract | check:permission-contracts:executable |
| backup-inventory-contract.test.js | test:backup-recovery | test:unit:files |
| hr-profession-conditions.test.js | test:hr-release-b | test:unit:files |
| profile-hr-professions-foundation.test.js | test:hr-release-b | test:unit:files |
| hr-profession-readiness-static.test.js | test:hr-release-b | test:unit:files |
| checkin-reliability-contract.test.js | test:staff-schedule-recovery | test:unit:files |

Standalone unit and executable-permission commands now rely on the named domain
commands for those files; use `npm test` for the aggregate baseline. No test body
was deleted. The exact existing Git Bash path fix is copied from the older
optimization worktree to support Windows verification; its original is untouched.

Explicit `.test.js` expansion at the committed base has 430 invocations and 424
unique files. All 424 remain; six repeats disappear and one new shard-runner test
file is registered once: 425 invocations / 425 unique files. This count excludes
the custom `tests/ui-check.js` program, which is unchanged. The previous audit's
432/426 count also included that program and the pending PDF lazy-load test in a
different worktree; these are different inventories, not a coverage loss.

`scripts/run-education-ci-shard.js` prepares five balanced groups retaining all
15 mandatory suite/engine pairs. Each suite runs through the unchanged native
runner, in its own process and evidence directory. The existing disposable DB
lock, schema reset/cleanup and source/proof hashes are retained. Execution is
serial inside a group. Failure, missing/corrupted evidence or uncertain cleanup
stops later suites as NOT_RUN, with no automatic retry. An old output directory
cannot be reused to combine evidence from attempts. The runner is inactive in CI.

`node scripts/run-education-ci-shard.js --plan` is read-only. Actual execution
needs the existing loopback disposable education database and Playwright setup.
For an intentional rerun, use a fresh `EDU_CLOSE_SHARD_OUTPUT` under this worktree's
`output/education-ready`; preserve the old evidence.

## Measured GitHub baseline and proposals

Read-only Actions API evidence is stored in `actions-runs.json`. The latest
production-source run 40193642237 (b8e842cf) failed; it is not a green release gate.
Two sampled job logs confirm artifact-storage quota failures, and education
acceptance also has a failed suite step with a browser-timeout marker. Raw log
contents and credentials were not persisted. The precise acceptance cause needs
separate diagnosis; storage exhaustion alone does not explain it.

The successful live-source run 40118259177 (34293c9b) provides the timing model:
23 jobs, 5,753 total job-seconds; education's 15 jobs total 3,686 seconds. Reusing
unchanged suite times plus one observed within-group upper-median setup/teardown cost
models five education jobs at 2,907 seconds: 779 seconds (13.0 runner-minutes,
21.1% of education time / 13.5% of total job time) potentially avoided. Longest
education job stays modeled at 798 seconds after balancing. These are modeled
elapsed job-seconds, not measured new runtimes, invoice savings or Railway RAM
savings. Post-change billed-minute rounding and queue behavior remain unknown.

Prepared outside the protected workflow:

- `education-ci.patch` / `ci.proposed.yml`: 15 education setups -> 5; 23 total jobs
  -> 13, preserving all 15 pairs and all eight mandatory non-education job names.
  Chromium groups contain four suites, WebKit groups two and one. Native
  20-minute deadlines remain; the outer job ceiling is 95 minutes for serial
  worst-case deadlines plus setup, not an expected duration. No path-based skips.
- `artifact-retention.patch` / `ci.retention-proposed.yml`: add explicit 14-day
  retention to five upload definitions currently using the default. Existing
  explicit 14-day settings are retained. No upload or mandatory evidence is
  suppressed and no error is ignored.
- `combined-ci.patch` / `ci.combined-proposed.yml`: both changes in one reviewable
  patch; use this instead of blindly stacking overlapping patches.

The repository artifact inventory contains 22 nonexpired artifacts totaling
214,024,769 bytes at inspection. Many default-retention artifacts expire in
January 2027, while two explicit 14-day artifacts expire November 7. This inventory
is not account-wide billing/storage usage and does not explain the full quota.
No artifact was selected for deletion. New retention does not recover occupied
space immediately. At a constant arrival rate, 90 -> 14 days would reduce steady
retained byte-days by 84.4% for affected artifacts; this is an assumption, not an
achieved saving or an account-wide forecast.

## Activation and rollback

1. Finish local checks and preserve their report. Resolve the independent
   acceptance/browser failure and account storage blocker before using CI as a
   release gate. Preserve relevant evidence before any separately authorized
   exact artifact cleanup; inspect account-wide storage instead of broad deletion.
2. Review the complete workflow proposal, exact SHA, affected education check
   names/branch protection and current required-gate policy. The checked-in
   `.github/workflows/ci.yml` remains byte-identical. Remote CI/settings activation
   requires the repository's applicable authorization; no settings bypass is added.
3. In an authorized review/release task, incorporate the desired proposal,
   validate GitHub's workflow syntax and obtain exact-SHA hosted CI. Verify all 15
   suite/engine results and artifacts, no hidden skips, and actual minutes/latency.
   A mocked runner test is not PostgreSQL/browser acceptance of grouped suites.
4. Keep other pending Hermes/PDF changes separate until explicitly integrated.
   Compare the same workload before claiming savings. Do not increase paid usage.

Rollback the local duplicate-list edit with an exact inverse diff, retaining new
unrelated edits. For a released workflow regression, restore the previous
workflow via a normal authorized commit, keeping diagnostic evidence and existing
release guards. Restoring retention cannot recover already expired/deleted
artifacts; the current task deletes none. No production DB rollback is required.

## Sources

- [GitHub matrix semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations)
- [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Artifact default retention](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)
- [upload-artifact retention input](https://github.com/actions/upload-artifact#retention-period)
- [Measured successful run](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/40118259177)
- [Current source run failure](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/40193642237)

Final verification status and integrity manifest are in the external report and
`optimization-progress.md`; a historical partial log is not a passing full run.
