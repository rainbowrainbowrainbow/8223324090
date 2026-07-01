# Event Genix Hermes notification_outbox E2E Smoke Plan

Status: plan only, not executed.

This document prepares a future approval-gated end-to-end smoke for Hermes
native task DM delivery through CRM `notification_outbox`.

## Goal

Verify this future path exactly once:

```text
real test CRM task
  -> notification_outbox event created
  -> Hermes sends exactly one Telegram DM
  -> CRM outbox ack status=sent
```

This smoke must prove Hermes-native delivery separately from the legacy CRM/Park
Telegram bot path.

## Non-Execution Statement

This file is a plan only.

During creation of this plan:

- No CRM task is created.
- No Telegram message is sent.
- No production DB migration is applied.
- No deploy is performed.
- No Railway setting is changed.
- No webhook is activated.
- No Hermes cron job is changed.

## Required Approval String

Do not execute this smoke unless the owner provides this exact approval block:

```text
APPROVE CRM HERMES OUTBOX E2E SMOKE
CREATE_ONE_TEST_TASK=true
TITLE="[HERMES_SMOKE] Тест outbox Hermes DM"
OWNER_USER_ID=4
SKIP_LEGACY_NOTIFICATIONS=true
ALLOW_HERMES_SEND=true
MAX_TELEGRAM_MESSAGES=1
NO_DEPLOY=true
NO_CRON_CHANGE=true
NO_REAL_CLIENT_TASKS=true
```

Any missing or changed line means approval is incomplete.

## Preconditions

- Target CRM environment is explicitly named.
- Target environment is not production unless the owner explicitly says it is
  production and approves production execution.
- CRM code includes `notification_outbox` schema and Hermes outbox endpoints.
- CRM env/config enables outbox event creation for the target environment.
- Hermes API auth is configured, but secrets are not printed in chat, logs, or
  docs.
- Test owner is `owner_user_id=4`.
- The task title is exactly `[HERMES_SMOKE] Тест outbox Hermes DM`.
- Any Hermes-side fallback or delivery job has been freshly verified outside
  this CRM repo if the smoke depends on it.
- No real client task is selected or mutated.

## Create Path

Preferred create path after approval:

```js
services/kleshnya.createTask(payload, {
  skipNotifications: true,
  hermesOutboxEnabled: true,
  hermesOutboxContext: { crmBaseUrl: "<approved CRM base URL>" }
});
```

Use `skipNotifications: true` to avoid intentional legacy CRM/Park bot
notification. The smoke is for Hermes-native delivery only.

Do not blindly use:

```http
POST /api/hermes/tasks
```

That route is a Hermes task mutation path and can exercise behavior unrelated to
this smoke. The smoke should create one real CRM task row while suppressing the
legacy app-bot notification path.

## Future Smoke Steps After Approval

1. Confirm the approval block exactly matches the required approval string.
2. Confirm the target CRM environment and base URL.
3. Confirm no deploy, no cron change, and no real client task are involved.
4. Create one test task with:
   - title: `[HERMES_SMOKE] Тест outbox Hermes DM`
   - `owner_user_id=4`
   - `skipNotifications=true`
5. Verify the CRM task id.
6. Verify exactly one outbox event was created.
7. Verify the event fields:
   - `event_type=task_created`
   - `status=pending`
   - `task_id=<created task id>`
   - `owner_user_id=4`
8. Run the Hermes outbox worker in dry-run/render mode.
9. Verify dry-run selects exactly one event.
10. Run Hermes send once with explicit send flags.
11. Verify exactly one Telegram message was sent.
12. Capture the Telegram message id.
13. Ack the outbox event in CRM.
14. Verify `status=sent`.
15. Re-run dry-run.
16. Verify no duplicate candidate is selected.
17. Do not complete, delete, archive, or mutate the test task unless separately
    approved.

## Suggested Safe Inspection Commands

Use the API where possible:

```http
GET /api/hermes/notification-outbox?status=pending&limit=50
GET /api/hermes/notification-outbox/stats
GET /api/hermes/notification-outbox/debug?limit=20
```

If direct DB read access is explicitly approved for a non-production
environment, keep it bounded and sanitized:

```sql
SELECT event_id, task_id, owner_user_id, event_type, status, attempts,
       created_at, available_at, claimed_at, sent_at,
       last_error_code, last_delivery_channel, last_delivery_target
FROM notification_outbox
WHERE task_id = <created_task_id>
ORDER BY id DESC
LIMIT 5;
```

Do not select full `payload_json` by default.

## Expected Receipt After Future Execution

The future executor should return this receipt shape:

```text
crm_task_created=true
task_id=<id>
skipNotifications=true
legacyParkNotifyAttempted=false
outbox_event_created=true
event_id=<event_id>
hermes_send_attempted=true
telegram_message_id=<id>
outbox_ack_status=sent
post_run_duplicate_check=pass
```

If any line cannot be truthfully filled, report the blocker and stop.

## Abort Conditions

Stop immediately if:

- More than one candidate event is selected.
- More than one Telegram message would be sent.
- The event is not `pending` before claim.
- The owner id is not `4`.
- The task title does not exactly match the smoke title.
- Legacy CRM/Park bot notification is attempted.
- Any secret would need to be printed.
- The target appears to contain a real client task.
- A deploy, cron change, webhook activation, or production migration is needed.

## Rollback After Future Smoke

Do not delete or complete the test task unless separately approved.

If the smoke exposes a problem:

1. Disable CRM outbox event creation with
   `HERMES_TASK_OUTBOX_ENABLED=false`. Compatibility flags such as
   `HERMES_NOTIFICATION_OUTBOX_ENABLED=false` or
   `NOTIFICATION_OUTBOX_ENABLED=false` may also be used if that is how the
   environment is configured.
2. Keep the `notification_outbox` table for diagnostics.
3. Use only a currently verified Hermes fallback plan. Historical V0.6 polling
   notes are not active instructions by themselves.
4. Do not change Hermes cron, gateway, route config, or Railway settings
   without explicit owner approval.
5. Preserve sanitized evidence: task id, event id, status, attempts, and
   `last_error_code`.

## Fresh Codex Session Prompt

Use this when starting a fresh Codex session:

```text
You are working in the Event Genix CRM repository.

Goal:
Implement CRM-side notification_outbox foundation for Hermes-native task notifications.

Do not send Telegram, do not deploy, do not apply production migrations, do not change Hermes cron jobs, and do not print secrets.

Historical fallback notes:
Older docs may mention a Hermes V0.6 polling cron. Treat that as historical
context only unless a fresh Hermes-side audit verifies the current job,
schedule, owner routes, and approval boundaries.

Do not disable, recreate, or modify Hermes fallback jobs from the CRM repo.

Final architecture:
CRM Task Service -> notification_outbox -> Hermes Delivery Worker -> Telegram DM.
Outbox is source of truth. Webhook is only accelerator.
CRM legacy Telegram bot is not Hermes-native delivery.

Execute only the task I name. Start with TASK 1 read-only discovery unless I explicitly ask for another task.
After each task return:
STATUS / FILES_CHANGED / TESTS_RUN / TEST_RESULT / SECURITY_NOTES / ROLLBACK_NOTES / BLOCKERS / NEXT_STEP.
```
