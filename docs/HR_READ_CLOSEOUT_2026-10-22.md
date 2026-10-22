# HR read closeout — 2026-10-22

## Current evidence

Production v0.82.108 / `af8c42a31f5fb7af71155943e76f4209d589b835` and remote `codex/eventgenix-production` matched at preflight. CI https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/39792701571 succeeded. EG-HR-16/17 changes remain in the production ancestry; no duplicate implementation is needed.

The original 2026-10-16 release proof and its redacted JSON are now included in this scoped test/documentation branch. Historical statements about their formerly local-only storage describe the original release; this closeout supersedes that storage status. No deploy or version bump is needed for test/docs changes.

## Browser synchronization debt

Observed failures retained in the original proof:
- Task Center measured the mobile sidebar after a fixed 75 ms despite finite CSS transitions.
- Omni used two animation frames before responsive geometry measurements; that is not evidence that transitions or ResizeObserver-driven layout have settled.
- Education journey treated a momentarily empty request set as safe navigation. Its timeout reported no outstanding routes. Teacher/hrLink pages had runtime/network-idle checks but no common request quiet-window barrier for their final navigation boundary.

Test-only changes observe geometry stability and finite animations without disabling motion or removing overflow assertions. The common request tracker requires a 500 ms quiet interval, resets on every same-origin request event, retains a 15-second hard timeout and reports only method/redacted pathname/type for stuck requests. Current-document requests and all page errors remain strict. Cancelled GET/HEAD reads of a previous committed document are retired from that document's pending set and recorded in navigationRetiredReads; writes are never retired. A permanent request still fails; no unlimited retries were added.

Focused unit tests cover a new request beginning during the initial empty interval, failed requests draining, foreign traffic not affecting the app boundary, stuck-request failure with redacted diagnostics and listener cleanup. A browser regression verifies waiting for finite motion while retaining deliberate overflow. Existing Task Center and Omni assertions are unchanged. These changes address identified synchronization gaps; they do not claim the whole CI is proven flake-free after one successful run.

Local runtime: Node 22.23.1/npm 10.9.8. Task Center, common browser synchronization and Omni suites passed. The local Docker daemon is unavailable; Education PostgreSQL/browser validation must pass in exact-SHA CI before integration.

## Ownership evidence and protected follow-up

At 2026-10-22T18:00:26Z the existing eventgenix_audit_ro role used REPEATABLE READ READ ONLY and ROLLBACK. Counts: professions 35; checklist items 93; checklist progress 7; assignments 264; staff 217; onboarding progress 7; templates 2; linked Park tasks 20. All checked orphan/invalid/foreign-task counters were zero. Ten read queries passed EXPLAIN. No new grant or lease.

These aggregates support integrity, not business ownership. The human Park-only owner decision remains authoritative for this legacy global dataset. Read projections still exclude training, compensation, conditions, medical and account identities. A concrete owner-column migration proposal is in HR_PARK_TENANT_OWNERSHIP_MIGRATION_PLAN_2026-10-22.md. No schema or data backfill was performed in this closeout.

## Remaining QA boundary

Both late-response orders remain covered by deterministic synthetic browser tests. This closeout may recheck current live Park reads and Dar denial without activating a new membership. A real two-business session requires an already suitable isolated test account or a separately approved exact temporary fixture. Synthetic proof must not be labelled live switching proof.

## Integration gate

Only these test helpers/regressions, package test commands and redacted docs are in scope. Feature exact-SHA CI, including Education journey/hrLink on disposable PostgreSQL, must be green before integration. Product release markers, HR API, roles, memberships, schema, grants and production settings remain unchanged. Any needed product/auth/schema fix requires its own review.

## Current live recheck

The existing isolated Park test account passed the same six GETs, Dar context denials, private-field masks, closed payroll/account paths, workspace/onboarding 403/500/offline Retry, Team and Today detail, and Schedule GET/render on v0.82.108 / af8c42a31f5fb7af71155943e76f4209d589b835. Evidence is in HR_READ_CLOSEOUT_LIVE_QA_2026-10-22.json. All product mutations were blocked; one unrelated daily-login reward POST was blocked before reaching the server. No membership was activated.

CI diagnostics identified old-document timeline reads remaining in the pending set after committed navigation. The tracker now binds that lifecycle explicitly, records every retired read and retains the no-page-errors assertion. Unit coverage proves that unfinished writes and new-document reads still block.
