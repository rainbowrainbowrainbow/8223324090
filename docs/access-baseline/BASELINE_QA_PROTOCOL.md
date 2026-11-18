# Registered baseline identity QA

Status: identity lifecycle and API operator implemented locally. Production
execution is not authorized. The canonical booking fixture and full browser
scenario in LIVE_QA_DESIGN.md remain separate unfinished work.

## Scope

services/baselineAccessQa.js is a CLI-only fixture bootstrap, not a public
permission/session endpoint. The source baseline_access_qa owns exactly eight
registered entities: two synthetic staff cards, two accounts (instructor/admin),
two active employee bridges and two Park membership pairs. Accounts have no
additional roles or individual permission overrides. The existing isolated
operator's account and permissions are read only. No creator account, customer,
payroll/finance row or external notification recipient is created.

The plan contains exactly runId (baqa- followed by12lowercase hex characters),
operatorId, businessId, releaseSha (40lowercase hex) and ttlMinutes (1–30).
Normalization binds every field to a SHA256 hash. Production requires Park
business1, the canonical deployed SHA/branch and complete deployment metadata.
The fixed database target fingerprint matches the existing trusted operator
protocol. URL query parameters cannot override its host/port/database. Local mode
requires both disposable database confirmation and loopback database/app targets.

Preflight requires an active QA-marked operator with no active staff bridge,
current Park membership, HR page and hr.staff.manage capability. This is an
operator identity/scope check, not a new permission granted to that account.
Bootstrap uses the separately authorized operator database credential. It locks
the current business/organization memberships, creates the run and all eight
entities in one transaction and returns credentials only in process memory.
Passwords are random, hashed through existing bcrypt and non-enumerable on the
internal result; accidental JSON serialization cannot log them. No raw QA run
token is exported. Authentication uses the existing normal login route.

## Operator commands

Prepare an absolute JSON plan path containing only the five non-secret fields.
Load the approved process-local credential through the established local file;
do not paste passwords, database URLs or tokens into commands/chat.

```text
node scripts/trusted-qa-baseline-access-run.js --mode plan --plan-file <absolute-plan>
```

Plan opens a repeatable-read/read-only transaction and rolls back. It creates no
accounts/runs. After an exact bounded production approval, the reviewed hash is
required for the one-shot identity/API scenario:

```text
node scripts/trusted-qa-baseline-access-run.js --mode run --plan-file <absolute-plan> --approved-hash <sha256> --confirm EXECUTE_EXACT_BASELINE_ACCESS_QA
```

Run logs in both new actors, checks six actual authenticated work APIs, and saves
the admin's own synthetic primary/secondary professions and admission metadata.
Requests cannot follow redirects, use fixed origin/paths, have deadlines and
bounded response bodies. Output contains only synthetic IDs, roles and outcomes.
It never returns response bodies, credentials, names of real people or secrets.
Exact cleanup runs in finally, including API failure. Its success is required
before the command reports success. If the process/connection disappears, the
existing expiry watchdog dispatches the same source-specific cleanup.

Manual exact retirement remains available after expiry:

```text
node scripts/trusted-qa-baseline-access-run.js --mode finish --plan-file <absolute-plan> --approved-hash <sha256> --confirm EXECUTE_EXACT_BASELINE_ACCESS_QA
```

Use --local only with the disposable runner's actual environment. The flag cannot
turn a remote/production database into a local target.

## Retirement boundaries

Cleanup locks exact registry-owned rows in a fixed order. It validates markers,
roles, absence of overrides, profiles, business/organization ownership, maximum
30minute lifetime and eight-entity cardinality. Unexpected contacts, pay/rate or
scheme records, responsibility nodes, chats, schedules/time/attendance, documents,
resource assignments, tasks or active created bookings abort the entire cleanup.
It does not delete or rewrite those unexpected records.

Only owned memberships, accounts/sessions, employee bridges, role assignments and
staff are retired. Audits and inactive fixture rows remain. Existing operator and
unregistered records stay untouched. Repeat finish verifies inactivity and is
idempotent; registry/ownership drift never silently becomes successful cleanup.

## Verification

- Node22.23.4/npm10.9.9; final focused plan/target/registry/runner tests64/64,
  including millisecond-precise maximum-lifetime rejection before record locks.
- Actual disposable PostgreSQL and running application: expanded lifecycle10/10,
  no skips. Includes normal login/readiness, real admin profession save, forced
  mid-bootstrap rollback, role/profile/business/contact/pay/dependency drift,
  expired-run watchdog, stale-session rejection, repeated cleanup, actual CLI
  plan/run/finish and finally cleanup after an injected API interruption.
- Existing animator-only HR fixture acceptance remains unchanged and passes1/1
  with its actual browser/API flow.
- The permissions integration gate now includes this lifecycle alongside
  permission capabilities, zone membership, Training, Chat and work readiness.
  Final gate result and exact evidence filenames are in STATE.md.
- Runtime and protected timeline guard pass; no schema/dependency/session
  mechanism changes. Final full npm test and approved live proof remain required.
