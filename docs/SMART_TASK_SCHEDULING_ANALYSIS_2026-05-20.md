# Smart Task Scheduling + Personal Tasker System Analysis

Date: 2026-05-20
Scope: analysis only, no production code changes, no version bump, no deploy
Confirmed live version: `v0.60.2 - Assistant Full Rethink`

## Reality Check

- Source repo: `C:\Users\Plotva\OneDrive\Документи\EventGenix`
- Branch: `claude/check-project-version-f2QmG`
- Worktree before analysis: clean
- Live runtime evidence:
  - `npm run version:smoke -- https://8223324090-production.up.railway.app` passed and reported `v0.60.2 - Assistant Full Rethink`.
  - Live `GET /`, `/tasks`, `/profile`, `/js/tasks-page.js`, `/js/profile-page.js`, `/js/alerts.js` returned HTTP 200.
- Source evidence is primary. Old docs/task files were not used as source of truth.

## Source Of Truth Map

### Core Task Model

Confirmed by source:

- Main task table and writer: `services/kleshnya.js#createTask`.
- Public task API: `routes/tasks.js`.
- Canonical typed owner: `tasks.owner_user_id`, introduced by `db/migrations/174_task_execution_truth_v2.sql`.
- Legacy owner/display compatibility: `tasks.assigned_to`, `tasks.owner`.
- Existing time-ish fields:
  - `tasks.date`
  - `tasks.deadline`
  - `tasks.time_window_start`
  - `tasks.time_window_end`
  - `tasks.remind_at`
  - `tasks.snoozed_until`
  - `tasks.effort_minutes`
- Existing OS fields:
  - `task_mode`
  - `task_kind`
  - `visibility`
  - `workflow_state`
  - `focus_rank`
- Existing execution history: `task_action_history`.
- Existing legacy history: `task_logs`.

Conclusion: this is not greenfield. Smart scheduling should extend the existing Tasks OS, not replace it.

### Current API And Mutation Paths

Reusable canonical paths:

- `POST /api/tasks` creates canonical tasks through `kleshnya.createTask`.
- `GET /api/tasks` lists tasks with visibility scope.
- `GET /api/tasks/my-cabinet` feeds Profile/My Cabinet task projection.
- `POST /api/tasks/:id/complete` uses `services/taskExecution.completeTask`.
- `POST /api/tasks/:id/reassign` uses `services/taskExecution.reassignTaskOwner`.
- `POST /api/tasks/:id/reschedule` uses `services/taskExecution.rescheduleTask`.
- `GET /api/tasks/:id/history` reads `task_action_history`.
- `PATCH /api/work-queue/tasks/:taskId/deadline` also uses `rescheduleTask`.

Insufficient or risky paths:

- `PUT /api/tasks/:id` can change `deadline`, `date`, owner, OS fields, and time window directly, but logs only a generic legacy `task_logs` update.
- `POST /api/tasks/:id/snooze` updates `snoozed_until` and `workflow_state='scheduled'`, but does not write `task_action_history`.
- `/auth/tasks/:id/quick-status` updates task status from Profile/My Cabinet and writes only legacy `task_logs`.
- `services/scheduler.js#checkTaskOverdue` directly sets `status='overdue'`, while the public task status enum is `todo/in_progress/done`.
- `services/chatService.js` has a separate `chat_tasks` table that is not the canonical `tasks` table.

### UI Surface Map

Main tasks module:

- `js/tasks-page.js` is the primary UX surface.
- Quick add currently supports today/tomorrow capture intent plus optional exact time from `taskDeadlineTime`.
- Card quick actions include status cycle, waiting, `+1 год` snooze, delete.
- Detail modal supports deadline, remind_at, owner, mode, kind, workflow, observers, subtasks, and history.
- Current frontend sorting prioritizes done/new/created time, not the requested canonical schedule order.

Profile/My Cabinet:

- `js/profile-page.js` uses `/api/tasks/my-cabinet`.
- My Day and My Tasks show tasks with quick `done`, `snooze`, `open`.
- Quick personal/private create posts to `/api/tasks`.
- No slot or duration UX exists here.

Alerts:

- `js/alerts.js` can create tasks from alerts through `POST /api/tasks`.
- Alert reschedule currently uses generic `PUT /api/tasks/:id` with a date-at-end-of-day deadline.
- This is a concrete place where a scheduling service must replace frontend-only deadline logic.

Dashboard and Work Queue:

- `routes/dashboard.js` has task widgets and overdue alert data using `deadline`.
- `services/workQueue.js` builds overdue/today/future task queue items from `deadline`/`date`.
- `routes/work-queue.js` already uses the durable task execution layer for done/owner/deadline actions.
- This is the best existing pattern for smart scheduling actions: durable mutation, history event, refetch.

Chat:

