# My Day Life System — canonical contract

## Purpose and location

This document is the fixed implementation contract for personal impacts,
blockers, actual task time, habits, and the contribution matrix.

The system lives in **Profile → My Day**. Its three modes are **Day**,
**Habits**, and **Contribution**. Management of impacts and habits
lives in an internal **My Day setup surface** opened from
**Profile → My Day → Налаштувати Мій день**. It is not a fourth My Day mode and
not part of general **Profile → Settings**. There is no new top-level page,
sidebar item, role, permission, or navigation-access rule.

My Day extends the existing personal task projection
\`GET /api/tasks/my-cabinet\`; it never replaces Tasks, task lifecycle,
scheduling, checklist, overdue, or business-scope behavior.

## User mental model

My Day uses an impacts-only active UX:

- Impacts are the only active classification control in task, habit, setup,
  and contribution UX.
- Impacts use one catalog with four statistical groups: `context` (where the
  work belongs), `activity` (what kind of work is done), `outcome` (the
  business result), and `personal` (the life area). The groups guide AI and
  reporting; they are not a second classification control.
- A representative work task normally uses `context + activity + outcome`.
  The system never forces all groups, and cross-product work may use two
  contexts.
- A task or habit may have zero through three impacts.
- Legacy directions remain in the database and API for rollback/history, but
  new active UX does not ask for a direction and new writes do not change
  legacy `direction_id`.

UI helpers and examples explain this model, but they are guidance only; they do
not add required validation. Classification remains optional.

Practical examples:

- Доробити CRM-фічу → impacts Робота: CRM, Продукт / розробка, Якість сервісу.
- Підготувати зміну в парку → impacts Робота: Парк, Якість сервісу, Команда / делегування.
- Налаштувати Hermes worker → impacts Робота: Hermes, Автоматизація / AI, Ризики / безпека.

## Scope and data ownership

- Every impact, habit, classification, check-in, and time entry is
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

\`my_day_directions\` and \`my_day_impacts\` have the same durable columns.
Directions are legacy taxonomy: they remain readable for rollback/history,
but the active My Day UX uses only impacts.

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
| \`direction_id\` | Legacy nullable FK to \`my_day_directions\`; preserved for rollback/history and not changed by new active UX writes. |
| \`tags\` | Legacy \`TEXT[]\`, retained only for rollback compatibility. Active My Day code does not read, render, or write it. |
| \`created_at\`, \`updated_at\` | Audit timestamps. |

Its unique key is \`(user_id, task_id)\`. New active classification writes
replace only impact links while preserving any existing legacy \`direction_id\`
and \`tags\` data. Separate task tags are retired and must not be mapped to
global task categories, watchdog labels, impacts, or any other storage without
an explicitly approved data-fix.

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
  task mode, and business context. They inherit no impacts and do not require
  a direction.

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

`my_day_time_entries` is a personal ledger. If a task is later reassigned, the
current user's recorded time remains in that user's contribution while the task
must still belong to the current authorized business context. Contribution never
exposes hidden task titles or other private task fields from this ledger.

### Habits

`my_day_habits` contains private habit definitions with `id`, `user_id`, `name`,
`color`, `icon`, legacy optional `direction_id`, metric/cadence fields,
`is_paused`, `is_archived`, `archived_at`, `sort_order`, `created_at`, and
`updated_at`.

| Column | Contract |
| --- | --- |
| \`metric\` | Required \`boolean\`, \`count\`, or \`minutes\`. |
| \`target_value\` | Required positive integer; exactly 1 for boolean. |
| \`cadence\` | Required \`daily\`, \`selected_weekdays\`, or \`times_per_week\`. |
| \`weekdays\` | Required only for selected weekdays; unique ISO days 1–7. |
| \`times_per_week\` | Required only for weekly cadence; positive integer. |
| \`direction_id\` | Legacy nullable FK to \`my_day_directions\`; preserved for rollback/history and not written by new active UX. |

\`my_day_habit_impacts\` links one habit to zero through three impacts and has
unique key \`(habit_id, impact_id)\`.

`my_day_habit_checkins` has required `habit_id`, `user_id`,
`local_date`, `value`, `state`, `created_at`, and `updated_at`.
`state` is `done` or `skipped`; its unique key is
`(habit_id, user_id, local_date)`. A check-in write replaces that one local
date idempotently. Skipped is not done. Paused habits create no expected
check-ins. Archived habits preserve history.

Habits do not create recurring tasks, dependencies, overdue items, task
statuses, or task time. Habit minutes and task minutes are separate. There is
no streak engine.


## Manual starter kit

The starter kit is not a startup bootstrap, global/default production seed,
historical-task backfill, login side effect, deploy side effect, or hidden data
creation. It is a caller-owned manual action from the internal My Day setup
surface.

Canonical endpoint: `POST /api/my-day/starter-kit`.

Contract:

- The endpoint requires the existing authenticated caller and never accepts an
  arbitrary `userId`.
- It creates rows only with `req.user.id` in the already existing
  `my_day_impacts`, `my_day_habits`, and `my_day_habit_impacts` tables.
  It does not create `my_day_directions`.
- It runs in one transaction and uses caller-scoped idempotency by normalized
  name.
- Repeating the action returns a created/skipped summary and creates no
  duplicate starter rows.
- Canonical/legacy starter impact name matches are normalized to the canonical
  name, color, icon, and order while preserving the selected row ID and archive
  state. Exact declared aliases are merged transactionally: task and habit
  links move to the most-used row, and duplicate rows are retained archived.
- Existing habits remain unchanged. Their archive state, metric, cadence,
  target, and current impacts are never overwritten.
- It does not create tasks, dependencies, overdue items, task time entries,
  active timers, or habit check-ins.
- Failures return the normal safe Ukrainian My Day error response.

Canonical payload:

- impacts-only starter kit.
- Context impacts: `Робота: Парк`, `Робота: CRM`, `Робота: Hermes`.
- Activity impacts: `Операційка / процеси`, `Автоматизація / AI`,
  `Продукт / розробка`, `Аналітика / рішення`, `Контент / медіа`,
  `Маркетинг / залучення`, `Команда / делегування`,
  `Стратегія / пріоритети`.
- Outcome impacts: `Продажі / клієнти`, `Фінанси / облік`,
  `Якість сервісу`, `Системність`, `Швидкість / ефективність`,
  `Бренд / репутація`, `Ризики / безпека`.
- Personal impacts: `Здоровʼя`, `Фізична форма`, `Відновлення`,
  `Побут / комфорт`, `Навчання / розвиток`, `Близькі / стосунки`.
- Habits:
  - `Ранкова зарядка`: `minutes`, target `10`, `daily`, impacts
    `Здоровʼя` and `Фізична форма`.
  - `Планування дня`: `boolean`, target `1`, `daily`, impacts
    `Системність` and `Швидкість / ефективність`.
  - `Відновлення без екранів`: `minutes`, target `30`, `daily`, impacts
    `Відновлення` and `Здоровʼя`.
  - `Навчання 20 хв`: `minutes`, target `20`, `selected_weekdays`,
    weekdays Monday-Friday (`1,2,3,4,5`), impacts `Навчання / розвиток` and
    `Системність`.
  - `Побутовий порядок`: `boolean`, target `1`, `times_per_week`, weekly
    target `3`, impacts `Побут / комфорт` and `Відновлення`.

UX:

- If the user has no active impact or habit, setup shows an onboarding card
  titled `Почати з базового набору` with an exact preview of impacts and
  habit metric/cadence details and
  the action `Застосувати базовий набір`.
- If the user already has personal My Day data, the same action is available
  only inside a collapsed `Додати базовий набір` block.
- On success, the UI reloads the canonical taxonomy and habits state and shows
  the created/skipped result.
## API contract

All new personal routes use \`/api/my-day\`, require the existing
authentication, and return \`success: true\` on success. Failures return
\`success: false\`, a stable code, and a safe Ukrainian error message.

### Legacy directions and active impacts

| Endpoint | Contract |
| --- | --- |
| `GET /api/my-day/directions` | Return active directions in `sort_order, id` order. `includeArchived=1` includes archived rows. |
| `POST /api/my-day/directions` | Create from `name`, `color`, `icon`, optional `sortOrder`. |
| `PATCH /api/my-day/directions/:id` | Rename, recolor, re-icon, reorder, archive, or restore caller-owned direction. Archive/restore uses `isActive`. |
| `GET /api/my-day/impacts` | Same list contract for impacts. |
| `POST /api/my-day/impacts` | Create an impact. |
| `PATCH /api/my-day/impacts/:id` | Edit, archive, or restore caller-owned impact. Archive/restore uses `isActive`. |

Legacy direction endpoints remain for rollback/history, but active My Day
setup and classification no longer render directions or require `directionId`.

Foreign catalog IDs return \`404 MY_DAY_TAXONOMY_NOT_FOUND\`. Malformed names,
colors, icons, duplicate names, and sort values return
\`400 MY_DAY_VALIDATION_ERROR\`. Archived IDs in a new classification return
\`409 MY_DAY_TAXONOMY_ARCHIVED\`.

### Task classification

There is no separate `GET /api/my-day/tasks/:taskId/classification` endpoint.
Task classification is read through the My Cabinet projection.

\`PUT /api/my-day/tasks/:taskId/classification\` accepts:

\`\`\`json
{ "impactIds": [7, 8] }
\`\`\`

\`impactIds: []\` clears active impacts. Missing or empty deprecated \`tags\`
is accepted for one-client rollout compatibility; non-empty \`tags\` returns
\`409 MY_DAY_TAGS_DEPRECATED\`. The request preserves existing legacy
\`direction_id\` and the historical database tags column. It validates current
task read visibility, current writable business scope, active caller-owned
impacts, numeric IDs, unique impact IDs, and the maximum of three impacts. It
persists nothing on failure.

Error contract:

| Condition | Result |
| --- | --- |
| Task outside current task visibility or business scope | \`404 MY_DAY_TASK_NOT_FOUND\` |
| Viewable task denied by current mutation policy | \`403 MY_DAY_TASK_CLASSIFICATION_FORBIDDEN\` |
| Malformed payload, duplicate impact, foreign taxonomy | \`400 MY_DAY_VALIDATION_ERROR\` |
| More than three impacts | \`409 MY_DAY_IMPACT_LIMIT_EXCEEDED\` |
| Non-empty deprecated tags | \`409 MY_DAY_TAGS_DEPRECATED\` |

\`POST /api/my-day/tasks/:taskId/classification/auto\` calls the direct OpenAI
Responses API with model \`gpt-5.6-luna\`, Structured Outputs, \`store: false\`,
\`reasoning.effort: low\`, and the server-side \`OPENAI_API_KEY\`. It can suggest only existing active
\`impactIds\`. Canonical impacts carry trusted server-side group and synonym
guidance so AI can distinguish context, activity, outcome, and personal
facets. The endpoint uses the existing authenticated caller, writable business
scope, \`canMutateTask\`, and task ownership guard. It does not classify tags,
directions, status, priority, deadline, owner, or dependencies.

The AI call is made before opening a PostgreSQL transaction. Before writing,
the task is loaded again with \`FOR UPDATE\`; if title/description/status/priority,
deadline, owner, or \`updated_at\` changed, the endpoint returns
\`409 MY_DAY_TASK_CHANGED_DURING_AI_CLASSIFICATION\` and writes nothing.
Timeouts, missing provider key, invalid JSON, invented impact IDs, and low
confidence also write nothing. Successful responses include
\`classification\`, a server-signed short-lived \`undoToken\`, and a non-secret
\`ai\` summary so the UI can update chips immediately and offer **Скасувати**
through \`POST /api/my-day/tasks/:taskId/classification/undo\`.

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
| `GET /api/my-day/timer` | Return the caller's active timer or `active: null`. |
| `POST /api/my-day/timer/start` | Start `taskId`; atomically stop a prior timer. |
| `POST /api/my-day/timer/stop` | Stop active timer; no active timer succeeds idempotently. |
| `GET /api/my-day/time-entries` | List caller entries for an inclusive validated Kyiv range. |
| `POST /api/my-day/time-entries` | Create one validated, non-overlapping manual entry. |
| `PATCH /api/my-day/time-entries/:id` | Edit the caller's manual entry with overlap validation. |
| `DELETE /api/my-day/time-entries/:id` | Delete the caller's own manual entry. There is no `archived_at` time-entry contract. |
| `GET /api/my-day/habits?date=YYYY-MM-DD` | Return due active habits for the caller and date; `includeArchived=1` includes settings history. |
| `POST /api/my-day/habits` | Create one private habit. |
| `PATCH /api/my-day/habits/:id` | Edit, pause/resume, archive, or restore through `isPaused` and `isArchived`. |
| `PUT /api/my-day/habits/:habitId/check-ins/:localDate` | Idempotently replace one caller check-in. |
| `DELETE /api/my-day/habits/:habitId/check-ins/:localDate` | Undo one caller check-in. |
| `POST /api/my-day/starter-kit` | Apply the manual caller-owned starter kit idempotently and return created/skipped summary. |
| `GET /api/my-day/contribution?from=YYYY-MM-DD&to=YYYY-MM-DD` | Return the personal matrix for an inclusive range up to 92 days, with overlapping impact rows grouped as context, activity, outcome, personal, and custom. |

## My Day projection

\`GET /api/tasks/my-cabinet\` remains the canonical Day-mode read model. Every
task receives this optional field without changing existing fields:

\`\`\`json
{
  "myDay": {
    "direction": null,
    "impacts": [],
    "isBlocked": false,
    "openDependencyCount": 0,
    "actualMinutes": 35,
    "activeTimer": false
  }
}
\`\`\`

Absent active classification data is represented as \`impacts: []\` and
\`actualMinutes: 0\`. The projection may still include legacy `direction` for
old rows, but active My Day UX does not render or edit it. Task classification,
dependency, and time joins are batched with aggregate joins/subqueries in the
projection; no query is executed per task. Completed history follows the same
object contract.

## UX contract

### Setup surface

My Day has one mode tablist with exactly **День**, **Звички**, and **Внесок**.
The secondary action **Налаштувати Мій день** opens an internal setup surface
with title **Налаштувати Мій день**, a **← Назад до Мого дня** action, and two
sections: **Впливи** and **Звички**. Setup is not a tab, modal,
action menu, sidebar page, or general Profile Settings section. Back restores
the previous My Day mode. The empty Habits action **Створити звичку** opens this
setup surface and focuses the habit name field. Create and edit forms in setup
are rendered in-page, not through modals or action menus.

### Day

The existing composer, drag/drop, reschedule, checklist, completion, overdue
triage, and task action menu remain canonical.

- Composer has compact optional **+ Впливи** controls. Classification never
  blocks task creation.
- A card shows impact chips and \`+N\` for remaining impacts. There is no
  separate task-tag control or second chip type.
- **Змінити маркування** in the card menu opens the same accessible impact
  selector.
- A blocked card shows blocker state, count, and next prerequisite title.
- Time uses one Start/Stop control. The active task shows elapsed local time;
  other tasks show accumulated actual minutes.
- Chips wrap, titles remain readable, and touch controls are at least 44 by 44
  CSS pixels.

### Habits

Habits mode lists active habits due today and provides the metric-appropriate
check-in control. Settings contains habit create/edit/archive. A habit card
uses the same optional impact chips as a task. Paused and archived history
appears in settings, not as due work.

## Contribution mathematics

Contribution is a transparent matrix, never a productivity score.

- Completed task total counts unique top-level \`tasks\` rows with
  \`status='done'\` and \`completed_at\` in the inclusive Kyiv range.
  Checklist items and subtasks never increase it.
- A reopened task whose completion is cleared is not counted.
- Impact totals overlap: a task contributes once to each impact. Impact columns
  are never added into a global total.
- Contribution groups impact rows into context, activity, outcome, personal,
  and custom facets. These group sections remain overlapping views and are
  never added into a global total.
- The legacy My Day tags column is not a contribution dimension and is never
  read as impacts.
- Task minutes equal each personal `my_day_time_entries` intersection with the
  selected range, split at Kyiv midnight. Unfinished-task time and active timer
  time count. The ledger remains personal after later task reassignment, but the
  task must still be in the current authorized business context and hidden task
  details are not returned.
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

