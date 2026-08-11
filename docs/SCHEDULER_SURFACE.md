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
| `checkBirthdayTagSync` | `services/scheduler.js` | customers | `60000` | `daily` |
| `checkDormantCustomers` | `services/scheduler.js` | customers | `60000` | `daily` |
| `checkUpcomingBookings` | `services/scheduler.js` | bookings | `60000` | `daily` |
| `checkEventQueue` | `services/scheduler.js` | event-queue | `60000` | none |
| `checkSLABreach` | `services/scheduler.js` | sla | `60000` | `hourly` |
| `checkScheduledAnnouncements` | `services/scheduler.js` | announcements | `60000` | `hourly` |
| `checkTaskOverdue` | `services/scheduler.js` | tasks | `60000` | `hourly` |
| `runTaskLifecycle` | `services/taskLifecycle.js` | tasks | `60 * 1000` | `daily` |
| `checkCustomerRetention` | `services/scheduler.js` | customers | `60000` | `daily` |
| `checkAutoReport` | `services/scheduler.js` | reports | `60000` | `daily` |
| `checkHotLeads` | `services/scheduler.js` | leads | `60000` | `hourly` |
| `checkScheduledChatMessages` | `services/scheduler.js` | chat | `30000` | none |
| `checkExpiredChatMessages` | `services/scheduler.js` | chat | `60000` | none |
| `checkAutoReviewRequests` | `services/scheduler.js` | reviews | `60000` | `hourly` |
| `checkTeamPulseReminder` | `services/scheduler.js` | team-pulse | `60000` | `daily` |
| `checkAutoOrdering` | `services/scheduler.js` | warehouse | `60000` | `hourly` |
| `checkBookingPushReminders` | `services/scheduler.js` | bookings | `60000` | none |
| `checkCertExpiryReminders` | `services/scheduler.js` | staff | `60000` | `daily` |
| `checkStaleCatalogImages` | `services/scheduler.js` | catalogs | `60000` | `daily` |
| `checkChatDailyDigest` | `services/scheduler.js` | chat | `60000` | `daily` |
| `checkRecurringAnnouncements` | `services/scheduler.js` | announcements | `60000` | none |
| `checkEventPipeline` | `services/scheduler.js` | events | `60000` | `5min` |
| `checkNpsFollowUp` | `services/scheduler.js` | customers | `60000` | `hourly` |
| `checkCleaningTasks` | `services/scheduler.js` | tasks | `60000` | `5min` |
| `checkGraduationOpsAutomation` | `services/scheduler.js` | graduation | `60000` | `hourly` |
| `checkAttendanceReviewTasks` | `services/scheduler.js` | hr | `60000` | none |
| `checkHrAttendancePrintAutomations` | `services/scheduler.js` | hr | `60000` | none |
| `checkTrainingPrompts` | `server.js:inline` | training | `60000` | `daily` |
| `checkTrainingSummary` | `server.js:inline` | training | `60000` | `daily` |
| `checkGuardianReports` | `server.js:inline` | guardian | `60000` | `daily` |
| `flushGuardianLearn` | `server.js:inline` | guardian | `5 * 60 * 1000` | none |
| `syncAgentActivities` | `server.js:inline` | agent-tracker | `30 * 60 * 1000` | `hourly` |
| `runCheckboxReadinessProbeScheduler` | `services/payments/paymentReadinessService.js` | payments | `60000` | none |
| `processPaymentOutboxJobs` | `services/payments/paymentOutboxWorker.js` | payments | `30000` | none |
| `cleanupOutbox` | `services/eventBus.js` | event-bus | `60000` | `daily` |
| `cleanupRefreshTokens` | `middleware/auth.js` | auth | `60000` | `daily` |

All guarded jobs must pass an explicit `dedup` option. Do not rely on the
`guardScheduler` default because the default is daily and can silently change a
minute-based job into a once-per-day job.

Supported `guardScheduler` dedup modes:

- `daily`: skips when `last_run_date` matches the current `YYYY-MM-DD` key.
- `hourly`: skips when `last_run_date` matches the current `YYYY-MM-DDTHH` key.
- `5min`: skips when `last_run_date` matches the current five-minute
  `YYYY-MM-DDTHH:MM` bucket, with minutes floored to `00`, `05`, `10`, etc.
