# My Day Existing Refactor - Adapted Execution Plan

Date: 2026-07-03
Source prompt: `C:/Users/Plotva/Downloads/codex_my_day_existing_refactor_prompt.md`
Target surface: existing Profile tab `/profile?tab=myday`
Production impact if implemented: yes

## 1. Reality Check

This is not a greenfield rebuild. The current `Мій день` already exists as an in-place Profile tab and must stay there.

Current repo facts:

- Branch: `codex/timeline-leads-hardening`.
- Current local package version: `0.77.114`.
- Runtime target: Node.js 22.x / npm 10.x.
- Worktree is dirty before this plan. Existing unrelated dirty files at the time of discovery:
  - `css/timeline.css`
  - `js/timeline.js`
  - `routes/hr.js`
  - `tests/route-smoke.test.js`
  - `tests/timeline-resources.test.js`
  - `tests/ui-check.js`
- Do not mix My Day work with those timeline/HR/test changes unless the user explicitly asks.

Current implementation map:

- Static page shell: `profile.html`
- Main controller: `js/profile-page.js`
- Current tab entry: `renderMyDayCommandCenterTab()` in `js/profile-page.js`
- URL/tab normalization: `normalizeProfileTaskTab()` maps legacy `mytasks` to `myday`.
- Data source: `GET /api/tasks/my-cabinet` in `routes/tasks.js`
- Projection service: `services/taskCabinetProjection.js`
- Existing preferences route: `GET/PATCH /api/tasks/preferences`
- Existing action routes reused by My Day:
  - `PATCH /api/tasks/:id/status`
  - `POST /api/tasks/:id/reschedule`
  - `POST /api/tasks/:id/snooze`
  - `PUT /api/tasks/:id`
  - subtask routes under `/api/tasks/:id/subtasks`
- Existing shared UI adapters:
  - `js/task-create.js`
  - `js/task-ui.js`
  - `js/task-ui-shared.js`
  - `js/sound-engine.js`

Important conclusion:

The downloaded prompt is realistic if treated as a UI/UX refactor that reuses the current task projection and mutations. It should not trigger DB migrations, auth changes, API contract changes, status taxonomy changes, or dependency work.

## 2. Prompt Adaptation To Current System

The source prompt is directionally correct, but several items need repo-specific interpretation.

### 2.1 In-place tab identity

Keep:

- `/profile?tab=myday`
- `activeTab === 'myday'`
- `renderMyDayTab() -> renderMyDayCommandCenterTab()`
- old `/profile?tab=mytasks` fallback to My Day

Do not create:

- `MyDayV2`
- a new HTML page
- a feature flag
- a duplicate route
- a new backend endpoint for this refactor

### 2.2 Large employee block

The prompt says to replace the large employee profile block on `Мій день`.

Current reality:

- The large identity header is not inside `renderMyDayCommandCenterTab()`.
- It is rendered globally by `renderProfile()` before `#tabContent`.
- It appears above all Profile tabs, including My Day.

Recommended adaptation:

- Add a My Day-specific compact header mode in `renderProfile()` when `activeTab === 'myday'`.
- Keep the full header for `professions`, `settings`, `achievements`, etc.
- Render a compact capsule using existing avatar/name/profession helpers.
- Do not delete global profile components.

Safer implementation shape:

- Extract existing large header markup into `renderProfileFullHeader(...)` only if it can be done without broad churn.
- Add `renderProfileMyDayCapsule(...)`.
- In `renderProfile()`, choose:
  - full header for normal tabs;
  - compact capsule/header for `myday`.

Avoid a broad header rewrite. If extraction causes noisy diff, use a small conditional class/markup branch in place.

### 2.3 Segmented counters

Current state:

- `renderMyDayCommandCenterTab()` has passive stat pills:
  - selected date/focus count
  - `Прострочено`
  - `Чекаю`
  - `Готово`
