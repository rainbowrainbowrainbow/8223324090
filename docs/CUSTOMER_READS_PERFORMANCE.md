# Customer reads and CI performance

The baseline is `50dee4768720ab3967c38d63ed2a66ad32a7e578`. The comparison used Windows, Node 22.23.4, npm 10.9.9 and PostgreSQL 17.11. Both versions used the same loopback database with 2,500 synthetic customers and 30,000 bookings across Event Genix and Dar. Each scenario had eight warm-up requests followed by 60 sequential HTTP requests. The client read the entire response with compression disabled. Run the two versions on the same Kyiv calendar day because visit metrics depend on that date.

| Request | HTTP p50, ms | HTTP p95, ms | Errors | Matching SQL execution, ms/request | Shared buffer accesses/request |
| --- | ---: | ---: | ---: | ---: | ---: |
| Customer list, 50 rows | 903.8 → 34.8 | 1082.8 → 42.7 | 0/60 → 0/60 | 915.6 → 17.5 | 701 → 798 |
| Selective autocomplete, one match | 497.8 → 18.4 | 577.7 → 26.2 | 0/60 → 0/60 | 494.4 → 8.7 | 653 → 64 |
| Broad autocomplete, 2,000 matches before limit | 923.7 → 574.4 | 1030.2 → 626.4 | 0/60 → 0/60 | 922.8 → 570.3 | 653 → 28,050 |

`pg_stat_statements` measures elapsed execution for statements containing `FROM customers c`. It excludes other API work. Shared buffer accesses count both hits and reads, including repeated hits to the same block. The list and selective search responses had identical SHA-256 digests. The broad search returned 20 rows with the same ordered last-visit dates and response size. The existing ordering leaves ties unspecified.

`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)` showed that the original default list scanned and aggregated all 18,000 qualifying booking rows before applying `LIMIT`. Its nested loop rejected 1,999,000 join pairs. The revised query selected the 50 customers first and used the existing booking customer index, averaging nine qualifying bookings for each selected customer. A selective search used one indexed booking lookup. The broad search uses that lookup for each match, which explains the higher buffer count. Sorting and filtering the list by booking metrics still requires those metrics before pagination.

## Reproduce the HTTP comparison

Use two local copies with dependencies installed under Node 22 and npm 10. Run from the candidate repository root in a shell with PostgreSQL client tools. Use a fresh disposable PostgreSQL cluster listening on `127.0.0.1:55439` with `pg_stat_statements` in `shared_preload_libraries`. Use source copies free of `.env` files and inherited production integration settings.

```sh
git worktree add --detach ../customer-perf-baseline 50dee4768720ab3967c38d63ed2a66ad32a7e578
(cd ../customer-perf-baseline && npm ci)
npm ci

export PGHOST=127.0.0.1 PGPORT=55439 PGUSER=postgres PGSSLMODE=disable
export PGDATABASE=eventgenix_perf_small_test DATABASE_URL= NODE_ENV=test
export BACKUP_OUTBOUND_HOLD=true PAYMENT_OUTBOX_WAKEUP_DISABLED=true
export SKIP_TELEGRAM_BOT_STARTUP_CONFIG=true RATE_LIMIT_MAX=10000
export BOOTSTRAP_CREATOR_USERNAME=bench_creator
export BOOTSTRAP_CREATOR_PASSWORD="$(node -p 'require("node:crypto").randomBytes(24).toString("hex")')"
export JWT_SECRET="$(node -p 'require("node:crypto").randomBytes(64).toString("hex")')"
export BENCHMARK_DATABASE_URL=postgres://postgres@127.0.0.1:55439/eventgenix_perf_small_test

createdb "$PGDATABASE"
(cd ../customer-perf-baseline && PORT=55442 node server.js)
```

Once `/api/ready` reports `ok`, use a second terminal with the same environment to load the fixture and run the baseline. Then stop the baseline and start the candidate in its place. Keep the PostgreSQL process and fixture running between measurements.

