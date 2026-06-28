# Event Genix Scheduler Behavior Discovery Report

Date: 2026-06-28
Status: discovery complete
Production impact: no

## Scope

This report analyzes scheduler jobs and runtime intervals that start from
`server.js` or are documented in `config/schedulerSurface.js`.

No runtime scheduler code, timings, manifests, env vars, CI config,
deployment config, database schema, or dependencies were changed in this task.
No live server was started. No scheduler job was manually run against a
production-like database. No real Telegram, push, or message side effects were
sent.

## Executive Summary

- Current scheduler surface has 47 `guardScheduler` jobs and 9 raw
  intervals/starters.
- 45 jobs are still listed as static-only coverage debt.
- 26 guarded jobs can send Telegram messages.
- 44 guarded jobs can mutate database state.
- `guardScheduler` gives useful daily/hourly repeat protection after a
  successful run, but it is not a strict distributed lock. Two app instances can
  still race if they pass the pre-run check before either records success.
- `guardScheduler` currently only implements `daily` and `hourly` keys. Jobs
  configured with `dedup: '5min'` are not actually deduplicated every five
  minutes by the guard.
- The first behavior-hardening implementation should be
  `checkBookingPushReminders`. It has user-visible Telegram side effects,
  no direct behavior test, an every-minute comment and interval, but it is
  wrapped without explicit dedup options, so it currently falls back to the
  guard's daily behavior.

## Commands Run

| Command | Result | Duration | Notes |
| --- | --- | ---: | --- |
| `git status --short --branch` | passed | <1s | Worktree was already dirty before this task. |
| `rg -n "guardScheduler\\(|setInterval\\(|setTimeout\\(|checkBookingPushReminders|processRetryQueue|processOutbox|runTaskLifecycle|scheduler_executions|sendTelegramMessage" server.js services config docs tests` | passed | ~1s | Used to map scheduler startup, guards, raw intervals, and side effects. |
| `npx -y -p node@22 -p npm@10 -c "npm run check:scheduler-surface"` | passed | ~6s | `47 guarded jobs, 9 raw intervals/starters`. |
| `npx -y -p node@22 -p npm@10 -c "node --test tests/scheduled-chat-dispatch.test.js tests/reply-escalation.test.js tests/customer-birthday-tags.test.js"` | passed | ~4s | 24 tests passed, 0 failed. Some error logs are simulated failure scenarios inside the test suite. |
| `npx -y -p node@22 -p npm@10 -c "npm run check:syntax"` | passed | ~31s | JavaScript parser check passed for 578 files. |

## Worktree State At Start

`git status --short --branch` showed:

```text
## codex/timeline-leads-hardening...origin/codex/timeline-leads-hardening
 M AGENTS.md
 M README.md
 M docs/STATIC_SURFACE.md
 M middleware/staticDocGuard.js
 M tests/static-doc-guard.test.js
?? docs/BROWSER_VISUAL_A11Y_DISCOVERY_2026-06-28.md
?? docs/LOCAL_RUNTIME_SETUP.md
?? docs/POSTGRES_CI_DISCOVERY_2026-06-28.md
?? docs/SYSTEM_OPTIMIZATION_ANALYSIS_AND_TASKS_2026-06-27.md
?? docs/SYSTEM_OPTIMIZATION_DETAILED_TASKS_2026-06-28.md
?? docs/SYSTEM_OPTIMIZATION_EXECUTION_MAP_2026-06-28.md
?? docs/UPLOAD_DURABILITY_DISCOVERY_2026-06-28.md
```

These existing dirty files were not reverted or reformatted.

## Current Scheduler Inventory

Source of truth for the static inventory:

- `config/schedulerSurface.js`
- `docs/SCHEDULER_SURFACE.md`
- `server.js`

Manifest counts:

| Category | Count |
| --- | ---: |
| Guarded scheduler jobs | 47 |
| Raw intervals/starters | 9 |
| Static-only coverage debt entries | 45 |
| Guarded jobs with Telegram side effects | 26 |
| Guarded jobs with database side effects | 44 |

Guarded dedup labels in the manifest:

| Dedup label | Count | Runtime interpretation |
| --- | ---: | --- |
| `daily` | 28 | Supported by `guardScheduler`. |
| `hourly` | 11 | Supported by `guardScheduler`. |
| `null` / none | 5 | Skip check disabled; success still writes a daily-looking tracking key. |
| `daily-default` | 1 | No explicit option passed; `guardScheduler` defaults to `daily`. |
| `5min` | 2 | Not implemented as five-minute dedup by `guardScheduler`; effectively no skip key. |

