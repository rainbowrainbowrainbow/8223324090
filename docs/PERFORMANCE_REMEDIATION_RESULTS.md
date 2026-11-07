# Performance remediation evidence

## Source and scope

The implementation is isolated on `codex/performance-remediation-20261107`. The production branch supplied the clean comparison base `50dee4768720ab3967c38d63ed2a66ad32a7e578`. The pre-existing local candidate was saved as a binary patch and a SHA-256 file inventory in the parent checkout's ignored evidence directory. Use that candidate for comparisons labeled **prior candidate**. Use the clean commit for comparisons labeled **original baseline**.

The test environment was Windows, Node 22.23.4, npm 10.9.9, and a disposable PostgreSQL 17.11 cluster bound to loopback. The customer fixture has 2,500 or 25,000 synthetic customers, 12 bookings per customer, and two business contexts. Full HTTP measurements compare real app processes against the same database and same Kyiv calendar date. Raw local measurements and status logs are under `output/performance-remediation/` in the parent checkout.

## Customer reads

The original list query aggregated booking metrics before pagination. The prior candidate selected the customer page first where the ordering and filters allow it. It still looked up and fully aggregated bookings for every matching customer in autocomplete. PostgreSQL estimated 12 matches when the broad small fixture actually matched 2,000. The new query scans matching booking IDs in a batch, ranks by the existing last visible visit, and calculates full metrics only for the selected customers. Customer, booking, revenue and business scope still use the canonical policy. A digit-subsequence filter skips unnecessary phone normalization and retains the existing exact normalized check for every possible match.

| Warm sequential measurement | Prior → revised p50 (ms) | Prior → revised p95 (ms) | Prior → revised SQL elapsed time per request (ms) | Prior → revised buffer accesses per request |
| --- | ---: | ---: | ---: | ---: |
| List, 2,500 customers | 34.2 → 33.6 | 40.1 → 39.0 | 17.2 → 16.4 | 798 → 798 |
| List, 25,000 customers | 50.2 → 50.0 | 58.4 → 54.9 | 32.7 → 32.3 | 1,172 → 1,172 |
| Broad, 2,500 customers | 570.5 → 126.1 | 631.8 → 145.6 | 569.6 → 118.6 | 28,050 → 1,044 |
| Broad, 25,000 customers | 5342.6 → 1108.6 | 5714.8 → 1295.7 | 5372.5 → 1124.4 | 84,973 → 7,067 |
| Selective, 2,500 customers | 18.6 → 16.9 | 21.3 → 19.5 | 8.2 → 5.2 | 64 → 81 |
| Selective, 25,000 customers | 95.3 → 61.2 | 107.9 → 70.0 | 84.2 → 49.6 | 520 → 557 |

These are medians of three paired runs of 60 requests with eight warm-ups in each run. Every scenario and scale recorded 0/180 HTTP errors per variant. The default list query is unchanged between these two versions. Broad queries contain no phone digits and are unaffected by the later phone-prefilter change. For the mixed selective term on the larger fixture, a separate SQL probe recorded 82.3 ms before the prefilter and 49.6 ms with it, median of three `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)` executions. The higher selective buffer count and lower SQL elapsed time coexist in the measured runs. SQL times are elapsed times.

For the initial clean baseline against the prior candidate on 2,500 customers, the HTTP p50/p95 were 903.8/1082.8 → 34.8/42.7 ms for the default list, 497.8/577.7 → 18.4/26.2 ms for selective search, and 923.7/1030.2 → 574.4/626.4 ms for broad search. Those figures are from a separate comparison with 0/60 errors in each cell. See [the original measurements](CUSTOMER_READS_PERFORMANCE.md) for SQL and reproduction details.

The PostgreSQL regression executes the production query builder on data covering an older visible and a newer invisible booking, cross-business customers and bookings, linked and cancelled records, future visits, and a child-name-only match. The phone case rejects an intervening digit while accepting formatting differences. On the small fixture the response hashes match across the two app versions for pagination, booking-count and date filters, metric sort, another business context, short and empty searches, child name and formatted phone. Unauthorized search returned HTTP 401. Broad order is compared by visit dates because ties have no prior stable ordering.

