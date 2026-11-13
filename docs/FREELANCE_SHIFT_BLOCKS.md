# Freelance shift blocks

Base: `dd511e2f0da52da1401502991a68d476eee9ce44`, verified against the production branch ref via GitHub. The isolated feature worktree does not include the unrelated performance checkout changes.

- Schedule: migration 392 adds the work mode to the canonical HR shift segment. The schedule and HR serializers expose it. The schedule editor and fill template submit it, the copy route keeps it, and the schedule filter matches staff with at least one matching segment in the selected period.
- Compatibility: identified existing freelance segments retain their mode when the request omits the field. Implicit replacement through older writers is rejected. Legacy staff-level placeholders are independent.
- Attendance and payroll: attendance retains the mode on new plans and physical allocations. Standard compensation snapshots do not treat freelance segments as base pay. Payroll currently stops mixed or freelance days at the allocation confirmation gate. This is an implementation checkpoint, not the final payroll flow.
- Remaining: versioned freelance terms and explicit fact confirmation, regular-only payroll with the daily/monthly policy gates, safe historical links and settlement through the finance ledger, UI for those flows, import and replacement coverage, full PostgreSQL and browser acceptance, commits and release/rollback review.

The PostgreSQL checkpoint test uses an already migrated isolated local test database. Run it with `RUN_FREELANCE_SHIFT_INTEGRATION=true`, `TEST_DATABASE_URL` and the repository test target guard. All fixture writes roll back.