## Guarded Jobs

These jobs are wrapped with `guardScheduler` and are tracked in
`scheduler_executions`.

| Job | Owner | Source | Interval | Dedup | Side effects | Direct test anchor |
| --- | --- | --- | --- | --- | --- | --- |
| `checkAutoDigest` | bookings | `services/scheduler.js` | `60000` | `daily` | telegram, settings, bookings | none |
| `checkAutoReminder` | bookings | `services/scheduler.js` | `60000` | `daily` | telegram, settings, bookings | none |
| `checkAutoBackup` | backup | `services/scheduler.js` | `60000` | `daily` | telegram, settings | none |
| `checkRecurringTasks` | tasks | `services/scheduler.js` | `60000` | `daily` | database | none |
| `checkRecurringAfisha` | afisha | `services/scheduler.js` | `60000` | `daily` | database | none |
| `checkScheduledDeletions` | telegram | `services/scheduler.js` | `60000` | `daily` | telegram, database | none |
| `checkCertificateExpiry` | certificates | `services/scheduler.js` | `60000` | `daily` | telegram, database | none |
| `checkTaskReminders` | tasks | `services/scheduler.js` | `60000` | `hourly` | telegram, database | none |
| `checkReplyAutoEscalations` | tasks | `services/scheduler.js` | `60000` | `hourly` | database | `tests/reply-escalation.test.js` |
| `checkWorkDayTriggers` | staff | `services/scheduler.js` | `60000` | `daily` | database | none |
| `checkMonthlyPointsReset` | gamification | `services/scheduler.js` | `60000` | `daily` | database | none |
| `checkHrAutoClose` | hr | `services/hr.js` | `60000` | `daily` | database | none |
| `checkHrNoShow` | hr | `services/hr.js` | `60000` | `daily` | database | none |
| `checkStreakUpdates` | gamification | `services/scheduler.js` | `60000` | `daily` | database | none |
| `checkBirthdayGreetings` | customers | `services/scheduler.js` | `60000` | `daily` | telegram, database | none |
| `checkBirthdayReminders` | customers | `services/scheduler.js` | `60000` | `daily` | telegram, database | none |
| `checkBirthdayTagSync` | customers | `services/scheduler.js` | `60000` | `daily` | database, settings | `tests/customer-birthday-tags.test.js` |
| `checkDormantCustomers` | customers | `services/scheduler.js` | `60000` | `daily` | telegram, database | none |
| `checkUpcomingBookings` | bookings | `services/scheduler.js` | `60000` | `daily` | telegram, database | none |
| `checkEventQueue` | event-queue | `services/scheduler.js` | `60000` | none | database, events | `tests/event-queue.test.js` |
| `checkSLABreach` | sla | `services/scheduler.js` | `60000` | `hourly` | telegram, database | none |
| `checkScheduledAnnouncements` | announcements | `services/scheduler.js` | `60000` | `hourly` | telegram, database | none |
| `checkTaskOverdue` | tasks | `services/scheduler.js` | `60000` | `hourly` | database | none |
| `checkCustomerRetention` | customers | `services/scheduler.js` | `60000` | `daily` | telegram, database | none |
| `checkAutoReport` | reports | `services/scheduler.js` | `60000` | `daily` | telegram, database | none |
| `checkHotLeads` | leads | `services/scheduler.js` | `60000` | `hourly` | telegram, database | none |
| `checkScheduledChatMessages` | chat | `services/scheduler.js` | `30000` | none | websocket, database | `tests/scheduled-chat-dispatch.test.js` |
| `checkExpiredChatMessages` | chat | `services/scheduler.js` | `60000` | none | websocket, database | none |
| `checkAutoReviewRequests` | reviews | `services/scheduler.js` | `60000` | `hourly` | telegram, database | none |
| `checkTeamPulseReminder` | team-pulse | `services/scheduler.js` | `60000` | `daily` | telegram, database | none |
| `checkAutoOrdering` | warehouse | `services/scheduler.js` | `60000` | `hourly` | telegram, database | `tests/telegram-callbacks.test.js` |
| `checkBookingPushReminders` | bookings | `services/scheduler.js` | `60000` | `daily-default` | telegram, database | none |
| `checkCertExpiryReminders` | staff | `services/scheduler.js` | `60000` | `daily` | telegram, database | none |
| `checkStaleCatalogImages` | catalogs | `services/scheduler.js` | `60000` | `daily` | storage, database | none |
| `checkChatDailyDigest` | chat | `services/scheduler.js` | `60000` | `daily` | chat, database | none |
| `checkRecurringAnnouncements` | announcements | `services/scheduler.js` | `60000` | none | telegram, database | none |
| `checkEventPipeline` | events | `services/scheduler.js` | `60000` | `5min` | database, events | none |
| `checkNpsFollowUp` | customers | `services/scheduler.js` | `60000` | `hourly` | telegram, database | none |
| `checkCleaningTasks` | tasks | `services/scheduler.js` | `60000` | `5min` | database | none |
| `checkGraduationOpsAutomation` | graduation | `services/scheduler.js` | `60000` | `hourly` | telegram, database | `tests/graduation-ops-automation.test.js` |
| `checkTrainingPrompts` | training | `server.js:inline` | `60000` | `daily` | telegram, database | `tests/training.test.js` |
| `checkTrainingSummary` | training | `server.js:inline` | `60000` | `daily` | telegram, database | `tests/training.test.js` |
| `checkGuardianReports` | guardian | `server.js:inline` | `60000` | `daily` | telegram, database | `tests/guardian-ops.test.js` |
| `flushGuardianLearn` | guardian | `server.js:inline` | `5 * 60 * 1000` | none | database, ai | `tests/guardian-convergence.test.js` |
| `syncAgentActivities` | agent-tracker | `server.js:inline` | `30 * 60 * 1000` | `hourly` | filesystem, database | none |
| `cleanupOutbox` | event-bus | `services/eventBus.js` | `60000` | `daily` | database | `tests/event-queue.test.js` |
| `cleanupRefreshTokens` | auth | `middleware/auth.js` | `60000` | `daily` | database | none |

