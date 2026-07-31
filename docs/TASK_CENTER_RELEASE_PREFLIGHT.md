# Task Center release preflight

**Prepared:** 2026-07-31 (Europe/Kyiv)
**Scope:** read-only production, Railway, and Git evidence only. No migration, merge, version bump, deploy, or production write was performed.

## Confirmed production state

| Item | Evidence | Result |
| --- | --- | --- |
| Live URL | `GET /api/version` | `https://8223324090-production.up.railway.app` |
| Live version | `/api/version` | `0.80.44` — `Hermes bot-native staff onboarding` |
| Live commit | `/api/version` and Railway deployment metadata | `87fd0363c50491def4097ffc13d079395007570e` |
| Confirmed Railway source branch | `/api/version.sourceBranch`; configured release metadata is complete | `codex/lead-guest-context-v08018-final` |
| Railway service state | Read-only `railway status --environment production --json` | CRM deployment `SUCCESS` and `RUNNING` |
| Rollback source | Current known-good production deployment | `87fd0363c50491def4097ffc13d079395007570e` on `codex/lead-guest-context-v08018-final`, v`0.80.44` |

## Migration 308 readiness

Local file: `db/migrations/308_task_saved_views_preferences.sql`.

The migration has the required `MIGRATION_KIND`, `SAFETY`, and `ROLLBACK` headers. It is additive and idempotent:

- adds `task_user_preferences.saved_task_views JSONB NOT NULL DEFAULT '[]'::jsonb` with `ADD COLUMN IF NOT EXISTS`;
- adds `task_user_preferences.saved_task_views_revision INTEGER NOT NULL DEFAULT 0` with `ADD COLUMN IF NOT EXISTS`;
- adds the named JSONB-array check only when the constraint is absent;
- does not read, update, delete, or migrate task rows;
- rollback policy is to retain the additive columns for an application rollback; permanent removal requires an explicitly separate operation after export/discard of saved views.

Production preflight was executed through `eventgenix_audit_ro` in one `BEGIN READ ONLY` transaction, verified with `SHOW transaction_read_only = on`, and always ended with `ROLLBACK`. It queried only the migration ledger and schema catalog; no task, user, preference, or connection data was printed.

| Read-only production check | Result |
| --- | --- |
| `schema_migrations` contains `308_task_saved_views_preferences` | No |
| `task_user_preferences.saved_task_views` exists | No |
| `task_user_preferences.saved_task_views_revision` exists | No |
| `task_user_preferences_saved_task_views_array_check` exists | No |

**Decision:** migration 308 is required before enabling server-side Saved Views in production. A release that includes the Saved Views routes without first applying this migration would fail against the current production schema.

## Exact integration path

The confirmed Railway source head and current live commit are the same:

```text
origin/codex/lead-guest-context-v08018-final
87fd0363c50491def4097ffc13d079395007570e
```

`codex/task4-overview` is not a fast-forward candidate:

| Comparison | Commits |
| --- | ---: |
| Source-only | 4 |
| Feature-only | 8 |
| Common base | `6177e897fa1f9cb876919d8714a8869d855ba309` |

Create a clean integration worktree from `origin/codex/lead-guest-context-v08018-final` and cherry-pick these Task Center product commits in this order:

1. `b01860c4f` — overview, Team Control, and planning.
2. `8e74dce53` — Saved Views, URL sync, and permission parity; includes migration 308.
3. `3c8e43d36` — Task Center parity report and browser smoke.
4. `09ad997ea` — approved dead summary-strip cleanup.

Do not include these feature-only commits in the Task Center product integration unless separately requested:

- `b025ab6bb` — unrelated sidebar test timing adjustment.
- `f060ec46c`, `2a4a3ed20`, `c16b110d3` — legacy audit tooling and documentation; no Task Center runtime dependency.
- this preflight document commit — release evidence only, not a runtime dependency.

Resolve cherry-pick conflicts manually in the clean integration worktree, rerun CI on the exact integrated SHA, and do not create a merge commit into the Railway source branch.

## Version floor and release guardrails

- Live version is `0.80.44`; the release version must be strictly higher. The minimal patch candidate is `0.80.45`.
- Do not run migration 308, version bump, release commit, push to the Railway source branch, or deploy until the owner approves the exact release version and migration execution.
- Before deploy, re-read live `/api/version`, fetch the confirmed source branch, ensure the integration worktree is clean, and verify the intended integrated SHA is current on the confirmed source branch.
- After a successful migration and release, run CI, deploy only the confirmed source SHA with `RELEASE_DEPLOY_BRANCH=codex/lead-guest-context-v08018-final`, then perform version smoke and live QA only with test accounts/tasks.
- If the release fails, restore the rollback source commit `87fd0363c50491def4097ffc13d079395007570e` (v`0.80.44`) using the same confirmed Railway source branch. Do not remove migration 308 during an application rollback.

## Required owner approval text for the next task

> Підтверджую release `0.80.45` (або вказану мною вищу версію) на підтвердженій Railway source branch `codex/lead-guest-context-v08018-final`. Дозволяю створити clean integration worktree від commit `87fd0363c50491def4097ffc13d079395007570e`, cherry-pick лише `b01860c4f`, `8e74dce53`, `3c8e43d36`, `09ad997ea`, вирішити лише їхні конфлікти, запустити migration `308_task_saved_views_preferences` на production, зробити version bump, commit, push, CI, deploy і live QA тільки тестовими задачами/акаунтами. Не дозволяю додавати audit commits, змінювати ролі/auth/Railway settings або виконувати будь-які інші production migrations. Rollback source: `87fd0363c50491def4097ffc13d079395007570e` (v0.80.44); migration 308 під час rollback не видаляти.
