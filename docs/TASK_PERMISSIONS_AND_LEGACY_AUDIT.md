# Task permissions and legacy-data audit

Date: 2026-07-31Scope: static code audit plus attempted read-only PostgreSQL aggregate audit.Status: **decision document; no roles, permissions, auth, database schema, or production data changed.**

## Evidence sources

- `config/roles.js`: the legacy task flags are `taskVisibility`, `canCreateTasks`, `canDeleteTasks`, and `canAssignAnyone`.
- `middleware/auth.js`: `requireRole('admin')` and `requireRole('user')` expand through `LEGACY_ROLE_MAP`; this is not the same contract as `config/roles.js` flags.
- `services/taskPolicy.js`: per-record read/mutate/reassign/reschedule/observer policy.
- `services/taskDetailContract.js` and `services/taskContract.js`: drawer and card action contracts.
- `routes/tasks.js`: route-level enforcement.
- `js/tasks-page.js` and `js/profile-page.js`: currently rendered controls.

## Current effective permission matrix

| Action | Backend enforcement | Task policy | Current UI | Parity result / required reason |
|---|---|---|---|---|
| Read/list/detail/history/logs | authenticated request + business scope + `buildTaskVisibilityScope` | private tasks require owner or observer; own roles only own/observed tasks | visible tasks only; no explicit denial state | Mostly aligned. Hidden/404 is correct for unavailable records. |
| Create | `POST /api/tasks` uses `requireRole('admin','user')` + writable business scope | no per-record policy | composer hidden when `/permissions.canCreateTasks === false` | **Gap P1:** `requireRole('user')` expands to roles including `senior_instructor` and `instructor`, while `canCreateTasks` is false for them; backend may allow a create that UI hides. Reason should be `task.create` capability. |
| Edit/priority/subtasks/focus | generic role guard on some routes, then `loadMutableTask` / `canMutateTask` | owner for own roles; department/all roles; private only owner | detail contract disables edit, card actions are partially local | Mostly aligned where drawer contract is used. Non-drawer cards need the server `actionPermissions` contract, not local inference. |
| Reassign | `POST /:id/reassign` + writable scope; `taskExecution.reassignTaskOwner` | `canReassignTask` for department/all or `canAssignAnyone` | drawer currently requires `canEdit && canReassignTask` | **Gap P2:** drawer can hide reassignment for a permitted department/all actor when the record-level edit condition differs. Show disabled with `task.reassign` reason. |
| Reschedule/schedule/snooze | writable scope + scheduling service | `canRescheduleTask`; explicit `control_meta.canReschedule=false` blocks | My Day and cards infer the same control meta; drawer uses contract | Partial alignment. UI must use `drawer.actions.reschedule` / `actionPermissions.canReschedule` everywhere and show the policy reason. |
| Complete | writable scope + `completeTask` | mutation policy plus completion-report requirement | drawer and My Day action controls | Partial alignment. A report-required denial needs a distinct reason, not a generic disabled state. |
| Archive | bulk route only; `POST /bulk` uses generic role guard and visibility SQL | no per-task mutation check inside bulk route | postponed-task UI derives `canArchive`; bulk controls are selection-driven | **Gap P0:** an observer can be visible through `buildTaskVisibilityScope` but is not allowed by `canMutateTask`; bulk archive/restore/done/priority can currently rely on visibility rather than per-task mutation. Authorization fix requires explicit approval. |
| Delete | `DELETE /:id` uses `requireRole('admin')` and business scope | no `canDeleteTasks` check | UI uses `/permissions.canDeleteTasks` | **Gap P1:** route's legacy `admin` expansion is broader than the config flag; UI and backend disagree. Do not expose delete until a single `task.delete` capability is agreed. |
| Observers | writable scope + `loadMutableTask` + `canManageTaskObservers` | mutate **or** reassign authority | drawer action contract uses `canManageTaskObservers` | Aligned in the canonical drawer. Other renderers must not recreate this check. |
| Completion report | writable scope + `loadMutableTask` | mutation policy | drawer shows report requirement | Partial: submit/complete reasons are not consistently shown in all cards. |
| Review | `POST /:id/review` uses legacy role expansion + visibility/business scope | no task-policy selector | no canonical visible review capability in the drawer contract | **Gap P1:** backend role set and UI contract are not represented by one capability. |
| Bulk | `POST /bulk` generic legacy role guard + visibility/business scope | missing per-row mutation check | selection UI; no server-provided capability reason | **Gap P0:** see Archive. Bulk reassign has additional owner validation, but the other mutations remain affected. |