## Static-Only Scheduler Jobs

These jobs are listed in `STATIC_ONLY_SCHEDULER_JOBS`. They have static
surface coverage but do not yet have direct behavior coverage in the fast local
baseline:

`checkAutoDigest`, `checkAutoReminder`, `checkAutoBackup`,
`checkRecurringTasks`, `checkRecurringAfisha`, `checkScheduledDeletions`,
`checkCertificateExpiry`, `checkTaskReminders`, `checkWorkDayTriggers`,
`checkMonthlyPointsReset`, `checkHrAutoClose`, `checkHrNoShow`,
`checkStreakUpdates`, `checkBirthdayGreetings`, `checkBirthdayReminders`,
`checkDormantCustomers`, `checkUpcomingBookings`, `checkSLABreach`,
`checkScheduledAnnouncements`, `checkTaskOverdue`, `checkCustomerRetention`,
`checkAutoReport`, `checkHotLeads`, `checkExpiredChatMessages`,
`checkAutoReviewRequests`, `checkTeamPulseReminder`,
`checkBookingPushReminders`, `checkCertExpiryReminders`,
`checkStaleCatalogImages`, `checkChatDailyDigest`,
`checkRecurringAnnouncements`, `checkEventPipeline`, `checkNpsFollowUp`,
`checkCleaningTasks`, `syncAgentActivities`, `cleanupRefreshTokens`,
`openclawBridgeStaleMessages`, `cleanupKleshnyaMessages`,
`telegramRetryQueue`, `eventBusProcessOutbox`, `marketingPublishScheduled`,
`marketingWeeklyPlan`, `dashboardAlertBroadcaster`, `taskLifecycleStartup`,
and `taskLifecycleDaily`.

## Raw Intervals And Starters

These jobs are not wrapped with `guardScheduler` and are not tracked in
`scheduler_executions`.

