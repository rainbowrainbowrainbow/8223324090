# Authenticated production surface QA

`npm run qa:live:authenticated` is a manual release gate. It is deliberately not a CI job: the runner reads dedicated production QA credentials only from the untracked local file `C:\Users\Plotva\.eventgenix\codex-crm-secrets.ps1`.

## Preconditions

- The local secret file contains `LIVE_SMOKE_URL`, `LIVE_SMOKE_USER`, `LIVE_SMOKE_PASS`, `LIVE_CREATOR_USER`, and `LIVE_CREATOR_PASS`.
- `LIVE_SMOKE_USER` identifies an isolated QA account. Its name or username must contain a QA marker (`qa`, `test`, `codex`, `smoke`, or `verifier`), it must not have `creator` in its stored role set, and it must not be linked to an active employee profile.
- `LIVE_CREATOR_USER` must be a permanent creator account with `manage_accounts`; a temporary QA creator lease cannot issue or revoke leases.

Do not run this command with a real employee account or copy its credentials into environment files, logs, screenshots, or Git.

## What the runner does

1. Reads deployed release metadata and verifies both sessions through `/api/auth/verify` and `/api/auth/permissions`.
2. Creates a server-side, 15-minute `creator` lease for only the isolated QA account, then starts a fresh browser session. It never changes `users.role`.
3. Allows browser GET/HEAD requests plus login and refresh auth POSTs. Any browser business mutation request is aborted and makes QA fail. The dedicated read-only browser context suppresses the automatic wallet daily-login reward before it can issue a POST.
4. Checks `/`, `/hr`, `/staff`, `/training`, `/finance`, and `/checkin`. Check-in receives a simulated `NotAllowedError`; it never requests hardware camera permission or submits attendance.
5. In `finally`, revokes exactly the lease it created, starts a fresh QA session, and verifies final role/capability parity. If the process is killed or loses power, authorization ignores the lease at its server-side expiry and falls back to the stored base role.

The JSON report includes only release metadata, boolean assertions, capability booleans, aggregate console/CSP counts, and final QA role. It never prints credentials, tokens, usernames, lease IDs, or business data. A `429` follows `Retry-After` (capped at 30 seconds) and retries up to four times.

## Run and interpret

```bash
npm run qa:live:authenticated
```

The gate passes only when `ok` and `temporaryCreator.restored` are `true`, all six routes are present under `routes`, and `businessMutations` is `0`. A failed lease revoke is a production-access incident: stop releases, revoke the matching lease through canonical account management, verify the stored base role, then rerun the gate.

This runner is manual-only. CI covers its safety contract but never receives production credentials or executes the live command.
