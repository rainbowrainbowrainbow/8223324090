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

#### Ordinary release authorized by the task

An explicit instruction in the current task or Goal to ship to production
(for example, `доведи до продакшену`) authorizes one ordinary release of that
task. This includes functional and release commits, push to the fixed production
branch, exact-SHA CI, deploy to the fixed Railway service, and read-only live QA.
An implementation-only Goal authorizes local work by default.

Use this scope only when the full live-to-candidate diff contains no migrations,
production data-fix or write-QA work, or Red/protected release changes. Consider
runtime side effects such as new startup jobs that write real data. Each migration,
disposable QA write or cleanup, and protected workflow needs exact bounded owner
authorization under its applicable Yellow or Red rules. An exact authorization
already supplied in the current task remains valid within those bounds.

Record the user instruction and its time, the task scope, the fixed destination,
the initial candidate and permitted descendants, the live base, and the rollback
reference. Start the six-hour cap at the user's production instruction and use
the earlier of that deadline and the manifest expiry. Set `--validity-minutes`
to no more than the remaining whole minutes. If less than the controller's
five-minute minimum remains, stop before preparing a new manifest. Keep the same
deadline and total limit of three attempts across any retry or handoff. If a
new manifest is required within the same scope, set `--max-release-attempts` to
no more than the remaining budget and retain the prior attempt evidence.

### Red

Always stop for a separate exact approval before:

- mutating real customer, booking, staff, finance, payroll, or operational data;
- broad cleanup or unregistered deletion;
- auth, role, permission, or session changes;
- payment, invoice, billing, or payroll operations;
- production secret or environment changes;
- Railway/GitHub project or service settings and changes to GitHub workflows;
- force-push, destructive rollback, history rewrite, or data drop;
- protected booking contract or protected manifest changes.

Yellow authorization never implies Red authorization.

## 2. Owner Warning Template

Use the template only when exact owner authorization is still needed. For an
already authorized ordinary release, send a short status update with the scope,
target and deadline and proceed.

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

Before preparing the block, check both live and remote production,
nearby in-flight releases, the current patch marker, and the Railway helper's
same-version guard. If a deployable candidate needs a version bump, describe it
as the next free patch unless the owner requires an exact version. State the
initial SHA, any permitted descendant rule, protected-path exclusions, and the
condition for live/remote convergence in the original envelope. Do not promise
continuation through drift that the owner did not approve. If a controller uses
an exact hash-bound manifest, its confirmation and drift checks remain binding.

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

### Running on another machine

- Use the clean checkout of the exact candidate and the repository Node 22/npm 10
  baseline. Install dependencies with `npm ci` and use that machine's Git and
  authenticated GitHub/Railway CLI sessions. Check `git --version`,
  `gh --version` and `railway --version` before starting. Check the system
  `System32\tar.exe --version` on Windows or `tar --version` elsewhere.
- The controller runs `npm test` without inherited release overrides and passes
  the approved branch, SHA, project, environment and service to the deployment
  subprocess. Leave `RELEASE_DEPLOY_BRANCH` out of shell startup profiles and
  use `--branch` for a direct helper invocation.
- On Windows, the browser smoke fixture can use Git Bash from the Git for Windows
  installation on PATH. If the selected Git distribution ships without Bash,
  set `GIT_BASH_PATH` to the local Git for Windows `bash.exe` for the test
  process. The Ubuntu mirror fixture uses the selected Git Bash installation's
  `/usr/bin` for `sed` and `grep`. The release helper uses the Windows system
  `tar.exe` by absolute path even when Git's GNU tar is first on `PATH`.
  A failed archive extraction discards the partial export and archive.
  The release helper accepts a native `railway.exe` on PATH, the
  npm-installed CLI, or a local `RELEASE_RAILWAY_BIN` override. On macOS and
  Linux, use the native Git, Bash, tar and Railway CLI.
- For an ordinary release handoff, keep the current block manifest, the
  checked-out SHA and attempt evidence together. The manifest expiry and
  attempt count still apply on the next machine. Stop the previous release
  process before continuing. Resolve any QA plan paths and credentials on the
  new machine under the original QA scope.

## 5. Read-Only Production Preflight

Before preparing or executing a Yellow release:

1. Read live `/api/version`.
2. Confirm the active source branch, exact live SHA and current remote production
   SHA. For an ordinary first attempt, require live and remote to match, or
   verify that remote is ahead only by the policy documentation commits defined
   below. On a scoped retry, the remote may hold only the recorded candidate
   pushed by this block, with the original live base still in place. Check for
   in-flight releases and resolve a version collision before attempting to push.
