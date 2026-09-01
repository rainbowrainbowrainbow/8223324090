# EventGenix Production Autonomy Runbook

This runbook defines the operational detail behind the Green/Yellow/Red policy in
the repository `AGENTS.md`. Read it only for production releases, migrations,
production data-fixes, or live-site QA.

The goal is one bounded owner decision for a production block, followed by
uninterrupted execution inside explicit technical and data boundaries. It does not
remove platform sandboxing, managed policy, or Red hard stops.

## 1. Authorization Model

### Green

Proceed without waiting for approval:

- repository and status inspection;
- clean-worktree changes;
- non-destructive local checks;
- feature-branch commits when requested;
- read-only GitHub, Railway, live-version, and browser inspection;
- release planning and manifest preparation.

### Yellow

One named authorization envelope is required for:

- production-branch push;
- additive/idempotent migration or bounded data-fix;
- manual Railway deploy through the repository helper;
- disposable production QA records;
- exact cleanup of the same registry-owned QA records;
- up to three scoped hotfix attempts.

The envelope expires at the earliest of:

- task completion;
- six hours after authorization;
- branch, service, action scope, or data-boundary drift;
- three release attempts.

An authorization in the current request is valid when it names the same protected
action and boundaries. Otherwise, use the exact warning template below.

### Red

Always stop for a separate exact approval before:

- mutating real customer, booking, staff, finance, payroll, or operational data;
- broad cleanup or unregistered deletion;
- auth, role, permission, or session changes;
- payment, invoice, billing, or payroll operations;
- production secret or environment changes;
- Railway/GitHub project or service settings;
- force-push, destructive rollback, history rewrite, or data drop;
- protected booking contract or protected manifest changes.

Yellow authorization never implies Red authorization.

## 2. Owner Warning Template

```text
УВАГА · <BLOCK-ID>

Дія: <одне речення>.

Наслідки:
1. <коротко>
2. <коротко>
3. <коротко>
4. <коротко>
5. <коротко>

Межі: <які дані/сервіси дозволені>.
Відкат: <rollback path>.
Потрібний дозвіл: «Дозволяю блок <BLOCK-ID>».
```

A production block should name:

- source and destination branches;
- exact initial SHA and allowed descendant rule;
- Railway project/environment/service;
- allowed migrations and their classification;
- allowed QA fixture type/count/date/resources/TTL;
- rollback reference;
- maximum attempts and expiry.

Do not request a second approval for normal push, CI wait, deploy, version proof,
and approved disposable QA inside the same valid envelope.

## 3. Fixed Production Identity

Verify these values read-only before every release; do not assume the runbook is
newer than the live system:

- release branch: `codex/eventgenix-production`;
- Railway project name: `fortunate-appreciation`;
- Railway environment: `production`;
- Railway service ID: `8223324090`;
- live source branch and SHA: `/api/version`.

Preserve `codex/checkbox-hardening-release-v080103` as the non-destructive
rollback reference for the pre-v0.81.13 production marker.

Historical branches such as `codex/timeline-leads-hardening` and `deployed` are
not production authority.

## 4. Clean Worktree Preflight

1. Run `git status --short --branch` in the main checkout.
2. If dirty, classify the files read-only and leave them untouched.
3. Fetch the production branch.
4. Create or use a clean isolated worktree for the task branch.
5. Confirm:
   - worktree is clean;
   - HEAD is the intended source SHA;
   - source is based on current `origin/codex/eventgenix-production`;
   - no unrelated commits or files are included.
6. Run `npm run check:runtime`; use Node 22/npm 10 only.

Never stash, reset, checkout, delete, or rewrite another user's dirty work.

## 5. Read-Only Production Preflight

Before asking for Yellow authorization:

1. Read live `/api/version`.
2. Confirm the active source branch and exact live SHA.
3. Confirm the candidate is a descendant of the live SHA.
4. Inspect `railway status --json` without changing settings.
5. Confirm project `fortunate-appreciation`, environment `production`, service
   `8223324090`, and the intended domain.
6. Compare migrations between live and candidate SHAs.
7. Classify each migration:
   - `schema`;
   - `seed`;
   - `data-fix`;
   - `cleanup`;
   - `mixed`.
8. Define the live QA scope and whether it is read-only or disposable-write.
9. Define the previous live SHA and migration rollback mapping.
10. Generate the owner warning and wait once.

Preparation must not push, deploy, execute migrations, create QA records, or
change production state.

## 6. Migration Safety

Database startup runs:

`initDatabase() -> runMigrations(pool) -> initDatabase()`

Before migration work:

- inspect `db/index.js`, `db/migrations/`, and
  `DB_MIGRATION_GOVERNANCE.md`;
- include required governance headers for migrations numbered `162_*.sql` or
  higher: `MIGRATION_KIND`, `SAFETY`, and `ROLLBACK`;
- add the extra documented headers for destructive or date-scoped work;
- run `npm run check:migrations`;
- identify the source of truth for generated/seeded values;
- provide a bounded rollback mapping.

Policy classification:

- additive, backward-compatible, idempotent schema: Yellow;
- bounded data-fix with exact predicate/inventory and rollback: Yellow;
- cleanup, destructive/mixed/unknown SQL, broad predicate, or real-data mutation:
  Red.

Never execute arbitrary SQL as part of a generic release command.

## 7. Validation Before Push

Run checks proportional to the change. The normal production baseline is:

1. targeted tests for the changed area;
2. `npm run check:runtime`;
3. `npm run check:migrations`;
4. `npm run check:syntax`;
5. `npm run test:unit`;
6. `npm run test:ui`;
7. `npm run check:timeline-protected-surface` when booking/timeline code is in
   scope;
8. full `npm test` for the release candidate.

`npm test` is the fast repository baseline. It includes runtime/version guards,
access/auth/static/CSS/API/storage/service-worker/scheduler/DB-startup ownership,
timeline protected-surface, migration governance, syntax, unit tests, and UI smoke.

`npm run test:api` and `npm run test:integration` require a running
PostgreSQL-backed application. Use them when CI/live behavior is insufficient or
the backend risk requires focused diagnosis.

Do not report skipped checks as passed.

## 8. Commit And Version Hygiene

- Commit functional work first.
- For a deployable release, create a separate version/cache/changelog commit when
  practical.
- `package.json` is the version source of truth.
- Use:
  - `npm run version:current` to inspect the current release;
  - `npm run version:bump -- patch --label "<Release Label>"` for the canonical
    patch bump;
  - `npm run check:version` to verify consistency.
- Update `index.html` changelog modal and `CHANGELOG.md` for release-relevant
  work.
- User-facing changelog text is Ukrainian.
- Pure documentation changes normally do not require a version bump.

## 9. Push And Exact-SHA CI

Inside a valid Yellow envelope:

1. Confirm HEAD and branch still match the envelope.
2. Confirm no new migration or Red-scope file appeared.
3. Push only the exact approved candidate to
   `codex/eventgenix-production`.
4. Record the resulting 40-character SHA.
5. Wait for GitHub Actions checks associated with that exact SHA.
6. Do not deploy while required checks are pending or failed.

CI uses Node 22 and npm 10. It runs `npm ci`, `npm test`, and separate disposable
PostgreSQL/browser jobs for high-risk areas including HR/payroll and My Day.
CI is not proof of production deployment or manual UX quality.

If CI fails:

- diagnose the exact failed check;
- make only a scoped fix related to the release;
- rerun relevant local checks;
- use the next attempt in the same envelope only if branch/service/scope/data
  boundaries are unchanged;
- stop after three attempts or on any Red-scope requirement.

## 10. Railway Deployment

The canonical bounded release controller is:

```powershell
npm run codex:production-block -- prepare [options]
npm run codex:production-block -- status --block-file <path>
npm run codex:production-block -- execute --block-file <path> --confirmation <exact-value>
npm run codex:production-block -- qa-resume --block-file <path> --confirmation <exact-value>
```

`prepare` is read-only against production and writes a sanitized, hash-bound
manifest under the operating-system temporary directory. It records the exact
live/candidate SHAs, fixed branch and Railway target, migration classifications,
QA scope, rollback reference, six-hour maximum lifetime, and three-attempt
maximum. It prints one authorization warning and the exact controller
confirmation. `execute` rejects expired manifests, target/SHA/migration drift,
Red paths, unknown/cleanup/mixed migrations, attempt exhaustion, and any
confirmation mismatch. `--dry-run` validates the full envelope and prints only
the fixed orchestration plan; it performs no push, deploy, migration, or QA
write.

If an already authorized, unexpired Trusted QA run is active after deploy,
`execute` records the exact release SHA and returns the canary as `deferred`.
It never cleans that run early. After the blocker TTL, `qa-resume` revalidates
the same unexpired block confirmation, exact live SHA/branch, and signed QA
scope, then runs only that QA scope. It cannot push, deploy, change settings,
accept booking IDs, or invoke cleanup.

On Windows/PowerShell, pass structured QA scope through
`--qa-scope-base64 <base64url-json>` so npm cannot strip JSON quotes. The
controller decodes it and applies the same strict QA schema; malformed or
non-canonical input fails closed.

The controller never accepts arbitrary commands or Railway settings. Its fixed
sequence is local validation, release artifact commit, exact-SHA push and CI,
the repository Railway helper, exact live version/release proof, and optional
trusted QA limited to `allowedQaScope`.

Production GitHub auto-deploy is disabled. Deploy manually only after exact-SHA CI
is green.

Required behavior:

- use `npm run release:railway-up`;
- pass the verified production branch through the helper's documented
  `RELEASE_DEPLOY_BRANCH` input;
- allow the helper to identify the production project explicitly;
- never run raw `railway up` from an unlinked worktree;
- never change Railway project, environment, service, owner, variables, secrets,
  or settings as part of release execution.

The helper must prove the uploaded SHA and branch through Railway metadata or its
clean archive release manifest. Legacy `RELEASE_DEPLOY_COMMIT` and
`RELEASE_DEPLOY_BRANCH` variables alone are not valid deployment identity.

## 11. Live Version And Release Proof

After deployment:

1. Run the version smoke with exact expected SHA and branch.
2. Verify:
   - live `/api/version`;
   - package version;
   - release label;
   - source branch;
   - exact deployment SHA;
   - login HTML/version cache markers.
3. Run the relevant release proof helper when one exists.
4. Save only sanitized evidence.

Version smoke must fail closed for missing, malformed, manual, or conflicting
deployment metadata.

## 12. Live-Site QA

Use production test credentials only from:

`C:\Users\Plotva\.eventgenix\codex-crm-secrets.ps1`

Rules:

- load secrets process-locally;
- never print values;
- test accounts only;
- read-only inspection first;
- disposable-write QA only inside a Yellow envelope;
- no real customer overlap;
- suppress side effects where the runner supports it;
- store sanitized reports/screenshots only;
- report live QA blocked if credentials are unavailable.

Targeted examples:

- booking: create/edit/detail/timeline using disposable records only;
- schedule: approved test date/resources with empty-slot preflight;
- client: test-customer create/edit/search/detail only;
- auth/navigation: read-only role visibility unless exact Red approval exists;
- reporting: changed filters/widgets/empty/error states.

## 13. Disposable QA Lifecycle

Every writable production QA run must have:

- unique run ID;
- test account and business context;
- registry ownership for every created entity;
- disposable marker;
- exact entity inventory;
- bounded TTL;
- suppressed external side effects where supported;
- cleanup strategy before apply.

The canonical timeline lifecycle command is:

```powershell
npm run qa:timeline:controller -- --action <status|run|verify|cleanup> [options]
```

Use `status` for a sanitized read-only registry audit. `run` requires an exact
date, release SHA, production branch, allowlisted live URL, animator subset, and
TTL of 5-240 minutes. It performs stale-run recovery, prepare, apply, registry
and API verification, then a read-only browser matrix. Successful fixtures stay
active until TTL; the controller does not clean them early.

`cleanup` requires the exact run ID, manifest/state/token paths, and the
run-bound confirmation emitted by the controller. It does not accept wildcards
or arbitrary booking IDs. On Windows, `qa:timeline:controller:windows` provides
an explicit UTF-8 PowerShell wrapper.

Cleanup rules:

- exact registered entities only;
- verify run ownership, marker, account/context, and manifest immediately before
  deletion;
- no wildcard, arbitrary ID list, broad predicate, or real-data fallback;
- idempotent repeated cleanup;
- sanitize reports;
- if ownership or marker mismatches, mark the run blocked and stop.

Never broaden cleanup to make a stuck QA run disappear. Provide exact run/entity
evidence and a safe recovery command instead.

## 14. Failure, Rollback, And Stop Conditions

Stop immediately when:

- live branch/SHA is inconsistent;
- candidate is not a descendant of the approved base;
- worktree or release scope drifts;
- unknown, cleanup, destructive, or mixed migration appears;
- required CI remains failed;
- Railway identity does not match;
- version proof cannot establish exact SHA/branch;
- QA inventory includes unregistered or real data;
- protected booking contract/manifest must change;
- secrets/settings/auth/billing/real-data mutation becomes necessary;
- authorization expires or attempt budget is exhausted.

Rollback options must be chosen before release:

- deploy the documented previous production SHA through the release helper;
- apply only the documented migration rollback path;
- exact-clean the approved disposable QA run;
- never force-push or run destructive rollback without Red approval.

If rollback itself requires real-data repair or destructive SQL, treat it as Red.

## 15. Evidence And Final Report

The production report should contain:

- authorization block ID and validity;
- functional and release commit SHAs;
- production branch and previous live SHA;
- exact-SHA CI URL/result;
- Railway project/environment/service and deployment evidence;
- live version/release label/SHA/branch;
- migration files, classification, and rollback mapping;
- QA run ID, sanitized entity count, TTL, and cleanup state;
- screenshots/report paths when UI work is in scope;
- checks actually run;
- remaining risks;
- rollback instructions.

Never include tokens, passwords, database URLs, environment values, or customer PII.

## 16. EventGenix Autopilot

Long EventGenix work may be launched explicitly with
`$eventgenix-production-autopilot`. Start it as one Goal using
`docs/templates/CODEX_EVENTGENIX_AUTOPILOT_GOAL.md`. If the work must survive an
idle turn, attach one same-task, 15-minute bounded heartbeat using
`docs/templates/CODEX_EVENTGENIX_HEARTBEAT.md`.

The heartbeat observes active work, resumes only idle incomplete Green work,
waits for in-flight commands, continues an already-authorized Yellow envelope,
and stops on a new Red requirement. It must be disabled when acceptance is
complete or the Goal is stopped. Reconnect by reopening the same task and
auditing Goal/worktree/block/CI/QA state before resuming; never start a second
writer on the same branch/worktree.

## 17. Instruction Discovery And Restart

Codex loads global instructions first and repository instructions from the project
root toward the working directory; more specific instructions appear later and
override earlier guidance. Global config and rules are loaded at startup.

After changing global `AGENTS.md`, `config.toml`, or `rules/default.rules`,
restart Codex desktop before relying on the new behavior.