| Name | Owner | Source | Trigger | Side effects | Current risk |
| --- | --- | --- | --- | --- | --- |
| `openclawBridgeStaleMessages` | kleshnya | `server.js` | `setInterval`, 30s, conditional on `OPENCLAW_BRIDGE` | AI/chat/websocket/message writes depending on stale message processing | Multi-instance duplicate handling is unclear; no guard tracking. |
| `cleanupKleshnyaMessages` | kleshnya | `server.js` | `setInterval`, 30m | local greeting cache cleanup | Low production blast radius if truly local cache only. |
| `telegramRetryQueue` | telegram | `server.js` -> `services/telegram.js` | `setInterval`, 30s | Telegram send retry and optional `bookings.telegram_message_id` update | In-memory queue, no DB tracking, restart loses queued work, multi-instance behavior depends on where the failure was queued. |
| `eventBusProcessOutbox` | event-bus | `server.js` -> `services/eventBus.js` | `setInterval`, 5s | outbox to event queue relay; downstream rules may create tasks, Telegram, print, or chat side effects | Has `FOR UPDATE SKIP LOCKED` and `ON CONFLICT`, but still a fast raw loop with no scheduler pause/error accounting. |
| `marketingPublishScheduled` | marketing | `server.js` -> `lib/marketing-agent` | `setInterval`, 5m | scheduled marketing publishing | External/content side effects depend on marketing agent implementation; no scheduler tracking. |
| `marketingWeeklyPlan` | marketing | `server.js` -> `lib/marketing-agent` | `setInterval`, 1m gate for Wednesday 08:00 UTC | creates weekly marketing plan | Uses in-memory `lastWeeklyGenDate`; duplicate protection is not cross-instance or restart durable. |
| `dashboardAlertBroadcaster` | dashboard | `server.js` -> `routes/dashboard` | starter with 60s interval | websocket/dashboard alert broadcasts | Needs owner-specific inspection before changing; not in `scheduler_executions`. |
| `taskLifecycleStartup` | tasks | `server.js` -> `services/taskLifecycle.js` | `setTimeout`, 30s after boot | task health updates and auto-archives | DB mutations on every app instance startup; no guard tracking. |
| `taskLifecycleDaily` | tasks | `server.js` -> `services/taskLifecycle.js` | `setInterval`, 24h | task health updates and auto-archives | Idempotent-looking updates, but no guard tracking and duplicate startup/daily runs are possible. |

## Scheduler Guard Behavior

`services/schedulerGuard.js` wraps scheduler functions with:

- a read from `scheduler_executions`;
- a skip check for `daily` or `hourly`;
- execution of the scheduler function;
- success or error accounting;
- auto-pause after 10 consecutive failures.

Important limitations:

- The guard is not a strict distributed lock. The row is read before the job
  function runs and written only after success. Two app instances can execute
  the same side-effecting job if they race before success is recorded.
- Only `daily` and `hourly` have skip keys. Any other truthy value, including
  `5min`, falls into the no-current-key path and does not skip repeated runs.
- `dedup: null` disables the skip check, but success still writes a daily-style
  `last_run_date`. That is acceptable for observability but can be misleading
  if someone interprets `last_run_date` as the active dedup key.
- Failures are swallowed after being tracked. The interval continues, and the
  app does not crash on scheduler failure.

## Focus Findings

### `checkBookingPushReminders`

Source:

- startup: `server.js`, `guardScheduler('checkBookingPushReminders', checkBookingPushReminders)`
- behavior: `services/scheduler.js`
- manifest: `config/schedulerSurface.js`

Behavior observed from source:

- Runs under a `60000` interval from `server.js`.
- Code comment says it checks every minute and finds bookings starting in
  about 30 minutes.
- The wrapper call does not pass `{ dedup: ... }`, so `guardScheduler` defaults
  to `daily`.
- It queries same-day `confirmed` or `pending` bookings for exactly the
  calculated target time.
- It requires `hosts` to be non-empty.
- It applies default timeline business context and booking visibility scope.
- It sends Telegram reminders to each visible host's `telegram_id`, with
  fallback to the configured chat id.
- It has an in-memory `pushRemindersSentToday` marker keyed by
  `todayStr + '_' + nowTime`.
- It sets the in-memory marker after due bookings are found but before the
  configured chat id is confirmed.
- It has no direct behavior test in the fast local baseline.

Risk:

- High user-visible notification risk.
- Current daily guard conflicts with the minute-level intent in code comments
  and interval configuration.
- A daily guard can under-send reminders after the first successful daily run.
- Removing or changing the guard can over-send reminders without a behavior
  test, especially in multi-instance deployments.
- The in-memory marker does not protect across app instances or restarts.
- The no-chat-id path can mark a minute as sent inside one process without
  actually sending anything.

Conclusion:

This should be the first implementation hardening task. Start with direct tests
before changing cadence or dedup semantics.

### `telegramRetryQueue`

Source:

- startup: `server.js`
- queue behavior: `services/telegram.js`

Behavior observed from source:

- Raw `setInterval` every 30 seconds.
- Processes an in-memory `_retryQueue`.
- Sends via `sendTelegramMessage(..., { retries: 1 })`.
- On success, removes the item and optionally writes
  `bookings.telegram_message_id`.
- On failure, reschedules with bounded delay or drops after max attempts.

Risk:

- Medium-high user-visible notification risk.
- No `scheduler_executions` tracking.
- No durable queue; restart loses pending retries.
- Multi-instance behavior depends on which process queued the failed item.
- Because this is a retry path, changing behavior needs Telegram mocks and
  booking update assertions.

Conclusion:

Do not harden before `checkBookingPushReminders` unless an operator reports
current retry loss or duplicate-send incidents.

### `eventBusProcessOutbox`

Source:

- startup: `server.js`
- behavior: `services/eventBus.js`

Behavior observed from source:

- Raw `setInterval` every 5 seconds.
- Uses a transaction.
- Selects unpublished outbox events with `FOR UPDATE SKIP LOCKED`.
- Inserts into `event_queue` with `ON CONFLICT (idempotency_key) DO NOTHING`.
- Marks outbox rows as published.
- Calls `processEventRules` with `setImmediate` after inserting new queue rows.

Risk:

- High blast radius because downstream event rules can produce tasks,
  Telegram messages, print jobs, chat messages, or other automation.
- Existing DB-level concurrency controls are stronger than most raw intervals.
- No `scheduler_executions` pause/error accounting.
- `tests/event-queue.test.js` exists, but it is documented as a live API suite,
  not a self-contained fast baseline test.

Conclusion:

This is an important later hardening target. It should get a focused
self-contained relay/idempotency test before any timing or guard refactor.

### `taskLifecycleStartup` And `taskLifecycleDaily`

Source:

- startup: `server.js`
- behavior: `services/taskLifecycle.js`

Behavior observed from source:

- One raw `setTimeout` runs 30 seconds after boot.
- One raw `setInterval` runs every 24 hours.
- `runTaskLifecycle` selects active non-archived tasks.
- It recalculates health score.
- It archives tasks at score 0 and updates `health_score` otherwise.

Risk:

- Medium DB mutation risk.
- No `scheduler_executions` tracking.
- Every app instance can run the startup pass.
- The function is mostly idempotent because archived tasks are excluded and
  health scores are recalculated, but concurrent updates can still produce
  duplicated work and noisy lifecycle logs.

Conclusion:

Good later candidate for guard conversion or a DB-backed lifecycle run marker,
but only after behavior tests define the intended startup and daily semantics.

### `checkEventPipeline` And `checkCleaningTasks`

Source:

- startup: `server.js`
- guard behavior: `services/schedulerGuard.js`

Behavior observed from source:

- Both are wrapped with `guardScheduler(..., { dedup: '5min' })`.
- `guardScheduler` does not implement `5min`.
- Because the skip key is null for unsupported values, these jobs can execute
  every scheduler tick instead of every five minutes.
- Success is still recorded with a daily-style date key.

Risk:

- Medium-high correctness risk.
- `checkEventPipeline` has event/database side effects.
- `checkCleaningTasks` has task/database side effects.
- A generic guard fix would affect more than one scheduler job, so it needs
  focused guard tests and owner review.

Conclusion:

This is a separate hardening task after `checkBookingPushReminders`, or a
small guard-contract task if product owners confirm `5min` is intended.

## Existing Direct Behavior Coverage

| Area | Test file | Discovery result |
| --- | --- | --- |
| Scheduled chat dispatch | `tests/scheduled-chat-dispatch.test.js` | Direct tests cover atomic claim, rollback on claim failure, and no retry after post-claim broadcast failure. |
| Reply auto-escalation | `tests/reply-escalation.test.js` | Direct tests cover one linked task, duplicate prevention, inactive rows, stale task closure, and partial unique index. |
| Customer birthday tag sync | `tests/customer-birthday-tags.test.js` | Direct tests cover tag taxonomy, idempotency, all-customer sync, missing columns, endpoint capability, and scheduler registration. |
| Event queue | `tests/event-queue.test.js` | Manifest has a test anchor, but docs state this is a live API suite, not part of the self-contained fast baseline. |
| Telegram callbacks / auto-ordering | `tests/telegram-callbacks.test.js` | Manifest anchor exists, but it is broader callback coverage, not necessarily a direct scheduler cadence/idempotency test. |
| Graduation ops automation | `tests/graduation-ops-automation.test.js` | Manifest anchor exists. Not executed in this discovery. |
| Training | `tests/training.test.js` | Manifest anchor exists. Not executed in this discovery. |
| Guardian ops/convergence | `tests/guardian-ops.test.js`, `tests/guardian-convergence.test.js` | Manifest anchors exist. Not executed in this discovery. |