```sh
psql -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
psql -f tests/benchmarks/customer-reads.sql
BENCHMARK_URL=http://127.0.0.1:55442 node tests/benchmarks/customer-reads.js > before.json

# Run in the candidate repository and leave it running while measuring.
PORT=55443 node server.js

# Run in the second terminal after the candidate is ready.
BENCHMARK_URL=http://127.0.0.1:55443 node tests/benchmarks/customer-reads.js > after.json
```

For a larger fixture on a separate empty database, pass `-v customer_count=25000` to `psql -f` and `BENCHMARK_CUSTOMER_COUNT=25000` to the benchmark. `BENCHMARK_WARMUP` and `BENCHMARK_SAMPLES` control the run size. The fixture loader temporarily skips rebuilding legacy counters inside its transaction. The production endpoints compute live metrics independently of those counters.

## CI coverage retained

| Removed CI invocation | Coverage still executed on every push and pull request |
| --- | --- |
| Railway pre-deploy collision guard step | Same file in `npm test` → `verify` → `test:version-tooling`, within the same job |
| Certificate scheduler step | `scheduler-notification-jobs-hardening.test.js` and `scheduler-guard-contract.test.js` in `npm test` → `test:unit`. The certificate job keeps its database, browser and legacy Telegram tests. |
| Education series step in HR/payroll | `series/chromium` in `chromium-core` executes the same 18 tests. `acceptance/chromium` in `chromium-journey` executes the same 11 tests. Each wrapper validates the TAP results and disposable cleanup. |
| Checkbox migration, OpenAPI compatibility and source safety steps | `check:migrations`, `check:checkbox-openapi` and `check:checkbox-safety` in `npm test` → `verify`. The Checkbox job keeps its thin unit and PostgreSQL/browser suites. |

In the baseline, the 74-second duplicate Education step included about 27 seconds for browser setup, 35 seconds for the two test processes, and about 12 seconds for fixture setup, app startup, cleanup and wrapper overhead. The HR onboarding browser step still needs Chromium, so its later install will absorb most of the setup time. The estimated reduction is about 0.9 aggregate runner minutes per workflow run, from 69.1 to roughly 68.2 minutes. The slowest jobs were WebKit responsive at 700 seconds, Chromium journey at 594 seconds, and HR/payroll at 439 seconds. The Education shards still determine the overall completion time in this run. [Baseline Actions run 42362422689](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/42362422689)

```sh
npm test
node --test tests/customer-booking-metrics.test.js tests/customer-search-query.test.js
node --test tests/education-ci-shard.test.js tests/release-railway-up-predeploy.test.js
```

For the two retained Education invocations, prepare a separate local disposable `eventgenix_education_ready_fixture_test` database and set `TEST_DATABASE_URL` to that loopback database and `TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE`.

```sh
npm exec --yes --package=playwright -c 'playwright install chromium'
npm exec --yes --package=playwright -c 'node tests/integration/run-education-close-ci.js series chromium'
npm exec --yes --package=playwright -c 'node tests/integration/run-education-close-ci.js acceptance chromium'
```

The Railway build for the baseline took about 36 seconds from the first to the last build log entry. Railpack used `npm install` and `npm run start`, copied the source and `node_modules`, and showed no app build, test or dependency pruning step. The tracked source export includes 18,946,032 bytes under `tests/`. Railpack v0.43.0 defaults to installing development dependencies and prunes them only when configured. A production image packaging change should be verified separately with an image inventory and isolated startup. [Railpack v0.43.0 Node provider](https://github.com/railwayapp/railpack/blob/v0.43.0/core/providers/node/node.go#L2351)

Two clean local production-only installs with the warmed npm cache took 30.9 and 32.7 seconds with identical package and lockfile contents. Use `npm ci --omit=dev --offline --no-audit --no-fund` in separate empty staging directories after warming the cache. These timings measure installation on Windows. A local install with Railpack's default environment (`NODE_ENV=production NPM_CONFIG_PRODUCTION=false`) included `jsdom` and `jsqr` and occupied 136.3 MB, compared with 116.8 MB using `--omit=dev`.

Compare release candidates against exact-SHA CI and compare endpoint traffic, PostgreSQL CPU and memory, and Railway usage over comparable windows after any separately approved deployment. These changes need no schema migration.
