# Certificate redemption CI gate

The `Certificate redemption regression` GitHub Actions job is the blocking
automated regression suite for one-time Park certificate redemption. It runs
on every push and pull request with an ephemeral PostgreSQL 16 service.

## Coverage

- Real PostgreSQL and authenticated certificate routes: concurrent requests,
  role and membership changes, scope denial, expiry, terminal states,
  verification-only subscription types, audit rollback, and status races.
- The actual Express app and PostgreSQL: booking creation and certificate
  redemption commit together, a failed booking rolls both back, duplicate use
  is rejected, and cancelling the booking leaves the certificate used.
- Trusted disposable QA certificates: server-bound token/account/context,
  expiry and one-certificate limit, no creation event, Telegram image, print,
  booking or finance side effects, business-list exclusion, direct redemption,
  and close-run preservation/revocation.
- Browser flow on synthetic local HTTP: scan/lookup, cancel confirmation,
  confirmed redemption, pending-submit protection, verify-only state,
  business-scope changes, stale responses, and mobile layout.
- Legacy Telegram certificate link: reports status and opens CRM without a
  redemption callback or recipient details.

All automated HTTP targets are loopback. The browser test aborts requests to
other origins. The actual-app test runs with test-only credentials, empty
Telegram/report tokens, and outbound backup hold enabled. Each PostgreSQL test
creates a UUID-named child database and drops only that database in `finally`.
The shared CI service database schema is not reset by these certificate tests.

## Local PostgreSQL run

Use Node 22, npm 10, and a disposable loopback PostgreSQL database whose name
contains a separate `test`, `testing`, `ci`, or `disposable` marker. The database
user needs permission to create and drop databases. Never point this variable
at `DATABASE_URL`, a Railway database, or production.

PowerShell example:

```powershell
$env:CERTIFICATE_TEST_DATABASE_URL = 'postgres://<local-user>:<local-password>@127.0.0.1:5432/eventgenix_certificate_ci_test'
$env:TEST_DATABASE_RESET_CONFIRM = 'RESET_DISPOSABLE_TEST_DATABASE'
npm run test:integration:certificates:ci
npm run test:unit:certificates-legacy
npm run test:browser:certificates
```

In CI, a missing PostgreSQL URL is an error rather than a skipped test. The
integration command sets `REQUIRE_CERTIFICATE_POSTGRES_TESTS=1` for both test
processes. The synthetic browser and Telegram tests do not need database
credentials.
