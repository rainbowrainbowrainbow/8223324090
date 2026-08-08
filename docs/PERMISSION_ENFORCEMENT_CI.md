# Permission enforcement CI

This document defines the local commands for the permission enforcement contract.

## Fast contract and unit checks

Run these without PostgreSQL or a browser:

```bash
npm run check:permission-contracts:executable
npm run check:permission-registry
npm run check:capability-policy
npm test
```

`check:permission-contracts:executable` fails when:

- an active page or action permission has no executable test contract;
- an unknown key is added to the contract;
- a sensitive action has no response assertion;
- a configured test file does not exist;
- deprecated/tombstone permissions leak into public UI/API definitions;
- account-access browser behavior classes are not wired into CI.

## Isolated PostgreSQL permission matrix

Use only a disposable database. Do not use `DATABASE_URL`.

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/eventgenix_ci_test \
TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE \
npm run test:integration:permissions:isolated
```

The runner hard-fails for production-like hosts, Railway hosts, production-like database names, missing `TEST_DATABASE_URL`, or a `TEST_DATABASE_URL` matching `DATABASE_URL`, `PRODUCTION_DATABASE_URL`, or `LIVE_DATABASE_URL`.

The permission matrix uses disposable users only and verifies `/api/auth/permissions` after PATCH + relogin for every active page and action permission.

## Browser access editor suites

Run these after installing Playwright browser dependencies:

```bash
npm run test:browser:account-access:lifecycle
npm run test:browser:account-access:draft
npm run test:browser:account-access:tri-state
npm run test:browser:account-access:backend
npm run test:browser:account-access:mobile
```

The aggregate command is still available:

```bash
npm run test:browser:account-access
```

Browser tests cover lifecycle/focus, dirty draft and failed save, tri-state page access, test-backend relogin persistence, and mobile layout.