- none / `null`: never skips by `last_run_date`; successful runs still write a
  minute-level `YYYY-MM-DDTHH:MM` tracking key for observability.

Unsupported dedup values are rejected before the scheduler function can run.

`runCheckboxReadinessProbeScheduler` runs every minute without guard-level dedup because readiness freshness is scoped by `checkbox_readiness_snapshots.expires_at`. It records sanitized Checkbox readiness only; raw secrets, PINs, and tokens are not stored. Direct coverage lives in `tests/payment-readiness.test.js`.

`processPaymentOutboxJobs` runs every 30 seconds without guard-level dedup because durable locking is owned by `payment_outbox_jobs`. It claims bounded batches with `FOR UPDATE SKIP LOCKED`, recovers expired locks, applies exponential backoff, moves exhausted jobs to dead-letter status, and performs receipt status lookup before retrying any sale after unknown provider responses. Direct coverage lives in `tests/checkbox-webhook-reconciliation.test.js`.

`checkHrAttendancePrintAutomations` runs every minute without guard-level dedup.
Its durable deduplication is owned by `hr_attendance_document_jobs`: the unique
key combines automation, Kyiv local date, document type, and selection hash.
Automation rows are locked with `FOR UPDATE`, PDF build work is claimed with
`FOR UPDATE SKIP LOCKED` and a lease, and expired artifacts are removed by TTL.
This allows two Railway replicas to evaluate the same minute without creating
two documents. The current target is `queue_only`; physical printer delivery is
intentionally outside this scheduler.
The database guarantee is exercised by
`tests/integration/hr-attendance-document-automation-concurrency.integration.test.js`,
which starts two independent PostgreSQL pools and proves that concurrent
scheduled/manual enqueue attempts converge on one idempotency key and one job.

`checkAttendanceReviewTasks` performs an immediate startup catch-up and then
runs every minute. Before 08:30 Europe/Kyiv it returns without scheduler
tracking. After the cutoff, `services/attendanceReviewTasks.js` targets the
previous full Kyiv calendar day, takes a transaction-scoped advisory lock, and
checks `attendance_daily_review:<reportDate>:<ownerUserId>` ownership through
the task `source_type`/`source_id` fields across every status, including
completed tasks. It creates one private routine task per active director or
art-director account, including roles from `extra_roles`; director reports use
the company scope, while art-director reports are restricted to the
`animators`/`creative` staff departments. Task creation disables both legacy
notifications and Hermes notification outbox delivery, so the employee list is
not sent to Telegram. Direct behavior coverage lives in
`tests/attendance-review-tasks.test.js`.

`checkBookingPushReminders` intentionally uses no guard-level dedup so the
60-second interval can evaluate bookings due in the next 30 minutes. Its direct
test covers the in-process same-minute send marker and the missing configured
chat retry path.

`tests/scheduler-notification-jobs-hardening.test.js` covers the high-risk
Telegram/booking notification scheduler pack: `checkAutoDigest`,
`checkAutoReminder`, `checkAutoBackup`, `checkScheduledDeletions`,
`checkCertificateExpiry`, `checkTaskReminders`, `checkUpcomingBookings`,
`checkSLABreach`, `checkScheduledAnnouncements`, and
`checkCertExpiryReminders`. The pack is self-contained and mocks DB, Telegram,
backup, Kleshnya reminders, Afisha distribution, and event bus publishing. It
does not change scheduler timing or guard-level dedup; `guardScheduler` remains
the dedup owner.

`checkBirthdayTagSync` normally runs at 03:20 Kyiv, but before the
`customer_birthday_tags_backfill_done` settings marker exists it is allowed to
run once on the next scheduler tick after deploy. That first run backfills
existing customer birthday tags and then writes the marker after a clean sync.

## Raw Intervals And Starters

These background jobs are not tracked through `scheduler_executions`.

