# Task Center product contract

This document defines the read contract shared by `/tasks`, My Day, alerts, and CRM task contexts. It is additive: database snake_case fields remain available for legacy clients while UI code consumes the normalized camelCase fields.

## Canonical response boundary

`services/taskContract.normalizeTaskPayload()` is the single server response normalizer. Both `routes/tasks.js` and `services/taskCabinetProjection.js` call it. New task-producing endpoints must return this normalized task rather than rebuilding owner, scheduling, report, or observer fields locally.

`js/task-ui-shared.js` is the single browser read boundary. New UI code must use `TaskUiShared.normalizeTask()` or its selectors; it must not re-implement owner, lifecycle, due-date, or visibility precedence.

## Field precedence

| Domain | Canonical read fields | Legacy/input fallbacks | Rule |
| --- | --- | --- | --- |
| Owner | `ownerUserId`, `ownerLabel`, `ownerState` | `owner_user_id`, `assigned_to`, `owner` | A positive typed owner ID wins. Without it, a non-empty legacy label is retained and gets `legacy_unknown_owner`; otherwise the state is `unassigned`. |
| Lifecycle | `status`, `workflowState` | `workflow_state` | Explicit workflow wins. If absent, status maps `done` to `done`, `archived` to `archived`, `in_progress` to `in_progress`; all other statuses map to `todo`. |
| Schedule | `scheduledStartAt`, `scheduledEndAt`, `snoozedUntil`, `dueAt`, `dueDate` | `scheduled_*`, `snoozed_until`, `date`, `deadline`, `remind_at` | Workload/due precedence is exact schedule, snooze, date, deadline, reminder. `scheduledEndAt` is for timing/overdue display, not the workload-date key. |
| Taxonomy | `taskMode`, `taskKind`, `visibility` | `task_mode`, `task_kind` | Preserve explicit visibility. Missing visibility reads as `private` only for private mode and `team` otherwise, so historical rows remain visible exactly as before. New writes use `TaskCreate.defaultVisibilityForTaskMode()`. |

## Context data

`TaskUiShared.taskContext()` exposes source (`source_type`, `source_id`, module, surface), business context, related CRM entity, subtasks, dependencies, reports, and observers. It is read-only UI data; policy enforcement remains server-side in `taskPolicy` and `taskExecution`.

## Compatibility rules

- Do not remove `assigned_to`, `owner`, snake_case scheduling fields, or existing API response properties.
- A legacy task without `owner_user_id` must remain in policy query fallbacks and UI lists.
- Do not infer a typed owner from a display name in the browser.
- Do not use a due-date selector to change task state; scheduling, snoozing, and lifecycle mutations remain separate API actions.
- The contract is additive and does not require a migration, role change, or client-side storage.

## Frontend module boundary

The first extraction keeps `tasks-page.js` as the page controller while moving domain selection to `TaskUiShared`:

- `TaskUiShared`: task normalizer and domain/query selectors.
- `TaskCreate`: canonical creation payload and due-preset write mapping.
- `tasks-page.js`: page state, fetch orchestration, page-specific rendering and actions.
- `profile-page.js`: My Day state, rendering and actions.

Further render extraction must preserve these selectors and keep page state out of reusable domain modules.