| Five-client warm run, 60 requests per scenario | Prior candidate p95 | Final query p95 | Prior → final successful requests per second |
| --- | ---: | ---: | ---: |
| Broad, 2,500 customers | 770.5 ms | 181.3 ms | 6.91 → 29.45 |
| Broad, 25,000 customers | 8036.9 ms | 1728.5 ms | 0.72 → 3.42 |
| Selective, 25,000 customers | 205.4 ms | 100.6 ms | See raw comparison |
| List, 25,000 customers | 151.0 ms | 161.1 ms | See raw comparison |

These bounded-load runs completed without HTTP errors and are one pair per scale. The default list query is identical between the prior and final candidates.

Separate five-client runs sampled the app pool counters immediately before and after the benchmark, including login and warm-up. At 2,500 customers both variants had two queued acquisitions, with aggregate observed wait of 8.02 → 6.25 ms. At 25,000 customers the result was six → two queued acquisitions and 201.15 → 6.11 ms. These single paired runs characterize observed pool behavior. The startup and background diagnostic work can affect the exact queue totals.

| First request after a fresh PostgreSQL restart and app startup | Prior candidate | Final query | Prior → final shared reads |
| --- | ---: | ---: | ---: |
| List, 2,500 customers | 160.1 ms | 169.0 ms | 3 → 3 |
| Selective, 2,500 customers | 84.0 ms | 90.6 ms | 2 → 2 |
| Broad, 2,500 customers | 642.3 ms | 204.5 ms | 42 → 44 |
| List, 25,000 customers | 166.0 ms | 186.6 ms | 4 → 4 |
| Selective, 25,000 customers | 156.5 ms | 140.0 ms | 9 → 11 |
| Broad, 25,000 customers | 5755.3 ms | 1501.2 ms | 6,407 → 6,408 |

Each cell is one request and all returned successfully. Startup and fixture checks can warm some shared buffers. The OS filesystem cache was intact. This provides first-request observations without a percentile claim.

### Reproduce locally

Use normal source checkouts with Node 22/npm 10 and all development dependencies installed. Reconstruct the prior candidate by applying the saved patch to a clean worktree of the original baseline if the original checkout is unavailable. Initialize the owned loopback fixtures using the commands in `docs/CUSTOMER_READS_PERFORMANCE.md`. The comparison harness verifies fixture counts, IDs, loopback and the dedicated synthetic login before installing an ephemeral password, restores the prior hash on exit, and starts one app process at a time with a clean child environment.

From the candidate checkout in PowerShell:

```powershell
$env:BENCHMARK_DATABASE_URL = 'postgresql://postgres@127.0.0.1:55439/eventgenix_perf_small_test'
$env:BENCHMARK_CUSTOMER_COUNT = '2500'
$env:BENCHMARK_SAMPLES = '60'
$env:BENCHMARK_REPEATS = '3'
$env:BENCHMARK_CONCURRENCY = '1'
$env:BENCHMARK_PARITY = '1'
$beforeApp = 'D:/path/to/prior-candidate'
$afterApp = (Get-Location).Path
node tests/benchmarks/compare-customer-reads.js $beforeApp $afterApp
```

For the larger fixture use `eventgenix_perf_test`, set customer count to `25000`, and use `BENCHMARK_SCENARIOS=customerSearch` for the mixed-term rerun. For the bounded-load run clear the scenarios and parity overrides and set concurrency to `5`. For first-request samples use one scenario, one sample, zero warm-ups and one version via `BENCHMARK_ONLY_VERSION`. Restart only the owned fixture cluster before each such sample, using its original loopback and port settings. These samples include application startup and fixture validation after restart. The OS cache is left intact.

For the Windows resource run, use the small fixture and a fresh PowerShell session with the same database, customer-count and checkout settings. Set `BENCHMARK_RESOURCE_WINDOW_SECONDS=600`, `BENCHMARK_REPEATS=2` and `BENCHMARK_OUTPUT_FILE` to a new absolute JSONL path, then run the same comparison command. Each app runs an idle and a load window in sequence. The load issues one complete response every 500 ms across the three routes in rotation, with at most five requests in flight. Both variants hold outbound integrations and isolate the foreground from periodic jobs. Run other builds and tests outside these windows.