| Name | Source | Owner | Interval | Notes |
| --- | --- | --- | --- | --- |
| `openclawBridgeStaleMessages` | `server.js` | kleshnya | `30000` | Conditional on `OPENCLAW_BRIDGE`; calls `processStaleMessages` with an in-process overlap guard. |
| `cleanupKleshnyaMessages` | `server.js` | kleshnya | `30 * 60 * 1000` | Local greeting cache cleanup with an in-process overlap guard. |
| `telegramRetryQueue` | `server.js` | telegram | `30000` | Calls `processRetryQueue`. |
| `eventBusProcessOutbox` | `server.js` | event-bus | `5000` | Calls `processOutbox`; fast transactional outbox relay. |
| `marketingPublishScheduled` | `server.js` | marketing | `5 * 60 * 1000` | Calls `publishScheduled`. |
| `marketingWeeklyPlan` | `server.js` | marketing | `60 * 1000` | Checks for Wednesday 08:00 UTC before `generateWeeklyPlan`. |
| `dashboardAlertBroadcaster` | `server.js` | dashboard | `60000` | Starts `startAlertBroadcaster(60000)`. |
| `taskLifecycleStartup` | `server.js` | tasks | `30000` | One startup delay before `guardedTaskLifecycle`. |

Raw intervals need extra care before refactoring because they do not have the
pause/dedup/error accounting from `guardScheduler`.

`openclawBridgeStaleMessages` remains a raw 30-second interval that only starts
when `OPENCLAW_BRIDGE` is enabled. It still calls
`processStaleMessages(generateChatResponse, addChatMessage, getChatHistory,
sendToUsername)` from `server.js`. `processStaleMessages()` now has an
in-process overlap guard and returns structured results for success, overlap
skip, and top-level error paths. The stale fallback still clears
`kleshnya_chat.is_generating`, calls the local fallback generator, saves the
assistant reply, updates `chat_sessions`, and sends the `kleshnya:reply`
WebSocket payload. It still has no durable multi-instance lock and no
`scheduler_executions` pause/error accounting, so multiple app instances may
still race on the same stale rows.

`cleanupKleshnyaMessages` remains a raw 30-minute interval from `server.js`.
It calls `cleanupExpired()` in `services/kleshnya-greeting.js`, which deletes
expired `kleshnya_messages` cache rows. `cleanupExpired()` now has an
in-process overlap guard and returns structured results for success, overlap
skip, and query error paths. It still has no durable multi-instance lock and no
`scheduler_executions` pause/error accounting, but its only runtime mutation is
removing expired local greeting cache rows.

`telegramRetryQueue` remains a raw 30-second retry loop for failed Telegram
notifications. Its queue is in-memory only: queued retries are lost on process
restart and are not shared across app instances. `processRetryQueue()` now has
an in-process overlap guard, so a second tick in the same Node.js process skips
while the first retry pass is still running. It still has no durable
multi-instance lock and no `scheduler_executions` pause/error accounting.

`eventBusProcessOutbox` remains a raw 5-second relay, but its duplicate
protection lives inside `services/eventBus.js`: `processOutbox()` opens a
transaction, claims unpublished rows with `FOR UPDATE SKIP LOCKED`, ignores
rows at `publish_attempts >= 5`, inserts into `event_queue` with
`ON CONFLICT (idempotency_key) DO NOTHING`, and marks claimed rows as published.
Rule processing is scheduled only after a successful `COMMIT`, so downstream
side effects are not started for a relay transaction that rolls back or fails
to commit. It still has no `scheduler_executions` pause/error accounting.

`marketingPublishScheduled` remains a raw 5-minute interval and
`marketingWeeklyPlan` remains a raw 60-second gate that only generates during
the Wednesday 08:00-08:05 UTC window. Both call scheduler-facing wrappers in
`lib/marketing-agent.js` with in-process overlap guards and `finally` reset.
The weekly wrapper marks the UTC date only after a successful generation, so a
failed generation can retry during the same window. These wrappers do not add
durable multi-instance locking and still do not write `scheduler_executions`
pause/error accounting. The weekly marker is in-memory only, so process restart
or multiple app instances can still duplicate the attempt unless the underlying
`content_posts` checks reject it.

