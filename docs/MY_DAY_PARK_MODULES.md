# My Day park edition modules

| State | Module and entrypoints | Restore condition |
| --- | --- | --- |
| active | Task projection and period UI (`services/taskCabinetProjection.js`, `routes/tasks.js`, `js/profile-my-day.js`); canonical TaskDetailDrawer and TaskReportGate | Existing task policy and visibility remain authoritative |
| active | Personal work results and salary (`services/profileEmployeeMonths.js`, `js/profile-employee-views.js`, existing self profile endpoints) | Salary remains a read-only presentation |
| disabled-for-park | Shop, inventory, leaderboard, achievements and game rewards (`js/profile-game-legacy.js`, `js/shop-page.js`, `js/game-page.js`, `routes/shop.js`, `routes/gamification.js`, `routes/wallet.js`, `routes/achievements.js`, `routes/quests.js`, `routes/streaks.js`); profile and daily-login callbacks; task completion/review rewards; scheduled monthly points reset and streak update | Product edition must explicitly reconnect surfaces, jobs and tested reward rules together |
| disabled-for-park | Habits, contribution, impacts and legacy timer controls (`js/my-day-*.js`, `routes/my-day-habits.js`, legacy branches of `routes/my-day.js`) | Approve the full edition entrypoints and revalidate historical data access |
| disabled-for-park | My Day dependency editor (`js/my-day-dependencies.js`); dependency records and existing completion constraints stay in use | Reintroduce a dependency editor without bypassing completion policy |
| disabled-for-park | Global task timer widget and polling | Full-edition pages can opt in with `data-full-edition-task-timer` on the HTML root. Park keeps `GET /api/my-day/timer` for compatibility and returns `410 MODULE_UNAVAILABLE` for `POST /api/my-day/timer/stop`. |

The registered park boundary is in `services/parkProfileModules.js`. The module switches apply to the deployment across business contexts. Disabled API calls return `410 MODULE_UNAVAILABLE` and never run a legacy handler. Old shop and game page URLs lead to the matching profile placeholder. Historical records are kept. The task module still validates access and reports; preserving a completion blocker does not restore dependency editing in My Day. Planning, bucket totals and pagination apply the same hold until an existing snooze expires, including for date-focused Telegram lists.

Work results include tasks owned by the linked account in the current business with `task_mode = work` and team visibility. NULL values use existing task contract defaults (work/team); personal and private modes or visibility never contribute. Checklist progress remains its own metric. For the open Kyiv month, both ranges have the same number of elapsed calendar dates, capped at the length of the previous month. Closed months use full calendar ranges.

Existing quizzes, the room and the standalone mini-game have separate entrypoints. Quiz and mini-game handlers access the shared game wallet directly when someone plays. They were not disabled by the My Day surface change. The park profile never opens them or reads the wallet. Training reviews remain active; the legacy coin-award call returns without writing to the game wallet.

## Local verification and eventual rollout

- `npm run test:integration:my-day-park:isolated`: disposable PostgreSQL, real HTTP, fixtures larger than the list limits, explicit unavailable responses, timer read compatibility and historical time reports.
- `npm run test:browser:my-day-park:isolated`: browser against the disposable local app.
- `node tests/browser/profile-employee-cabinet-browser-smoke.js`: scoped results and salary fixture; verifies month races, retry, amounts and original detail fields in disclosures.
- The existing isolated My Day gate selects the Park API and browser scenarios; its Telegram CRM integration remains selected. The retained `my-day-full-edition` and `my-day-full-edition-browser` harnesses require a full-edition checkout. In Park, the runner reports the missing modules before starting the database or the app. The Park unit suite continues testing the shared legacy handlers.

Before releasing the Park stop change, use the approved production read path to confirm that no timer session has a missing end timestamp. Keep the stop path while any sessions remain active.