## Ranked CI Candidates

These are the current candidates for future CI scheduler gates, ranked by
stability and value.

| Rank | Candidate | Why |
| ---: | --- | --- |
| 1 | `npm run check:scheduler-surface` | Already stable, self-contained, no live DB, catches manifest drift. Keep in CI. |
| 2 | `tests/scheduled-chat-dispatch.test.js` | Self-contained and validates a high-risk no-dedup scheduler with atomic claim behavior. |
| 3 | `tests/reply-escalation.test.js` | Self-contained and validates DB idempotency logic without sending external messages. |
| 4 | `tests/customer-birthday-tags.test.js` | Self-contained and validates a guarded backfill job plus idempotent tag writes. |
| 5 | Future `checkBookingPushReminders` focused test | Should become the first new scheduler behavior gate after it exists and uses Telegram mocks only. |
| 6 | Future `schedulerGuard` contract test | Should lock down `daily`, `hourly`, `null`, and any intended `5min` semantics. |
| 7 | Future `eventBusProcessOutbox` relay test | Valuable but more integration-heavy because it touches transaction/outbox semantics. |

First browser-free scheduler CI gate recommendation:

```bash
npm run check:scheduler-surface
node --test tests/scheduled-chat-dispatch.test.js tests/reply-escalation.test.js tests/customer-birthday-tags.test.js
```

Do not add this CI change in this discovery task. It is only a future
recommendation.

## Risk Ranking

| Rank | Job or group | Risk level | Why it ranks here | First safe action |
| ---: | --- | --- | --- | --- |
| 1 | `checkBookingPushReminders` | High | Telegram side effects, booking/staff visibility, no direct test, minute intent vs daily-default guard. | Add direct mocked behavior tests, then decide guard cadence. |
| 2 | `checkEventPipeline` / `checkCleaningTasks` | High | `dedup: '5min'` is not implemented by `guardScheduler`; jobs can run every tick. | Add guard contract tests and owner-confirmed expected cadence. |
| 3 | `telegramRetryQueue` | Medium-high | Raw interval, external Telegram sends, DB update on success, in-memory queue only. | Add mocked retry queue tests before changing durability. |
| 4 | `eventBusProcessOutbox` | Medium-high | Fast raw interval and high downstream blast radius, but has strong DB concurrency controls. | Add self-contained outbox relay/idempotency tests. |
| 5 | `taskLifecycleStartup` / `taskLifecycleDaily` | Medium | Raw startup and daily DB mutations, no guard tracking, likely idempotent but untested as scheduler behavior. | Add lifecycle behavior tests and decide whether startup run should be guarded. |
| 6 | `checkRecurringAnnouncements` | Medium | No dedup, Telegram/database side effects, static-only coverage. | Add send/claim/idempotency tests. |
| 7 | Daily Telegram jobs without direct tests | Medium | Guarded daily, but user-visible messages and race windows remain. | Add owner-specific tests before cadence or target changes. |
| 8 | `checkStaleCatalogImages` | Medium | Storage/database side effects and static-only coverage. | Add storage-safe behavior test before any cleanup logic change. |
| 9 | `marketingWeeklyPlan` | Medium | Raw interval, external/content side effects, in-memory only weekly marker. | Add mocked marketing-agent behavior test before durable guard changes. |
| 10 | local cleanup/cache jobs | Low | Lower blast radius if they only prune local memory/cache. | Keep manifest coverage unless behavior changes. |

## First Hardening Task Recommendation

Next implementation task:

`Task 06 - checkBookingPushReminders Behavior Hardening`

Production impact:

Yes if cadence, notification targets, dedup behavior, or Telegram send behavior
changes. Start with tests only, then make the smallest code change that matches
the confirmed intended behavior.

