# My Day park edition modules

| State | Module and entrypoints | Restore condition |
| --- | --- | --- |
| active | Task projection and period UI (`services/taskCabinetProjection.js`, `routes/tasks.js`, `js/profile-my-day.js`); canonical TaskDetailDrawer and TaskReportGate | Existing task policy and visibility remain authoritative |
| active | Personal work results and salary (`services/profileEmployeeMonths.js`, `js/profile-employee-views.js`, existing self profile endpoints) | Salary remains a read-only presentation |
| disabled-for-park | Shop, inventory, leaderboard, achievements and game rewards (`js/profile-game-legacy.js`, `js/shop-page.js`, `js/game-page.js`, `routes/shop.js`, `routes/gamification.js`, `routes/wallet.js`, `routes/achievements.js`, `routes/quests.js`, `routes/streaks.js`); profile and daily-login callbacks; task completion/review rewards; scheduled monthly points reset and streak update | Product edition must explicitly reconnect surfaces, jobs and tested reward rules together |
| disabled-for-park | Habits, contribution, impacts and legacy timer controls (`js/my-day-*.js`, `routes/my-day-habits.js`, legacy branches of `routes/my-day.js`) | Approve the full edition entrypoints and revalidate historical data access |
| disabled-for-park | My Day dependency editor (`js/my-day-dependencies.js`); dependency records and existing completion constraints stay in use | Reintroduce a dependency editor without bypassing completion policy |
| active during transition | Global legacy timer detection and user-initiated stop (`js/global-task-timer.js`, GET /api/my-day/timer, POST /api/my-day/timer/stop) | Remove recovery only following an approved, read-only production active-session preflight and after remaining users have stopped their timers |

The registered park boundary is in `services/parkProfileModules.js`. Disabled API calls return `410 MODULE_UNAVAILABLE` and never run a legacy handler. Old shop and game page URLs lead to the matching profile placeholder. Historical records are kept. The task module still validates access and reports; preserving a completion blocker does not restore dependency editing in My Day. Planning, bucket totals and pagination apply the same hold until an existing snooze expires, including for date-focused Telegram lists.

Work results include tasks owned by the linked account in the current business with `task_mode = work` and team visibility. NULL values use existing task contract defaults (work/team); personal and private modes or visibility never contribute. Checklist progress remains its own metric. For the open Kyiv month, both ranges have the same number of elapsed calendar dates, capped at the length of the previous month. Closed months use full calendar ranges.

Existing quizzes, the room and the standalone mini-game have separate entrypoints. Quiz and mini-game handlers access the shared game wallet directly when someone plays. They were not disabled by the My Day surface change. The park profile never opens them or reads the wallet. Training reviews remain active; the legacy coin-award call returns without writing to the game wallet.

## Local verification and eventual rollout

- `npm run test:integration:my-day-park:isolated`: disposable PostgreSQL, real HTTP, fixtures larger than the list limits, explicit unavailable responses, active timer recovery.
- `npm run test:browser:my-day-park:isolated`: browser against the disposable local app.
- `node tests/browser/profile-employee-cabinet-browser-smoke.js`: scoped results and salary fixture; verifies month races, retry, amounts and original detail fields in disclosures.
- The existing isolated My Day gate selects the park API and browser scenarios; its Telegram CRM integration remains selected. The older full-edition harnesses are retained under `my-day-full-edition` and `my-day-full-edition-browser`: they expect starter kit, impacts and reward endpoints to be available and need the full-edition build. The park unit suite continues testing the underlying legacy modules without registering their frontend or HTTP entrypoints.

Read-only release preflight for the legacy timer: obtain the count of timer sessions with no end timestamp using the approved production read path. Do not select employee identifiers or task descriptions for that check. Keep the stop path if the count is nonzero. Removing the recovery path requires a separate verified transition plan.