- There is also `renderCabinetMyDayListModeToggle()` for `Обрана дата` / `Всі`.
- There is an older `CABINET_TASK_SEGMENTS` set for `all/personal/private/work/actionable/idea`, but that is not the same as the prompt's desired daily segments.

Recommended adaptation:

- Add a separate My Day segment state, for example:
  - `let cabinetMyDaySegment = 'today';`
  - `const CABINET_MY_DAY_SEGMENTS = ['today','overdue','waiting','completed','private'];`
- Render one segmented control:
  - `Сьогодні N`
  - `Прострочено N`
  - `Чекаю N`
  - `Готово N`
  - `Приватне N`
- Use existing projection data:
  - today: `focusedTasks` for selected today, or `cabinetPlanningList('today')`/`cabinetList('today')` depending selected mode
  - overdue: `cabinetFocusedOverdueTasks(...)` or all overdue bucket
  - waiting: `cabinetList('waiting')`
  - completed: `cabinetCompletedHistoryList()`
  - private: `cabinetList('private')`

Do not reinterpret backend statuses. `Чекаю` must still come from existing `workflow_state/task_kind/status` helper logic.

### 2.4 Quick-add form

Current state:

- `renderCabinetTaskComposer()` is already isolated.
- Creation uses `window.TaskCreate.buildPayload(...)`.
- Existing tests protect collapsed state, due chips, priority chips, and canonical create adapter.

Required behavior:

- Do not redesign the form.
- Do not change create payload semantics.
- It is acceptable to move surrounding layout, but the form itself should stay structurally stable.

High-risk edits to avoid:

- changing `CABINET_DUE_PRESETS`;
- changing `createCabinetTask(...)` payload fields;
- changing `TaskCreate.buildPayload(...)`;
- moving advanced fields in a way that breaks `tests/profile-tasker-segments.test.js`.

### 2.5 Compact task cards

Current state:

- `renderCabinetTaskCard(task, compact = false)` already centralizes My Day cards.
- The card already has only two visible main actions:
  - done button;
  - more button.
- But metadata is too dense:
  - due badge;
  - move today action;
  - priority select;
  - relation badge;
  - mode;
  - kind;
  - schedule status;
  - subtask count;
  - subtask toggle;
  - report badge;
  - progress.

Recommended adaptation:

- Keep `renderCabinetTaskCard()` as the single card renderer.
- Add a small helper such as `cabinetTaskVisibleBadges(task, context)` that returns max 3-5 badges.
- Keep report-required and overdue/due state visible because those affect whether completion works.
- Move lower-priority metadata into the existing more menu or detail link.
- Preserve `data-task-id`, `data-task-status`, `data-task-priority`, `data-task-due-state`, drag attributes, and action data attributes.

Do not remove:

- report gate badge/logic;
- priority quick control unless replaced with an equally functional compact control;
- due/reschedule affordance for overdue tasks;
- `data-cabinet-task-action` delegated action model.

### 2.6 Checklist behavior

Current state:

- Subtask expansion is controlled by `expandedCabinetSubtaskIds` and `collapsedCabinetSubtaskIds`.
- The current model can allow more than one inline checklist to be expanded.
- `renderCabinetSubtasksPanel(...)` renders inline content.

Recommended adaptation:

- Add a single active inline checklist state, for example:
  - `let activeCabinetTaskId = null;`
- Default active task:
  - first visible open today task with subtasks;
  - if none, no inline checklist.
- In normal card view:
  - only `activeCabinetTaskId` can render inline checklist;
  - other decomposed cards show compact progress only.
- In overdue triage/list mode:
  - never render inline checklist;
  - row title/progress should open existing full task route `/tasks?view=my&open=<id>` or existing action menu.

Compatibility concern:

- Existing tests expect `is-subtasks-collapsed`, `is-subtasks-expanded`, and `renderCabinetSubtaskCollapsedSummary`.
- Update tests to assert single active checklist behavior instead of allowing arbitrary expanded sets.

### 2.7 Overdue compact triage

Current state:

- Overdue due badge already opens reschedule choices.
- Move menu already has:
  - today;
  - tomorrow;
  - snooze hour;
  - custom date;
  - no date;
  - waiting;
  - private.
- `executeCabinetMoveTarget()` already supports `today`, `tomorrow`, `snooze_custom`, `no_date`, `waiting`, `private`.
- `Без дати` is already supported by `updateCabinetTaskFields(id, { date: null, deadline: null })`.

Recommended adaptation:

- Add `renderCabinetOverdueTriageList(overdueTasks)` and use it only when selected segment is `overdue`.
- Header: `Прострочено · N`.
- Row actions:
  - `На сьогодні`: call `moveCabinetTaskToToday(id, 'button')`
  - `Відкласти`: call existing custom date path, likely `rescheduleCabinetTask(id, 'custom')`
  - `Закрити`: use the same done path as the card, including report/subtask gate
  - `Без дати`: call `executeCabinetMoveTarget(id, 'no_date')`
- Keep more menu as fallback for less common actions.

Risk:

- `Закрити` may be blocked by unfinished subtasks or report requirement. This is correct; do not bypass it.

### 2.8 CRM signals

Current state:

- CRM signals in My Day are rendered through `renderCabinetPulseCluster()`.
- The prompt explicitly says not to touch CRM signal cards.

Allowed:

- Keep the signal block where it is.
- Move surrounding panels only if the signal function output and behavior remain unchanged.

Not allowed:

- changing live counter source;
- changing alert/funnel counts;
- changing labels/semantics inside `renderCabinetPulseCluster()`.

### 2.9 Sound controls

Current state:

- My Day renders a visible right-column block:
  - header `Звук`
  - `renderCabinetTaskSoundControls()`
- Preferences persist through `PATCH /api/tasks/preferences`.
- Sound behavior is already task-scoped through `js/sound-engine.js`.

Recommended adaptation:

- Remove the visible `Звук` support panel from main My Day page.
- Reuse `renderCabinetTaskSoundControls()` inside an existing UI primitive instead of creating a new settings system.
- Best low-risk option:
  - add a compact settings/gear button in the My Day command bar;
  - open an existing `TaskUI.openActionMenu(...)` surface;
  - render `renderCabinetTaskSoundControls()` inside that menu/panel;
  - rebind existing `data-cabinet-task-sound-*` listeners after opening.

Important:

- Existing `tests/ui-check.js` and `tests/profile-tasker-segments.test.js` currently assert that `renderCabinetTaskSoundControls` exists and that task sound controls are exposed.
- Update tests to assert that controls are reachable via the settings/menu trigger, not visible as a main support panel.

### 2.10 Closing history

Current state:

- `renderCabinetCompletedHistoryStrip()` renders a compact-ish strip with visible day groups and markers.
- It still takes visible space and contains detail behavior.
- Counts come from `myCabinetData.stats.taskQuick`.

Recommended adaptation:

- Keep the function name, but change default visible output to one compact line:
  - `99+ виконань`
  - optionally `· streak N` if a streak field exists in current data.
- Do not introduce `/api/tasks/productivity` back into My Day. Current UI-check explicitly protects against noisy productivity panel usage.
- If detail view is needed, keep existing detailed history behind a click/disclosure.

Streak handling:

- If no reliable streak exists in `myCabinetData`, omit it.
- Do not calculate a new backend streak in this task.
- Do not fetch `/api/tasks/productivity` just for streak; it was intentionally removed from this page's visible surface.

### 2.11 Microcopy and encoding

The downloaded prompt is UTF-8 and contains correct Ukrainian labels. Use those labels in UI.

Fix visible copy only in touched My Day UI:

- `Просрочено` -> `Прострочено`
- `Киньте сюди задачу, щоб поставити на сьогодні` -> `Перетягніть сюди, щоб запланувати на сьогодні`
- `Нічого не зависло в очікуванні.` -> `Немає задач в очікуванні`
- `Приватний шар порожній.` -> `Приватних задач немає`
- Long checklist helper copy -> `Чекліст 0/2` or `2 пункти залишилось`
- `Розгорнути Пункти 0/3` -> `Пункти 0/3`

