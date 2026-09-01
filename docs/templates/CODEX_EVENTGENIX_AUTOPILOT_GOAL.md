# EventGenix autopilot Goal template

Invoke with `$eventgenix-production-autopilot` in the EventGenix project task.

```text
Outcome:
<the user-visible result, not only the implementation activity>

Constraints:
- Work in one isolated clean worktree.
- Preserve the dirty main checkout and unrelated changes.
- Green work continues automatically.
- Production work uses one bounded Yellow controller block.
- Red actions stop for a separate exact decision.

Acceptance criteria:
- Final code and required tests are complete.
- Exact-SHA CI is green.
- Deploy and live proof exist when production is in scope.
- Disposable QA state and cleanup/TTL evidence exist when live QA is in scope.
- UI screenshots/report exist when UI is in scope.
- Remaining risks and rollback path are documented.

Allowed side effects:
<feature commits/push, production release, disposable QA scope, or none>

Stopping rules:
- Stop on Red scope, real-data risk, target drift, expired authorization,
  exhausted attempt budget, or protected booking contract changes.
```

After connectivity loss, resume this same task. Inspect the Goal status, current
worktree/branch, latest commit, production block manifest, CI/deploy wait state,
and QA registry before selecting only the next safe step.
