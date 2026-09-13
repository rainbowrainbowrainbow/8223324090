# SYS-MB · Membership profile and access editor parity

Historical checkpoint: the cumulative worktree now continues in [DOMAIN_ISOLATION_IMPLEMENTATION_REPORT.md](DOMAIN_ISOLATION_IMPLEMENTATION_REPORT.md). Its domain inventory and verification manifest supersede the next-step status and source hashes below; the recorded profile/browser evidence remains historical.

Date: 2026-09-12. Local continuation of the streaming/ownership checkpoint.

## Baseline and scope

- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.
- Branch: `codex/sys-mb-auth-p0-20260912`; base: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
- Local package marker: `0.81.132`, unchanged. This is not a statement of the current live version.
- Input checkpoint: `STREAMING_OWNERSHIP_IMPLEMENTATION_REPORT.md` and `STREAMING_OWNERSHIP_VERIFICATION.json`. Prior P0, lifecycle and streaming changes are retained in this cumulative, uncommitted worktree.
- Authorized work: the next implementation task, aligning login/refresh/profile and the existing editor with business memberships. No commit, push, CI dispatch, deploy, production credentials or production records were used.
- No new migration, dependency, lockfile, shared sidebar/menu/router/theme, booking renderer/identity contract, HR behavior, financial calculation or hosting change belongs to this increment.

## Problems and implementation decisions

The server previously returned global account roles on login/refresh while protected requests used business roles. The browser also forced lower roles into Park, discarded custom business keys, reused permission state across equal-role business switches, and edited business access through legacy account arrays. These paths could produce contradictory UI permissions or silently ignore the requested membership change.

Login, refresh, verify and the current user's operational profile now use one fresh server projection. Identity/session success is separate from usable business access: `accessContext.status` is `ready`, `selection_required` or `unavailable`. An unavailable scope has no active business and no operational role/overrides. JWT mint/rotation contracts remain intact; permissions still come from the database.

`GET /api/auth/business-profile` is the canonical discovery endpoint. Without explicit context it can return a successful identity/discovery response with no active business. An explicitly invalid or unauthorized context returns 403 with a cleared user and safe discovery profile. Operational `/api/auth/profile` and `/api/auth/permissions` still require a valid business. Canonical discovery does not call Omni integration status repair helpers: those helpers can write legacy provider bindings.

The browser accepts the server's allowed-business policy, including an empty list and custom keys. It never manufactures Park for a membership user with no active scope. Business switches fetch and adopt the selected business profile before permission hydration and data-change callbacks. Late responses cannot overwrite a later selection or a changed session. A failed profile request leaves the old selection intact; a failure loading permissions after an accepted profile leaves the new scope blocked by the recovery overlay and does not invoke business-data callbacks. It does not restore potentially revoked old grants.

The existing sidebar consumes the new profile without a sidebar source edit. Multiple-organization labels identify the organization. Aggregate selection is restricted to the active organization on the client; the server retains its stricter organization and equal-role/override checks. Park remains explicit in the URL when another business is the account default, preventing refresh from reverting the selection.

The existing shared active-cabinet policy across browser tabs is preserved. Before a sibling tab reloads after a business change, its explicit business route is synchronized with the accepted shared profile. Publishing the profile before the generation notification prevents Park/Dar tabs from repeatedly restoring opposing contexts. Independent simultaneous cabinets per tab are not introduced by this patch.

## Access management

| Surface | Behavior |
|---|---|
| Existing account access editor | Adds organization/business scope while preserving tabs, keyboard support, dirty-draft protection and technical/legacy account mode. |
| Business role and overrides | Read the target membership; save through the existing organization membership PUT. Existing memberships send changed fields only, preserving unrelated concurrent edits. |
| Default and deactivation | Existing membership lifecycle APIs; deactivation has a confirmation and server-side owner/target checks. |
| Global account mode | Existing callback retained; migrated business keys are a read-only compatibility mirror. Attempted changes return 409 `business_membership_required`. Unchanged mirror fields do not block an unrelated technical account edit. |
| `GET /api/organizations/members` | Only current members in manageable organizations; no global employee directory, invitation or account creation. |
| `GET /api/organizations/members/:userId/access-profile` | Fresh owner/admin/platform-manager checks, scoped organizations/businesses and safe permission metadata. Foreign business keys are not exposed to an ordinary organization manager. |
| Personal `/profile` | Owner/admin entry to the same membership-only editor. A user without an active business can reach an account recovery panel without loading operational profile data or permissions. |
| Root auth recovery | Accessible business selection, retry, logout and an owner/admin link to team/access management. Operational app initialization waits for valid access. |

Organization role controls use the existing lifecycle API; this increment does not add a standalone organization-administration, invitation, organization-creation or business-creation wizard. The team directory intentionally lists existing organization members only. Adding an unrelated existing account remains a separately controlled lifecycle/API operation, not a global search exposed to an organization owner.

## Changed areas

- Server: `services/authBusinessProfile.js`, `services/businessProfile.js`, `services/organizationLifecycle.js`, `routes/auth.js`, `routes/organizations.js`, `routes/users.js`, exact account exceptions in `middleware/auth.js`.
- Client: `js/api.js`, `js/auth.js`, `js/account-access-editor.js`, `js/business-membership-manager.js`, `js/profile-page.js`, `profile.html`.
- Tests: new backend projection/manager/frontend/real-PostgreSQL/browser suites; existing account-editor and auth/security/timeline-context fixtures aligned with the new endpoint contract. `package.json` registers the new self-contained unit suites.
- Exact incremental and cumulative source paths with SHA-256 are recorded in `PROFILE_UI_VERIFICATION.json`.