Do not change enum values, DB values, route names, or internal status ids.

### 2.12 Overflow/layout

Current CSS surfaces:

- `css/pages-tasks.css` contains My Day command center layout:
  - `.cabinet-command-center`
  - `.cabinet-day-command-bar`
  - `.cabinet-day-workspace`
  - `.cabinet-day-primary`
  - `.cabinet-day-secondary`
  - responsive My Day rules
- `css/pages-cabinet.css` contains card/history/sound/control styling:
  - `.cabinet-task-card`
  - `.cabinet-task-meta`
  - `.cabinet-completed-strip`
  - `.cabinet-task-sound-controls`
- `profile.html` still contains some page-level Profile and dark-mode CSS.

Recommended adaptation:

- Prefer adding My Day-specific classes to `css/pages-tasks.css` when changing the daily command layout.
- Prefer card internals/history/sound rules in `css/pages-cabinet.css`.
- Avoid adding more inline CSS to `profile.html` unless existing styles there are the only local surface.

## 3. Recommended Implementation Passes

Run these as separate GPT-5.5 tasks. Do not merge all into one giant edit unless the user explicitly wants a single implementation sweep.

### Pass 0 - Baseline and protection

Goal:

- Establish clean context before touching files.

Actions:

1. Run `git status --short --branch`.
2. Confirm current runtime: `npm run check:runtime`.
3. Read current dirty diffs if any target file is already dirty.
4. Confirm no My Day target file has unrelated user changes before editing.
5. Run focused current tests if time allows:
   - `node --test tests/profile-tasker-segments.test.js`
   - `npm run test:ui`

Expected result:

- Clear note about existing dirty timeline/HR files.
- No edits yet.

### Pass 1 - My Day shell, compact profile capsule, segmented control

Goal:

- Make the page feel like one compact daily workspace without changing task creation or backend behavior.

Target files:

- `js/profile-page.js`
- `css/pages-tasks.css`
- `css/pages-cabinet.css` only if capsule/card shared styles need it
- `tests/profile-tasker-segments.test.js`
- `tests/ui-check.js`

Implementation tasks:

1. Add `activeTab === 'myday'` compact header/capsule behavior in `renderProfile()`.
2. Reuse:
   - `profileDisplayName(p)`
   - `profileProfessionEntries()`
   - `renderProfileAvatarVisual(...)`
3. Capsule copy:
   - `{name} · {primaryProfession.title} · робочі + особисті задачі`
4. Keep full header on every non-My-Day tab.
5. Add `cabinetMyDaySegment` state and helpers:
   - `normalizeCabinetMyDaySegment(value)`
   - `cabinetMyDaySegmentCounts()`
   - `setCabinetMyDaySegment(segment, options)`
   - `renderCabinetMyDaySegments()`
6. Replace passive `.cabinet-day-command-stats` with interactive segmented control.
7. Keep command bar actions:
   - `+ Задача`
   - links to full Tasks page if still useful
8. Keep `renderCabinetTaskComposer(...)` unchanged.

Acceptance criteria:

- `/profile?tab=myday` still opens the same tab.
- No My Day v2 exists.
- Full profile header is not taking the My Day first viewport.
- Compact capsule appears with real/fallback user data.
- One segmented control drives selected view.
- Quick-add form markup remains materially unchanged.
- CRM signal rendering remains unchanged.

Focused tests:

- Add/adjust `tests/profile-tasker-segments.test.js` for segment counts and active segment rendering.
- Update `tests/ui-check.js` static guard for:
  - compact My Day capsule;
  - no duplicate v2 route;
  - no visible sound support panel in later pass only when implemented.

Risks:

- `renderProfile()` re-renders the whole page on tab switch. Compact header condition must remain stable on browser back/forward.
- Existing tests may assume `.profile-identity-block` is always present. Update only the My Day-specific expectation.