- `js/chat-page.js` has canonical task creation via `POST /api/tasks`.
- `services/kleshnya-chat.js` creates canonical tasks via `kleshnya.createTask`.
- `routes/chat.js` and `services/chatService.js` also create/read `chat_tasks`, a separate task-like model.
- Scheduling must either explicitly bridge `chat_tasks` or keep it out of scope and only support canonical tasks.

Templates, Routines, Operation Packs, Automations:

- `routes/tasks.js` operation packs create canonical tasks via `kleshnya.createTask`.
- `services/scheduler.js#checkRecurringTasks` creates recurring tasks via `kleshnya.createTask`.
- Hot lead and booking-related schedulers create canonical tasks.
- `services/taskTemplates.js` generates event task payloads with `date`, status, priority, category.
- These writers must not each implement slot math locally.

Gamification, Profile, Shop, Quests

- `services/gamification.js#onTaskComplete` awards coins/XP on completion.
- `services/scheduler.js#checkTaskOverdue` applies coin penalties through `spendCoins`.
- Achievements and quests count completed tasks through `assigned_to = userId`, which conflicts with the newer `owner_user_id` source of truth.
- Wallet/shop/profile systems exist and are reusable, but task discipline penalties need an idempotent backend event hook.

## Existing vs Missing Contracts

### Already Exists And Reusable

- Canonical `tasks` table and task creation path.
- `owner_user_id` typed ownership plus `taskPolicy` visibility helpers.
- Transactional execution service for complete/reassign/reschedule.
- Durable `task_action_history` with actor snapshot, old/new JSON, source surface, meta, summary.
- My Cabinet task projection and quick task actions.
- Dashboard/work-queue task execution rails.
- Existing `effort_minutes` field, suitable as the duration source if product confirms it.
- Existing `time_window_start/end`, usable as legacy display or migration input, but not sufficient as canonical scheduled window.
- Existing alerts, notifications, WebSocket refresh, and event bus patterns.
- Existing gamification/wallet/achievement/shop systems.

### Exists But Insufficient

- `date + deadline` is enough for simple due dates, but not for a smart slot with duration, start/end, fallback proposal, and missed-slot state.
- `time_window_start/end` are string fields and do not provide timezone-safe scheduled instants.
- `effort_minutes` exists, but no policy applies the 30-minute default or uses it for availability search.
- Reschedule updates only `deadline`; it does not assign slot metadata, duration, scheduled window, or fallback proposals.
- Task history action types only cover complete, owner reassignment, reschedule, observer updates.
- My Cabinet and alerts mutate tasks without the same durable history semantics as `taskExecution`.
- Sorting differs by surface: tasks list, My Cabinet, dashboard widgets, work queue all order tasks differently.
- Gamification still relies heavily on legacy `assigned_to`, so typed-owner tasks can be undercounted or penalized inconsistently.

### Missing And Must Be Introduced

- Shared backend scheduling policy service.
- Four canonical day slots and slot preset contract.
- Availability search for owner/date/slot/duration.
- Schedule proposal contract when a slot has no room.
- Canonical schedule mutation endpoint.
- Schedule metadata fields, including scheduled start/end, slot, duration, mode, status, and missed-slot processing state.
- Typed creator source of truth for creator notifications. Current `created_by` is a username snapshot, not a stable user id.
- Durable action types for scheduling:
  - `task_scheduled`
  - `task_schedule_moved`
  - `task_slot_missed`
  - `task_schedule_proposal_created`
  - `task_schedule_manual_override`
  - `task_discipline_penalty_applied`
- Idempotent backend discipline event hook for penalties/profile/gamification.
- Shared server-side schedule sorting contract, mirrored in frontend only for local arrays.
- Tests for schedule policy, API mutation, writer normalization, missed-slot idempotency, and UI/static expectations.

### High-Risk / Regression-Prone Areas

- Ownership split: `owner_user_id` is canonical, but old gamification/quests/achievements still use `assigned_to`.
- Status split: scheduler writes `status='overdue'`, while API validation expects `todo/in_progress/done`.
- History split: `task_action_history` and `task_logs` coexist.
- Writer split: tasks page, profile, alerts, dashboard work queue, chat, Kleshnya chat, scheduler, templates, and operation packs all create or mutate task timing.
- `chat_tasks` is a separate table and can drift from canonical task scheduling.
- Timezone handling must be explicit. Existing code often uses Kyiv date strings, but exact scheduled windows should be stored as timezone-safe timestamps.
- Duplicate detection includes date/deadline fields, so changing scheduling semantics can alter duplicate behavior.
- Penalties must be idempotent. A scheduler retry must not charge coins twice for the same missed slot.

## Scheduling Architecture Recommendation

Build smart scheduling as a backend service layer on top of the existing Tasks OS.

Recommended new service:

- `services/taskScheduling.js`

Responsibilities:

- Define four canonical day slots.
- Normalize incoming schedule payloads from all writers.
- Apply default duration of 30 minutes when duration is absent.
- Resolve exact scheduled start/end from date + slot + duration + owner availability.
- Search nearest available window inside the selected slot.
- Return alternative proposals when the selected slot has no window.
- Write durable schedule history.
- Provide canonical schedule sorting metadata.
- Provide missed-slot detection inputs for scheduler.

