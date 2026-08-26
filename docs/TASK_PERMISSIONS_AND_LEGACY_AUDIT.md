# Task permissions and legacy-data audit

Date: 2026-08-26
Scope: static code audit, focused task-permission tests, and documentation re-baseline.
Status: **Task 25 evidence refresh; no runtime authorization gap found; no application roles, application permissions, auth runtime, database schema, migrations, or production task data changed. The existing read-only PostgreSQL audit role was hardened for this audit.**

## Evidence sources

- `config/roles.js`: legacy task flags are `taskVisibility`, `canCreateTasks`, `canDeleteTasks`, and `canAssignAnyone`.
- `middleware/auth.js`: request authentication and legacy route role expansion.
- `config/permissionRegistry.js`: canonical action permissions for task route capabilities.
- `services/taskPolicy.js`: per-record read/mutate/reassign/reschedule/observer policy and explicit action allow/deny resolution.
- `services/taskExecution.js` and `services/taskReschedule.js`: mutation services used by direct task action routes.
- `services/taskDetailContract.js` and `services/taskContract.js`: server-derived drawer/card action contracts.
- `routes/tasks.js`: task route enforcement, bulk mutation ordering, and action capability guards.
- `js/tasks-page.js` and `js/profile-page.js`: frontend permission hydration and task action visibility.
- `tests/task-permissions-parity.test.js`: focused regression coverage for canonical task capabilities, explicit deny, drawer parity, hydration, and bulk guard ordering.

## Task 15 re-baseline result

The older P0 bulk mutation finding is **closed in the current runtime**.

Current `routes/tasks.js` bulk flow:

1. authenticates the request through the router;
2. validates action and target ids;
3. loads all requested target rows using task visibility and business-scope SQL;
4. rejects missing or invisible targets before mutation;
5. rejects any target that fails `canMutateTask(req.user, task)` with `TASK_BULK_MUTATION_FORBIDDEN`;
6. for `assign`, rejects any target that fails `canReassignTask(req.user, task)` with `TASK_BULK_REASSIGN_FORBIDDEN`;
7. performs the first `UPDATE tasks t` only after those checks pass.

`tests/task-permissions-parity.test.js` statically asserts this ordering so the route cannot drift back to visibility-only bulk mutation without failing tests.

## Current effective permission matrix

| Action | Backend enforcement | Record-level policy | Frontend contract | Re-baseline result |
|---|---|---|---|---|
| Read/list/detail/history/logs | authenticated request + business scope + `buildTaskVisibilityScope` | private tasks require owner or observer; own roles only own/observed tasks | visible tasks are rendered from API payloads; unavailable records are hidden or reported as missing | Aligned. Hidden/404 remains the expected result for records outside scope. |
| Create | task creation endpoints use `requireTaskRouteCapability('create')`, canonical `tasks.create`, and writable business scope | no existing record | create/composer/template/operation-pack controls stay hidden until `/api/tasks/permissions` hydrates and `create.allowed === true` | Aligned. Explicit `action_denylist` wins over role defaults. |
| Edit/priority/subtasks/focus/commitment/observers/completion report | mutable routes use `loadMutableTask` or equivalent visible-row load before write | `canMutateTask`; private tasks are owner-only for mutation; department/all roles follow their configured scope | canonical drawer uses server `actions`/`reasons`; local quick controls remain backend-authoritative | Aligned for security. UI must not be treated as the authorization boundary. |
| Reassign | direct reassign route uses `taskExecution.reassignTaskOwner`; full edit checks owner changes; bulk assign checks every target | `canReassignTask` for department/all scope or `canAssignAnyone`; bulk also requires `canMutateTask` for every target | drawer uses `actions.reassign` directly, not `canEdit && canReassignTask` | Aligned. The older drawer P2 is closed. |
| Reschedule/schedule/snooze | reschedule service loads a visible task and checks `canRescheduleTask` before update; related writable routes use mutable-task guards | `canRescheduleTask`; explicit `control_meta.canReschedule=false` blocks | drawer uses `actions.reschedule`; other controls remain backend-authoritative | Aligned for security. Drawer parity is covered by the server-derived contract. |
| Complete/status done | `completeTask` and status-update routes load visible task, then check `canMutateTask` before write | mutation policy plus completion-report/subtask requirements where applicable | drawer/My Day controls use action state and backend responses | Aligned for authorization. Business-rule denial reasons can still differ by surface but do not create a permission bypass. |
| Archive/restore/done/priority bulk | `POST /api/tasks/bulk` loads all targets, checks target count, then checks every row before first `UPDATE` | every target must pass `canMutateTask`; `assign` additionally requires `canReassignTask` | selection toolbar is convenience UI; server is authoritative | **Closed.** The older P0 bulk mutation gap is not present in current code. |
| Delete | delete and duplicate-cleanup routes use `requireTaskRouteCapability('delete')`, canonical `tasks.delete`, and business scope | route capability owns this action; no separate per-record task-policy selector is currently part of the contract | UI consumes `/api/tasks/permissions.capabilities.delete` and drawer delete reasons | Aligned with the current canonical action-capability contract. Explicit deny wins. |
| Review | review route uses `requireTaskRouteCapability('review')`, canonical `tasks.review`, and visibility/business scope | task completion/review state still applies before writes | drawer exposes review denial reasons from the server policy | Aligned. Explicit deny wins. |

