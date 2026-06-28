# PostgreSQL CI Discovery

Date: 2026-06-28
Status: discovery report, no CI changes
Task: `SYSTEM_OPTIMIZATION_DETAILED_TASKS_2026-06-28.md` Task 02
Production impact: none from this document; future CI implementation has
protected CI/DB impact and needs explicit confirmation.

## Summary

Event Genix CI currently runs one fast baseline job:

- Node version comes from `.node-version`.
- npm is aligned to `10.9.8`.
- dependencies install with `npm ci`.
- verification is `npm test`.

That fast baseline is useful and green, but it does not start PostgreSQL and
does not run live API tests. The next CI improvement should be a separate
PostgreSQL-backed job, not a replacement for the fast baseline.

Recommended first DB CI slice:

1. Start an ephemeral PostgreSQL service.
2. Start the app against that DB with CI-only local seed credentials.
3. Wait for `/api/ready`.
4. Run authenticated local smoke:

   ```bash
   npm run smoke:live -- http://127.0.0.1:3000
   ```

5. Run focused account-access API smoke:

   ```bash
   npm run test:api:account-access
   ```

Do not start with full `npm run test:api` or `npm run test:integration`.
`tests/api.test.js` is valuable, but it is a broad 4k+ line live API suite with
many domain mutations and seed assumptions. It should be a second-phase CI
suite after the first DB job is stable.

## Evidence Collected

Commands run:

```bash
git status --short --branch
rg -n "TEST_URL|TEST_USER|TEST_PASS|DATABASE_URL|PGHOST|loadLocalEnv|listen\(|localhost:3000" tests scripts db routes README.md utils package.json
npx -y -p node@22 -p npm@10 -c "npm test"
```

`npm test` result:

- passed on Node 22.23.1 / npm 10.9.8;
- package version during this run: `0.77.44`;
- version references in sync;
- API surface check passed: 84 route files, 85 route mounts, 2 server-level API
  routes;
- migration governance check passed;
- JavaScript syntax check passed: 578 files;
- UI smoke reported 1078 passed / 0 failed.

Not run:

- `npm run test:api`;
- `npm run test:integration`.

Reason: these require a confirmed isolated running app/database and test
credentials. Running them against an unknown local server or real database would
risk mutating non-disposable data.

## Current CI Baseline

Source: `.github/workflows/ci.yml`.

Current job:

- job name: `Fast baseline`;
- runner: `ubuntu-latest`;
- timeout: 15 minutes;
- Node setup: `actions/setup-node@v4` with `.node-version`;
- npm alignment: `npm install -g npm@10.9.8`;
- install: `npm ci`;
- command: `npm test`.

What it covers:

- runtime alignment;
- version references;
- access and auth-boundary manifests;
- static/CSS/theme/API/storage/service-worker/scheduler/DB-startup surface
  manifests;
- static migration governance;
- JavaScript parser check;
- self-contained unit tests;
- static/jsdom UI smoke.

What it does not cover:

- real PostgreSQL connection;
- DB migrations executed against an empty database;
- server startup against a real DB;
- authenticated live API flows;
- route behavior that depends on persisted data;
- live smoke against `/api/ready` and `/api/health/deep`.

## Runtime And App Startup Facts

Relevant files:

- `server.js`
- `db/index.js`
- `db/migrate.js`
- `utils/loadLocalEnv.js`
- `utils/validateEnv.js`
- `db/userSeedPolicy.js`

Findings:

- `server.js` calls `loadLocalEnv(__dirname)` before loading DB/auth modules.
- `server.js` validates env, builds the Express app, and starts listening
  directly on `PORT || 3000`.
- `server.js` does not export an app factory for `tests/api.test.js`.
- Startup DB flow is:

  ```text
  initDatabase() -> runMigrations(pool) -> initDatabase()
  ```

- `db/migrate.js` can be run standalone, but normal server startup already
  runs migrations.
- `db/index.js` uses `DATABASE_URL` when set, otherwise standard `pg` env vars.
- `validateEnv()` warns if DB env is missing and requires `JWT_SECRET` only in
  production.
- `ALLOW_DEV_USER_SEED=true` can create a local-only creator user when not in a
  production-like environment.
- `ALLOW_DEV_USER_SEED` is blocked when `NODE_ENV=production` or Railway env
  markers exist.

Implication for CI:

- The DB CI job should start `node server.js` as a process.
- The job must set `DATABASE_URL`, `JWT_SECRET`, `PORT`, `TEST_URL`,
  `TEST_USER`, and `TEST_PASS`.
- The job can use `ALLOW_DEV_USER_SEED=true` with `DEV_SEED_ADMIN_*` values for
  an ephemeral CI-only creator user.
- The job must not use production credentials or production DB URLs.

## Live API Test Entry Points

### `tests/helpers.js`

Shared live API helper behavior:

- `BASE_URL = process.env.TEST_URL || 'http://localhost:3000'`;
- `TEST_USER = process.env.TEST_USER`;
- `TEST_PASS = process.env.TEST_PASS`;
- `getToken()` throws if `TEST_USER` or `TEST_PASS` is missing;
- authenticated requests login through `/api/auth/login`.

