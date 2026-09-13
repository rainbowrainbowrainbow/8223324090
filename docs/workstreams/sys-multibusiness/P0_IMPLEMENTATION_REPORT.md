# SYS-MB · P0 membership/context fixes

Date: 2026-09-12. Scope: local implementation after the approved QA analysis follow-up.

This is the historical P0 checkpoint. Subsequent local lifecycle changes and current remaining blockers are documented in `LIFECYCLE_IMPLEMENTATION_REPORT.md`; the original P0 verification hashes describe the earlier source state.

## Baseline and ownership

- Base: `a5180def01a1e47f8f4fc75e2f7a43092f205828`, fetched production branch `codex/eventgenix-production`.
- Working branch: `codex/sys-mb-auth-p0-20260912`.
- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.
- Package version remains `0.81.132`; this is an unreleased patch, not a new live version.
- Input analysis: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-foundation-20260911\docs\workstreams\sys-multibusiness\SYS_MB_LIFECYCLE_MANUAL_QA_PLAN.md`, especially findings F01–F12 and section 11.
- The main checkout and other agents' HR/sidebar/Hermes/task changes were not edited or transferred. No new migration, dependency, generated version marker, UI, hosting configuration, secret or production record was changed.
- No commit, push, CI dispatch, deploy or production mutation was performed for this patch. A production auth release remains a separate bounded operation; previous release evidence does not prove this code is live.

## Implemented behavior

| Finding | Local result | Implementation |
|---|---|---|
| F01: missing/revoked membership restores legacy grants | Fixed for registered membership businesses | Query the business registry independently of active user memberships. A migrated business still requires an active organization and business membership after revocation. Inactive business/organization and runtime database failures fail closed. |
| F02: Dar-only/custom-only lower roles forced into Park | Fixed | Membership context policy uses the available memberships rather than the legacy creator/director switch rule. |
| F03: stale global `roles` and overrides survive | Fixed | Replace primary/extra roles, `roles`, page/action allow/deny arrays and both field aliases from the active membership. Clear operational grants on invalid membership. |
| F04: omitted context yields Dar role with Park data | Fixed in shared resolver and profile task queries | Default requests use the same active membership for role and scope. `/auth/profile` retains authenticated membership fields after its identity/profile SQL lookup. |
| F05: business `creator` becomes platform authority | Fixed for the identified resolver/lifecycle path | Refresh `platformRole` from the account DB row. Reject a non-platform account's primary creator membership, strip delegated creator extras, reject creator assignment through normal business-membership PUT, and check platform authority explicitly in organization guards. |
| F06: cross-organization aggregate | Fixed | Aggregates require all selected businesses to belong to one organization. Existing aggregate writes remain denied. |
| F07: invalid `/auth/business-profile` scope returns 200 | Fixed for backend endpoint | Require valid scope before building the profile. |
| F08: raw account overwrites membership profile | Backend portion fixed | `/auth/verify` and `/auth/profile` preserve the authenticated membership role and overrides. Frontend account editor/switcher remains a separate task. |
| F12: malformed single context silently becomes Park | Backend single-context guard added | Reject malformed or unregistered custom single contexts with `403 business_context_unavailable`. Broader input/status-code and frontend parity work is not claimed complete. |

Compatibility for explicit `maysternya_doli` and `crm` requests is retained. An empty, existing membership schema retains the pre-bootstrap compatibility path; a missing schema or runtime SQL error does not. Removing registry records is not a supported cutover rollback.

There are two deliberate conservative restrictions while the richer contracts remain unfinished:

1. A user with memberships in multiple organizations must provide an explicit business context. Omitted context gets `business_context_required`; SQL row order does not choose their organization.
2. Existing aggregate routes authorize once. Until they authorize each business partition separately, aggregate reads with different role/override sets, or mixed membership/compatibility modes, get `business_scope_permissions_mismatch`. Equal-permission businesses in one organization retain read-only aggregate access. Compatibility-only aggregate behavior is preserved where organization identity is known.

The central authentication guard rejects invalid operational scope. Exact account identity/security routes remain usable without a business membership; `/auth/verify` returns identity with cleared business grants. Exact organization lifecycle methods also remain reachable and retain their own fresh organization-manager/platform guards, so an owner can reactivate the last inactive business. Similar URL prefixes and other methods are not exempted. This does not broaden owner/admin policy or authorize production fixture creation.

## File ownership

| File | Minimal change |
|---|---|
| `services/businessMembership.js` | Independent registry lookup; authoritative membership payload; inactive/revoked/error denial. |
| `services/businessContext.js` | Membership-based defaults and available contexts; organization and permission checks for aggregate reads. |
| `middleware/auth.js` | Require a current DB account; fresh platform role; scope guard with exact account/lifecycle exceptions. |
| `routes/auth.js` | Scope-check business profile; preserve membership payload in verify and personal profile. |
| `routes/organizations.js` | Separate platform creator authority and reject delegating creator as a business role. |
| `package.json` | Register all four focused membership unit/route test files in the existing `test:unit` command; no dependency/version change. |
| `tests/business-membership.test.js` | Extend pure resolver regressions. |
| `tests/business-membership-security.test.js` | Actual authentication middleware with explicit DB fixtures, stale JWT, denied contexts, aggregate checks and account/lifecycle exceptions. |
| `tests/business-membership-organization-guards.test.js` | Actual lifecycle router/policy with fixture DB: platform separation, role assignment, owner recovery and denied foreign access. |
| `tests/business-membership-auth-profile.test.js` | Actual auth/profile route stacks: role/override parity, Dar task SQL scope and same-token membership refresh/revocation. |
| `tests/integration/business-membership-postgres.test.js` | Disposable PostgreSQL resolver/middleware integration with an actual SQL data partition. |
| `tests/dashboard-assistant.test.js`, `tests/guardian-rbac.test.js`, `tests/chat-upload-route.test.js` | Update legacy fixtures to contain current DB accounts. Previous mocks returned an active session but no user; the corrected auth rightly rejects that state. Existing feature assertions remain intact. |

## Verification

- Windows runtime: Node `22.23.1`, npm `10.9.8`.
- Resolver/security targeted run: **34/34 PASS**, no skips (13 pure resolver tests and 21 authentication/security tests).
- Organization guards and recovery: **11/11 PASS**, no skips.
- Actual auth/profile route stacks: **5/5 PASS**, no skips. These are local route-stack/fixture tests, not live-site QA.
- Updated Dashboard Assistant and profile tests together: **28/28 PASS**; Guardian: **8/8 PASS**; chat upload: **4/4 PASS**.
- Final real PostgreSQL run: **14/14 PASS** (13 scenarios plus the parent), no skips, exit 0, Node `22.22.2` and PostgreSQL 16 in local WSL. Cleanup independently confirmed `remaining_test_databases=0`, `remaining_test_connections=0`.
- Full `npm test`: **PASS, exit 0**. All preceding runtime/version/ownership/migration/syntax/contract gates passed; the final unit sweep passed **2790/2790**, My Day **337/337**, UI/static checks **1312/1312**, and the following staff-schedule loader tests **4/4**, with zero failures/skips in these suites.
- `git diff --check`: **PASS**. Git reported only its existing Windows LF-to-CRLF conversion notices.
- First sandbox run stopped before assertions with `spawn EPERM`; the approved local rerun allowed child processes. The first complete unit sweep exposed the 16 obsolete-fixture assertions above; they were corrected and retested rather than weakening runtime authentication.

Reproduction commands from this worktree:

```powershell
npm test
node --test tests/business-membership.test.js tests/business-membership-security.test.js tests/business-membership-organization-guards.test.js tests/business-membership-auth-profile.test.js
wsl -d Ubuntu -u postgres -- env BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST=1 node --test '/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-auth-p0-20260912/tests/integration/business-membership-postgres.test.js'
```

The PostgreSQL test requires an already available local PostgreSQL server and explicit opt-in. It creates and drops only a randomly named disposable test database. It never uses `DATABASE_URL` as its connection source, boots no operational app and makes no production calls. Without explicit opt-in it skips; that skip is not a pass. The SQL migration used is the actual existing `357_organizations_business_memberships.sql`, executed twice to verify repeatability; no migration 356/357 source was modified. This is not a full application migration/startup/rollback certification.

The focused unit/route files now participate in the existing CI `npm test` command when this patch is pushed. The new PostgreSQL suite is operator-run, not wired into CI in this patch.

## Remaining work and release boundary

1. **D01/F09 — session policy.** Actual membership PUT/DELETE still update account-wide `session_revoked_at`, so those mutations invalidate all the target's sessions. The PostgreSQL test changes membership rows inside its isolated fixture to prove per-request refresh with an existing JWT; it does not claim that the current lifecycle HTTP mutations avoid relogin. Resolve this contract before live lifecycle acceptance.
2. **D02/F10 — lifecycle authority and atomicity.** Owner/admin delegation, ownership transfer, last-owner protection, omitted-array update semantics and reliable transactional audit remain separate work. The existing organization manager policy was preserved; creator assignment alone was restricted.
3. **D04/D05/F08 — profile/UI and platform capabilities.** Add the organization selection/default contract, membership-backed account editor, switcher refresh and metadata visibility policy. Audit the remaining platform-only checks: `/auth/impersonate` and `/auth/users-list` still inspect operational `role`, which can hide platform functions from a real creator whose business role is lower. This patch does not broaden those functions.
4. **F11/D06 — controlled QA fixtures.** Establish registry, side-effect-free test identities, exact permitted mutations, retention and cleanup before production membership mutation QA. Existing account creation may join production chats; it is not an approved fixture workflow.
5. **SYS-MB-05/06 — domain boundaries and compatibility retirement.** Validate every actual booking/timeline, customer/lead, task, finance, warehouse, product/graduation query and action in each context. Shared resolver tests do not prove every domain applies its SQL filters. Personal profile still has legacy unscoped booking/certificate/history/HR-related reads outside this patch's task-scope fix. HR, Telegram, payments and other integrations were not migrated. MD/CRM cutover and compatibility removal remain separate releases.
6. **Release then controlled live QA.** Reconfirm current production SHA/branch and integrate only this patch into a clean release worktree. Use a newly authorized auth release block, required exact-SHA green CI, the canonical version/cache release flow and Railway helper. Verify live `/api/version`, then run read-only checks and only the separately authorized fixture lifecycle scenarios. No local result here is a live PASS.

## Final evidence and handoff

Status: **READY_LOCAL_REVIEW**. `P0_VERIFICATION.json` records the checked base, commands, results and SHA-256 hashes of the local changed source/test files. Full initial/final test logs are retained locally under ignored `.codex-temp/sys-mb-p0/`; they are not release or live-site evidence.

Review the membership resolver and central guard first, then the profile merges, platform-role guard and tests. Keep the three existing fixture corrections with this patch: they model current accounts under the stricter authentication contract. Before any release, rebase/integrate against a freshly confirmed production base without including unrelated work.

The P0 core patch is ready for local review. The full multi-business lifecycle and production manual QA are not complete. The next implementation task is the lifecycle/session contract in items 1–2 above, followed by controlled fixture setup; it must not be replaced by broad production mutation testing.