## Canonical task route capabilities

| Capability | Owner | Backend consumers | Frontend consumers | Explicit deny behavior |
|---|---|---|---|---|
| `tasks.create` | task creation actions | `routes/tasks.js` creation, operation-pack, dependency quick-create, AI-draft commit routes | Task Center create controls after permission hydration | `action_denylist: ['tasks.create']` blocks even if the role has default access. |
| `tasks.delete` | task deletion and duplicate cleanup | `routes/tasks.js` delete and dedup cleanup routes | drawer delete action and Task Center delete controls | `action_denylist: ['tasks.delete']` blocks even if the role has default access. |
| `tasks.review` | task review submission | `routes/tasks.js` review route | drawer review action and reasons | `action_denylist: ['tasks.review']` blocks even if the role has default access. |

These capabilities intentionally mirror the existing role defaults where applicable. The re-baseline did not broaden default access.

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

Task 25 completed the aggregate-only production legacy-data audit with a
dedicated read-only PostgreSQL credential exposed locally as
`TASK_AI_ROLLOUT_DATABASE_URL`.

Read-only safety proof:

- transaction mode: `BEGIN READ ONLY`;
- verified `transaction_read_only=on`;
- verified `default_transaction_read_only=on`;
- persistent CRM table write grants for the audit role: `0`;
- output policy: aggregate counts only; no task/customer text, prompts,
  filenames, raw logs, URLs, passwords, tokens, or provider responses.

Latest aggregate-only artifact:
`.codex-temp/task25-task-legacy-audit.json`.

Production aggregate counts from 2026-08-26:

| Counter | Count | Classification |
|---|---:|---|
| total tasks | 2926 | baseline only |
| missing `owner_user_id` | 1819 | legacy ownership compatibility population |
| owner token single active user candidates | 0 | no deterministic typed-owner backfill candidate found by this audit |
| owner token manual review | 9 | manual review only; no automatic production write |
| terminal status/workflow mismatch | 925 | legacy compatibility/manual review bucket; not a permission bypass |
| active task with `completed_at` | 0 | no active completed-at inconsistency found |
| `date`/`deadline` disagreement | 1 | manual review; schedule and deadline can intentionally differ |
| `date`/`scheduled_start_at` disagreement | 0 | no mismatch found |
| `deadline`/`scheduled_start_at` disagreement | 0 | no mismatch found |
| missing/blank business context | 0 | no missing business-context rows found |
| partial source reference | 1061 | manual review/legacy source-reference bucket |
| active duplicate signature input rows | 464 | duplicate analysis input only |
| active duplicate signature groups | 40 | manual review only; no automatic archive/delete |
| task action history rows | 1849 | related-table aggregate |
| task subtask rows | 239 | related-table aggregate |
| task dependency rows | 8 | related-table aggregate |
| My Day task impact rows | 372 | related-table aggregate |

These counts are intentionally not interpreted as zero-risk cleanup approval.
They identify legacy/manual-review buckets only. Any production backfill,
delete, archive, duplicate cleanup, or canonicalization requires a separate
explicit data-fix task with its own read-only preflight and approval.

## Historical implementation decisions

The 2026-07-31 approval allowed the following task-permission parity work:

- every bulk target must pass the existing `canMutateTask` policy before any bulk mutation;
- bulk reassignment also requires the existing `canReassignTask` policy for every target;
- create, delete, and review use canonical task action capabilities;
- drawer reassignment uses the canonical server-derived action contract;
- no role definitions, role expansion, backend access broadening, database change, production migration, deploy, or production data mutation were part of that scope.

The current code and focused regression tests confirm those authorization items are implemented.

## Access-system baseline after Tasks 4-8

- `view_revenue` protects financial fields in booking/banquet and subscription responses; financial-only deposit operations deny before business services.
- `manage_settings` governs subscription/package/feature-flag administration and system configuration mutations such as catalog settings, lead-assistant settings, and program-icon settings.
- `export_data` is additive: payroll, HR report, attendance PDF, and schedule XLSX exports require both their relevant domain capability and this export capability. A payroll or HR view alone is insufficient.
- Public integration exceptions are owned by explicit integration contracts with an owner, authentication mechanism, source guard, and focused tests.
- The registry, route guards, and frontend visibility are checked together by access, action-permission, permission-registry, capability-policy, auth-boundary, and API-surface checks.

## Remaining risks

- Legacy task-data aggregate counts are no longer credential-deferred, but the
  non-zero legacy/manual-review buckets above are not approved for automatic
  data cleanup.
- Non-drawer Task Center quick actions may still choose how much disabled-state explanation to show, but backend route/service guards remain authoritative and covered by tests.
- No runtime authorization gap was found during Task 15, so this re-baseline requires no patch release or Railway deploy.
