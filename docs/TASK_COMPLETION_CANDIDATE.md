# Task completion candidate and KPI decision

## Proposed KPI contract for Art

The production profile aggregates standard task KPIs through the primary-owner predicate with a legacy match for untyped tasks and the selected business scope. Its My Day history uses personal task visibility, which includes current co-assignees. HR's `/api/hr/kpi` aggregates by the current typed primary owner through an active employee profile and has no business predicate in its task CTE. Its monthly drill-down pins `event_genix`. Both HR implementations select tasks created or completed in the period. The profile's completed slices filter by completion time. The queries also differ in legacy status normalization and date conversion. None of these KPI aggregations attributes task completion to the actor in `task_action_history`.

The proposed contract uses the following rules.

- Apply the same explicit eligible business set and `taskKpiEligibleSql` policy in HR and the profile. Compute period bounds in Europe/Kyiv, including the lower bound and excluding the upper bound. Apply the canonical status and overdue rules consistently.
- Assign workload and the completion-rate numerator to the primary owner for the same task cohort. Use one task per business and task ID in that KPI. Snapshot the primary owner when the task is completed so later reassignment does not move historical credit. Keep legacy owner resolution explicit and leave ambiguous matches unattributed.
- Report actual completions as a separate count by actor, from the canonical `task_completed` history event for the selected completion. Keep a missing actor unknown. Co-assignment and observation do not create KPI credit or completion events on their own.
- Use the current completion for a reopened and completed task in the same reporting cohort. Keep the prior actions in history. A retry of the same operation changes neither the counters nor history.

| Synthetic case | Primary-owner KPI | Actual completions |
| --- | --- | --- |
| A owns and completes an eligible task in Park | A +1 completed in Park | A +1 |
| A owns, co-assignee B completes, observer C reads | A +1 completed | B +1, C +0 |
| A owns when B completes, then the task is reassigned to C | A retains the historical completion | B +1 |
| Park and Dar each have a completed task, with Park selected | Count only the Park task | Count only the Park actor event |
| B retries the same confirmation, then an eligible new completion follows a reopen | One completed task using the latest completion in the cohort | Count the actor for that completion once |
| An untyped legacy task has an ambiguous primary-owner match and no actor record | Unattributed | Unknown |
| Completion at 00:05 Kyiv on the first day of the month, or an unaccepted machine task | Include the eligible completion in the new month. Exclude the unaccepted machine task. | Follow the same business, period and eligibility filters |

This is a decision proposal. The candidate includes no changes to the KPI queries or their attribution rules.

## Publication plan

1. Confirm live and remote SHA, current release markers, migration inventory and available patch version. Confirm the migration ledger has no previous local draft of 428 and review the exact candidate SQL. Keep 419 and 427 byte-for-byte. Migration 425 already exists at the baseline. Keep the separate HR/payroll/freelance work, RAM/Checkbox, task 28 and the task-creation co-assignee picker out of the release.
2. Before a production push, verify the WebKit tag gate independently. Compare the full production and tag jobs at the same SHA. For the tag failure, investigate the background fetches and navigation sequence in `task-entry-checks.js` without loosening genuine transport and access checks.
3. After explicit production authorization, prepare the version commit and release manifest. Require green exact-SHA CI. Review migration 428's relation rename and index build for lock duration on the target PostgreSQL instance. Use the documented Railway helper for service `8223324090`.
4. Verify the live SHA, branch and version, and inspect read-only queue counters. Coordinate the compatible Telegram worker so completion events are claimed with `completionEvents: true`. Prove actual delivery separately under an authorized disposable QA scope.
5. For an application rollback, prepare a forward release that restores the 01be710 runtime behavior, retains the 428 migration file, and gets a new patch version and exact-SHA CI proof. The Railway helper rejects uploading the older version directly. Leave the applied migration and delivery table in place. The old API accesses a filtered writable view of primary assignments, so it can finish its own deliveries while co-assignment and completion events remain durable. Recover them with the compatible API and worker within the queue's normal expiry window and reconcile uncertain in-flight leases before reattempting delivery.