For the browser trace, use the small fixture in a fresh session and set `BENCHMARK_TRACE_SECONDS=15`, `BENCHMARK_REPEATS=1`, `BENCHMARK_BROWSER_MODULE` to an absolute path to `playwright-core`, and `BENCHMARK_BROWSER_EXECUTABLE` to an absolute path to Chromium. Set `BENCHMARK_TRACE_SCREENSHOT_DIR` to an existing absolute directory to run the 390 px mobile variant. The trace ignores login bootstrap requests, disables the browser cache through routing, blocks non-local traffic, and counts transferred response bodies, including scripts. Reuse the comparison command for each mode with a distinct output file.

## Runtime artifact

The canonical release helper produced a clean tar export of 199,669,760 → 179,650,560 bytes and kept the version manifest, application source and migrations. Its test-directory entries fell from 950 to zero. `railpack.json` changes only the npm install environment in the builder. GitHub and local developer installs retain development dependencies. The archive exclusion follows the normal Git archive path used by the release helper.

| GitHub Linux builder, Railpack 0.43.0 | Before | After |
| --- | ---: | ---: |
| Source file bytes in export | 195,775,965 | 176,830,456 |
| Docker image bytes | 812,362,966 | 774,035,044 |
| Installed dependency bytes | 154,869,674 | 135,342,942 |
| First build, separate install cache namespaces | 52.900 s | 22.461 s |
| Warm rebuild, same builder | 0.742 s | 0.511 s |
| Readiness polling time | 3.060 s | 3.063 s |
| App container memory sampled after smoke | 126.8 MiB | 127.1 MiB |

