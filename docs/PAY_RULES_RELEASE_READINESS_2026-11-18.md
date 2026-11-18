# Configurable compensation: release preparation

Status: local preparation only; wait for the owner's explicit queue-clear/start
signal. No production push, upload, migration or production QA mutation occurred.
The completed implementation goal did not authorize those actions.

## Candidate and production snapshot

- Source checkpoint: `f6e43394f68641f8234eba35f314abfafba37be8` on
  `codex/configurable-pay-rules-20261118` (original local implementation).
- Current production/live base verified read-only:
  `566c4efedef069d595fbd43071b6eb3adf68c0bf`, v0.83.116,
  `CRM-доступ і звільнення в Park`. Live and origin matched at preparation.
- Integrated functional commit: `397307997e70a82a2ba90e0080175f8fea6ad6fa`.
  Its only cherry-pick conflicts were HR asset markers; new assets were added
  with the current 0.83.116 markers. Current production HR account/offboarding
  behavior is retained.
- CI coverage follow-up: `4cac953fa` adds the new SQL suite to the existing
  `payroll` mode and the actual-app browser suite to existing `fullstack` mode.
  Browser evidence goes under the existing uploaded HR-pay artifact directory.
  No workflow, trigger, permission or GitHub setting was changed.
- Candidate branch: `codex/pay-rules-release-prep-20261118`.
  Worktree: `D:/Codex/EventGenix/pay-rules-release-prep-20261118`.
- Observed queued predecessor: `8d52d56f566dd71d1aaee8ab3219c7fb6ef71e05`,
  freelance v0.83.118. Its merge preview with our candidate has only an `hr.html`
  asset-marker conflict; services, HR JavaScript/routes and test runner merge
  automatically. Preview is evidence, not authorization to include or deploy
  another task's unshipped work.

The candidate deliberately retains the base version until the queue clears.
0.83.117 and 0.83.118 are already used by parallel candidates. 0.83.119 is only
the next observed free suggestion, not a reservation. Re-fetch production and
recheck in-flight releases before selecting the actual next free patch. The
Railway helper's same-version guard currently rejects uploading this candidate
over the live 0.83.116 binary; do not override that guard.

## Release scope and migration

Release label: `Налаштовувані ставки, рівні та доплати`.
Notes: `docs/release-notes-configurable-pay-rules.json` (five Ukrainian entries,
validated with the controller's existing release-note schema).

Exactly one new migration: `db/migrations/423_configurable_pay_rules.sql`.
It adds nullable JSON columns to profile versions, profiles and vacancies, plus
empty scoped default, qualification/history and manual commission-input tables.
It seeds no rates, profiles, assignments, staff changes or payroll entries.
The current remote and observed queued candidate still end at migration 422.
Recheck numbering at final integration; never replace an already published SQL.
Canonical SQL hash and file inventory are in the ignored readiness snapshot.

The owner explicitly approved the ten local PAY-RULES-ACCESS mappings. Their
existing payroll capability sets, membership, scope, ownership and period locks
remain intact. Production execution must bind the precise deployment/migration
and any required Red authorization to one bounded release envelope; a local
approval or technical manifest confirmation alone is insufficient.

Production target remains fixed: branch `codex/eventgenix-production`, Railway
project `fortunate-appreciation` / `bc28b46c-d4bc-491c-893a-d8401c633668`,
environment `production` / `d9f9b984-d54d-4620-a8bf-c48882ad5158`, service
`8223324090` / `3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`.
Observed Railway deployment `9d8ef823-fa77-4b37-af3e-6273ae58a971` succeeded.
The owner queue hold remains binding even if the service itself reports idle.

## Local validation

Integrated focused regression selection: 75 passed, no failures/skips.
The integrated full `npm test`, expanded isolated `payroll` mode and actual-app
browser journey are rerun for this preparation; see the final ignored receipt
and `output/pay-release-*.log` for actual terminal results. Earlier goal evidence
is preserved in `docs/CONFIGURABLE_PAY_RULES_VERIFICATION.md` and is not relabeled
as proof of this new base.

Node 22.23.4 / npm 10.9.9; shared ignored node_modules junction, no install or
application dependency/lockfile change. Process-only GNU Bash settings reuse the
genuine bundled shell for the existing mirror bootstrap tests. Local PostgreSQL
17 is the task-owned loopback cluster on port 59643; a startup-only
`checkpoint_completion_target=0` avoids the previously diagnosed database-drop
checkpoint delay, without disabling durability or changing production settings.
All mutations are synthetic and confined to disposable local test databases.

Exact-SHA GitHub CI has not run: no remote push is part of this preparation.
Authenticated live QA remains deferred; the canonical local credentials file
was absent at this preflight. Do not print or request credentials in chat.

## Final release sequence after the queue-clear signal

1. Fetch production, inspect the actual settled live version/SHA and queued
   predecessor. Rebase/cherry-pick only this task's commits onto that verified
   base. Preserve unrelated released HR/freelance behavior. Recheck migration 423.
2. Bind one exact owner authorization for the fixed target, schema migration,
   reviewed payroll/access scope and read-only QA. No real rate import, payouts,
   backfill, production fixture, secret or setting mutation is included.
3. Select the next free patch and create the separate release/cache commit with
   the canonical version tool. Revalidate markers, notes and the changed-file
   inventory. Do not use the stale base version or a reserved parallel patch.
4. Prepare a fresh bounded controller manifest using the current runbook,
   release label/notes and `--qa-scope none`. Verify exact migration scope,
   live/remote identity, rollback SHA and dry-run. Do not start an expiring
   execution manifest or spend attempts while waiting in the queue.
5. Within that authorization, let the controller run its per-attempt local
   baseline, push the exact production SHA, and require green exact-SHA main CI
   and Runtime artifact smoke before the repository Railway helper upload.
6. Verify exact `/api/version`, branch/SHA, release label and asset proof. Perform
   only authorized read-only HR inspection. `PAY_RULES_RELEASE_POSTCHECKS.sql`
   provides aggregate schema/configuration checks after the migration.
7. Publish the supplied Ukrainian notes through the normal controller and save
   sanitized release evidence. Real employee-rate entry remains a separate task
   with exact dates/units/amounts from the private 28-row owner guide.

## Rollback and unresolved business policy

Keep the additive schema and all history. Before any new rule/template/input is
used, the verified prior binary can be a rollback candidate under a separate
valid release decision. Once configured terms or qualification/commission data
exist, do not silently deploy a legacy calculator that ignores those terms:
prefer a compatible forward fix, preserve captured snapshots, and separately
approve any real-data repair. Aggregate postchecks distinguish these cases;
nonzero counts never authorize cleanup.

Remaining product boundaries are explicit: commission bases are manual; partial
commission months and unagreed absence policies require review; other companies'
legacy staff/profile ownership remains unavailable. These are not automatic
production conversions. Source date/unit/amount ambiguities remain in the
private entry guide; no real rates are seeded by deployment.
