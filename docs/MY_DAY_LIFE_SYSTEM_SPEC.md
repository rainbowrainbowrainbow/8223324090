# My Day Life System — canonical contract

## Purpose and location

This document is the fixed implementation contract for personal directions,
impacts, blockers, actual task time, habits, and the contribution matrix.

The system lives in **Profile → My Day**. Its three modes are **Day**,
**Habits**, and **Contribution**. Management of directions, impacts, and habits
lives in **Profile → Settings → My Day**. There is no new top-level page,
sidebar item, role, permission, or navigation-access rule.

My Day extends the existing personal task projection
\`GET /api/tasks/my-cabinet\`; it never replaces Tasks, task lifecycle,
scheduling, checklist, overdue, or business-scope behavior.

## Scope and data ownership

- Every direction, impact, habit, classification, check-in, and time entry is
  owned by one authenticated user.
- A task classification belongs to the pair \`(user_id, task_id)\`. A task
  visible to several users may have a different private classification for each
  user.
- Every task-derived read and write uses the current task
  visibility/ownership policy and the current authorized business-scope helper.
  This feature never broadens task access.
- Task-derived reads use the current authorized business context only.
  Multi-business and all-business scopes are not writable My Day scopes.
- Personal taxonomy and habits are never returned to another user, including
  a manager, observer, and task owner.
- \`tasks.category\`, \`business_context\`, \`task_mode\`, and \`visibility\`
  retain their existing meanings and are never directions or impacts.
- Authentication, roles, \`PAGE_ACCESS\`, cross-business visibility, Railway,
  CI/CD, environment variables, and secrets are out of scope.

## Timezone and local dates

- Product timezone: \`Europe/Kyiv\`.
- A date-only value is \`YYYY-MM-DD\` in \`Europe/Kyiv\`.
- \`today\` is the current Kyiv calendar date.
- A seven-day range is today plus the prior six Kyiv dates.
- Database timestamps are absolute timestamps. Local grouping uses
  \`AT TIME ZONE 'Europe/Kyiv'\`.

## Canonical schema

All new durable product tables are introduced through additive SQL migrations
with migration-governance headers. No startup bootstrap, production seed, or
historical-task backfill is allowed.

### Private taxonomy

\`my_day_directions\` and \`my_day_impacts\` have the same columns:

| Column | Contract |
| --- | --- |
| \`id\` | Primary key. |
| \`user_id\` | Required FK to \`users\`; private owner. |
| \`name\` | Required trimmed name, unique case-insensitively within the user's catalog. |
| \`color\` | Required normalized six-digit CSS hex value with \`#\`. |
| \`icon\` | Required short text icon, maximum 32 characters. |
| \`sort_order\` | Required integer; ascending order defines catalog order. |
| \`is_active\` | Required boolean, default \`true\`. |
| \`archived_at\` | Null while active; archive timestamp otherwise. |
| \`created_at\`, \`updated_at\` | Audit timestamps. |

Catalog records are archive-only. UI has no hard-delete operation. An archived
record remains linked to historic work and is absent from new-classification
selectors. A rename changes the label in the live historical projection; the
MVP intentionally has no name snapshot. Index each catalog by
\`(user_id, is_active, sort_order, id)\`.

### Personal task classification

\`my_day_task_metadata\`:

| Column | Contract |
| --- | --- |
| \`user_id\` | Required FK to \`users\`. |
| \`task_id\` | Required FK to \`tasks\`. |
| \`direction_id\` | Nullable FK to \`my_day_directions\`; archived directions remain linked. |
| \`created_at\`, \`updated_at\` | Audit timestamps. |

Its unique key is \`(user_id, task_id)\`. An absent row or null
\`direction_id\` is valid and is represented as **Без напряму**.

\`my_day_task_impacts\`:

| Column | Contract |
| --- | --- |
| \`user_id\` | Required FK to \`users\`. |
| \`task_id\` | Required FK to \`tasks\`. |
| \`impact_id\` | Required FK to \`my_day_impacts\`; archived impacts remain linked. |
| \`created_at\` | Audit timestamp. |

Its unique key is \`(user_id, task_id, impact_id)\`. The service rejects more
than three impacts for the pair before writing. No rows are represented as
**Без впливу**. Index task tables by \`(user_id, task_id)\`.

### Task blockers

\`task_dependencies\` is the canonical dependency table already introduced by
the task taxonomy migration.

- \`task_dependencies.task_id\` is the blocked task.
- \`task_dependencies.depends_on_task_id\` is its prerequisite.
- \`isBlocked\` is true when at least one prerequisite status is not
  \`done\`, \`archived\`, or \`cancelled\`.
- Self-links, duplicate pairs, and directed cycles are rejected.
- \`tasks.dependency_ids\` is synchronized in the same transaction for legacy
  consumers only. New behavior never reads it as the source of truth.
- Blocked is projection state; the system never writes
  \`tasks.status='blocked'\`.
- A blocker is a top-level task, not a subtask and not a waiting state.
- Quick-created prerequisites inherit the source task's owner, visibility,
  task mode, business context, and direction. They inherit no impacts.

### Actual task time

\`my_day_time_entries\`:

| Column | Contract |
| --- | --- |
| \`id\` | Primary key. |
| \`user_id\` | Required FK to \`users\`; the private entry owner. |
| \`task_id\` | Required FK to a task currently visible to the user in the active business scope. |
| \`started_at\` | Required absolute timestamp. |
| \`ended_at\` | Nullable absolute timestamp; null means an active timer. |
| \`source\` | Required value \`timer\` or \`manual\`. |
| \`created_at\`, \`updated_at\` | Audit timestamps. |

A unique partial index enforces one active timer per user:
\`UNIQUE (user_id) WHERE ended_at IS NULL\`. Starting another task atomically
stops the active timer. Starting the same task again is idempotent. Completion
stops the current user's active timer for that task.

Manual entries require positive duration of no more than 24 hours and cannot
overlap another entry of the same user. Entries longer than eight hours are
highlighted but never truncated. Contribution calculations split a session at
Kyiv midnight. \`tasks.effort_minutes\` remains planned effort only.

### Habits

\`my_day_habits\` contains \`id\`, \`user_id\`, \`name\`, \`color\`, \`icon\`,
\`sort_order\`, \`is_active\`, \`archived_at\`, \`created_at\`, and
\`updated_at\` with the same private archive rules as taxonomy, plus:

| Column | Contract |
| --- | --- |
| \`metric\` | Required \`boolean\`, \`count\`, or \`minutes\`. |
| \`target_value\` | Required positive integer; exactly 1 for boolean. |
| \`cadence\` | Required \`daily\`, \`selected_weekdays\`, or \`times_per_week\`. |
| \`weekdays\` | Required only for selected weekdays; unique ISO days 1–7. |
| \`times_per_week\` | Required only for weekly cadence; positive integer. |
| \`direction_id\` | Nullable FK to \`my_day_directions\`. |

\`my_day_habit_impacts\` links one habit to zero through three impacts and has
unique key \`(habit_id, impact_id)\`.

\`my_day_habit_checkins\` has required \`habit_id\`, \`user_id\`,
\`local_date\`, \`value\`, \`status\`, \`created_at\`, and \`updated_at\`.
\`status\` is \`done\` or \`skipped\`; its unique key is
\`(habit_id, user_id, local_date)\`. A check-in write replaces that one local
date idempotently. Skipped is not done. Paused habits create no expected
check-ins. Archived habits preserve history.

Habits do not create recurring tasks, dependencies, overdue items, task
statuses, or task time. Habit minutes and task minutes are separate. There is
no streak engine.

## API contract

All new personal routes use \`/api/my-day\`, require the existing
authentication, and return \`success: true\` on success. Failures return
\`success: false\`, a stable code, and a safe Ukrainian error message.

### Directions and impacts

| Endpoint | Contract |
| --- | --- |
| \`GET /api/my-day/directions\` | Return active directions in \`sort_order, id\` order. \`includeArchived=1\` includes archived rows. |
| \`POST /api/my-day/directions\` | Create from \`name\`, \`color\`, \`icon\`, optional \`sortOrder\`. |
| \`PATCH /api/my-day/directions/:id\` | Rename, recolor, re-icon, or reorder caller-owned direction. |
| \`POST /api/my-day/directions/:id/archive\` | Archive caller-owned direction. |
| \`GET /api/my-day/impacts\` | Same list contract for impacts. |
| \`POST /api/my-day/impacts\` | Create an impact. |
| \`PATCH /api/my-day/impacts/:id\` | Edit caller-owned impact. |
| \`POST /api/my-day/impacts/:id/archive\` | Archive caller-owned impact. |

Foreign catalog IDs return \`404 MY_DAY_TAXONOMY_NOT_FOUND\`. Malformed names,
colors, icons, duplicate names, and sort values return
\`400 MY_DAY_VALIDATION_ERROR\`. Archived IDs in a new classification return
\`409 MY_DAY_TAXONOMY_ARCHIVED\`.

### Task classification

\`GET /api/my-day/tasks/:taskId/classification\` returns the caller's
\`direction\` object or \`null\`, plus an \`impacts\` array.

\`PUT /api/my-day/tasks/:taskId/classification\` accepts:

\`\`\`json
{ "directionId": 3, "impactIds": [7, 8] }
\`\`\`

\`directionId: null\` and \`impactIds: []\` remove that part of the caller's
classification. The request replaces the whole classification in one
transaction. It validates current task read visibility, current writable
business scope, active caller-owned taxonomy, numeric IDs, unique impact IDs,
and the maximum of three impacts. It persists nothing on failure.

Error contract:

| Condition | Result |
| --- | --- |
| Task outside current task visibility or business scope | \`404 MY_DAY_TASK_NOT_FOUND\` |
| Viewable task denied by current mutation policy | \`403 MY_DAY_TASK_CLASSIFICATION_FORBIDDEN\` |
| Malformed payload, duplicate impact, foreign taxonomy | \`400 MY_DAY_VALIDATION_ERROR\` |
| More than three impacts | \`409 MY_DAY_IMPACT_LIMIT_EXCEEDED\` |

### Blockers

| Endpoint | Contract |
| --- | --- |
| \`GET /api/tasks/:taskId/dependencies\` | Return visible prerequisites and \`isBlocked\`. |
| \`POST /api/tasks/:taskId/dependencies\` | Add \`dependsOnTaskId\` with existing policy/scope checks. |
| \`POST /api/tasks/:taskId/dependencies/quick-create\` | Create and link one inherited top-level prerequisite. |
| \`DELETE /api/tasks/:taskId/dependencies/:dependsOnTaskId\` | Remove the pair and synchronize legacy IDs. |

The primary Day action leads to the prerequisite. **Завершити попри блокер** is
an explicit permitted completion action.

### Time, habits, and contribution

| Endpoint | Contract |
| --- | --- |
| \`GET /api/my-day/timer\` | Return the caller's active timer or \`active: null\`. |
| \`POST /api/my-day/timer/start\` | Start \`taskId\`; atomically stop a prior timer. |
| \`POST /api/my-day/timer/stop\` | Stop active timer; no active timer succeeds idempotently. |
| \`GET /api/my-day/time-entries\` | List caller entries for an inclusive validated Kyiv range. |
| \`POST /api/my-day/time-entries\` | Create one validated, non-overlapping manual entry. |
| \`PATCH /api/my-day/time-entries/:id\` | Edit the caller's manual entry with overlap validation. |
| \`POST /api/my-day/time-entries/:id/archive\` | Archive a manual correction without deleting audit history. |
| \`/api/my-day/habits\` | GET, POST; PATCH \`/:habitId\`; POST \`/:habitId/archive\`. |
| \`PUT /api/my-day/habits/:habitId/check-ins/:localDate\` | Idempotently replace one caller check-in. |
| \`GET /api/my-day/contribution?from=YYYY-MM-DD&to=YYYY-MM-DD\` | Return the personal matrix for inclusive range up to 92 days. |

## My Day projection

\`GET /api/tasks/my-cabinet\` remains the canonical Day-mode read model. Every
task receives this optional field without changing existing fields:

\`\`\`json
{
  "myDay": {
    "direction": { "id": 3, "name": "Здоров'я", "color": "#22C55E", "icon": "♥", "isActive": true },
    "impacts": [],
    "isBlocked": false,
    "openDependencyCount": 0,
    "actualMinutes": 35,
    "activeTimer": false
  }
}
\`\`\`

Absent personal data is represented as \`direction: null\`, \`impacts: []\`,
and \`actualMinutes: 0\`. Task classification, dependency, and time joins are
batched with aggregate joins/subqueries in the projection; no query is executed
per task. Completed history follows the same object contract.

## UX contract

### Day

The existing composer, drag/drop, reschedule, checklist, completion, overdue
triage, and task action menu remain canonical.

- Composer has compact **+ Напрям** and **+ Вплив** controls. They use active
  private taxonomy selectors and never block creation.
- A card shows one direction chip, one impact chip, and \`+N\` for remaining
  impacts. **Без напряму** is shown only where classification context is
  requested, not as permanent noise on every card.
- **Змінити маркування** in the card menu opens the same accessible selector.
- A completed unclassified task exposes the non-blocking action **Додати
  напрям**.
- A blocked card shows blocker state, count, and next prerequisite title.
- Time uses one Start/Stop control. The active task shows elapsed local time;
  other tasks show accumulated actual minutes.
- Chips wrap, titles remain readable, and touch controls are at least 44 by 44
  CSS pixels.

### Habits

Habits mode lists active habits due today and provides the metric-appropriate
check-in control. Settings contains habit create/edit/archive. A habit card
uses the same optional direction and impact chips as a task. Paused and
archived history appears in settings, not as due work.

## Contribution mathematics

Contribution is a transparent matrix, never a productivity score.

- Completed task total counts unique top-level \`tasks\` rows with
  \`status='done'\` and \`completed_at\` in the inclusive Kyiv range.
  Checklist items and subtasks never increase it.
- A reopened task whose completion is cleared is not counted.
- Direction totals are mutually exclusive: every completed task contributes
  once to its direction or **Без напряму**. Direction columns sum to task total.
- Impact totals overlap: a task contributes once to each impact. Impact columns
  are never added into a global total.
- Task minutes equal each time-entry intersection with the selected range,
  split at Kyiv midnight. Unfinished-task time and active timer time count.
- Habit completion comes only from \`done\` check-ins and remains separate by
  metric. Habit minutes never add to task minutes.
- The response labels task count, task minutes, habit count, and habit minutes
  as different measures.

## Loading, error, empty, and accessibility

- A mode loads inside its named region with \`aria-busy="true"\`; previous
  successful content remains visible during refresh.
- A failed refresh keeps existing content and shows a compact Retry action.
  With no previous content it shows a focused safe error state and Retry.
  Raw server errors, SQL, IDs, and authorization diagnostics are never shown.
- Empty Day states explain that classification is optional and retain the task
  composer. Empty Habits offers **Створити звичку**. Empty Contribution shows
  selected dates and zero totals, never an invented score.
- Modes use one \`role="tablist"\`, \`role="tab"\`, \`aria-selected\`, and
  \`aria-controls\`; only the active panel is exposed.
- Icon-only controls have accessible names. Chips have text as well as color
  and icon. List selectors support keyboard focus, Arrow navigation,
  Enter/Space selection, Escape close, and focus return to the trigger.
- Success and failure announcements use \`aria-live="polite"\`. The blocker
  completion control is explicitly labelled and does not rely on color.

## Delivery sequence and exclusions

1. Directions, impacts, task classification, settings, and Day projection.
2. Blocker dependency UX and canonical dependency APIs.
3. Actual time entries and timer UX.
4. Habits, check-ins, settings, and Day/Habits switch.
5. Contribution matrix, regression tests, release verification, and live QA.

Every slice preserves existing task behavior. No slice seeds production data,
classifies old tasks, changes task-category semantics, changes access, or
deploys without an explicit release task.

Excluded from this MVP: OKRs, goal trees, Eisenhower matrix, mood/energy,
Pomodoro/idle tracking, AI prioritization, calendar integration, billing,
team timesheets, complex streaks, cross-business analytics, new dependencies,
and auth or infrastructure changes.

