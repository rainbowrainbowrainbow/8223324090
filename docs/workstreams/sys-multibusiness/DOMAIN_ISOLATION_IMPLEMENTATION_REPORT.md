# SYS-MB-05 — Operational domain increment

Historical checkpoint. D-01 was subsequently implemented and verified locally in [FINANCE_AVAILABILITY_IMPLEMENTATION_REPORT.md](FINANCE_AVAILABILITY_IMPLEMENTATION_REPORT.md). Use its verification manifest for the current source hashes and remaining-work status; the results below remain evidence of this earlier increment.

Date: 2026-09-12. Base commit: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
Branch: `codex/sys-mb-auth-p0-20260912`.
Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.

This increment continues the existing profile/editor checkpoint. It closes concrete employee, related-record, timeline, warehouse and graduation boundary gaps. It does not certify the entire multi-business model as complete. Release readiness remains on hold for the explicit domain gaps in [DOMAIN_ISOLATION_INVENTORY.md](DOMAIN_ISOLATION_INVENTORY.md).

## Baseline and isolation

- Before edits, verified the worktree branch/HEAD and all 55 source hashes from `PROFILE_UI_VERIFICATION.json`.
- Retained cumulative P0, lifecycle, streaming/effective-owner and profile/editor changes. Main checkout and other streams were not edited.
- No schema/migration, dependency, global menu/router/theme, financial formula, production data, credential or hosting change. Existing migration 357 is used only in disposable test databases; this increment adds no migration.
- No commit, push, CI dispatch, deploy or live QA was performed. Version remains the unreleased worktree marker `0.81.132`; no current production version is inferred from it.

## Implementation decisions

`services/businessUserAccess.js` composes parameterized candidate predicates and a role projection from active business and organization memberships. It requires an active organization, business and candidate memberships and excludes an invalid non-platform creator role. Legacy internal/compatible paths retain their existing role policy; inaccessible explicit contexts fail closed. `services/taskExecution.js` applies this query to candidate lists and assignment validation. `routes/tasks.js` retains the read-scope check and passes task context during observer assignment. Existing department, self-only and private-task handoff policies remain in force.

`routes/leads.js` reuses the same membership projection for assignees and the accountant candidate, validates product/booking/mailing foreign IDs before writes, scopes historical product joins and conversation matches, and passes the business into collaboration-task ownership validation. `services/customerCommunicationHub.js` scopes exact/suggested conversations and expected-message identity. `routes/customers.js` filters inconsistent child-parent and review business links.

`services/timelineContext.js` takes its implicit context from the authenticated user and uses the current settings capability. `routes/bookings.js` retains user context for ticket quotes and rejects disagreement with an explicit query/header before pricing queries. The production server already mounts the aggregate write guard after authentication; actual HTTP/PG tests verify it. No duplicate guard or protected booking identity/renderer change was added.

`routes/warehouse.js` explicitly denies global photo-intake access for membership users or a non-Park business, before reading drafts or calling a provider. `services/warehousePhotoIntake.js` restricts the retained legacy confirmation to Park stock and locations, and records context in the existing transaction. Membership intake remains unavailable until ownership is durable. `routes/products.js` scopes the graduation fallback count, preserving a truthful zero.

## Verification

Final status: **READY_LOCAL_DOMAIN_INCREMENT_REVIEW**. The broader cutover remains **HOLD_REMAINING_DOMAIN_GAPS**. This increment changes 21 source/test files; the cumulative worktree contains 74 changed source/test files. Exact paths and SHA-256 hashes are recorded in [DOMAIN_ISOLATION_VERIFICATION.json](DOMAIN_ISOLATION_VERIFICATION.json).