### Meaning of severity

- **P0** — possible authorization parity/security boundary; requires explicit approval before code changes.
- **P1** — backend/UI contract inconsistency; can hide allowed work or show a misleading control.

## Proposed capability matrix (before -> after)

This is a proposal only; it is **not** implemented.

| Capability | Current source of truth | Proposed source of truth |
|---|---|---|
| `task.read` | business scope + visibility SQL | same backend policy, exposed as a reasoned read decision |
| `task.create` | legacy `requireRole('admin','user')` plus coarse config flag | one backend capability returned by `/permissions` |
| `task.edit`, `task.complete`, `task.reschedule` | `canMutateTask` / `canRescheduleTask`, with route variation | per-task action contract with `allowed` and `reasonCode` |
| `task.reassign`, `task.observers` | `canReassignTask` / `canManageTaskObservers` | same policy, consumed directly by every UI surface |
| `task.archive`, `task.bulk` | mixed UI contract and bulk visibility SQL | explicit per-task mutation enforcement; bulk is allowed only when every target passes the required action |
| `task.delete`, `task.review` | legacy role expansion differs from config flags | explicit capability decisions, separately tested |

No default access should be broadened. The proposed matrix is intended to make current backend enforcement visible and to close accidental differences, not to grant new power.

## Legacy task-data audit rules

The following queries are designed to run inside `BEGIN READ ONLY` and return aggregate counts only.

| Rule | Deterministic auto-fix candidate? | Classification |
|---|---|---|
| Legacy owner token without `owner_user_id`, matching exactly one active user | Yes, after a second uniqueness and business-scope check | typed-owner backfill candidate |
| Legacy owner token without a unique matching user | No | manual review |
| Terminal status/workflow mismatch (`done != done`, `archived != archived`) | Potentially, only after approved canonical mapping | deterministic only for terminal states |
| Active task with `completed_at` | No | manual review; could be intentionally reopened |
| `date`, `deadline`, `scheduled_start_at` date disagreement | No | manual review; schedule and deadline can intentionally differ |
| Missing/blank business context | Potentially only when source/business ownership proves the target context | otherwise manual review |
| Partial source reference | No | manual review |
| Known source entity absent | No | manual review; source entities can be intentionally archived or external |
| Active duplicate according to canonical duplicate signature | No automatic delete; at most archive a noncanonical duplicate after an approved migration rule | review first |

## Exact count status

**Not executed — counts are intentionally not represented as zero.**

The repository has no `.env` and the permitted local CRM secrets file contains test-login data but no `DATABASE_URL`, `PRODUCTION_READONLY_DATABASE_URL`, `TASK_AUDIT_DATABASE_URL`, or `PG*` connection components. Therefore no PostgreSQL connection was available to perform the requested `BEGIN READ ONLY` aggregate audit.

To complete this section, provide one operator-controlled read-only connection string through `PRODUCTION_READONLY_DATABASE_URL` (or an equivalent read-only audit variable). The audit must:

1. start `BEGIN READ ONLY`;
2. verify `SHOW transaction_read_only = on`;
3. execute aggregate `SELECT` statements only;
4. record only counts and no customer/task text in this document;
5. roll back and close the connection.

## Required decisions before implementation

1. Approve or reject an authorization fix for **P0 bulk mutation enforcement**.
2. Choose which P1 UI parity gaps to fix: create, reassign, delete, review, and denial reasons.
3. Approve or amend the proposed capability names and `before -> after` matrix.
4. Provide a read-only DB audit connection to obtain exact counts.
5. After counts are available, choose which deterministic rules may appear in a migration. A migration file must not be created before that separate approval.

## Draft rollback approach (no migration exists)

If a later approved migration writes normalized fields, it must be idempotent, snapshot each affected row's old values into a migration-owned audit table or approved backup artifact, skip ambiguous records, and have a tested reverse SQL path. No task deletion is permitted.

## Approved implementation scope (2026-07-31)

The product owner approved only the following permissions-parity work:

- P0: every bulk target must pass the existing canMutateTask policy before any bulk mutation; bulk reassignment also requires the existing canReassignTask policy for every target.
- P1: surface the current route capabilities for create, delete, and review; use the canonical drawer contract for reassign and display a reason for disabled actions.
- No role definitions, role expansion, or backend access broadening.
- No legacy-data migration file, database change, production migration, deploy, or production data mutation.

The legacy-data counts and normalization rules remain blocked on an operator-provided read-only database audit.