Recommended implementation sequence:

1. Add a focused self-contained test file for `checkBookingPushReminders`.
2. Mock `pool.query`, `getConfiguredChatId`, `sendTelegramMessage`, booking
   time helpers, booking visibility helpers if needed, and staff visibility.
3. Test that due bookings at `now + 30 minutes` send to visible staff.
4. Test that `second_animator` is included only when it is numeric.
5. Test that a missing configured chat id does not silently mark a minute as
   successfully sent without a send.
6. Test that repeated same-minute calls do not duplicate sends inside one
   process.
7. Test the scheduler registration explicitly documents the intended dedup:
   either daily, no dedup, or a new custom key.
8. Only after tests, update runtime behavior if product/operator confirms the
   desired cadence.
9. Remove `checkBookingPushReminders` from `STATIC_ONLY_SCHEDULER_JOBS` only
   after direct tests are in place.
10. Run `npm run check:scheduler-surface`, the focused test, `npm run test:ui`
    if static expectations changed, and `npm test` if scheduler surface config
    changed.

Recommended product/operator question before changing behavior:

Should booking push reminders be evaluated every minute with job-level
idempotency per booking/staff/time window, or should they remain a once-per-day
summary-style reminder?

Based on comments and query shape, every-minute evaluation appears intended,
but this is an inference from source code, not confirmed production policy.

## Missing Tests To Add Later

High-priority missing behavior tests:

- `checkBookingPushReminders`: mocked Telegram send, staff visibility,
  second animator, no chat id, same-minute duplicate prevention, scheduler
  registration dedup.
- `schedulerGuard`: explicit contract for `daily`, `hourly`, `null`, invalid
  values, and any intended `5min` support.
- `checkEventPipeline`: cadence/idempotency and no duplicate event side effects.
- `checkCleaningTasks`: expected five-minute behavior and task write
  idempotency.
- `telegramRetryQueue`: retry schedule, max attempts, queue cap, booking
  message id update, no duplicate sends under repeated interval calls.
- `eventBusProcessOutbox`: `FOR UPDATE SKIP LOCKED`, `ON CONFLICT`, published
  marker, publish attempt increment, and downstream rule isolation.
- `taskLifecycle`: startup vs daily behavior, archive idempotency, active task
  scope, and duplicate app instance safety.
- `checkRecurringAnnouncements`: no duplicate Telegram sends under repeated
  ticks and failed send handling.
- `checkStaleCatalogImages`: storage-safe dry behavior with missing/local/remote
  assets mocked.
- Daily Telegram jobs: smoke-style direct tests for notification target, one-run
  guard behavior, and no send when settings are missing.

## Risks Requiring Confirmation Before Code Changes

These should not be changed without product/operator confirmation:

- Changing `checkBookingPushReminders` from daily-default to per-minute/no-dedup
  behavior, because it can increase real Telegram sends.
- Changing any Telegram retry semantics, because it can resend messages users
  already saw or drop messages operators expect.
- Converting raw outbox/event bus intervals to guarded jobs, because the current
  fast relay may be required for near-real-time automation.
- Changing task lifecycle startup behavior, because it can affect task archival
  timing immediately after deploy.
- Implementing `5min` in `guardScheduler`, because it would alter
  `checkEventPipeline` and `checkCleaningTasks` production cadence.
- Making scheduler guard locking distributed/transactional, because it changes
  cross-instance behavior for many jobs at once.

## Verification Results

Passed:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:scheduler-surface"
```

Result:

```text
Scheduler surface check passed: 47 guarded jobs, 9 raw intervals/starters.
```

Passed:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
```

Result:

```text
JavaScript syntax check passed: 578 files.
```

Passed:

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/scheduled-chat-dispatch.test.js tests/reply-escalation.test.js tests/customer-birthday-tags.test.js"
```

Result:

```text
tests 24
suites 2
pass 24
fail 0
```

The focused test output includes expected warning/error logs for simulated
failure scenarios in `scheduled-chat-dispatch.test.js`; those logs did not fail
the tests.

## Final Recommendation

Do `Task 06 - checkBookingPushReminders Behavior Hardening` next, starting with
tests only. It is the best first implementation slice because the current code
has a clear behavior mismatch, high user-visible notification risk, and a small
enough surface to harden safely without touching broad scheduler architecture.
