# Task cleanup inventory — read-only runbook

Status: read-only audit tooling. No task cleanup, archive, delete, status update, migration, scheduler change, or production setting change is included here.

## Purpose

Use this inventory before any task cleanup decision. The classifier separates machine-created task debt from manual, private, My Day, AI-assisted, attendance, Hermes/integration, and unknown provenance records.

## Command

```bash
npm run audit:task-cleanup-inventory -- --output .codex-temp/task-cleanup-inventory/manifest.json
```

Connection env, in priority order:

1. `TASK_CLEANUP_AUDIT_DATABASE_URL`
2. `TASK_AUDIT_DATABASE_URL`
3. `PRODUCTION_READONLY_DATABASE_URL`

The script starts `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, verifies `SHOW transaction_read_only = on`, runs SELECT queries only, then ends with `ROLLBACK`.

## Output policy

- stdout prints aggregate counts only.
- `--output` writes the full deterministic JSON manifest with task IDs, classifier version, counts, and checksum.
- The manifest must stay out of tracked repo history unless the owner explicitly approves storing production IDs.
- The script does not select or print task titles, descriptions, user names, customer data, connection strings, or secrets.

## Cleanup candidate policy

Only `cohorts.cleanupCandidates.strictCancelledBookings` is intended as the first possible cleanup candidate list.

A task is excluded from cleanup candidates and routed to protected/review if any of these apply:

- typed `created_by_user_id`;
- `private`, `me_only`, or `personal` task visibility/mode;
- `in_progress`;
- focus rank;
- snooze history or future snooze;
- human task log/action history;
- subtasks;
- dependencies;
- observers;
- AI draft/bundle provenance;
- attendance provenance;
- Hermes/integration provenance;
- manual or unknown provenance.

## Booking cohorts

Booking-linked overdue automation is split into:

- `cancelled`;
- `past_active`;
- `today_future`;
- `orphan`.

If counts differ from an older baseline, prefer the current manifest. Do not tune SQL to reproduce stale counts.
