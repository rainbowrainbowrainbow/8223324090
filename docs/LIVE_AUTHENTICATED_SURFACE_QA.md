# Authenticated production surface QA

`npm run qa:live:authenticated` is a manual release gate. It is deliberately not a CI job: the runner reads dedicated production QA credentials only from the untracked local file `C:\Users\Plotva\.eventgenix\codex-crm-secrets.ps1`.

## Preconditions

- The local secret file contains `LIVE_SMOKE_URL`, `LIVE_SMOKE_USER`, `LIVE_SMOKE_PASS`, `LIVE_CREATOR_USER`, and `LIVE_CREATOR_PASS`.
- `LIVE_SMOKE_USER` identifies the dedicated QA account. Its name or username must contain a QA marker (`qa`, `test`, `codex`, `smoke`, or `verifier`) and it must not start as `creator`.
- The creator account can use `manage_accounts` only to elevate and restore that one QA account.

Do not run this command with a real employee account or copy its credentials into environment files, logs, screenshots, or Git.

## What the runner does

1. Reads deployed release metadata and verifies both sessions through `/api/auth/verify` and `/api/auth/permissions`.
2. Changes only the dedicated QA account to `creator`, then starts a fresh browser session.
3. Allows browser GET/HEAD requests plus login and refresh auth POSTs. Any browser business mutation request is aborted and makes QA fail.
4. Checks `/`, `/hr`, `/staff`, `/training`, `/finance`, and `/checkin`. Check-in receives a simulated `NotAllowedError`; it never requests hardware camera permission or submits attendance.
5. In `finally`, restores the exact initial QA role, starts a fresh QA session, and verifies final role/capability parity.

The JSON report includes only release metadata, boolean assertions, capability booleans, aggregate console/CSP counts, final QA role, and sanitized paths of blocked automatic requests. The known wallet daily-login call remains blocked; it cannot mutate the QA account and does not fail the gate. Any other blocked mutation attempt fails the gate. It never prints credentials, tokens, usernames, or business data. A `429` follows `Retry-After` (capped at 30 seconds) and retries up to four times.

## Run and interpret

```bash
npm run qa:live:authenticated
```

The gate passes only when `ok` and `temporaryCreator.restored` are `true`, all six routes are present under `routes`, and `businessMutations` is `0`. A failed role restoration is a production-access incident: stop releases, restore the dedicated QA account through canonical account management, then rerun the gate.

This runner is manual-only. CI covers its safety contract but never receives production credentials or executes the live command.
