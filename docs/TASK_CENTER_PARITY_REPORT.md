# Task Center parity report — Task 8.1R

Дата перевірки: 2026-07-31
Branch: `codex/task4-overview`
Базовий feature commit: `8e74dce53 feat(tasks): add saved views and permission parity`
Production impact: no

## Рішення та межі

Task Center release candidate перевірено без Tasks 7.3–7.5. Legacy data audit і normalization відкладені рішенням власника продукту та не блокують цей parity gate.

У межах Task 8.1R:

- legacy UI/code не видалявся;
- міграції не запускалися;
- `db/migrations/308_task_saved_views_preferences.sql` лишається migration draft і не запускалася на production;
- roles, auth і permissions не змінювалися;
- version bump, merge і deploy не виконувалися;
- browser smoke блокував усі task/preferences mutations.

## Підсумок

Parity gate пройдено. Targeted tests, повний локальний baseline і контрольований browser smoke зелені. Старі deep links збережені. Month-end регресійні assertions у My Day зроблено детермінованими для календарного випадку, коли останній день місяця збігається із сьогоднішнім днем.

## Виконані перевірки

| Перевірка | Результат |
| --- | --- |
| Targeted Task Center/My Day tests | 93/93 passed |
| Task-specific Playwright browser smoke | passed |
| `npm test` на Node.js 22 / npm 10 | passed, exit code 0 |
| Unit sweep у складі `npm test` | 2237 passed, 0 failed |
| Static UI checks у складі `npm test` | 1278 passed, 0 failed |
| Migration governance | passed; SQL migrations не виконувалися |
| JavaScript syntax check | passed |
| `git diff --check` | passed |
| UTF-8 validation змінених test-файлів | passed |

Використані команди:

```powershell
node --test tests/profile-tasker-segments.test.js tests/task-center-shell.test.js tests/task-contract.test.js tests/task-detail-drawer.test.js tests/task-overview-projection.test.js tests/task-team-control.test.js tests/task-saved-views.test.js tests/task-permissions-parity.test.js tests/leads-tasks-pagination-behavior.test.js
npx --yes --package playwright node tests/browser/task-center-parity-browser-smoke.js
npm test
git diff --check
```

## Що перевірено реальним браузером

`tests/browser/task-center-parity-browser-smoke.js` запускає Chromium проти локального fixture HTTP server і реальних `tasks.html`, `js/tasks-page.js` та CSS. Auth/API відповіді контрольовано мокаються; зовнішня мережа й усі non-GET запити блокуються.

Browser smoke перевіряє:

- режими `overview`, `team`, `planning`, `library`;
- URL state для mode, queue, owner, date range, status, priority, category, source і search;
- legacy deep links `view=today`, `view=team`, `view=board`, `view=templates`, `view=archive`;
- drawer через `?open=42`, CRM source і permission-disabled actions;
- server-side saved-view controls;
- loading, empty, error і partial states;
- viewports 320, 360, 390, 768 і 1440 px;
- відсутність horizontal page overflow;
- light/dark themes;
- ArrowLeft/ArrowRight/Home/End navigation між mode tabs;
- focus-visible та ARIA tab semantics;
- `prefers-reduced-motion: reduce`;
- відсутність uncaught browser errors і task/preferences mutations.

## Що перевірено contract/static tests

- canonical/legacy task normalization;
- overview classification, server-side counts і permission-aware drawer payload;
- team workload, capacity-unavailable та planning rollback contract;
- saved-view validation, optimistic revision і DB-to-API mapping;
- URL mapping, pagination і stale-response protection;
- drawer URL/back/deep-link contract;
- bulk per-task mutation authorization;
- My Day composer/date/month-end regressions;
- shared `crm:tasks-updated` / `BroadcastChannel` contract присутній у shared task UI та перевіряється static UI gate.

## Відомі обмеження

1. Це локальний parity gate з mocked authenticated API, а не production live QA.
2. Browser smoke навмисно read-only. Create/update/complete/reschedule rollback перевіряються contract/static tests, але не виконуються як реальні browser mutations.
3. Cross-tab transport у цій перевірці покритий shared/static contract, а не окремим двовкладковим end-to-end сценарієм.
4. ARIA, keyboard, focus і reduced motion перевірені автоматично; ручний screen-reader audit не виконувався.
5. Під час побудови швидкого fixture виявлено baseline-ризик: якщо `AppState.currentUser` уже є, але capability catalog ще не гідрований, дуже швидкий mocked auth bootstrap може тимчасово викликати page-access redirect. Нормальний hydrated-session сценарій проходить. Auth не змінювався, оскільки це прямо заборонено scope Task 8.1R.
6. Saved Views потребують migration 308 у середовищі, де вони мають працювати server-side. Цей gate не дає дозволу на її production run.

## Cleanup candidates

Нижче лише перелік для окремого підтвердження. У Task 8.1R нічого з нього не видалено.

### Completed cleanup

1. Task 8.2A: removed tasksSummaryStrip, its unreferenced styles, and the corresponding click-listener after a complete reference audit. Legacy compatibility controls remain unchanged.

### Conditional compatibility candidates

Ці блоки ще обслуговують legacy deep links або функції й не можуть бути видалені одним cleanup-комітом без попереднього remap:

1. `tasks.html` — `#boardTabs` усередині `#taskCenterLegacyControls`.
2. `js/tasks-page.js` — `setBoardView`, binding `.board-tab` та legacy branches у `renderBoard`.
3. `js/tasks-page.js` — `renderSimpleTaskView`, `renderTodayView`, `renderWeekView`, `renderMyView`, `renderDoneTodayView`, `renderKanbanView`, `renderArchiveView`.
4. `tasks.html` — `#tasksGovernance` / `#tasksGovernancePanel` і `js/tasks-page.js:setupTaskGovernanceMenu`; видалення можливе лише після перенесення всіх view, bulk і service actions у канонічні controls.
5. `tasks.html` — inline style blocks для `.board-tabs`, `.board-tab`, `.tasks-governance*` і `.task-sound*`; прибирати лише після підтвердження selector ownership у `css/pages-tasks.css`.
6. `css/pages-tasks.css` — legacy overrides `.tasks-filter-shell .board-tabs` і `.tasks-filter-shell .board-tab`; видаляти разом із відповідним DOM, не раніше.

## Висновок

Task Center готовий як release candidate у межах погодженого scope. Наступний крок — окреме рішення власника щодо cleanup-переліку; до такого підтвердження compatibility layer має залишатися в коді.
