# EventGenix Goal heartbeat template

Run this heartbeat in the same task every 15 minutes only while the Goal is
active. It must have a bounded stop condition.

```text
Inspect the current EventGenix Goal and task state. Do not start duplicate work.

1. If the task is actively working, return without creating another writer.
2. If the task is idle and acceptance is incomplete, resume the next safe Green step.
3. If a command, exact-SHA CI, deploy, browser run, or QA lifecycle is in flight,
   use the native wait/status mechanism instead of restarting it.
4. If the existing Yellow block is authorized, unexpired, and unchanged,
   continue that envelope without another approval.
5. If a new Red action is required, stop and show one exact blocker.
6. Never give two tasks write access to the same branch or worktree.
7. Disable this heartbeat when the Goal completes, is stopped, or reaches its
   bounded expiry. Do not create a new task or standalone project.
```