### Pass 2 - Compact cards and single active checklist

Goal:

- Reduce card density and stop rendering multiple inline checklists.

Target files:

- `js/profile-page.js`
- `css/pages-cabinet.css`
- `css/pages-tasks.css`
- `tests/profile-tasker-segments.test.js`
- `tests/ui-check.js`

Implementation tasks:

1. Add active inline task state:
   - `let activeCabinetInlineTaskId = null;`
2. Add helper:
   - `cabinetVisibleTaskListForSegment(segment)`
   - `cabinetDefaultInlineTaskId(tasks)`
   - `isCabinetTaskInlineActive(taskId, context)`
3. Update `renderCabinetTaskCard(task, compact, options)` so it knows:
   - current My Day segment;
   - whether inline checklist is allowed;
   - whether this task is the active inline task.
4. Limit visible badges to 3-5.
5. Keep visible primary actions:
   - done/check;
   - more menu.
6. Keep progress compact:
   - `Чекліст 0/3`
   - or `2 пункти залишилось`
7. Make click/toggle set the active inline task.
8. Ensure non-active cards never render full checklist inline.

Do not change:

- subtask API;
- report gate;
- task completion semantics;
- priority/status values.

Acceptance criteria:

- Normal My Day views use compact task cards.
- Only one task can show inline checklist.
- Other checklist tasks show compact progress only.
- Long titles and badge rows do not overflow.
- Done and more menu remain visible and keyboard reachable.

Focused tests:

- Add card renderer tests for:
  - max badge count;
  - single inline checklist;
  - non-active checklist summary;
  - report-required task still blocks completion.

Risks:

- Existing `expandedCabinetSubtaskIds` behavior may be used by task cards outside My Day. Scope changes to My Day rendering context only, or keep old behavior outside My Day.

### Pass 3 - Overdue triage segment

Goal:

- Make `Прострочено` a compact operational list/table with mass-triage style actions.

Target files:

- `js/profile-page.js`
- `css/pages-tasks.css`
- `css/pages-cabinet.css`
- `tests/profile-tasker-segments.test.js`
- `tests/ui-check.js`

Implementation tasks:

1. Add `renderCabinetOverdueTriageList(tasks)`.
2. Add `renderCabinetOverdueTriageRow(task)`.
3. In selected segment `overdue`, render:
   - header `Прострочено · N`
   - compact rows instead of full cards.
4. Row actions:
   - `На сьогодні` -> `moveCabinetTaskToToday(id, 'button')`
   - `Відкласти` -> `rescheduleCabinetTask(id, 'custom', { sourceSurface: 'profile_my_cabinet_overdue_triage' })`
   - `Закрити` -> same done handler path as task card
   - `Без дати` -> `executeCabinetMoveTarget(id, 'no_date', { method: 'triage' })`
5. Ensure row title/progress opens existing full task details:
   - `/tasks?view=my&open=<id>`
6. Do not inline checklist in overdue triage.

Acceptance criteria:

- Clicking `Прострочено` segment shows a compact triage list.
- Header says `Прострочено · N`.
- All four requested actions are present.
- Actions reuse existing mutations and preserve gates.
- No backend route or schema change.

Focused tests:

- Static render test for triage row actions.
- Action dispatch test for `today`, `custom`, `done`, `no_date` branches if practical in existing VM harness.

Risks:

- `Закрити` action must not bypass unfinished subtasks/report requirement.
- `Без дати` must stay disabled or route through existing no-date behavior for fixed scheduled tasks.

### Pass 4 - Sound menu, compact history, microcopy, overflow

Goal:

- Clean visible page weight after the core list is stable.

Target files:

- `js/profile-page.js`
- `css/pages-tasks.css`
- `css/pages-cabinet.css`
- `tests/profile-tasker-segments.test.js`
- `tests/ui-check.js`

Implementation tasks:

1. Remove visible right-column `Звук` support panel from `renderMyDayCommandCenterTab()`.
2. Add a compact settings trigger in the command bar.
3. Reuse `TaskUI.openActionMenu(...)` or existing page menu primitive to show `renderCabinetTaskSoundControls()`.
4. Ensure listeners for `data-cabinet-task-sound-*` still bind after the menu opens.
5. Simplify `renderCabinetCompletedHistoryStrip()` default output:
   - `99+ виконань`
   - optionally `· streak N` only if current projection already contains a reliable streak
6. Keep detailed history hidden behind click/disclosure only if needed.
7. Apply microcopy replacements from the source prompt.
8. Harden CSS:
   - `min-width: 0` on command/grid/card rows;
   - ellipsis or `overflow-wrap:anywhere` for title and long tokens;
   - non-wrapping action column;
   - stable row heights for triage rows;
   - responsive behavior at 1280, 1440, 1920 and mobile widths.

Acceptance criteria:

- Sound settings are not a visible main/right-column block.
- Sound settings still work.
- Closing history is one compact line by default.
- CRM signal cards remain unchanged.
- Short Ukrainian labels are used.
- No horizontal overflow in tested desktop widths.

Focused tests:

- Update sound tests to assert reachable settings/menu, not visible support panel.
- Update history tests to assert compact summary.
- Extend UI check for microcopy and no Russian `Просрочено`.

Risks:

- `TaskUI.openActionMenu(...)` may close on internal input interaction if not configured for form controls. Verify volume slider/select interactions.

### Pass 5 - Verification and release hygiene

Goal:

- Prove the refactor without mixing unrelated release/version churn unless preparing an actual release.

Minimum verification after each pass:

- `npm run check:runtime`
- `node --test tests/profile-tasker-segments.test.js`
- `npm run test:ui`

After all passes:

- `npm test`

Manual/browser verification:

1. Open `/profile?tab=myday`.
2. Confirm no duplicate My Day tab/route.
3. Confirm compact profile capsule.
4. Confirm quick-add still creates a task.
5. Segment checks:
   - `Сьогодні`
   - `Прострочено`
   - `Чекаю`
   - `Готово`
   - `Приватне`
6. Create/view:
   - long Ukrainian title;
   - long English string without spaces;
   - task with many badges;
   - checklist 0/3, 2/4, 3/3.
7. Overdue actions:
   - `На сьогодні`
   - `Відкласти`
   - `Закрити`
   - `Без дати`
8. Verify report-required task is not closed without report.
9. Verify unfinished checklist task is not closed incorrectly.
10. Verify sound settings still persist.
11. Verify CRM signal cards visually/functionally unchanged.
12. Check no horizontal overflow at:
   - 1280px
   - 1440px
   - 1920px
   - mobile narrow width if time allows.

Release/version:

- Do not bump version for planning-only work.
- For implemented user-visible UI changes, prepare a separate release hygiene pass if the user asks to ship:
  - patch bump through repo canonical version flow;
  - Ukrainian changelog/release modal entry;
  - `npm run version:sync`;
  - final `npm test`.

## 4. Risk Register

### Risk 1 - Header is global, not tab-local

The prompt assumes a large employee block inside My Day. The current code renders it globally. A careless implementation could remove profile identity from all Profile tabs.

Mitigation:

- Use `activeTab === 'myday'` conditional rendering only.
- Test both `/profile` and `/profile?tab=myday`.

### Risk 2 - Segment semantics could accidentally change statuses

The desired segments look like status filters, but current task semantics use a mix of `status`, `workflow_state`, `task_kind`, `task_mode`, `visibility`, and date projection.

Mitigation:

- Keep all semantics in frontend selectors over existing projection data.
- Do not change backend enum/status values.

### Risk 3 - Compact card may hide critical blocking information

Report-required and unfinished checklist constraints affect whether completion works.

Mitigation:

- Always keep report-required indicator or completion block feedback visible enough.
- Completion button must keep existing guard behavior.

### Risk 4 - Sound controls inside menu may lose event binding

Listeners currently bind after page render through `attachProfileListeners()`. Menu-created controls may appear after binding.