3. Confirm the candidate is a descendant of the live SHA and, for an ordinary
   release, of the verified remote tip.
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
10. For an ordinary release with explicit production intent, record the existing
    authorization and proceed to the controller. If exact owner approval is
    missing for the required scope, show one warning and wait for that decision.

Preparation must not push, deploy, execute migrations, create QA records, or
change production state.

### Publishing release notes

Put the Ukrainian notes in the signed release block with `--release-notes-file`.
The controller publishes a CRM changelog GitHub Release after Railway version
smoke and timeline asset proof. It verifies the production version and SHA,
saves that evidence in the block, and creates one publication tagged
`crm-changelog-v<version>` at the exact SHA.

A publication outage leaves the deployment complete and the changelog status pending.
While the original authorization is valid, retry the same publication with
`node scripts/production-block-controller.js publish-notes --block-file <file> --confirmation <value>`.
This action uses the existing deployment proof and preserves the release attempt
counter. A GitHub tag or release already bound to other content requires inspection.
The GitHub CLI identity used for publication needs repository Contents write access.

The CRM reads the published catalog on demand with a server-side cache. The
historical fragment and Markdown remain available when GitHub is unavailable.
Before shipping the catalog for the first time, refresh the imported archive with
any confirmed releases that shipped after its base commit and verify the resulting
version list against the latest production rollout.

### Policy documentation on the production branch

When the owner authorizes publishing policy documentation to the production
branch, push the reviewed documentation commits without a version bump or
Railway upload. For the next ordinary release, an ahead-of-live remote tip is
acceptable if live is its ancestor, the intervening commits contain no merges,
and each commit changes only these files:

- `AGENTS.md` and `README.md`;
- `docs/CODEX_PRODUCTION_AUTONOMY.md` and `docs/RELEASE_RELIABILITY.md`;
- `docs/templates/CODEX_EVENTGENIX_AUTOPILOT_GOAL.md` and
  `docs/templates/CODEX_EVENTGENIX_HEARTBEAT.md`.

Inspect each commit between live and remote with rename detection disabled. If
any commit falls outside that list, stop and reconcile the branch before the
ordinary release. Include the verified remote tip in the next candidate and
keep the actual live SHA as the release manifest's live base. The next runtime
release follows normal versioning, CI, and live proof.

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

Run focused tests during development and any additional checks required by the
change. The controller runs the full local `npm test` baseline once per release
attempt before push. Skip a separate `release:gate` invocation and individual
baseline checks that would merely repeat that run. The standalone `release:gate`
command remains available for manual validation or diagnosis.

`npm test` is the fast repository baseline. It includes runtime/version guards,
access/auth/static/CSS/API/storage/service-worker/scheduler/DB-startup ownership,
timeline protected-surface, migration governance, syntax, unit tests, and UI smoke.

`npm run test:api` and `npm run test:integration` require a running
PostgreSQL-backed application. Use them when CI/live behavior is insufficient or
the backend risk requires focused diagnosis.

Do not report skipped checks as passed.

## 8. Commit And Version Hygiene

- Commit functional work first.
- For a deployable release, create a separate version and cache commit when
  practical.
- `package.json` is the version source of truth.
- Use:
  - `npm run version:current` to inspect the current release;
  - `npm run version:bump -- patch --label "<Release Label>"` for the canonical
    patch bump;
  - `npm run check:version` to verify consistency.
- Supply the release notes to the controller for release-relevant work.
- User-facing changelog text is Ukrainian.
- Pure documentation changes normally do not require a version bump.

## 9. Push And Exact-SHA CI

Inside a valid Yellow envelope:

1. Confirm HEAD, branch, live base and remote state still match the envelope
   and the expected release stage. Recheck live and remote again before upload.
2. Confirm no new migration or Red-scope file appeared.
3. When the release requires `Runtime artifact smoke`, verify that the exact
   candidate's diff against the current remote production tip matches its push
   paths filter. If the candidate is already on the remote, the controller
   still requires its existing exact production-push workflow run.
   Push only the exact approved candidate to
   `codex/eventgenix-production`.