## Verification performed

Final status: **READY_LOCAL_PROFILE_UI_REVIEW**. This increment changes 26 source/test files; the cumulative worktree contains 55 changed source/test files. Exact content hashes and evidence paths are in [PROFILE_UI_VERIFICATION.json](PROFILE_UI_VERIFICATION.json).

| Check | Actual result |
|---|---|
| `npm test`, Node 22.23.1 / npm 10.9.8 | PASS, exit 0. Runtime/version and all configured ownership/governance checks passed; parser checked 1165 JS files. Unit 2875, My Day 337, UI/static 1312, loader 4; no failures. |
| Focused auth/session/security/default regression command | 231 PASS, zero skipped. |
| New full-API VM frontend tests | 18 PASS; empty/custom context, selection, aggregate reload, stale requests, failure paths and header parity. |
| Two-tab shared-storage VM tests | 5 PASS; convergence, role/session invalidation, identity replacement and forced legacy route. Included in final `npm test`. |
| New actual HTTP/bcrypt/PostgreSQL profile suite | 13 PASS, zero skipped, after backend freeze. Includes real token rotation, role/default/revocation, organization/editor boundaries, compatibility mirror guard and a provider SQL write trap proving canonical discovery does not run repair. |
| Prior PostgreSQL resolver/lifecycle/streaming suites rerun | 47 PASS, zero skipped. Combined with the new suite: 60 PASS. |
| Browser: existing editor + membership editor + auth access gate | 19 PASS, one worker, exit 0. Actual browser events, focus/Tab behavior, 390/768/1440 editor widths, 390 light/dark recovery, same-token revocation and real two-tab storage event. Synthetic API and shell fixtures; not live-site QA. |
| Disposable PostgreSQL cleanup | Independently checked: zero owned test databases and zero remaining connections. |
| `git diff --check` | PASS. |
| CI / deploy / live QA | NOT_RUN; outside this local task. |

The first full baseline found two outdated test expectations: treating canonical discovery as an operational endpoint, and requiring a Park fallback. Both expectations were updated while retaining executable access-denial and legacy-default checks; the full baseline was then repeated successfully. Browser/review failures also reproduced and fixed stale unavailable-user permission caches, failed-submit focus loss, aggregate refresh fallback, cross-tab reload feedback and the directory/editor loading race. No failing scenario was relabeled as PASS without a rerun.

Safe synthetic screenshots, inspected visually: [membership editor at 390px](../../../output/playwright/business-membership-editor-390.png), [business access recovery at 390px](../../../output/playwright/business-profile-access-390.png). Raw local logs live in ignored `.codex-temp/sys-mb-profile-ui/` and `.codex-temp/sys-mb-profile/`; their hashes are recorded in the verification manifest.

Repeat the combined browser check with the already cached tool:

```powershell
npx --offline --package @playwright/test playwright test tests/browser/business-profile-access.spec.js tests/browser/business-membership-editor.spec.js tests/browser/account-access-editor.spec.js --reporter=line --workers=1 --output=.codex-temp/sys-mb-profile-ui/evidence-browser-results
```

The PostgreSQL suites require an owned local Linux peer-authenticated PostgreSQL instance with `BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST=1`, or their explicitly named loopback test-only connection variable. They never fall back to `DATABASE_URL`. Exact commands and test paths are in the manifest; no production credentials are needed.

## Review and demonstration

Use disposable accounts and business records in an isolated test environment. The following is a review scenario, not a claim of completed live QA:

1. Sign in with Park manager / Dar animator memberships. Switch to Dar; confirm the label, role and available actions change together. Refresh and rotate the session; Dar remains selected.
2. Set Dar as the default, then explicitly select Park. Refresh: Park remains selected. A fresh login with no explicit business uses the server default policy.
3. With memberships in two organizations and no explicit context, see the business selection screen. Select a business from the second organization. Aggregate cannot include a business from the first organization.
4. Open `/profile` as an organization owner. Open a current employee's access editor, choose Dar, change one override and save. Park membership and unrelated Dar fields remain unchanged.
5. Revoke Dar membership through the controlled lifecycle. Existing JWT requests to Dar are denied immediately; Park access survives if still granted. An account with no active membership sees recovery rather than an operational cabinet.
6. Test keyboard navigation, dirty scope changes, save failure and deactivation failure at 390/768/1440 widths. No production fixture creation is implied by this script.

## Remaining work

1. Domain isolation is the next implementation block: inventory and enforce organization/business boundaries for the accepted operational domains, with focused SQL and route tests. General chat/personal AI transcript ownership and MD/CRM compatibility cutovers remain separate, explicit boundaries. Mixed-role aggregates remain conservatively denied.
2. The lifecycle API and membership-level organization-role controls exist. Complete organization/business administration UX and invitation/onboarding are not implemented by this profile/editor task; owner promotion still needs its controlled end-to-end live acceptance.
3. Cumulative production delivery and controlled live QA remain separate: integrate onto a fresh confirmed production base, review auth-sensitive changes, run exact-candidate CI and PostgreSQL/browser checks, then use an active bounded authorization for release and disposable live fixtures. Local fixture results are not live PASS evidence.