Implication:

- Any test using `authRequest()` or `getToken()` requires a running app and
  credentials.
- Public-only tests using `request()` may still assume an app at `TEST_URL`.

### `npm run test:api`

Command:

```bash
node --test tests/api.test.js
```

Requirements:

- running app at `TEST_URL` or `http://localhost:3000`;
- PostgreSQL-backed app;
- valid `TEST_USER` and `TEST_PASS`;
- test user must have broad permissions, effectively creator/admin-level.

Coverage:

- auth;
- health/stats;
- lines;
- bookings CRUD and validation;
- afisha;
- settings;
- history;
- Telegram/digest/reminder surfaces;
- tasks;
- staff and staff schedule;
- CRM customers;
- finance;
- analytics;
- budget;
- procurement;
- exports;
- HR;
- reports;
- finance accounts.

Risk:

- broad data mutations across many domains;
- requires active staff and animator-like staff for some scenarios;
- assumes seeded finance accounts and categories;
- can leave data behind if a later assertion aborts cleanup;
- too large for the first new CI job.

Recommendation:

- Do not add to first DB CI job.
- Add as Phase 2 after DB startup smoke is stable and fixture cleanup is
  documented.

### `npm run test:api:account-access`

Command:

```bash
node --test tests/api-account-access.test.js
```

Requirements:

- running app at `TEST_URL` or `http://localhost:3000`;
- PostgreSQL-backed app;
- creator/director-capable `TEST_USER`;
- valid `TEST_PASS`.

Coverage:

- direct account center API access;
- user creation boundaries;
- HR/director permission boundaries;
- staff/account linking boundaries;
- `/checkin.html` auth guard presence.

Risk:

- creates users and staff rows;
- has cleanup for created user IDs and staff ID;
- narrower than `tests/api.test.js`.

Recommendation:

- Good first DB CI test after local smoke.

### `npm run test:integration`

Command:

```bash
node --test tests/*.test.js
```

Requirements:

- everything required by all top-level tests.

Risk:

- too broad for first CI DB job;
- mixes self-contained unit tests, static tests, live API tests, and older
  domain smoke files;
- includes live helper users and broad DB mutation suites;
- duplicates much of `npm test` while also adding live suites.

Recommendation:

- Do not add to CI as the first DB job.
- Consider a later scheduled/manual job only after live tests are classified.

### Other Live Helper Tests

The following top-level tests reference `tests/helpers.js` or live env names and
should be treated as live/API candidates, not first-slice CI defaults:

- `tests/afisha.test.js`
- `tests/art-director.test.js`
- `tests/api.test.js`
- `tests/analytics.test.js`
- `tests/api-account-access.test.js`
- `tests/automation.test.js`
- `tests/auth-refresh.test.js`
- `tests/backup.test.js`
- `tests/board.test.js`
- `tests/center.test.js`
- `tests/certificates.test.js`
- `tests/contractors.test.js`
- `tests/customers.test.js`
- `tests/dashboard-widgets.test.js`
- `tests/decisions.test.js`
- `tests/demo.test.js`
- `tests/designs.test.js`
- `tests/event-queue.test.js`
- `tests/employees.test.js`
- `tests/finance.test.js`
- `tests/graduation.test.js`
- `tests/gamification.test.js`
- `tests/hr.test.js`
- `tests/kleshnya.test.js`
- `tests/leads.test.js`
- `tests/loyalty.test.js`
- `tests/music.test.js`
- `tests/our-fixes.test.js`
- `tests/packages.test.js`
- `tests/page-statuses.test.js`
- `tests/points.test.js`
- `tests/print.test.js`
- `tests/procurement.test.js`
- `tests/products.test.js`
- `tests/sales.test.js`
- `tests/sales-funnel.test.js`
- `tests/scripts.test.js`
- `tests/search.test.js`
- `tests/staff.test.js`
- `tests/status.test.js`
- `tests/support.test.js`
- `tests/svitlana.test.js`
- `tests/tasks.test.js`
- `tests/task-templates.test.js`
- `tests/telegram.test.js`
- `tests/training.test.js`
- `tests/users.test.js`
- `tests/v40-features.test.js`
- `tests/vacancies.test.js`
- `tests/wallet-shop.test.js`
- `tests/warehouse.test.js`
- `tests/workers.test.js`

Some tests, such as `tests/customers.test.js` and `tests/sales-funnel.test.js`,
skip live describe blocks when `TEST_USER`/`TEST_PASS` are missing. Others do
not skip and will fail as soon as `authRequest()` is used without credentials.

## Environment Matrix For First DB CI Job

Use only CI-local values and an ephemeral PostgreSQL service.