4. Record the resulting 40-character SHA.
5. Wait for the `CI` workflow for the exact production push. An ordinary
   release also waits for `Runtime artifact smoke` for that SHA. When packaging
   inputs change, the artifact build and smoke step must execute successfully.
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
npm run codex:production-block -- prepare -- [options]
npm run codex:production-block -- status -- --block-file <path>
npm run codex:production-block -- execute -- --block-file <path> --confirmation <exact-value>
npm run codex:production-block -- release-resume -- --block-file <path> --confirmation <exact-value>
npm run codex:production-block -- qa-resume -- --block-file <path> --confirmation <exact-value>
```

The second `--` is required before controller flags. It keeps npm 10 and the
portable Windows PowerShell shim from consuming `--block-file`,
`--confirmation`, and prepare options as npm configuration. The controller also
accepts the legacy stripped positional form for `status`, `execute`,
`release-resume`, and `qa-resume`. Use the explicit double-boundary form above
for new automation and operator commands.

`prepare` is read-only against production and writes a sanitized, hash-bound
manifest under the operating-system temporary directory. It records the exact
live/candidate SHAs, fixed branch and Railway target, migration classifications,
QA scope, rollback reference, six-hour maximum lifetime, and three-attempt
maximum. It prints a warning and the exact controller confirmation. For an
ordinary release already authorized by the task, use the `confirmation` value
returned by that `prepare` invocation with the same `blockFile`. The value
binds `execute` to the manifest. Owner authorization comes from the recorded
request. Run `prepare` with `--qa-scope none` and confirm the manifest has no
migrations and no protected workflow before executing. For a release needing
exact owner approval, obtain or verify that approval for the bound scope before
using the confirmation value.

`execute` rejects expired manifests, target/SHA/migration drift,
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
An optional JSON release-notes file under `docs/` supplies up to six signed
plain-text title/body items. The controller publishes them only after the
production version, commit and asset proof pass.

The `certificate-qa-isolation` protected workflow is reserved for the exact
certificate QA release surface: Red paths `routes/auth.js` and
`routes/finance.js`, the certificate QA implementation, and migration 371 only.
It does not change their Red classification. A certificate `allowedQaScope`
signs one run ID, exact test account, `event_genix` context, TTL up to 30
minutes, and one-certificate limit. `prepare` verifies the operator plan in a
read-only transaction. After deploy the block records `pending_manual`; use
the certificate operator procedure only after exact live SHA and QA isolation
proof. It never invokes timeline QA for a certificate scope.

The `certificate-ci-gate` protected workflow is reserved for the certificate
expiry and booking precheck release. It permits exactly one Red path,
`.github/workflows/ci.yml`, and only the listed release files in
`scripts/production-block-policy.js`. It permits no migration or production QA
fixture and does not change the Red classification of CI workflows. Review the
CI diff for certificate-only jobs before preparing the block. The expiry
scheduler can change real certificate statuses after deployment; obtain a fresh
read-only count and the owner's separate bounded Red approval before execution.
The controller itself does not run a direct data-fix. If the count exceeds the
approved cap, stop; do not split the release into unapproved batches.

The `lead-ui-ci-gate` protected workflow is reserved for the reviewed unified
lead-card and Omni UI release. It permits exactly `.github/workflows/ci.yml` as
a Red path, plus only the exact functional/documentation paths enumerated in
`scripts/production-block-policy.js`. It does not authorize arbitrary workflow
changes: the separately reviewed CI diff adds disposable PostgreSQL 16 and the
existing Omni links DB/actual-app browser suites to the existing Omni CI job,
with bounded timeout and fixture diagnostics. Triggers, GitHub permissions,
secrets, hosting, and production providers stay unchanged. Separate explicit
approval covers this exact CI/policy diff before implementation. Existing
current-task or active bounded release authorization remains applicable while
its named scope, branch/service, data boundaries, time and attempt limits match;
adding this gate does not itself require repeating that authorization. The
certificate exception is not reusable.
No migrations, production QA records, or production backfill are allowed in this
workflow. Production verification remains read only; lead/link mutation tests
run against the isolated database. New files outside the exact allowlist require
a newly reviewed scope rather than a wildcard or controller bypass.

The `profile-employee-release` workflow is limited to the reviewed personal
profile release from `e076dcd4` (v0.83.52) to v0.83.53. It requires an exact
file inventory and Git blob for `routes/auth.js`, a prepared release SHA,
matching live and remote production, and one attempt. It allows no migrations
or writable production QA. Both production-push CI and Runtime artifact smoke
must succeed for the exact candidate before the Railway upload. The existing
Red classification and separate owner authorization still apply.

The `hr-payroll` protected workflow is exclusive to the exact HR-PAY file inventory
and additive migration 374 in `scripts/production-block-policy.js`. It permits
`routes/payroll.js` and the HR test/evidence changes in `.github/workflows/ci.yml` without changing their Red classification. It does not reuse
certificate, lead or SYS-MB exceptions and does not permit CI settings, auth policy,
production fixtures, backfill or payouts. Prepare functional and release commits
before the final manifest: this workflow signs the exact prepared release SHA and
rejects even descendant SHA drift. Execute does not bump or commit another version.
Only read-only production QA is permitted; synthetic mutation tests run in isolated
PostgreSQL. See `docs/HR_PAY_PROTECTED_RELEASE.md` for remaining readiness gates.

The `payroll-425-426` protected workflow permits one separately owner-approved
production attempt for the reviewed commission-basis constraint replacement
and empty monthly-review table. Prepare the next patch from matching live and
production-ref SHAs and use `--protected-workflow payroll-425-426
--qa-scope none --max-release-attempts 1`. The manifest binds the exact
candidate and both SQL hashes. Before Railway upload, the controller requires
the exact production push's HR/payroll CI jobs and Runtime artifact smoke.
Keep the widened constraint and the review table during recovery. Use a
compatible forward release if records already use the new schema.

The `performance-ci-release` protected workflow is exclusive to the reviewed
CI follow-up from production `8e5c312d` to the prepared `0.83.23` patch. It pins
the exact file inventory and canonical-LF hashes of the two workflow files.
Prepare only after an explicit owner authorization for this protected scope.
The manifest binds the exact prepared SHA and one attempt. It permits no
migrations, QA records, settings changes, or unrelated protected paths.
The controller requires successful production-push CI for all 13 main jobs
and the actual Railpack build and smoke step for the same SHA before upload.
For routine runs the packaging probe skips image builds for version markers
alone and builds one candidate image for packaging or dependency changes.
The first candidate c5204dfb failed the artifact smoke database-name guard
in production-push CI run 42490074963 before upload. A fresh owner-approved
block may prepare one direct corrective commit on that exact failed SHA while
live remains at 8e5c312d. The controller verifies the failed run and exact
correction inventory, requires the failed SHA on the remote before push, and
requires the corrected SHA on the remote before upload. Both CI gates run again.

The `finance-manual-qa` protected workflow is limited to the exact reviewed finance
inventory and the canonical-LF SHA-256 hashes of migrations 381 and 382 in
`scripts/production-block-policy.js`. The generic migration classifier still marks
381 Red because of its index replacement; this exception accepts only the reviewed
SQL bytes. It does not authorize other SQL, auth, provider calls, CI settings,
backfill or real account/booking changes. Prepare the version and release commit
before the manifest; descendant SHAs, changed file inventory and SQL hash drift
are rejected. Existing PostgreSQL and browser CI jobs include the money and QA
isolation tests; skipped required jobs cannot satisfy the release gate.

Optional finance QA scope signs `runId`, `testAccountId`, `businessContext`,
`ttlMinutes`, an absolute local `planFile` and the complete normalized `planHash`.
The fixed finance operator validates two cash accounts, one bank/card account,
two categories, at most two synthetic bookings, operation/amount caps, and TTL
of at most 30 minutes. Prepare and execution use its read-only `--mode plan`
preflight; after exact live SHA/branch proof the controller rechecks the plan and
returns `pending_manual`. It never calls finance `create` or `finish` itself.
Any operator lease or protected permission change requires its own exact approval.
Ending QA preserves immutable journal evidence and ownership markers. After manual
records exist, rollback requires a compatible binary retaining source-write guards
and legacy/manual shift separation; never deploy a pre381 binary or remove the
journal/index safeguards. See `docs/FINANCE_PRODUCTION_QA_PLAN_2026-10-07.md`.

For a finance candidate pushed by this controller whose exact production-push CI
failed before deploy, prepare a corrected descendant using `prepare --
--retry-from <prior-manifest-path> --retry-ci-run <exact-failed-run-id>` with the
same finance options. This creates a fresh hash-bound exact-SHA manifest while
preserving the prior target, version, file inventory, SQL hashes, disabled QA
scope, original expiry and aggregate attempt budget. The remote branch must
still equal the failed prior candidate, and live must still equal the original
base. The prior manifest is marked superseded; it cannot execute or spawn a
second continuation. Use the new manifest's exact technical confirmation only
within the still-valid human authorization. No CI/deploy bypass is provided.

Finance execution and retry preparation use a per-manifest exclusive local lock;
an unexpected stale lock requires explicit state reconciliation, not automatic
removal. The controller revalidates expiry immediately before each push and
Railway upload, including after long tests or CI waits. A corrected candidate
does not reset the original three-attempt limit or extend the original window.

The separately approved `FIN-MONEY-03-RELEASE` is a one-time renewal after the
original three failed pre-deploy finance attempts. It must not use `--retry-from`
or rewrite that exhausted history. Prepare it with `--renewal-from <last-manifest>`,
`--renewal-ci-run <exact-failed-run-id>`, `--renewal-block FIN-MONEY-03-RELEASE`,
`--renewal-approved-at <recorded-human-approval-UTC-ISO-time>` and
`--max-release-attempts 1`. The approval time must be at or before preparation;
the new deadline is capped at six hours after that approval, never after it.
This is technical binding for an already supplied human approval, not permission
to create a renewal without one.

The renewal retains the exact failed predecessor SHA/manifest/CI and all three
historical attempts, the original live base, service, release version, SQL pins,
notes, disabled QA scope and rollback restrictions. Its only additional file is
the reviewed `tests/integration/costing-management-postgres.test.js` fixture.
The old chain may be expired when read as historical evidence; it remains
exhausted and cannot execute. The successor is locked to one exact corrected SHA,
one new attempt, and one recorded continuation. A renewal cannot be renewed or
enter the old retry flow. Any further failure requires stopping again. All CI,
new expiry, scope, migration and live/remote identity checks remain mandatory.

Production GitHub auto-deploy is disabled. Deploy manually only after exact-SHA CI
is green.

Required behavior:

- use `npm run release:railway-up`;
- pass the verified production branch to the helper with `--branch`. The
  controller also supplies `RELEASE_DEPLOY_BRANCH` to the deployment child
  process. When invoking the helper directly with that environment variable,
  scope it to the helper process;
- allow the helper to identify the production project explicitly;
- never run raw `railway up` from an unlinked worktree;
- never change Railway project, environment, service, owner, variables, secrets,
  or settings as part of release execution.

The helper must prove the uploaded SHA and branch through Railway metadata or its
clean archive release manifest. Legacy `RELEASE_DEPLOY_COMMIT` and
`RELEASE_DEPLOY_BRANCH` variables alone are not valid deployment identity.

### Resume an ordinary release after successful CI

Use `status` to find the recorded release SHA and deployment phase for an
ordinary block with no migrations, protected workflow, or writable QA. The
controller records `awaiting-ci` after push; `pre-upload-failed` records a
confirmed helper failure before Railway upload. Either phase can use
`release-resume` with the same manifest and confirmation to spend the next
attempt on that SHA. Add `--dry-run` to see the mode and SHA
without changing state or spending an attempt. Both paths require the exact
clean checkout, both successful production-push CI workflows, the recorded
production ref, and verified live identity. A retry also requires the original
base to still be live and the original authorization and budget to be valid.

If the recorded phase is `upload-starting` or `proof-pending`, inspect Railway
status and the deployment list for the fixed target. Wait for any active
deployment to settle. When `/api/version` proves the exact release SHA is live,
`release-resume` finishes the live checks and records success without another
upload or attempt. If upload may have started and the original base is still
live, `release-resume` stops. An already completed release returns its recorded
result.

After proof, `release-resume` publishes the approved release notes for the
verified SHA. A publication failure records `changelog.status` as `pending`
and the deployment as complete. Use `publish-notes` to retry publication.

If Railway confirms an upload was attempted and the exact deployment failed,
the existing manual recovery remains available for an ordinary release. Verify
that the failed deployment has settled, the original live base is still active,
the clean checkout and production ref equal the recorded release SHA, and both
CI workflows for that push succeeded. Record the failed Railway deployment ID
and the manual attempt number. Invoke the helper with the same explicit branch,
SHA, project, environment, service, and live URL inside the original deadline
and budget, counting controller and manual attempts together. Once the exact
SHA is live, finish proof via `release-resume` for a block with recorded state,
or run the version and release proof directly for a legacy block.

Record the Railway deployment ID with the block evidence. Resume uses the same
block lock as `execute`, records the attempt before upload, and leaves the
original deadline and total attempt budget in force. No new release commit or
push occurs. Older manifests without recorded deployment state remain historical
evidence and cannot use this action.

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

The heartbeat observes active work, resumes idle incomplete Green work, waits
for in-flight commands, and continues authorized Yellow work. It may prepare an
ordinary manifest when the Goal already authorizes production delivery. It stops
when the next action requires additional exact approval. Disable it when
acceptance is complete or the Goal is stopped. Reconnect by reopening the same
task and auditing Goal/worktree/block/CI/QA state before resuming; never start a
second writer on the same branch/worktree.

## 17. Instruction Discovery And Restart

Codex loads global instructions first and repository instructions from the project
root toward the working directory; more specific instructions appear later and
override earlier guidance. Global config and rules are loaded at startup.

After changing global `AGENTS.md`, `config.toml`, or `rules/default.rules`,
restart Codex desktop before relying on the new behavior.