Both containers passed health, readiness, version, static CSS, synthetic customer create/list/search, Excel export, banquet PDF generation, and native thumbnail-worker checks. The candidate also proved exact SHA and branch via the manifest and asserted absence of the test directory, `jsdom`, and `jsqr`. The workflow runs on packaging-relevant paths and uses a private Docker network with no host ports. First-build time is one paired observation and may include shared base-image pull effects. The sampled database memory is unsuitable for an independent before/after comparison because both runs shared one disposable PostgreSQL process. [Linux builder run](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/42389889245) and [Railpack config](https://railpack.com/config/file).

## Preserved CI coverage

The removed steps repeated existing checks. This change retains the standalone package scripts and keeps the production release, migration, payment, certificate, permissions, My Day, HR and payroll gates.

| Removed invocation | Retained check |
| --- | --- |
| Fast baseline standalone Railway collision test | Same `tests/release-railway-up-predeploy.test.js` through `npm test → verify → test:version-tooling` |
| Certificate scheduler unit invocation | Same scheduler notification and guard files in the explicit fast baseline unit list |
| HR/payroll Education series and acceptance invocation | Same isolated Education `series/chromium` and `acceptance/chromium` suites in the dedicated shards, with cleanup and evidence validation |
| Checkbox migration governance, OpenAPI compatibility and source safety invocations | Same three commands through `npm test → verify`. The wiring contract now asserts that path and the retained Checkbox unit and isolated integration jobs. |
| Repeated direct Today page load in each responsive profile/theme | The initial direct Today load now explicitly verifies active view, rendered cards, session readiness, date and theme before capture. All 14 profile/theme combinations, screenshots, UI actions, accessibility checks and later navigation remain. |

The responsive browser harness logs distinct login, navigation, idle wait, screenshot, layout audit, contrast and check durations. Its contrast audit reuses the same RGBA value for repeated colors within a capture. This changes computation reuse while retaining all contrast thresholds and evidence records.

| Main CI workflow | Original baseline | Verified comparison candidate |
| --- | ---: | ---: |
| Jobs passed | 13/13 | 13/13 |
| Sum of job durations | 4,147 s (69.1 runner minutes) | 3,970 s (66.2 runner minutes) |
| Earliest job start to last job completion | 700 s | 588 s |
| WebKit responsive job | 700 s | 544 s |
| Chromium journey job | 594 s | 588 s |
| HR/payroll PostgreSQL job | 439 s | 405 s |

The comparison candidate was `66277ed4fcf30fd750aabc05d9524410dc3448b5`. The observed sum fell 4.3%, below the 10% target, and the critical path fell 16.0%. These are single hosted observations. Another run without the responsive optimization took 423 seconds for that WebKit step, so the observed critical-path improvement cannot be attributed entirely to this patch. The duplicate checks and repeated initial page requests are removed by construction. [Baseline CI](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/42362422689) and [comparison CI](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/42389889230).

GitHub step timestamps put WebKit responsive at 25 → 24 s for PostgreSQL container setup, 3 → 3 s for npm install, 64 → 61 s for browser installation, 585 → 438 s for the isolated shard and 3 → 3 s for evidence upload. Chromium journey spent 23 → 22 s on the container, 4 → 3 s on npm, 22 → 24 s on the browser and 529 → 520 s on the shard. The HR/payroll job spent 24 → 20 s on the container, 3 → 4 s on npm and 4 → 30 s on its Chromium install. Its duplicate Education step had taken 74 s; the retained attendance/recovery, payroll and onboarding checks took 83 → 83 s, 89 → 94 s and 73 → 77 s respectively. Container startup is measured separately from app-specific migrations and fixture initialization, which run inside the isolated suites. GitHub's timestamps are rounded to seconds, so the shard step is about one second longer than its logged execution time.

Within the 14 verified profiles in the comparison run, WebKit recorded 48 s in login, 61 s navigating via the measured helper, 26 s draining reads there, 54 s taking screenshots, 8 s auditing layout and contrast, and 44 s in checks. The corresponding Chromium phases were 43 s, 77 s, 29 s, 57 s, 8 s, and 28 s. These phase totals omit work outside the timers, including browser actions and initial navigation. Both engine suites retained the complete required evidence. The path-filtered image workflow time is separate from the normal 13-job CI.

The query and artifact tip `bab45c1533f32dcee3002f3223cd8419ac7e7a89` passed the 124 focused tests covering customer query behavior, the Education shard contract and the release collision guard. The owned PostgreSQL permissions run passed 21 tests, including timeline business membership. The customer metrics and birthdays suites passed 2 and 1 tests respectively. The full `npm test` completed in 437.0 seconds with 3,971 passing tests in the main unit batch. The original baseline completed in 512.3 seconds on the same workstation. After the first sidebar revision, the full suite passed in 557.8 seconds. These local observations show run-to-run variation and do not establish a repeatable local suite speedup. Hosted job durations are reported separately.

## Customer page and sidebar

A clean Chromium trace after login captured 58 requests to open the customer page in each query version. It included six booking-day requests from the shared sidebar and one customer list request. Typing one selective term made one more customer request. No further requests were observed in either of the 60-second visible and hidden phases. Headless Chromium kept the tab visible, so the hidden phase exercised the application's visibility handlers with a synthetic visibility event. Browser caching and external requests were disabled for the controlled trace. The open phase transferred about 501 kB of response bodies, including 284 kB of JavaScript. These observations cover the customer page and the observed windows.

Business context, hydration and profile listeners rerendered the sidebar and then forced a timeline summary refresh. The first Group D commit suppresses the ordinary refresh from those renders. The paired browser trace still found six booking reads. Chromium network initiators identified three forced pairs from authenticated-runtime readiness, synchronous business-shell hydration, and the later async business-profile response. `showAuthenticatedPageShell` dispatches the first two from the same call stack, and both pairs used the same Event Genix business and view modes.

The follow-up queues one invalidating refresh per synchronous turn in `js/components/sidebar.js`. It resolves the current scope after synchronous shell updates and retains a fresh request for later async updates. The focused regression exercises coalescing across the readiness/hydration and context/profile event pairs, the resulting scope, and a fresh request on the following turn. All 15 sidebar lifecycle tests passed, including stale reads across business, operator, session and unload transitions. The request endpoints, modes, cache keys, permission checks and stale-response checks are the existing ones.

| Chromium requests through page open and first search | Desktop prior → final | 390 px prior → final |
| --- | ---: | ---: |
| Total completed | 59 → 57 | 59 → 57 |
| Booking-day requests | 6 → 4 | 6 → 4 |
| `animators` / `rooms` reads | 3 / 3 → 2 / 2 | 3 / 3 → 2 / 2 |
| Response body bytes | 501,627 → 499,418 | 501,627 → 499,418 |
| Failed requests | 0 → 0 | 0 → 0 |
| Visible/hidden idle requests | 0 / 0 → 0 / 0 | 0 / 0 → 0 / 0 |

Some bootstrap work landed in the search phase on the final variant, so the table combines both phases. The mobile trace opened and closed the drawer through actual clicks and asserted the `aria-expanded` transitions. The counts were 56 and 49 in both versions. Both screenshots were reviewed. The separate browser attempt to switch to Dar did not settle in the synthetic session and is excluded from the claims. The isolated PostgreSQL permissions and customer checks cover business membership and data scope, and the sidebar lifecycle test covers the client refresh under a changed scope.

## Foreground CPU and memory

Two paired runs alternated order and used the small fixture, 600 seconds idle and 600 seconds at two requests per second. Each load window completed all 1,200 requests with zero errors and zero dropped arrivals. CPU is the observed Windows process counter delta. PostgreSQL accounts for CPU deltas on PIDs present in consecutive samples, which can miss work from a short-lived process. Process working sets can double-count shared pages, so the table reports private bytes separately. Private bytes represent committed memory and do not translate directly to Railway container memory.

| Measurement | Pair 1, prior → revised | Pair 2, prior → revised |
| --- | ---: | ---: |
| Node CPU, idle/load (seconds) | 0.39/9.72 → 0.16/9.63 | 0.23/9.42 → 0.25/9.63 |
| Observed PostgreSQL CPU, idle/load (seconds) | 0.03/198.50 → 0.02/48.36 | 0.02/197.75 → 0.02/48.36 |
| Incremental combined CPU per 1,000 requests (seconds) | 173.16 → 48.18 | 172.44 → 48.10 |
| Node RSS, idle/load (MiB) | 92.9/125.1 → 94.8/125.7 | 96.5/128.1 → 95.3/126.9 |
| Node heap used, idle/load (MiB) | 48.7/56.1 → 48.9/56.0 | 48.9/56.7 → 48.9/56.3 |
| Node external memory, idle/load (MiB) | 2.60/3.30 → 2.61/3.32 | 2.61/3.27 → 2.61/3.30 |
| PostgreSQL private bytes, idle/load (MiB) | 19.5/35.1 → 19.4/31.5 | 19.4/34.9 → 19.4/31.4 |
| Incremental Node RSS over load window (MiB-minutes) | 322.8 → 308.8 | 317.0 → 316.1 |
| Pool queued acquisitions / total queued time (ms) | 18/719.6 → 18/812.1 | 18/473.3 → 18/1058.8 |
| Customer SQL statements, load | 2,800 → 2,800 | 2,800 → 2,800 |

The median of per-interval event loop p95s was approximately 32.2–32.3 ms throughout. Idle statement counts were zero with schedulers held. Customer statements fell from 243.6–244.6 to 55.4–56.4 seconds of total SQL elapsed time at the same statement count. The CPU improvement repeated across both pairs. Node memory and event loop measurements show no clear reduction, and queue duration rose in these fixed-rate windows despite unchanged queue count. The five-client burst in the customer section measures a different arrival pattern.

## Background jobs

The real scheduler registry ran for a 600-second window after app readiness against a fresh clone of the small fixture, with a loopback network guard and no external credentials. `tests/benchmarks/profile-customer-schedulers.js` attributes `pg` calls to the scheduler guard or job via async context and reports unassigned calls separately. The app used 1.27 CPU seconds during this window. This counter includes Node work and excludes PostgreSQL CPU.

| Job | Timer ticks | Actual executions | Guard queries | Work queries |
| --- | ---: | ---: | ---: | ---: |
| `checkEventPipeline` | 10 | 2 | 3 | 1,081 |
| `checkScheduledChatMessages` | 20 | 20 | 38 | 61 |
| `checkAttendanceReviewTasks` | 10 | 10 | 18 | 61 |
| `checkEventQueue` | 10 | 10 | 21 | 39 |
| `checkAutoBackup` | 10 | 10 | 20 | 10 |

The busiest job in `services/scheduler.js` emitted 120 synthetic lifecycle events in two batches of three stages, with the default seed rules configured in `db/migrations/124_operations_intelligence.sql`. Database-wide `pg_stat_statements` for the scheduler fixture recorded six pipeline selects, 120 queue inserts, 120 stage markers, 120 event state transitions and 240 rule-audit reads/writes. The marker writes accounted for 333 ms of SQL elapsed time across the sample. The per-event markers preserve durable progress, and `services/eventBus.js` reads active rules and records individual action outcomes. Reusing a stale rule snapshot, delaying progress markers or lowering polling frequencies would change behavior. The profile identifies the job and its round trips without demonstrating a material redundant workload that warrants a scheduler change. The number of due events and external work in production require separate telemetry.

To reproduce, confirm the same owned loopback server and create a fresh `eventgenix_perf_scheduler_test` database from `eventgenix_perf_small_test` while no app uses the template. Set `BENCHMARK_SCHEDULER_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/eventgenix_perf_scheduler_test` and `BENCHMARK_SCHEDULER_SECONDS=600`, then run `node tests/benchmarks/profile-customer-schedulers.js` from the candidate checkout. The probe verifies the expected synthetic customer/booking counts and starts the app with a clean child environment. Keep the separate profiler output and statement summary with the run evidence.

## Railway usage and production handoff

The actual Railway project usage from 2026-09-30 to 2026-10-30 was $15.23. The CRM and its main PostgreSQL service accounted for $8.31, including $7.83 of memory and $0.21 of CPU. The current period from 2026-10-30 to 2026-11-30 had accrued $3.91 for the project and $2.45 for that pair as of 2026-11-07. The workspace showed $33.31 of prior-period usage, $9.13 accrued in the current period and a $20.20 forecast at the time of inspection. Separately, 337 Railway samples per service in the preceding 168 hours averaged 0.321 GB for the app and 0.479 GB for PostgreSQL. Image size, process memory, SQL elapsed time and billed resource units are separate measurements.

At $0.000463 per vCPU-minute, the local difference of 124–125 CPU seconds per 1,000 requests corresponds to about $0.00096 per 1,000 requests for this synthetic mix, before included usage. The estimate assumes the same CPU-seconds transfer to the production service. Production CPU, resident container memory, traffic mix, the invoice and cheaper-plan eligibility remain to be measured. [Railway pricing](https://docs.railway.com/pricing/plans).

The separate [production proposal](PERFORMANCE_PRODUCTION_PROPOSAL.md) identifies the target and rollback reference, version and CI gates, live QA scope, matched observation windows, and the conditions for a separate plan or settings review. No production migration is required by the query change.

## Independent rollback

Review current diffs before reverting. Revert only the selected group in reverse commit order.

| Group | Files | Revert order |
| --- | --- | --- |
| A — Customer reads | `routes/customers.js`, `services/customerBookingMetrics.js`, `services/customerSearchQuery.js`, `tests/customer-booking-metrics.test.js`, `tests/customer-search-query.test.js`, `tests/integration/customer-booking-metrics-postgres.test.js` | `0267a169`, then `04fcf005` |
| B — CI | `.github/workflows/ci.yml`, `tests/payment-readiness.test.js`, `tests/browser/education-close-ux-browser.js` | `66277ed4`, `505b9e27`, then `6503400a` |
| C — Packaging | `.gitattributes`, `railpack.json`, `.github/workflows/runtime-artifact.yml`, `tests/benchmarks/runtime-artifact-smoke.js` | `bab45c15`, `ea2786e2`, then `34e884e7` |
| D — Sidebar | `js/components/sidebar.js`, `tests/education-sidebar-read-lifecycle.test.js` | `10863d0f`, then `1b0ee09e` |
| E — Evidence | `docs/CUSTOMER_READS_PERFORMANCE.md`, `docs/PERFORMANCE_PRODUCTION_PROPOSAL.md`, `docs/PERFORMANCE_REMEDIATION_PLAN.md`, `docs/PERFORMANCE_REMEDIATION_RESULTS.md`, `tests/benchmarks/compare-customer-reads.js`, `tests/benchmarks/customer-page-trace.js`, `tests/benchmarks/customer-reads.js`, `tests/benchmarks/customer-reads.sql`, `tests/benchmarks/customer-resource-probe.js`, `tests/benchmarks/profile-customer-schedulers.js` | Retain for historical context. Remove only via a separate evidence revert if needed. |

After A run the focused customer and isolated PostgreSQL tests. After B run the coverage wiring and both browser shards. After C rebuild the clean export and run artifact smoke. After D run the sidebar lifecycle checks and browser trace with the two timeline modes. A local revert does not change the deployed service.
