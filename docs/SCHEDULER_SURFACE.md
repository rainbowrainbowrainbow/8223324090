# Event Genix Scheduler Surface Map

This document records the background jobs started from `server.js`. The
machine-readable source is `config/schedulerSurface.js`; `npm run
check:scheduler-surface` runs `scripts/check-scheduler-surface.js`.

## Why This Exists

Scheduler cleanup is risky because most jobs create side effects: Telegram
messages, database writes, WebSocket broadcasts, event processing, storage
refreshes, or filesystem/git inspection. A job can look like a small interval
but still duplicate customer messages or partially update operational tables.

The rule going forward: any scheduler addition, removal, retiming, dedup change,
or raw interval conversion must update `config/schedulerSurface.js`, this
document, and test coverage when behavior changes.

Do not remove retry or fallback paths until failure semantics are documented.

## Guarded Jobs

These jobs are wrapped with `guardScheduler` and are tracked in
`scheduler_executions`.

| Job | Source | Owner | Interval | Dedup |
| --- | --- | --- | --- | --- |
| `checkAutoDigest` | `services/scheduler.js` | bookings | `60000` | `daily` |
| `checkAutoReminder` | `services/scheduler.js` | bookings | `60000` | `daily` |
| `checkAutoBackup` | `services/scheduler.js` | backup | `60000` | `daily` |
| `checkRecurringTasks` | `services/scheduler.js` | tasks | `60000` | `daily` |
| `checkRecurringAfisha` | `services/scheduler.js` | afisha | `60000` | `daily` |
| `checkScheduledDeletions` | `services/scheduler.js` | telegram | `60000` | `daily` |
| `checkCertificateExpiry` | `services/scheduler.js` | certificates | `60000` | `daily` |
| `checkTaskReminders` | `services/scheduler.js` | tasks | `60000` | `hourly` |
| `checkReplyAutoEscalations` | `services/scheduler.js` | tasks | `60000` | `hourly` |
| `checkWorkDayTriggers` | `services/scheduler.js` | staff | `60000` | `daily` |
| `checkMonthlyPointsReset` | `services/scheduler.js` | gamification | `60000` | `daily` |
| `checkHrAutoClose` | `services/hr.js` | hr | `60000` | `daily` |
| `checkHrNoShow` | `services/hr.js` | hr | `60000` | `daily` |
| `checkStreakUpdates` | `services/scheduler.js` | gamification | `60000` | `daily` |
| `checkBirthdayGreetings` | `services/scheduler.js` | customers | `60000` | `daily` |
| `checkBirthdayReminders` | `services/scheduler.js` | customers | `60000` | `daily` |
| `checkDormantCustomers` | `services/scheduler.js` | customers | `60000` | `daily` |
| `checkUpcomingBookings` | `services/scheduler.js` | bookings | `60000` | `daily` |
| `checkEventQueue` | `services/scheduler.js` | event-queue | `60000` | none |
| `checkSLABreach` | `services/scheduler.js` | sla | `60000` | `hourly` |
| `checkScheduledAnnouncements` | `services/scheduler.js` | announcements | `60000` | `hourly` |
| `checkTaskOverdue` | `services/scheduler.js` | tasks | `60000` | `hourly` |
| `checkCustomerRetention` | `services/scheduler.js` | customers | `60000` | `daily` |
| `checkAutoReport` | `services/scheduler.js` | reports | `60000` | `daily` |
| `checkHotLeads` | `services/scheduler.js` | leads | `60000` | `hourly` |
| `checkScheduledChatMessages` | `services/scheduler.js` | chat | `30000` | none |
| `checkExpiredChatMessages` | `services/scheduler.js` | chat | `60000` | none |
| `checkAutoReviewRequests` | `services/scheduler.js` | reviews | `60000` | `hourly` |
| `checkTeamPulseReminder` | `services/scheduler.js` | team-pulse | `60000` | `daily` |
| `checkAutoOrdering` | `services/scheduler.js` | warehouse | `60000` | `hourly` |
| `checkBookingPushReminders` | `services/scheduler.js` | bookings | `60000` | `daily-default` |
| `checkCertExpiryReminders` | `services/scheduler.js` | staff | `60000` | `daily` |
| `checkStaleCatalogImages` | `services/scheduler.js` | catalogs | `60000` | `daily` |
| `checkChatDailyDigest` | `services/scheduler.js` | chat | `60000` | `daily` |
| `checkRecurringAnnouncements` | `services/scheduler.js` | announcements | `60000` | none |
| `checkEventPipeline` | `services/scheduler.js` | events | `60000` | `5min` |
| `checkNpsFollowUp` | `services/scheduler.js` | customers | `60000` | `hourly` |
| `checkCleaningTasks` | `services/scheduler.js` | tasks | `60000` | `5min` |
| `checkGraduationOpsAutomation` | `services/scheduler.js` | graduation | `60000` | `hourly` |
| `checkTrainingPrompts` | `server.js:inline` | training | `60000` | `daily` |
| `checkTrainingSummary` | `server.js:inline` | training | `60000` | `daily` |
| `checkGuardianReports` | `server.js:inline` | guardian | `60000` | `daily` |
| `flushGuardianLearn` | `server.js:inline` | guardian | `5 * 60 * 1000` | none |
| `syncAgentActivities` | `server.js:inline` | agent-tracker | `30 * 60 * 1000` | `hourly` |
| `cleanupOutbox` | `services/eventBus.js` | event-bus | `60000` | `daily` |
| `cleanupRefreshTokens` | `middleware/auth.js` | auth | `60000` | `daily` |

