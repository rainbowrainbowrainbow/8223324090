# Performance remediation execution plan

Status: planning only, prepared on 2026-11-07. This document does not start a Goal or authorize production changes.

## Outcome and scope

Complete the existing customer-read optimization, resolve the remaining broad-search bottleneck, reduce proven CI overhead without weakening coverage, and produce a smaller verified runtime artifact. Investigate memory, polling and background work; change them only where measurements demonstrate avoidable consumption. Deliver reproducible evidence and independent rollback instructions for each change group.

The implementation scope is local development and disposable test environments. Feature-branch commits and hosted CI require explicit authorization in the Goal launch request. Production deployment, production migrations, service settings, environment variables and plan changes are a separate follow-up. Do not invoke an autopilot skill unless the owner explicitly requests it and its instructions are available.

Read `AGENTS.md` and any applicable nested instructions first. Read the production runbook before production inspection/release work, migration governance before migration design, and the protected timeline contract before touching a protected surface. Never change permissions, authentication, payment/payroll behavior or protected booking contracts as an incidental optimization.

## Evidence already available

Use `docs/CUSTOMER_READS_PERFORMANCE.md` as the detailed source. Historical numbers below are observations, not acceptance guarantees on another machine.

| Area | Original baseline | Current uncommitted candidate | Remaining work |
| --- | --- | --- | --- |
| Customer list, 50 rows, HTTP p95 | 1082.8 ms | 42.7 ms | Preserve improvement and verify scale/concurrency |
| Selective autocomplete, HTTP p95 | 577.7 ms | 26.2 ms | Preserve improvement and access/data parity |
| Broad autocomplete, HTTP p95 | 1030.2 ms | 626.4 ms | Reduce work for many matching customers |
| Broad autocomplete, shared buffer accesses/request | 653 | 28,050 | Investigate indexed lookup amplification and cold-cache impact |
| HTTP errors, each scenario | 0/60 | 0/60 | Retain zero errors under the agreed local load |
| Aggregate hosted CI time | 69.1 runner minutes | About 68.2 estimated | Measure final exact-SHA CI; estimate is not a hosted result |
| Slow hosted jobs | WebKit responsive 700 s; Chromium journey 594 s; HR/payroll 439 s | Not yet measured in hosted CI | Profile actual critical path and repeated setup |
| Tracked source under `tests/` | 18,946,032 bytes | Unchanged | Verify exclusions in the final runtime artifact |
| Local installed dependencies | 136.3 MB with Railpack-equivalent defaults | 116.8 MB with `--omit=dev`, experiment only | Verify production startup and final image; disk size is not RSS |

Baseline commit: `50dee4768720ab3967c38d63ed2a66ad32a7e578`. The customer benchmark used Node 22.23.4, npm 10.9.9, PostgreSQL 17.11, 2,500 customers and 30,000 bookings across two businesses, eight warm-ups and 60 sequential measurements.

The six existing CI removals remove repeated invocations, not test cases. Their retained coverage is mapped in the existing report. The previous full candidate `npm test` passed in 533.6 seconds with 3,971 unit tests. The initial local baseline failed because Git Bash was not configured, so those two total durations are not a valid before/after speed comparison.

## 1. Preserve work and establish reproducible baselines

1. Inspect status, HEAD, worktrees and relevant diffs. Preserve all current tracked and untracked work, including this plan, the report and `tests/benchmarks/`. Do not stash, reset or overwrite it.
2. Record a file/hash inventory and save a binary patch plus copies of task-owned untracked files in an ignored evidence directory. Exclude secrets, `.env` files and customer data. Verify the saved copy before proceeding.
3. Create a clean isolated feature worktree from the appropriate current upstream. Reconcile the existing task-owned patches there; preserve the original checkout. If the upstream has advanced, record that and remeasure its baseline instead of treating historical timings as current.
4. Use Node 22/npm 10, a loopback disposable PostgreSQL cluster, synthetic credentials and blocked/mocked outbound integrations. Use the repository's disposable database guards. Existing startup migrations may initialize only this disposable database.
5. Preserve historical baseline, current candidate and final candidate identities separately. Make the benchmark runnable from PowerShell without manually exposing credentials. Retain sanitized machine-readable results outside temporary-only storage.

