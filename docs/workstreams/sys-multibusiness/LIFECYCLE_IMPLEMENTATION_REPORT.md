# SYS-MB · Organization lifecycle and HTTP session contract

Date: 2026-09-12. Local implementation following the P0 resolver checkpoint.

This is the historical HTTP lifecycle checkpoint. Its streaming/account-deactivation findings are addressed by the subsequent local work in `STREAMING_OWNERSHIP_IMPLEMENTATION_REPORT.md`. Original verification hashes below describe the earlier source state; use `STREAMING_OWNERSHIP_VERIFICATION.json` for the current cumulative patch.

## Scope and baseline

- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.
- Branch: `codex/sys-mb-auth-p0-20260912`.
- Git base remains `a5180def01a1e47f8f4fc75e2f7a43092f205828`; this task builds on the previous uncommitted P0 patch, not a newly deployed version.
- Inputs: `P0_IMPLEMENTATION_REPORT.md` and the previous QA analysis D01/F09 and D02/F10 lifecycle findings.
- Prior route source and verification manifest are retained in ignored `.codex-temp/sys-mb-lifecycle/input/`.
- Incremental files: `services/organizationLifecycle.js`, `routes/organizations.js`, `package.json`, `tests/organization-lifecycle.test.js`, `tests/business-membership-organization-guards.test.js`, and `tests/integration/organization-lifecycle-postgres.test.js`.
- No schema/migration, dependency, HR, frontend/menu/theme, hosting, secret or production-data change. No commit, push, CI dispatch, deploy or live mutation was performed.

## Problems and implementation decisions

The previous member PUT replaced omitted `organizationRole` with `member`, cleared omitted override arrays/defaults and invalidated every account session. This could accidentally demote an owner while editing a business role. Admins could change their own organization role or promote other admins/owners. Audit was best-effort and often happened after COMMIT, so a successful access change could lack its corresponding audit record. Empty-table bootstrap was not serialized by `SELECT ... FOR UPDATE`.

Existing-organization lifecycle mutations now share one explicit service. Each such mutation starts a transaction, locks its organization row, rechecks the actor's current organization authority, validates the target and performs its changes together with strict audit before COMMIT. The organization lock serializes cooperating lifecycle writers across processes; it does not depend on a JavaScript mutex or new schema. Bootstrap retains its separate router workflow and global advisory lock.

### Authority contract

| Actor | Allowed behavior |
|---|---|
| Active organization owner | Create/activate/deactivate businesses; manage ordinary members, admins and owners, subject to last-owner protection. |
| Active organization admin | Manage business access for other ordinary organization members. Cannot modify self, another admin, an owner or a platform creator, and cannot promote an organization role to admin/owner. |
| Ordinary/inactive/foreign organization member | No lifecycle management. |
| Permanent platform creator with current `manage_accounts` authority | Retains technical organization-management bypass, with the account role rechecked from DB. Business creator role alone is insufficient. |
| Temporary QA creator lease | Does not grant the permanent platform bypass or bootstrap ownership. Independent organization ownership still grants its normal organization authority. |

An organization admin can assign any existing non-platform business role to another ordinary member, including director. Organization administration is an access-management responsibility; it is not a per-capability grant-ceiling policy. The service does not change the platform account role. Ordinary business CRUD is owner-only, matching the accepted SYS-MB plan.

### Existing API contracts

| Endpoint | Behavior |
|---|---|
| `POST /api/organizations/bootstrap` | Permanent creator only; global transaction advisory lock serializes first bootstrap, including different slugs. Existing organization returns `409 organization_bootstrap_complete`. Audit failure rolls back the whole organization/business/member graph. |
| `POST /api/organizations/:organizationId/businesses` | Owner/platform manager creates a new custom business key. All canonical built-in keys and aggregate aliases are reserved. An owner cannot claim unregistered CRM/MD legacy data partitions through this endpoint. |
| `PATCH /api/organizations/businesses/:businessId` | Owner/platform manager changes active/inactive status. Organization identity is obtained from the business record; a body `organizationId` cannot override it. |
| `PUT /api/organizations/:organizationId/members/:userId` | Updates or creates membership for the supplied `businessId`. Omitted values preserve existing state. Target account and business must be active. |
| `DELETE /api/organizations/:organizationId/members/:userId/:businessId` | Soft-deactivates business membership and clears its default flag. Keeps organization ownership/membership; an owner can still manage/recover the organization without an operational business membership. Repeat deactivation remains safe and auditable. |

Member PUT details:

- `businessId` is required. `role` is required for a new business membership and optional for an existing one.
- Omitted `organizationRole` preserves the existing organization role; a new organization membership defaults to `member`.
- Omitted `extraRoles`, page/action allow/deny arrays and `isDefault` preserve existing values. Explicit `[]` clears the corresponding override list; explicit `false` clears default.
- An explicit `true` default clears other defaults only for this user within this organization. Other organizations are unaffected.
- Malformed array/boolean/role inputs fail with 400 before mutation. Explicit primary/extra creator assignment remains forbidden.
- Denied organization management returns `403 organization_management_denied`. Demoting the last effective active organization owner returns `409 organization_last_owner`.
- Successful response envelopes and existing endpoint paths are retained. No new ownership-transfer endpoint or UI was introduced.