`daily-default` means no explicit `{ dedup: ... }` option is passed to
`guardScheduler`, so the guard's default `daily` behavior applies. Today this is
only allowed for `checkBookingPushReminders`. Its code comment and interval look
minute-based, but the guard currently makes it daily. Leave that visible here
until a runtime fix is paired with notification-focused tests.

## Raw Intervals And Starters

These background jobs are not tracked through `scheduler_executions`.

| Name | Source | Owner | Interval | Notes |
| --- | --- | --- | --- | --- |
| `openclawBridgeStaleMessages` | `server.js` | kleshnya | `30000` | Conditional on `OPENCLAW_BRIDGE`; calls `processStaleMessages`. |
| `cleanupKleshnyaMessages` | `server.js` | kleshnya | `30 * 60 * 1000` | Local greeting cache cleanup. |
| `telegramRetryQueue` | `server.js` | telegram | `30000` | Calls `processRetryQueue`. |
| `eventBusProcessOutbox` | `server.js` | event-bus | `5000` | Calls `processOutbox`; fast transactional outbox relay. |
| `marketingPublishScheduled` | `server.js` | marketing | `5 * 60 * 1000` | Calls `publishScheduled`. |
| `marketingWeeklyPlan` | `server.js` | marketing | `60 * 1000` | Checks for Wednesday 08:00 UTC before `generateWeeklyPlan`. |
| `dashboardAlertBroadcaster` | `server.js` | dashboard | `60000` | Starts `startAlertBroadcaster(60000)`. |
| `taskLifecycleStartup` | `server.js` | tasks | `30000` | One startup delay before `runTaskLifecycle`. |
| `taskLifecycleDaily` | `server.js` | tasks | `24 * 60 * 60 * 1000` | Daily `runTaskLifecycle`. |

Raw intervals need extra care before refactoring because they do not have the
pause/dedup/error accounting from `guardScheduler`.

## Test Anchors

The manifest records test files where direct coverage exists:

- `tests/event-queue.test.js`
- `tests/reply-escalation.test.js`
- `tests/scheduled-chat-dispatch.test.js`
- `tests/telegram-callbacks.test.js`
- `tests/graduation-ops-automation.test.js`
- `tests/training.test.js`
- `tests/guardian-ops.test.js`
- `tests/guardian-convergence.test.js`

`tests/event-queue.test.js` is a live API suite and requires the configured app
credentials/env described in `README.md`; it is not part of the self-contained
`npm test` baseline. Many legacy jobs are still only statically mapped. Add
direct tests before changing their timing, idempotency, retry behavior, or
notification target.

## Done Marker

This pack is considered done when all of these remain true:

- `npm run check:scheduler-surface` passes.
- `npm test` includes `npm run check:scheduler-surface`.
- Every `guardScheduler` job in `server.js` exists in `config/schedulerSurface.js`.
- Every raw `server.js` interval/starter is listed here and in
  `config/schedulerSurface.js`.
- Any future scheduler behavior change has a direct test or an explicit
  cleanup-register note explaining the remaining gap.