| Check | Final observed result |
|---|---|
| `npm test`, Node 22.23.1 / npm 10.9.8 | PASS, exit 0. Runtime/version, configured ownership/governance checks and parser (1173 JS files) passed. Unit 2892, My Day 337, UI/static 1312, loader 4; zero failures. |
| Focused new domain, route-smoke and private-handoff regression | 123 PASS, zero failures/skips. |
| Four new disposable PostgreSQL suites on frozen final source | 34 PASS, zero failures/skips, exit 0; tasks 12, customer/leads 7, timeline 7, warehouse/products 8. |
| Existing timeline/context/resource/booking visibility focused run | 274 PASS. Protected source guard: all six blocks passed. |
| Existing client communication and lead deposit regressions | 18 PASS. |
| Warehouse/product focused HTTP/service fixtures | 11 PASS, including seven existing intake regressions. |
| PostgreSQL cleanup, independent read-only check after final run | 0 owned test databases, 0 remaining test connections. |
| `git diff --check` | PASS. |
| CI / deploy / live-site QA | NOT_RUN; production operations: 0. |

Final logs are in ignored `.codex-temp/sys-mb-domain-isolation/verification-final.log`, `focused-final.tap`, `postgres-final.tap` and `postgres-cleanup.json`. Their hashes are retained in the manifest. Earlier resolver/lifecycle/profile PostgreSQL and browser results belong to prior checkpoints; they were not rerun or relabeled as new live evidence here.

The first full baseline identified three fixture failures: a compatibility test lacked an actual CRM grant, and two private-handoff tests still matched the previous unqualified SQL projection. Corrected the fixtures while preserving the access/confirmation assertions. Focused rerun: 123 PASS. Independent review also reproduced and fixed the inaccessible compatibility-context fallback; its unit tests passed afterward.

Actual PostgreSQL suites execute the real changed services/routes. Tasks, customer/leads and timeline also use fresh DB-backed auth; the warehouse/product suite supplies a fixture principal and does not claim fresh-auth coverage. Fixtures are synthetic, created in uniquely named local databases and removed afterward. External providers, Telegram and production connections are not exercised. The task POST probe validates the canonical candidate lookup; it is not a full actual task-creation or reassignment transaction test. Existing private-handoff regression tests continue to cover mutation confirmation.

No browser UI code was changed in this increment. Existing UI/static checks are part of the full baseline; previous browser results remain historical evidence in `PROFILE_UI_VERIFICATION.json`. No screenshot or fixture test is presented as live-site QA.

## Review scenario

Run in an isolated fixture environment:

1. Give one account a Park role and a different Dar role. Open task/lead candidate lists in each business. Verify both the employees and returned roles change; stale legacy user context arrays do not remove a valid membership or restore a revoked one.
2. Revoke a candidate or actor membership. Repeat with the same JWT: directory and assignment access changes immediately; remaining business access survives.
3. Try a foreign product/booking/lead ID in a lead or mailing update. Expect rejection before mutation. Insert inconsistent fixture links directly in the disposable DB and verify related labels, conversations, messages and reviews do not cross business boundaries.
4. Make Dar the default. Request timeline/bookings without explicit context. Confirm Dar data and permissions. Try conflicting quote context or aggregate writes; expect denial before pricing/write SQL. Verify a role downgrade removes settings access with the same JWT.
5. Check membership photo intake returns `warehouse_photo_intake_not_migrated`. In legacy Park fixtures, foreign stock/location confirmation fails without quantity/history changes. A valid Park confirmation retains its existing transaction and explicit context.
6. Exercise the Park graduation fallback with zero and nonzero Park package counts alongside Dar/foreign fixture packages. Confirm the count excludes other businesses. Non-Park catalog visibility retains its current module policy.

## Remaining risk and handoff

The completed patch is reviewable locally. Global catalogs, recurring/templates, salary/HR ownership, resource availability privacy/default initialization, custom-business module behavior and integration intake ownership still prevent a claim of complete operational business isolation. Detailed files, minimal changes, dependencies, acceptance checks and explicit decision boundaries are in the inventory's D-01–D-06 tasks. Additional warehouse auxiliaries and graduation configuration evidence is in [DOMAIN_PRODUCTS_WAREHOUSE_FINANCE_AUDIT.md](DOMAIN_PRODUCTS_WAREHOUSE_FINANCE_AUDIT.md).

Recommended next task: **D-01 — finance account/reference ownership and resource availability**, followed by explicit legacy ownership/containment. Do not deploy the cumulative changes as a completed multi-business cutover on the strength of local tests alone.