Recommended data extension:

- Keep `tasks.date` as the day-level compatibility field.
- Keep `tasks.deadline` as the legacy due/deadline compatibility field.
- Use `tasks.effort_minutes` as duration if product confirms duration and effort are the same concept.
- Add schedule-specific fields:
  - `scheduled_start_at TIMESTAMPTZ`
  - `scheduled_end_at TIMESTAMPTZ`
  - `schedule_slot TEXT`
  - `schedule_mode TEXT` such as `auto_slot`, `manual_exact`, `suggested`
  - `schedule_status TEXT` such as `unscheduled`, `scheduled`, `missed`, `completed`, `cancelled`
  - `schedule_meta JSONB`
  - `missed_at TIMESTAMPTZ`
  - `missed_processed_at TIMESTAMPTZ`
  - `created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`

Recommended API layer:

- `GET /api/tasks/schedule-policy`
- `GET /api/tasks/schedule/availability?ownerUserId=&date=&slot=&durationMinutes=`
- `POST /api/tasks/:id/schedule`
- Extend `POST /api/tasks` to accept schedule payload and call the scheduling service.
- Keep `/api/tasks/:id/reschedule` for deadline compatibility, but route schedule-aware payloads through the new scheduling service.

Canonical sorting rule:

- Implement on the server and return enough fields for every UI to display the same order.
- Proposed sort contract:
  1. Active tasks without exact time, grouped first.
  2. Tasks scheduled for today.
  3. Tasks scheduled for future days.
  4. Inside timed groups, sort by `scheduled_start_at`, then priority, then created_at.
- Frontend should mirror this only for already-loaded arrays, not invent its own business rule.

Writer strategy:

- Do not implement slot math in `js/tasks-page.js`.
- Route every writer through the same backend contract:
  - tasks quick add
  - task detail
  - profile quick add
  - alerts task creation/reschedule
  - dashboard work queue schedule action
  - chat canonical task creation
  - scheduler recurring/hot lead writers
  - operation packs/templates

## Accountability + Gamification Map

Missed slot detection:

- Add a scheduler pass that finds active canonical tasks where:
  - `scheduled_end_at < now`
  - status is not done/cancelled/archived
  - schedule status is scheduled
  - missed event has not already been processed
- It should write `task_action_history` event `task_slot_missed`.
- It should update `schedule_status='missed'`, `missed_at`, and `missed_processed_at`.

Notifications:

- Notify the assignee/owner.
- Notify the creator when a typed `created_by_user_id` exists.
- Notify observers if product decides they should see missed accountability events.
- Use backend notification/event hooks, not frontend-only alerts.

Penalty and profile impact:

- Add a backend discipline event hook instead of calling `spendCoins` ad hoc from UI.
- The hook should be idempotent by task id + schedule window id/event id.
- It should publish a structured event such as `task.discipline.missed_slot`.
- Gamification can consume that event to apply coins/profile discipline changes.
- Achievements, quests, leaderboard, and shop should not depend on stale `assigned_to` logic for new discipline events.

## Product Questions For Serhiy

1. What are the four canonical day slots?
- A. Fixed global slots for everyone, e.g. morning / midday / afternoon / evening.
- B. Role-based slots, e.g. managers/operators/animators can have different default windows.
- C. User-configurable slots stored in task preferences.

2. What does "tasks without time on top" mean exactly?
- A. Tasks with no `scheduled_start_at`, even if they have a date.
- B. Only fully unscheduled tasks with no date and no time.
- C. Tasks with date-only should appear above timed tasks inside that date.

3. If the selected slot has no available window, what should the quick action do?
- A. Save nothing and show proposals only.
- B. Auto-pick the nearest later window outside the slot.
- C. Create a scheduled proposal state that must be confirmed in the task card/detail.

4. For missed-slot accountability, who gets the negative discipline event?
- A. Current typed owner/assignee only.
- B. Owner plus creator gets notified but not penalized.
- C. Depends on delegation state: owner is penalized, delegator is notified, unresolved ownership falls back to creator/process owner.

5. What should the first penalty model affect?
- A. Coins only.
- B. Separate discipline score only.
- C. Both coins and discipline score, with achievements/leaderboard adjusted carefully.

6. What should happen to `chat_tasks`?
- A. Leave `chat_tasks` separate; smart scheduling only supports canonical `tasks`.
- B. Bridge new chat task creation into canonical `tasks`, keep old `chat_tasks` read-only/legacy.
- C. Migrate chat task UX fully to canonical `tasks`.

## Follow-Up Implementation Boundary

The implementation should start only after the product questions above are answered. The next task should be a real implementation task with version wording `current live + 0.1`, migration, tests, changelog, GitHub delivery flow, deploy, and live smoke verification.
