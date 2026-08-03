# Hermes Railway notification_outbox worker

Status: safe-local implementation scaffold. Do not deploy or enable this worker without a separate cutover approval.

## Purpose

This worker is the future server-side replacement for the local Hermes cron job:

```text
6cd93e92f156 — event_genix_hermes_notification_outbox_live_cron.py
```

The local cron remains the canonical live poller until a server worker target is deployed in read-only mode, smoke-tested, and the local cron is paused first.

## Entry points

```bash
npm run hermes:outbox:worker:read-only
npm run hermes:outbox:worker:dry-run
npm run hermes:outbox:worker:batch-read-only-loop
npm run hermes:outbox:worker:live-once
```

Default mode is `read_only`.

## Required future Railway worker env names

Values are secrets/config and must not be printed in logs or receipts.

```text
HERMES_OUTBOX_WORKER_MODE=read_only|dry_run|read_only_loop|dry_run_loop|live_once|live_loop
HERMES_OUTBOX_HOURLY_BATCH_OWNER_USER_IDS=4,3,40,13,1  # owner allowlist, not batching by itself
HERMES_OUTBOX_BATCH_ENABLED=0|1
HERMES_OUTBOX_BATCH_OWNER_USER_IDS=4,3,40,13,1
HERMES_OUTBOX_BATCH_WINDOW_MINUTES=60
HERMES_OUTBOX_BATCH_MAX_ITEMS=10
HERMES_OUTBOX_BATCH_FORCE=0
HERMES_OUTBOX_BATCH_STATE_DIR=.hermes/outbox-batch-state
HERMES_OUTBOX_OWNER_TARGETS_JSON={...}
HERMES_OUTBOX_WORKER_LIMIT=20
HERMES_OUTBOX_WORKER_MAX_EVENTS=5
HERMES_OUTBOX_ALLOW_SEND=0 until live cutover
HERMES_OUTBOX_ALLOW_CRM_MUTATION=0 until live cutover
HERMES_OUTBOX_CONFIRM_SEND=0 until live cutover
HERMES_OUTBOX_LOCAL_CRON_PAUSED_CONFIRMED=0 until local cron 6cd93e92f156 is verified paused
HERMES_OUTBOX_SEND_BUTTONS=0 for initial rollout
TELEGRAM_BOT_TOKEN=[REDACTED]
```

## Live gates

The worker refuses live mutation/send unless all of these are true:

```text
mode is live_once or live_loop
owner allowlist is exactly 4,3,40,13,1
owner16 is absent and always hard-blocked
HERMES_OUTBOX_LOCAL_CRON_PAUSED_CONFIRMED=1
HERMES_OUTBOX_ALLOW_SEND=1
HERMES_OUTBOX_ALLOW_CRM_MUTATION=1
HERMES_OUTBOX_CONFIRM_SEND=1
TELEGRAM_BOT_TOKEN is present
all approved owners have Telegram targets configured
HERMES_OUTBOX_SEND_BUTTONS=0
```

## Batch policy

When `HERMES_OUTBOX_BATCH_ENABLED=1`, normal/low `task_created` and `task_assigned` events for configured batch owners are grouped per owner into one hourly Telegram message. High/urgent reminders, overdue events, task updates, unsupported owners, missing targets, and owner16 stay outside the batch path.

Safe rollout starts with:

```text
mode=read_only_loop
batch_enabled=1
batch_owner_ids=4
send_attempted=false
crm_mutation_attempted=false
```

Live batch send/ack still requires the same live gates as one-by-one mode plus separate owner approval for the live smoke.

## Owner16 policy

Owner 16 is blocked with:

```text
OWNER16_IDENTITY_SENDER_AUDIT_REQUIRED
```

Do not add owner16 to the allowlist until identity/sender audit and separate approval are complete.

## Button/callback policy

Initial Railway worker rollout sends plain Telegram task messages without callback buttons. The local Hermes Python worker stored callback token state on the Hermes filesystem; Railway must not create callback buttons until server-readable callback state exists.

## Cutover invariant

```text
NEVER: local cron active + server live worker active
ONLY: local cron paused -> exactly one server live worker active
ROLLBACK: disable server worker -> verify off -> resume local cron
```

## Verification before any deploy approval

```bash
npm run check:runtime
node --check scripts/hermes-notification-outbox-worker.js
npm run test:hermes-outbox-worker
npm run check:syntax
```

Read-only or dry-run server smoke must prove:

```text
send_attempted=false
crm_mutation_attempted=false
owner16 blocked
no secrets printed
local cron unchanged
```