Exit evidence: source identity and patch inventory; reproducible environment/fixture commands; valid successful baseline test run; before measurements for the current candidate. No performance claim may depend on a failed baseline.

## 2. Resolve broad autocomplete work amplification

Primary files: `services/customerSearchQuery.js`, `services/customerBookingMetrics.js`, `routes/customers.js`, related unit/PostgreSQL tests and the benchmark harness.

1. Collect `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)` and per-query statistics for selective and broad searches, including customers without bookings and skewed booking counts.
2. Compare a set-based aggregate restricted to matching customer IDs with a two-stage query that computes the minimum last-visit information for ranking, then full metrics for the selected customers. Start with existing indexes. Select the simpler option that wins across the measured workload.
3. Never apply `LIMIT` before the existing last-visit ordering has been determined. Preserve matching by names, normalized phones, Instagram, child names and social identities, as well as business context, booking visibility, revenue restrictions, status/date semantics, limits and response shape.
4. Preserve the fast default list/selective paths. Metric-based list filters and sorts must still run before pagination. Reuse canonical metric/visibility logic; do not create a divergent definition of a visit or revenue.
5. Add focused behavioral coverage for changed query behavior, especially the newest visit belonging to a match outside the first candidate page. Compare complete selected records and allowed membership at tied boundaries; byte equality alone is inappropriate for existing unspecified ties.

Acceptance: zero measured errors, unchanged API/access semantics, repeatable reduction in broad-search SQL work and p95, and no repeatable list/selective regression greater than 10% against the same-run current candidate. Investigate apparent regressions before dismissing them as noise. Target at least 30% lower broad-search p95 and 50% fewer buffer accesses on the small fixture; these are optimization targets, not promised outcomes. Record achieved values and any target gap explicitly.

An index proposal is a separate fallback only after query-only options are measured. Prepare its local experiment and governance/rollback proposal separately; do not apply a production migration.

## 3. Reduce CI setup and verification time

Primary files: `.github/workflows/ci.yml`, `scripts/run-education-ci-shard.js`, relevant test runners and test helpers. Inspect `package.json` scripts before changing orchestration.

1. Retain and validate the six existing duplicate-invocation removals. Build a coverage map for every additional proposed removal: original command/test, behavior/assertions, retained command/test, fixture, browser engine, isolation and trigger conditions.
2. Time dependency/browser installation, database creation/migrations, fixture loading, application startup, assertions/browser actions, and cleanup separately. Start with WebKit responsive, Chromium journey and HR/payroll, then the slowest `npm test` components.
3. Optimize demonstrated repeated setup, unnecessary fixed waits and repeated process startup. Consider browser/package caching only after comparing cache restore cost with installation cost and testing cache misses. Do not add dependencies or lockfile churn without approval.
4. Rebalance Education shards only where timings justify it. Preserve all 15 mandatory suite/engine pairs exactly once, native isolation, one attempt, cleanup and evidence validation. Do not hide flakes with retries or relaxed assertions.
5. Keep the separate HR/payroll and My Day database/browser gates, payroll concurrency/profile gates, certificate gates, permissions and data-integrity coverage. Browser-specific behavior remains in real browsers. Move a check down a test layer only with demonstrated behavioral equivalence.

Acceptance: all retained gates pass; every removal has a coverage mapping; measured phase-level reductions explain the improvement. Report total runner minutes and critical-path elapsed time separately. Target at least 10% lower total runner time and 15% lower critical-path time after profiling; do not weaken coverage to meet these targets. If a target is not justified by the available overhead, report the measured limit.