Ownership transfer uses the existing PUT API in a safe sequence: an owner promotes the successor to owner, then may demote their own organization role. If two owners concurrently demote themselves, exactly one request succeeds and the other receives 409. The service counts active owner memberships whose user accounts are active. This invariant is scoped to organization lifecycle writers; see the global deactivation gap below.

### HTTP sessions and audit

Membership PUT/DELETE no longer update `users.session_revoked_at` or revoke refresh tokens. The P0 middleware reads current membership for each protected HTTP request: the same JWT receives new roles/defaults immediately, loses a revoked business with 403 and can keep using another permitted business. Explicit account-wide session revocation remains unchanged and returns 401 for the old JWT afterward.

This is an **HTTP membership session contract**, not a claim that every streaming transport or frontend cached profile is refreshed. The existing WebSocket gap predates this patch and remains a rollout concern.

`recordAccountSecurityEvent` is reused with the same transaction client and `strict: true`. PUT records prior and resulting access state; DELETE records previous activation state. Business create/status and bootstrap also use strict transactional audit. If audit insertion fails, no business/membership change commits. Missing audit storage causes the operation to fail closed rather than silently succeeding.

## Verification and reproducibility

- Windows runtime: Node `22.23.1`, npm `10.9.8`.
- Targeted service + organization-route tests: **24/24 PASS**, no failures/skips.
- Actual lifecycle HTTP + PostgreSQL integration: **14/14 PASS** (13 scenarios plus parent), no failures/skips, exit 0; local WSL Node `22.22.2`, PostgreSQL 16.
- Integration proves admin/owner/foreign-role boundaries, actual ownership transfer, concurrent owner demotion, default/override preservation, reserved keys, old-JWT behavior and explicit account revocation. Six audit-failure mutation paths restore the exact organization/business/membership row state; PostgreSQL sequence increments are not rolled back.
- Bootstrap concurrency uses different slugs, so a unique-slug constraint cannot mask a missing bootstrap lock.
- Independent cleanup check: **0 test databases and 0 test connections remain**.
- Full `npm test`: **PASS, exit 0**. Runtime/version/ownership/migration/syntax/contract gates passed; unit **2803/2803**, My Day **337/337**, UI/static **1312/1312**, followed by loader tests **4/4**, with zero failures/skips in these suites.
- `git diff --check`: **PASS**; only Windows line-ending conversion notices.
- Current source hashes and the incremental file list are recorded in `LIFECYCLE_VERIFICATION.json`. The complete local log is retained at ignored `.codex-temp/sys-mb-lifecycle/verification-final.log`.

```powershell
npm test
node --test tests/organization-lifecycle.test.js tests/business-membership-organization-guards.test.js
wsl -d Ubuntu -u postgres -- env BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST=1 node --test '/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-auth-p0-20260912/tests/integration/organization-lifecycle-postgres.test.js'
```

The new unit file is registered in `test:unit`, which existing CI runs after a future push. The PostgreSQL suite remains explicit opt-in and operator-run; it is not wired into CI in this patch. It uses a randomly named disposable database, actual existing migrations 204/357 and synthetic records. It never uses `DATABASE_URL` as its connection source or starts the operational app. A default opt-out SKIP must not be reported as PASS. There is no live-site QA evidence in this report.

## Remaining blockers and next task

1. **WebSocket authorization and unscoped payloads — BLOCKED for full access-revocation acceptance.** `services/websocket.js` authenticates with the global account once and retains that snapshot; timeline dispatch reuses it. Existing account-wide JWT cutoff also never closed these already-open sockets. Fresh per-event membership checks are needed. Several task/alert events lack usable business ownership, and chat-to-business ownership is not yet defined. This patch does not invent that ownership or change HR/chat/timeline payloads.
2. **Account deactivation outside organization lifecycle — BLOCKED for a global last-owner guarantee.** `PATCH /api/users/:id/active` and other account/staff lifecycle paths can disable a user without the organization lock/invariant. They were not changed here. Their lock ordering and effective-owner checks must be coordinated with these transactions before claiming every path preserves an active owner. No new DB trigger or migration was added to enforce all SQL writers.
3. **Refresh/login/UI profile parity — still open.** `/auth/refresh` produces a global profile and `js/api.js` merges it into current user state. Protected HTTP requests remain membership-checked, but the UI can display stale role/default metadata. Membership-backed account editor, organization selector/default UX and metadata policy also remain separate work.
4. **Controlled live fixtures and broader domain boundaries — still open.** No production identities, business records or operational fixtures were created. Registry/retention/cleanup and all domain-level SQL boundaries still need their previously listed work. Legacy `users` context fields are not converted into membership editing by this patch.

Recommended next implementation: close the streaming and global account-deactivation boundaries above, preserving existing business/booking payload contracts and explicitly classifying events whose business ownership is absent. Then finish profile/UI parity and controlled QA fixtures. Release and live mutation QA need their own current bounded authorization and exact-SHA evidence; previous release envelopes do not apply.

Final status: **READY_LOCAL_HTTP_LIFECYCLE_REVIEW**. Full multi-business access-revocation acceptance and production rollout remain blocked by items 1–2 above. The local test results are not CI/deploy/live evidence.