Mitigation:

- After opening sound menu, explicitly bind sound controls or call a small existing-safe binding helper.

### Risk 5 - Existing static tests are brittle

`tests/ui-check.js` uses string guards. UI refactor will require updating tests carefully.

Mitigation:

- Update static guards in the same pass as markup changes.
- Do not delete guards; rewrite them to protect the new intended behavior.

### Risk 6 - Dirty worktree

There are unrelated dirty files. Accidentally including them in a My Day commit would make review and rollback harder.

Mitigation:

- Before editing, check `git status --short`.
- Stage only My Day-specific files.
- Do not touch timeline/HR dirty files.

## 5. Suggested Task Breakdown For GPT-5.5

### Task A - Baseline and exact diff boundaries

Prompt:

```text
Read docs/MY_DAY_EXISTING_REFACTOR_ADAPTATION_PLAN_2026-07-03.md and the downloaded source prompt.
Do not implement yet. Run git status, inspect My Day files, and produce the exact file/function edit map for Pass 1 only.
```

Output expected:

- exact functions to edit;
- tests to update;
- no code changes unless explicitly asked.

### Task B - Pass 1 implementation

Prompt:

```text
Implement Pass 1 only from docs/MY_DAY_EXISTING_REFACTOR_ADAPTATION_PLAN_2026-07-03.md.
Do not touch quick-add behavior, DB, API contracts, status taxonomy, CRM signals, or unrelated dirty files.
Run npm run check:runtime, node --test tests/profile-tasker-segments.test.js, and npm run test:ui.
```

### Task C - Pass 2 implementation

Prompt:

```text
Implement compact My Day cards and single active inline checklist only.
Keep existing completion/report/subtask gates.
Do not implement overdue triage yet except where needed to keep current behavior compiling.
Run focused profile tasker tests and UI check.
```

### Task D - Pass 3 implementation

Prompt:

```text
Implement only the overdue triage segment/list for My Day.
Reuse existing move/reschedule/snooze/done/no-date functions and routes.
Do not change backend status taxonomy or API contracts.
Run focused profile tasker tests and UI check.
```

### Task E - Pass 4 cleanup

Prompt:

```text
Move My Day sound controls out of the visible page area into an existing menu/popover primitive, compact closing history, clean My Day microcopy, and fix overflow.
Do not touch CRM signal card internals.
Run focused tests, UI check, and browser/manual viewport checks if feasible.
```

### Task F - Final verification and release decision

Prompt:

```text
Run final verification for the completed My Day refactor.
Do not bump version or changelog unless I explicitly say this is a release/deploy task.
Report changed files, tests run, remaining risks, and recommended release hygiene.
```

## 6. What Not To Do

Do not:

- implement old `docs/TASK-smart-task-scheduling-personal-tasker-current-live-plus-0.1.md` as if it were the current task;
- add migrations;
- add new dependencies;
- change auth or permissions;
- change task status enums;
- change task API contracts;
- add My Day v2;
- redesign quick-add;
- rewrite the entire Profile page;
- remove CRM signal cards;
- fetch `/api/tasks/productivity` into My Day unless the user explicitly approves a productivity panel comeback;
- commit/push/deploy without explicit user request.

## 7. Recommended Definition Of Done

The refactor is done when:

- existing `/profile?tab=myday` is modified in place;
- full profile header is compact on My Day but intact on other Profile tabs;
- quick-add behavior is unchanged;
- one segmented control drives My Day views;
- normal tasks use compact cards;
- only one active task can show inline checklist;
- overdue segment uses compact triage list;
- overdue actions reuse existing mutations;
- sound settings are reachable but not a visible page block;
- completed history is compact by default;
- CRM signals are unchanged;
- status taxonomy is unchanged;
- Ukrainian microcopy is cleaned;
- no horizontal overflow in target desktop widths;
- `npm run check:runtime`, focused profile tests, `npm run test:ui`, and final `npm test` pass or failures are clearly documented.