Hosted comparison requires an authorized feature-branch push and successful CI for the exact final SHA. Compare runner images, cache state and workflow contents; otherwise label differences as non-equivalent. A single run is evidence, not a stable p95 estimate.

## 4. Produce and verify a minimal runtime artifact

1. Trace runtime file/dependency references before choosing exclusions. Inventory the clean export generated by `scripts/railway-release-up.js` and the final filesystem produced by the production builder.
2. Prepare a repository-controlled packaging change that retains the documented release helper, commit/version metadata and collision guards. Verify compatibility with the current builder before selecting configuration. Do not change Railway settings or production environment variables.
3. Install only runtime dependencies in the runtime artifact and exclude proven development-only files. Retain migrations, SQL, startup scripts, assets, templates, required documentation/data files and any runtime references regardless of directory name. Keep the full test suite in the repository and CI.
4. Build with clean and warmed dependency caches, then start the actual resulting artifact against a fresh disposable database. Verify `/api/health`, `/api/ready`, `/api/version`, customer scenarios, static assets, `sharp` image processing and representative PDF/Excel generation with synthetic data. Observe build/start process logs to confirm tests are not invoked.
5. Measure source upload, final image/filesystem bytes, dependency bytes, installation/build/startup times and runtime RSS separately. Do not infer Linux image size or Railway build time from Windows `node_modules` alone.

Acceptance: inventoried dev-only content is absent; all runtime smoke checks pass; measured artifact size is lower; no unexplained startup or memory regression. If a compatible local builder/container runtime is unavailable, deliver the candidate configuration and exact verification blocker without claiming the artifact passed. Reclassify any proposal requiring platform settings as a separate approval item.

## 5. Investigate the actual resource-cost drivers

The earlier billing observation attributed most CRM/database usage cost to memory, not CPU. Re-fetch read-only usage with exact dates and resource/service scope before using those values. No dollar saving has been established by the local query changes.

1. Measure Node and PostgreSQL independently: idle/load RSS, heap/external memory, CPU seconds, event-loop delay, pool wait/connections and statement frequency. Use stable repeated 10-15 minute windows with the same data/load.
2. For the customer page, measure request count, transferred bytes, repeated API calls and client polling during an active session and while hidden. Inspect loaded JavaScript and payload fields only where that trace shows relevant cost.
3. Attribute background queries to jobs and their existing dedup guards. Profile jobs against synthetic data with external sends/payments mocked. Do not disable operational jobs or reduce freshness merely to improve a benchmark.
4. Implement only confirmed redundant work, unbounded retained data, repeated loading or unnecessary requests. Preserve scheduling guarantees, reconnect/focus refresh, error handling, business isolation and permission behavior. Keep any resulting changes separate from query, CI and packaging changes.
5. Separate resource-unit reductions from money: calculate CPU-seconds/1,000 requests and incremental memory-time under a defined load. Apply only verified billing rates, with fixed/shared costs and included usage shown separately. Do not convert SQL elapsed milliseconds directly into billed CPU seconds.

Acceptance: either a measured, safe resource reduction with regression evidence, or an explicit finding that no avoidable consumption was demonstrated. Record exactly which metrics/access are missing. A smaller image alone is not proof of lower RAM charges or eligibility for a cheaper plan.

## 6. Verify the final candidate under comparable conditions