| Variable | Example | Required | Reason |
| --- | --- | --- | --- |
| `NODE_ENV` | `test` | yes | Keeps environment non-production-like so local dev seed is allowed. |
| `PORT` | `3000` | yes | Stable local app URL for tests. |
| `DATABASE_URL` | `postgres://postgres:postgres@127.0.0.1:5432/event_genix_test` | yes | App and migrations connect to ephemeral CI PostgreSQL. |
| `JWT_SECRET` | long CI-only random string | yes | Stable auth tokens during test run. |
| `ALLOW_DEV_USER_SEED` | `true` | yes | Allows local-only seed in non-production CI. |
| `DEV_SEED_ADMIN_USERNAME` | `ci_creator` | yes | Seeded test user. |
| `DEV_SEED_ADMIN_PASSWORD` | CI-only password, 8+ chars | yes | Seeded test password. |
| `DEV_SEED_ADMIN_ROLE` | `creator` | yes | Required for broad account/admin flows. |
| `DEV_SEED_ADMIN_NAME` | `CI Creator` | optional | Human label. |
| `TEST_URL` | `http://127.0.0.1:3000` | yes | Shared live API helper base URL. |
| `TEST_USER` | `ci_creator` | yes | Live API login user. |
| `TEST_PASS` | same as seed password | yes | Live API login password. |
| `LIVE_SMOKE_URL` | `http://127.0.0.1:3000` | optional | Alternative to passing URL arg. |

Do not set:

- production `DATABASE_URL`;
- production `TEST_USER`/`TEST_PASS`;
- Railway environment markers;
- real Telegram/report-bot/provider secrets.

## First CI Job Proposal

Name:

```text
postgres-api-smoke
```

Shape:

1. Checkout.
2. Setup Node from `.node-version`.
3. Align npm to `10.9.8`.
4. Start PostgreSQL service.
5. Install with `npm ci`.
6. Run:

   ```bash
   npm run check:runtime
   npm run check:migrations
   ```

7. Start app:

   ```bash
   node server.js
   ```

   with env from the matrix above.

8. Wait until `/api/ready` returns success.
9. Run:

   ```bash
   npm run smoke:live -- http://127.0.0.1:3000
   npm run test:api:account-access
   ```

10. Always stop the server process.

Why this first:

- It proves real DB connectivity.
- It proves startup `initDatabase -> migrations -> initDatabase`.
- It proves `/api/version`, `/api/health`, `/api/ready`, and
  `/api/health/deep`.
- It proves authenticated bookings/lines/leads smoke through `smoke:live`.
- It proves account-access boundaries with a focused live API test.
- It avoids the full mutation blast radius of `tests/api.test.js`.

## Phase 2 CI Candidates

Add only after first DB job is green and stable:

1. `npm run test:api`
   - high value;
   - broad mutation surface;
   - needs cleanup strategy and stable seed assumptions.

2. Focused live API shards:
   - `node --test tests/finance.test.js`
   - `node --test tests/tasks.test.js`
   - `node --test tests/leads.test.js`
   - `node --test tests/products.test.js`
   - `node --test tests/event-queue.test.js`

3. Full `npm run test:integration`
   - only as manual/scheduled job until classified;
   - not recommended for push/pull_request first pass.

## Rejected For First Slice

| Candidate | Decision | Reason |
| --- | --- | --- |
| `npm run test:api` | defer | Broad live suite with many domain mutations and seed assumptions. |
| `npm run test:integration` | reject for first slice | Runs every top-level test, mixing unit/static/live suites and old broad API tests. |
| `tests/certificates.test.js` | defer | Live API mutations and cleanup; good later focused shard. |
| `tests/customers.test.js` | defer | Live customer/tag lifecycle; some migrations/capabilities may skip parts. |
| `tests/sales-funnel.test.js` | defer | Mixed static local regression plus live lead/customer/payment flows. |
| `tests/event-queue.test.js` | defer | Useful but writes event/rule state; add after base DB smoke. |
| Real production smoke | reject | Must not be used for CI PR job. |

## Open Questions Before CI Edit

- Should first DB CI job run on every push/PR or only pull requests?
- What timeout is acceptable for PostgreSQL startup plus app boot?
- Should app server logs be uploaded as an artifact on failure?
- Should the job use `ALLOW_DEV_USER_SEED=true` or explicit
  `BOOTSTRAP_CREATOR_*`?
- Should the first DB job run after fast baseline or in parallel?
- Does CI need a deterministic cleanup command for live test rows before Phase
  2 broad API suites?

## Protected Implementation Task

Only after explicit confirmation, create a new CI job in
`.github/workflows/ci.yml`:

- add PostgreSQL service;
- set CI-local DB/auth/test env vars;
- start `node server.js` in background;
- wait for readiness;
- run `npm run smoke:live -- http://127.0.0.1:3000`;
- run `npm run test:api:account-access`;
- keep the existing fast baseline unchanged.

Do not change production deployment configuration.
Do not add dependencies.
Do not use production secrets.

## Acceptance Check

This discovery is complete when:

- exact first CI candidate commands are named;
- required env vars are named;
- broad suites are explicitly deferred;
- no CI file is edited;
- no production DB or credentials are used;
- verification for this docs-only change passes.

## Verification

Run for this document:

```bash
git diff --check -- docs/POSTGRES_CI_DISCOVERY_2026-06-28.md
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
```
