# Task cleanup review

The figures below are from a disposable PostgreSQL database. A production
read-only database binding was unavailable, so production counts and membership
checksums are pending. The inventory, stale-machine report and operator ran
against the fixture in read-only or dry-run mode.

| Business | Source | Reason | Fixture count |
| --- | --- | --- | ---: |
| event_genix | booking | Passed the strict cancelled-booking selector | 1 |
| event_genix | booking | Eligible for an archive wave after replay checks | 0 |
| event_genix | booking | Review individually because the trigger recreates it | 1 |
| event_genix | booking | Replan: active task needs an assignee | 1 |
| event_genix | recurring | Replan: active task needs an assignee | 2 |

Treat ambiguous lineage, human activity, private work, co-assignees and
dependencies as individual-review signals. An active task that still needs
execution belongs in replanning after checking those protections and the linked
record. Use the strict dry-run wave selector for archive membership.

## Booking replay

The same `booking_create` event matched the fixture rule **QA booking replay rule**
with a `create_task` action both before and after archival. Two calls before archival
returned one active task, ID `1`. After archiving that exact fixture row, there were
zero active tasks. Replaying the trigger created ID `2` and restored the active count
to one. The new booking created ID `3`.

`processBookingAutomation` re-evaluates the rule on replay. The
`findActiveDuplicateTask` predicate in `services/taskDuplicatePolicy.js` excludes
archived rows. Hold waves whose cancelled booking triggers can be replayed until
the rule behaviour is approved and verified.

The recurring template query now sorts by the qualified business context with
the existing default for legacy rows. The test calls the actual scheduler twice
for each fixture date. It kept ID `4` on `2099-02-02` and created only ID `5`
on `2099-02-03`.

## Read-only commands for production counts

Run this with the approved read-only connection already loaded into
`PRODUCTION_READONLY_DATABASE_URL` through the secret store. The output directory
contains task IDs and should stay in the operator's restricted workspace.

```bash
set -euo pipefail
: "${PRODUCTION_READONLY_DATABASE_URL:?Load the approved read-only connection}"
mkdir -p ./output
report_dir=$(mktemp -d ./output/task-cleanup.XXXXXXXX)

TASK_CLEANUP_AUDIT_DATABASE_URL="$PRODUCTION_READONLY_DATABASE_URL" \
  npm run audit:task-cleanup-inventory -- --output "$report_dir/inventory.json"
TASK_CLEANUP_READONLY_DATABASE_URL="$PRODUCTION_READONLY_DATABASE_URL" \
  npm run audit:task-stale-machine-report -- --output "$report_dir/stale-machine.json"

for classifier in \
  task5_strict_auto_complete_cancelled_booking_v1_2026_08_09 \
  task_strict_rule_engine_booking_type_auto_backlog_v1_2026_08_10_cancelled_booking \
  task_strict_auto_complete_past_booking_backlog_v1_2026_08_10 \
  task_strict_rule_engine_booking_type_auto_backlog_v1_2026_08_10_past_confirmed_booking
do
  TASK_CLEANUP_AUDIT_DATABASE_URL="$PRODUCTION_READONLY_DATABASE_URL" \
    npm run task-cleanup:operator -- --classifier "$classifier" --output "$report_dir/$classifier.json"
done
```

The inventory contains `byBusinessContext`, provenance, protection reasons and
cohorts. Reconcile each wave with the linked source's current state, and confirm
that it cannot recreate the same task after archival. The fixture wave had one
ID and membership checksum
`412a81d2b54140b6992a74782614d7fb082d224483d52b99329a575bff5fda23`.
That checksum identifies the held fixture wave only.

For any separately approved archive wave, record the classifier, reason, count,
membership and evidence checksums. Keep the rollback manifest emitted by the
operator. An approved rollback would restore only the recorded IDs and their
previous status, workflow, archive timestamp and reason, after confirming the
current archive reason and checking for a newly recreated active task.
