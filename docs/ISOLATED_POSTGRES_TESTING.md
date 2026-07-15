# Isolated PostgreSQL tests

DB-backed API and HR integration tests must run only against a disposable PostgreSQL database. The runner never falls back from `TEST_DATABASE_URL` to the application `DATABASE_URL`.

## Safety contract

The test database must meet all of these conditions:

- `TEST_DATABASE_URL` is set explicitly;
- the database name contains a separate `test`, `testing`, `ci`, or `disposable` marker;
- `TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE` is set;
- the URL does not match `DATABASE_URL`, `PRODUCTION_DATABASE_URL`, or `LIVE_DATABASE_URL`;
- neither the host nor database name contains an explicit `prod`, `production`, or `live` marker;
- the process is not running under Railway or `NODE_ENV=production`;
- the HTTP test target is a local server started by the runner.

The runner executes `DROP SCHEMA public CASCADE` before and after every suite. Never point it at a database that contains data you need.

Remote test databases are blocked by default. An explicitly disposable remote database additionally requires:

```text
TEST_DATABASE_ALLOW_REMOTE=ALLOW_REMOTE_DISPOSABLE_TEST_DATABASE
```

Railway-like hosts stay blocked even with that confirmation. Do not change Railway settings or production secrets for this flow.

## Local PowerShell example

Create an empty local database such as `eventgenix_test`, then run:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:<local-password>@127.0.0.1:5432/eventgenix_test'
$env:TEST_DATABASE_RESET_CONFIRM = 'RESET_DISPOSABLE_TEST_DATABASE'
npm run test:api:isolated
```

Available commands:

```text
npm run test:api:isolated
npm run test:integration:attendance-lock:isolated
npm run test:integration:backup-recovery:isolated
npm run test:integration:hr-disposable:isolated
npm run test:integration:hr-onboarding:isolated
npm run test:integration:hr-legacy-backfill:isolated
npm run test:integration:live-multi-segment-qa:isolated
npm run test:db:isolated
```

Each suite gets a clean schema. The runner starts the CRM on a random local port, applies startup initialization and all SQL migrations, creates a temporary creator login, runs the test, stops the server, and resets the schema again.

The live multi-segment QA mode first verifies the marker-bound attendance/cleanup helper and then runs the same end-to-end command used after deploy. It remains fully local and uses the disposable database; it does not contact production.

The runner verifies the complete `schema_migrations` inventory after the
standard startup and fails immediately if any migration is still pending. It
never inserts migration markers manually. The separate fresh-database startup
suite covers restart/idempotency behavior where that proof is required.

The default per-suite timeout is 15 minutes. For a slower local machine it can be changed explicitly with `ISOLATED_TEST_TIMEOUT_MS`.

The API smoke file is a stateful CRUD suite with shared far-future fixtures. The isolated runner uses Node's `--test-concurrency=1` so top-level suites cannot overwrite each other's lines, bookings, or schedule rows.

For focused diagnosis only, `ISOLATED_TEST_NAME_PATTERN` is passed to Node's `--test-name-pattern`; omit it for acceptance verification.

The legacy commands remain available when a server is already running:

```text
npm run test:api
npm run test:integration:hr-disposable
```

`test:integration:hr-disposable` now creates and archives its own staff fixtures, but it also requires the verification marker injected by the isolated runner, `REQUIRE_ISOLATED_TEST_TARGET=true`, and a local `TEST_URL`. Prefer the isolated wrapper command. Do not run global HR copy-week integration against production. Live verification must use a separate safe QA runner with explicit test staff/date scope or dry-run behavior.

## Failure and cleanup behavior

- Migration verification fails if any SQL migration is absent from `schema_migrations`.
- HR fixtures are filtered by their exact staff IDs; unrelated rows do not affect assertions.
- Created shift IDs are registered before detailed assertions whenever the API exposes or allows them to be read.
- The HR suite deletes discovered fixture shifts and archives fixture staff in its `after` hook.
- A fixture cleanup failure fails the suite separately.
- A runner-level cleanup failure takes precedence and includes the original test failure in its message.