- Use the same fixtures at 2,500 and 25,000 customers, preserving booking/customer ratios and two-business coverage. Record skew and match counts. Include empty/short searches and metric-based filters/sorts in correctness checks.
- Compare historical baseline where reproducible, current candidate and final candidate. Keep machine, database settings, timezone/date, compression, process configuration and load fixed; alternate version order to reduce drift.
- For warm sequential runs, retain eight warm-ups and at least 60 measured requests per scenario, with three paired repetitions for final claims. Add bounded concurrency, initially five clients, recording throughput, errors, pool waits and p50/p95 separately.
- Define cache state precisely. A PostgreSQL restart clears shared buffers but does not clear the OS filesystem cache. Label that condition accurately. Use isolated cold-start samples and report individual values/range when the sample is insufficient for p95. Never clear shared host caches or restart a production database.
- Extend the existing benchmark harness with only the controls/evidence needed for this matrix. Record timeouts and failures separately; do not improve reported latency by dropping failed requests.
- Run targeted query/runner tests first, actual PostgreSQL customer metrics and birthdays tests, applicable permissions/isolation and critical regression gates, then one full `npm test` after final relevant changes. Include real clicks, a small viewport and reviewed screenshots if frontend behavior changes.
- For an authorized hosted run, wait for exact-SHA CI and diagnose failures before reporting delivery. Do not rerun an unchanged full suite repeatedly without a failure, change or unresolved concern.

Useful existing commands (inside the correctly configured disposable environment):

```text
npm run check:runtime
node --test tests/customer-booking-metrics.test.js tests/customer-search-query.test.js
node --test tests/education-ci-shard.test.js tests/release-railway-up-predeploy.test.js
npm run test:integration:customer-birthdays:isolated
node tests/benchmarks/customer-reads.js
npm test
git diff --check
```

Use the existing isolated PostgreSQL runner for additional customer-metrics/permissions suites after inspecting its current suite mapping. Preserve database reset guards; a test filename is not an instruction to run against production.

## 7. Deliver evidence and independent rollback

Keep these groups independently reviewable and, when commits are authorized, independently revertible:

| Group | Contents | Rollback |
| --- | --- | --- |
| A: customer reads | Query helpers/routes and their behavioral regression tests | Revert only group A commits, newest first; rerun customer metrics/search integration |
| B: CI | Workflow/runners and coverage map | Revert only group B commits; rerun workflow/runner contracts and exact-SHA CI if authorized |
| C: packaging | Runtime artifact configuration and smoke evidence | Revert only group C commits; rebuild and recheck the prior artifact |
| D: resource fixes | Only independently confirmed memory/polling/job fixes | Revert the specific fix and repeat its resource/behavior measurements |
| E: evidence | Harness, fixture documentation and sanitized results | Retain as historical evidence; update candidate identities after any revert |

Do not restore entire files from the historical baseline over unrelated later work. Before reverting, inspect dependencies and current diffs. Rollback of a local feature commit is separate from a production redeploy; never force-push or rewrite shared history.

Deliver a before/after table, reproduction commands, exact source identities, environment/fixture description, changed-file list, test results, coverage map, artifact inventory, actual billing observations versus estimates, and remaining risks. Classify each item as implemented/verified, investigated with no justified change, or blocked by a specific missing resource/approval. Do not label unresolved required verification as passed or the full implementation complete.

## Separate production follow-up

Prepare this only after a reviewable candidate exists. It is outside the initial implementation Goal:

1. Read the production runbook; recheck live/remote refs, parallel releases, service identity and same-version guard. Select the next free patch at that time, without reserving a version now.
2. Prepare one bounded Yellow envelope covering production branch, exact candidate/allowed descendants, service/environment, release attempts, expiry, permitted QA and rollback. Verify exact-SHA CI again if a version/release commit changes the SHA.
3. Request any required Red settings/secrets/plan changes separately. Query-only changes do not justify a production migration. Keep a justified index proposal separate with migration governance and rollback evidence.
4. Deploy only through `npm run release:railway-up` after authorization. Verify live version, read-only behavior and any specifically authorized disposable QA; retain cleanup evidence.
5. Compare comparable traffic/resource windows, ideally a representative week before and after. Normalize request mix/volume and scheduled jobs. Confirm billing savings from measured resource units and actual usage rather than promising a lower plan based on a benchmark.

The initial Goal may complete with verified local/authorized CI delivery and this separate release proposal. It must state clearly that production performance and billing changes remain unverified until a separately authorized release and observation window.
