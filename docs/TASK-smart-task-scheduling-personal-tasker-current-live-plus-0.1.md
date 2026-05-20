# TASK: Codex Execution - Smart Task Scheduling + Personal Tasker Upgrade

Priority: HIGH
Date: 2026-05-20
CRM Version: current live + 0.1
Type: CODEX_EXECUTION_TASK + PLAN_THEN_IMPLEMENT + BACKEND_SERVICE_LAYER + TASK_UI_UPGRADE

## Analysis Dependency

Read first:

- `docs/SMART_TASK_SCHEDULING_ANALYSIS_2026-05-20.md`

This implementation task must use that analysis as the source impact map. Do not treat this as greenfield.

## Mission

Upgrade Event Genix CRM tasks from simple due-date handling into a shared smart scheduling system:

- four compact day slot quick actions;
- default task duration of 30 minutes;
- smart nearest-window search inside selected slot;
- proposal behavior when no slot window is available;
- fast reschedule from list/card/detail;
- durable history for scheduling, reschedule, delegation, owner changes, and missed-slot events;
- missed-slot accountability flow;
- profile/gamification/shop-safe discipline events;
- consistent scheduling logic across tasks, profile, alerts, dashboard/work queue, chat, templates, operation packs, and scheduler writers.

## Approved First-Pass Product Decisions

Use these as approved defaults for this task unless direct repo evidence or an explicit Serhiy override inside the same run proves a specific default is unsafe.
Encode these defaults into the implementation task; do not turn them back into blocking questions.

1. Canonical four day slots:
- A. Fixed global slots for everyone.

2. Meaning of "tasks without time on top":
- C. Date-only tasks go above timed tasks inside their day group.

3. Behavior when a chosen slot is full:
- C. Save a proposal state that must be confirmed.

4. Missed-slot penalty target:
- B. Owner gets penalty, creator gets notification only.

5. First penalty model:
- B. Discipline score only.

6. `chat_tasks` strategy:
- A. Leave separate; smart scheduling applies only to canonical `tasks`.

## Product Decision Rule

Do not hard-stop just to re-ask approved first-pass defaults.
Treat the approved defaults above as locked for first implementation.

Stop only if repo evidence proves that a default would create a real contradiction, unsafe migration, or broken delivery path.
If that happens, ask only the specific blocked question and explain which approved default is no longer safe.

## Mandatory Pre-Implementation Steps

1. Verify current reality:
   - read `AGENTS.md`;
   - run `git status --short --branch`;
   - confirm current runtime version from repo-approved version command;
   - verify live version using the repo version smoke command.
2. Use the approved first-pass defaults above; do not stop merely because the analysis file contains the original product questions.
3. Do not hardcode a guessed target version. Use the repo canonical patch-release flow from the current live version.
4. Inspect dirty files before editing and do not overwrite user changes.

## Primary File Targets

Backend:

- `routes/tasks.js`
- `routes/work-queue.js`
- `routes/auth.js` only if Profile quick-status needs routing through the canonical execution layer
- `services/kleshnya.js`
- `services/taskExecution.js`
- `services/taskActionHistory.js`
- `services/taskPolicy.js`
- new `services/taskScheduling.js`
- `services/scheduler.js`
- `services/gamification.js`
- `services/workQueue.js`
- `services/taskTemplates.js`
- `services/kleshnya-chat.js`
- `routes/chat.js`
- `services/chatService.js` only if product chooses to bridge `chat_tasks`

Database:

- new migration under `db/migrations/`
- migration must follow current migration governance headers.

Frontend:

- `js/tasks-page.js`
- `js/profile-page.js`
- `js/alerts.js`
- `js/dashboard-page.js`
- `js/chat-page.js`
- related CSS only if the new scheduling controls need layout/states.

Docs/release:

- `index.html` changelog modal
- `CHANGELOG.md`
- version references via canonical version sync

Tests:

- `tests/route-smoke.test.js`
- `tests/work-queue.test.js`
- `tests/tasks.test.js` or a new focused task scheduling test
- `tests/ui-check.js`
- any relevant scheduler/gamification tests

## Required Backend Design

Create `services/taskScheduling.js` as the canonical scheduling service.

It must own:

- four day slot definitions;
- duration defaulting;
- date + slot + duration normalization;
- exact manual time normalization;
- availability search for owner/date/slot;
- proposal result when the selected slot is full;
- schedule write payloads;
- missed-slot detection helpers;
- canonical sorting metadata.

Add or reuse fields so the system can store:

- scheduled start;
- scheduled end;
- selected slot;
- schedule mode;
- schedule status;
- duration;
- scheduling metadata/proposals;
- missed-slot processing state;
- typed creator id for accountability notifications.

Use `tasks.effort_minutes` for duration only if product confirms duration and effort are the same contract. Otherwise add a dedicated schedule duration field.

## Required API Changes

Add schedule-aware API endpoints:

- `GET /api/tasks/schedule-policy`
- `GET /api/tasks/schedule/availability`
- `POST /api/tasks/:id/schedule`

Extend existing endpoints carefully:

- `POST /api/tasks` must accept schedule payload and call `taskScheduling`.
- `POST /api/tasks/:id/reschedule` must route schedule-aware payloads through `taskScheduling`, while preserving legacy deadline behavior.
- `PATCH /api/work-queue/tasks/:taskId/deadline` should either keep legacy deadline behavior or gain a schedule-aware sibling endpoint, depending on product decision.

Do not duplicate slot math in frontend code.

## Required UI Changes

Main implementation surface: main tasks module.

Tasks page:

- add four compact icon slot controls in create flow;
- support arbitrary date selection without making exact manual time the default flow;
- add duration control with 30-minute default;
- add fast reschedule controls in task cards/list actions;
- update detail modal with advanced exact time mode;
- show schedule status, slot, duration, and missed/proposal states clearly;
- extend task history UI to show scheduling events.

Profile/My Cabinet:

- support same schedule semantics for quick personal/private task creation where appropriate;
- ensure done/snooze/open behavior does not bypass canonical scheduling state.

Alerts:

- replace date-at-23:59 raw deadline reschedule with schedule-aware contract.

Dashboard/work queue:

- ensure task queue execution reads new schedule fields and still supports durable task actions.

Chat:

- update canonical task creation from chat to pass schedule payload if the UI exposes it.
- If `chat_tasks` remains separate, document that smart scheduling applies only to canonical tasks.

## Required Accountability Flow

Implement missed-slot processing in backend scheduler:

- detect active scheduled tasks whose scheduled end passed;
- write `task_slot_missed` to `task_action_history`;
- update schedule status and missed timestamps idempotently;
- notify responsible owner/assignee;
- notify creator if typed creator exists;
- publish a structured task discipline event;
- call gamification/profile penalty hook once per missed slot.

Penalties must be idempotent. Retried scheduler runs must not double-charge or double-penalize.

## Required History Taxonomy

Extend task action history with schedule/action types such as:

- `task_scheduled`
- `task_schedule_moved`
- `task_schedule_manual_override`
- `task_schedule_proposal_created`
- `task_slot_missed`
- `task_discipline_penalty_applied`

History entries must include:

- old value;
- new value;
- actor;
- source surface;
- summary;
- enough meta to reconstruct slot/date/duration/window changes.

## Required Sorting Contract

Create one canonical schedule sort rule:

- tasks without exact time first;
- then tasks for current day;
- then tasks for future days;
- inside timed blocks sort by scheduled time.

Implement this server-side and expose stable sort metadata to frontend surfaces. Frontend may mirror the sort for already-loaded arrays but must not become the source of truth.

## Writer Coverage Checklist

Verify and update as needed:

- tasks quick create;
- task detail save;
- task card/list reschedule;
- profile quick create;
- profile quick actions;
- alerts create/reschedule;
- dashboard task widgets;
- work queue task actions;
- canonical chat task creation;
- Kleshnya chat task creation;
- recurring tasks;
- hot lead follow-up tasks;
- booking/template/operation-pack task writers;
- assistant/task creation helpers if they call `/api/tasks`.

## Verification Requirements

Run the smallest focused checks first, then repo baseline:

- `npm run check:runtime`
- focused Node tests for task scheduling/task execution/work queue
- `npm run test:ui`
- `npm test`

If touching scheduler/gamification/accountability:

- add focused unit/route tests for missed-slot idempotency;
- verify no double penalty;
- verify creator notification event is emitted only once.

Manual verification:

- create task with each of four slots;
- create task with default duration;
- create task with custom duration;
- attempt scheduling when selected slot is full and verify proposal behavior;
- reschedule from list/card;
- reschedule from detail;
- create from Profile/My Cabinet;
- create/reschedule from Alerts;
- verify dashboard/work queue still shows and mutates tasks;
- verify history shows old -> new for schedule moves and owner/delegation changes;
- simulate missed slot and verify accountability event, notification, and penalty behavior;
- verify mobile hit targets and keyboard focus for slot controls.

Live verification after deploy:

- run repo version smoke against live host;
- log in to live CRM and confirm updated tasks UX is visible;
- verify no regression in `/tasks`, `/profile`, alerts panel, dashboard work queue, and chat task creation.

## Deployment Contract

This is an implementation task, so complete the real delivery flow:

- bump version from current live by `+0.1` through the repo canonical version flow;
- update changelog and visible release notes in Ukrainian;
- run required checks;
- commit relevant changes;
- push through the real GitHub delivery flow for this repo;
- run required deployment step if applicable;
- smoke-check the live CRM after deploy.

Do not push/deploy only if repo evidence contradicts an approved default in a way that makes schema, accountability, idempotency, or delivery unsafe.

## Stop Conditions

Stop and report instead of forcing a partial implementation if:

- an approved first-pass product decision is contradicted by repo reality in a way that makes implementation unsafe;
- a separate `chat_tasks` migration/bridge decision is required before safe implementation;
- ownership/creator identity cannot be made typed without a broader auth/data migration;
- missed-slot penalties would double-count due to missing idempotency key;
- live deploy target/branch is unclear.

## Final Report Required

Return:

1. Reality check:
   - repo path;
   - branch;
   - clean/dirty status;
   - current live version and target version.
2. Product decisions used.
3. Files changed.
4. Schema/API/service/UI changes.
5. Writer coverage.
6. Verification commands and results.
7. Manual/live checks.
8. Remaining risks.
9. Deployment status.
