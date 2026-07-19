# Isolated PostgreSQL tests

DB-backed API, HR, payroll, admission, and QA integration tests must run only against a disposable PostgreSQL database. The runner never falls back from `TEST_DATABASE_URL` to the application `DATABASE_URL`.

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

## Windows one-command payroll gate

On Windows with Docker Desktop already installed and running, run this from the repository root:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-local-payroll-postgres-gate.ps1
```

The helper:

- runs `npm run check:runtime` first;
- checks Docker CLI and the Docker daemon before starting any database work;
- starts a uniquely named `postgres:16` container with EventGenix disposable labels;
- binds PostgreSQL only to `127.0.0.1` on a random host port;
- uses tmpfs for the PostgreSQL data directory and does not create a persistent database volume;
- waits for the Docker healthcheck to report healthy;
- passes `TEST_DATABASE_URL` and `TEST_DATABASE_RESET_CONFIRM` only to the child npm process;
- runs the canonical payroll command: `npm run test:integration:payroll-profiles:isolated`;
- removes only the container it created, and only after verifying the expected disposable labels.

The helper does not install Docker, read production/live secrets, print the password or connection URL, use `DATABASE_URL`, delete unknown containers, or connect to a remote database. A test failure or cleanup failure returns a non-zero exit code.

## Canonical payroll-only command

If you already have a disposable local PostgreSQL database, the canonical payroll command remains:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:<local-disposable-password>@127.0.0.1:5432/eventgenix_test'
$env:TEST_DATABASE_RESET_CONFIRM = 'RESET_DISPOSABLE_TEST_DATABASE'
npm run test:integration:payroll-profiles:isolated
Remove-Item Env:\TEST_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:\TEST_DATABASE_RESET_CONFIRM -ErrorAction SilentlyContinue
```

Use a database created only for tests. The runner will reset schema `public` with `DROP SCHEMA public CASCADE` before and after the suite.

## Manual Docker fallback

Use this only for diagnosis when the one-command helper is not suitable. Choose a local disposable password and do not reuse production credentials.

```powershell
$container = 'eventgenix-payroll-pg-manual'
$dbPass = '<local-disposable-password>'
docker run --detach --name $container `
  --label com.eventgenix.disposable=true `
  --label com.eventgenix.purpose=manual-payroll-postgres-gate `
  --publish 127.0.0.1:55432:5432 `
  --tmpfs /var/lib/postgresql/data:rw `
  --env POSTGRES_USER=postgres `
  --env POSTGRES_PASSWORD=$dbPass `
  --env POSTGRES_DB=eventgenix_disposable_test `
  --health-cmd "pg_isready -U postgres -d eventgenix_disposable_test" `
  --health-interval 2s `
  --health-timeout 2s `
  --health-retries 60 `
  postgres:16

$env:TEST_DATABASE_URL = "postgresql://postgres:$dbPass@127.0.0.1:55432/eventgenix_disposable_test"
$env:TEST_DATABASE_RESET_CONFIRM = 'RESET_DISPOSABLE_TEST_DATABASE'
npm run test:integration:payroll-profiles:isolated

Remove-Item Env:\TEST_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:\TEST_DATABASE_RESET_CONFIRM -ErrorAction SilentlyContinue
docker rm --force --volumes $container
```

## Available isolated commands

```text
npm run test:api:isolated
npm run test:integration:attendance-lock:isolated
npm run test:integration:backup-recovery:isolated
npm run test:integration:hr-disposable:isolated
npm run test:integration:payroll-profiles:isolated
npm run test:integration:hr-onboarding:isolated
npm run test:integration:hr-legacy-backfill:isolated
npm run test:integration:live-multi-segment-qa:isolated
npm run test:db:isolated
```

Each suite gets a clean schema. The runner starts the CRM on a random local port, applies startup initialization and all SQL migrations, creates a temporary creator login, runs the test, stops the server, and resets the schema again.

The live multi-segment QA mode first verifies the marker-bound attendance/cleanup helper and then runs the same end-to-end command used after deploy. It remains fully local and uses the disposable database; it does not contact production.

The runner verifies the complete `schema_migrations` inventory after the standard startup and fails immediately if any migration is still pending. It never inserts migration markers manually. The separate fresh-database startup suite covers restart/idempotency behavior where that proof is required.

The default per-suite timeout is 15 minutes. For a slower local machine it can be changed explicitly with `ISOLATED_TEST_TIMEOUT_MS`.

The API smoke file is a stateful CRUD suite with shared far-future fixtures. The isolated runner uses Node's `--test-concurrency=1` so top-level suites cannot overwrite each other's lines, bookings, or schedule rows.

For focused diagnosis only, `ISOLATED_TEST_NAME_PATTERN` is passed to Node's `--test-name-pattern`; omit it for acceptance verification.

The legacy commands remain available when a server is already running:

```text
npm run test:api
npm run test:integration:hr-disposable
```

`test:integration:hr-disposable` now creates and archives its own staff fixtures, but it also requires the verification marker injected by the isolated runner, `REQUIRE_ISOLATED_TEST_TARGET=true`, and a local `TEST_URL`. Prefer the isolated wrapper command. Do not run global HR copy-week integration against production. Live verification must use a separate safe QA runner with explicit test staff/date scope or dry-run behavior.

## Troubleshooting

- Docker CLI missing: install Docker Desktop outside this helper, then rerun the command.
- Docker daemon unavailable: start Docker Desktop and wait until `docker info` works.
- Port conflict: the helper asks Docker for a random `127.0.0.1` port; rerun if Docker reports a bind failure.
- Healthcheck timeout: inspect the disposable container logs, then rerun the helper. The helper removes the container it created before exiting.
- Runtime failure: use Node 22.x and npm 10.x; `npm run check:runtime` must pass before Docker starts.
- Marker failure: the database name must contain `test`, `testing`, `ci`, or `disposable`, and `TEST_DATABASE_RESET_CONFIRM` must equal `RESET_DISPOSABLE_TEST_DATABASE`.
- Confirmation failure: do not set `DATABASE_URL`; set only `TEST_DATABASE_URL` for the disposable target.

## Failure and cleanup behavior

- Migration verification fails if any SQL migration is absent from `schema_migrations`.
- HR fixtures are filtered by their exact staff IDs; unrelated rows do not affect assertions.
- Created shift IDs are registered before detailed assertions whenever the API exposes or allows them to be read.
- The HR suite deletes discovered fixture shifts and archives fixture staff in its `after` hook.
- A fixture cleanup failure fails the suite separately.
- A runner-level cleanup failure takes precedence and includes the original test failure in its message.