`dashboardAlertBroadcaster` remains a raw starter from `server.js`; startup
still calls `startAlertBroadcaster(60000)`. The starter now keeps a single
interval per Node.js process and returns an `already_started` skip result on
duplicate start attempts instead of replacing the active interval or adding
another initial timeout. Broadcaster tick errors are logged and contained, and
the last-delivered alert hash is updated only after a successful websocket
broadcast. It still has no durable multi-instance lock and no
`scheduler_executions` pause/error accounting, so multiple app instances may
broadcast independently.

`taskLifecycleStartup` remains a raw startup `setTimeout` after 30 seconds, but
it calls the same `guardedTaskLifecycle` runner as the minute interval. The
guarded `runTaskLifecycle` job is deduplicated daily in `scheduler_executions`.
The lifecycle runner updates `tasks.health_score` only when the calculated score
changes and runs the strict cancelled-booking machine auto-archive policy. That
archive path uses a transaction-scoped advisory lock, repeats the safety
predicates in the `UPDATE`, writes canonical task history, and does not delete
or mark tasks done. Generic score-zero archive remains report-only.

## Test Anchors

The manifest records test files where direct coverage exists:

- `tests/checkbox-webhook-reconciliation.test.js`
- `tests/event-queue.test.js`
- `tests/customer-birthday-tags.test.js`
- `tests/reply-escalation.test.js`
- `tests/scheduled-chat-dispatch.test.js`
- `tests/booking-push-reminders.test.js`
- `tests/scheduler-guard-contract.test.js`
- `tests/event-bus-outbox-hardening.test.js`
- `tests/telegram-retry-queue-hardening.test.js`
- `tests/openclaw-bridge-stale-messages-hardening.test.js`
- `tests/kleshnya-cleanup-hardening.test.js`
- `tests/scheduler-notification-jobs-hardening.test.js`
- `tests/marketing-scheduler-hardening.test.js`
- `tests/dashboard-alert-broadcaster-hardening.test.js`
- `tests/task-lifecycle-scheduler-hardening.test.js`
- `tests/telegram-callbacks.test.js`
- `tests/graduation-ops-automation.test.js`
- `tests/hr-attendance-document-automation.test.js`
- `tests/attendance-review-tasks.test.js`
- `tests/training.test.js`
- `tests/guardian-ops.test.js`
- `tests/guardian-convergence.test.js`

`tests/event-queue.test.js` is a live API suite and requires the configured app
credentials/env described in `README.md`; it is not part of the self-contained
`npm test` baseline. Many legacy jobs are still only statically mapped. Add
direct tests before changing their timing, idempotency, retry behavior, or
notification target.

## Static-Only Coverage Debt

These jobs are intentionally registered as static-only coverage debt in
`config/schedulerSurface.js`. They have source/interval/dedup ownership guards,
but no direct behavior test in the local baseline yet:

`checkRecurringTasks`, `checkRecurringAfisha`, `checkWorkDayTriggers`,
`checkMonthlyPointsReset`, `checkHrAutoClose`, `checkHrNoShow`,
`checkStreakUpdates`, `checkBirthdayGreetings`, `checkBirthdayReminders`,
`checkDormantCustomers`, `checkTaskOverdue`, `checkCustomerRetention`,
`checkAutoReport`, `checkHotLeads`, `checkExpiredChatMessages`,
`checkAutoReviewRequests`, `checkTeamPulseReminder`,
`checkStaleCatalogImages`, `checkChatDailyDigest`,
`checkRecurringAnnouncements`, `checkEventPipeline`, `checkNpsFollowUp`,
`checkCleaningTasks`, `syncAgentActivities`, and `cleanupRefreshTokens`.

If one of these jobs gets direct tests, remove it from
`STATIC_ONLY_SCHEDULER_JOBS` in the same change. If a new scheduler job is added
without tests, it must appear here so the production risk remains visible.

## Done Marker

This pack is considered done when all of these remain true:

- `npm run check:scheduler-surface` passes.
- `npm test` includes `npm run check:scheduler-surface`.
- Every `guardScheduler` job in `server.js` exists in `config/schedulerSurface.js`.
- Every raw `server.js` interval/starter is listed here and in
  `config/schedulerSurface.js`.
- Any future scheduler behavior change has a direct test or an explicit
  cleanup-register note explaining the remaining gap.
