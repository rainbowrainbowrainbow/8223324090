# Task cleanup operator toolkit

Status: operator tooling only. This is not product UI and does not schedule automatic cleanup.

## Purpose

Use `scripts/task-cleanup-operator.js` when a task cleanup wave has already been technically classified and the operator needs a reproducible dry-run manifest or a guarded archive apply.

The default mode is dry-run. Production mutation is not possible unless the operator passes explicit `--apply` approval flags and uses the dedicated `TASK_CLEANUP_APPLY_DATABASE_URL` environment variable.

## Dry-run

```bash
npm run task-cleanup:operator -- \
  --classifier task_strict_rule_engine_booking_type_auto_backlog_v1_2026_08_10_cancelled_booking \
  --output .codex-temp/task-cleanup/operator-manifest.json
```

Dry-run requirements:

- `TASK_CLEANUP_AUDIT_DATABASE_URL`, `TASK_AUDIT_DATABASE_URL`, or `PRODUCTION_READONLY_DATABASE_URL`;
- `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
- verified `transaction_read_only=on`;
- verified `transaction_isolation=repeatable read`;
- unconditional `ROLLBACK`.

stdout is aggregate-only: classifier, count, membership checksum, evidence checksum, and manifest checksum. It does not print task IDs, titles, owner names, source IDs, customer data, or secrets.

## Apply

Apply is for a separately approved production cleanup wave only.

```bash
npm run task-cleanup:operator -- \
  --classifier task_strict_rule_engine_booking_type_auto_backlog_v1_2026_08_10_cancelled_booking \
  --apply \
  --approved-classifier task_strict_rule_engine_booking_type_auto_backlog_v1_2026_08_10_cancelled_booking \
  --approved-count 2 \
  --approved-membership-checksum <sha256> \
  --archive-reason cleanup_strict_cancelled_booking_type_auto_v1 \
  --rollback-output .codex-temp/task-cleanup/rollback.json
```

Apply guardrails:

- requires `TASK_CLEANUP_APPLY_DATABASE_URL`; generic `DATABASE_URL` is refused;
- approval must match exact classifier, count, and membership checksum from fresh preflight;
- writes a rollback manifest before mutation;
- repeats all safety predicates inside `UPDATE`;
- archives in small batches;
- aborts on drift;
- supports archive only.

Unsupported operations:

- `DELETE`;
- `status=done`;
- restore;
- schema or migration changes;
- scheduler/Railway/settings changes.

## Supported classifiers

- `task5_strict_auto_complete_cancelled_booking_v1_2026_08_09`
- `task_strict_auto_complete_past_booking_backlog_v1_2026_08_10`
- `task_strict_rule_engine_booking_type_auto_backlog_v1_2026_08_10_past_confirmed_booking`
- `task_strict_rule_engine_booking_type_auto_backlog_v1_2026_08_10_cancelled_booking`

Add new classifiers only with tests that prove:

- dry-run remains read-only;
- stdout remains PII-free;
- apply requires exact approval;
- `UPDATE` repeats safety predicates;
- drift cancels mutation.

