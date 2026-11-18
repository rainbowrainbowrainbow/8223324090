# Baseline access Goal state

- Date: 2026-11-18 (Europe/Kyiv).
- Branch: `codex/baseline-access-20261118`; worktree `D:/Codex/EventGenix/baseline-access-20261118`.
- Original base: `571a57acb80118cc6cc0e5a923c5a5bba9c09d86`, production 0.83.120.
- Integrated upstream and latest observed live/remote: `c6d88d91bdc331e124ac07938e3d551563c3d8f6`, version 0.84.3 (freelance reserve scheduling). Own unpublished commits were rebased; no shared history was rewritten. Upstream task-entry/session fixes and reserve scheduling were retained alongside team-scope guards.
- Functional fix commits after rebase: `b175957e7`, `80524a4ec`, `45a111548`; approved zone implementation is now `faf3f7cb7`. No version reserved; local package inherits upstream 0.84.3, not a baseline-access release.
- Candidate: local implementation, not release-ready. The owner approved the protected local block and implementation resumed; remaining access/ownership/release gates still prevent Goal completion.
- Authorization: baseline authorization/preset code, regressions and local feature commits; additionally exact local block EG-BASE-ZONES-20261118 was approved on 2026-11-18. No production classification/data writes, login/session mechanism changes, secrets or deploy are authorized by that block.

## Implemented locally

- Captured production registry and generated full 26-role before/after matrix.
- Shared page presets include waiter and training for every role. Timeline presets include instructors, reception and relevant read-only roles; page permission remains distinct from data/module availability.
- Booking operations limited to operational roles; reception creates/edits without cancellation. Working details, contacts and revenue have independent capabilities and GET response/banquet summary/PDF boundaries.
- HR/vice-director payroll approval and payment confirmation need explicit grants. Accountant unrelated blanket pages and HR/IT all-booking scope removed.
- Invalid membership fails closed. Active membership supplies extra roles/overrides; explicit denials win.
- Tasks use canonical capabilities. Team SQL uses active staff structure nodes and business/organization memberships; ambiguous actor links fail closed.
- Schedule coordination hides absence reasons, notes, personnel/account metadata and compensation. Attendance is separate. Team edits need structure links; full XLSX export requires business scope.
- Mandatory work links survive old favorites. Unavailable modules remain findable with accessible disabled states, visible reasons and prevented activation.
- Account creation/link/replay/workspace reports profile, active state, membership, role, pages, modules and data checks. Database probes return no rows and expose only storeReadPassed; data remains api_not_verified until authenticated_api evidence exists. A successful SELECT 1 cannot mark work access ready.
- Read-only audit CLI uses a read-only transaction and reports account-ID-only preset impact/exceptions; no automatic record fixes.
- Added a separate executable chat ownership inventory. It reports channel/business IDs and counts only, includes historical authors/creators/DM recipients, never infers ownership, uses bounded repeatable-read read-only SQL and always rolls back. Production inventory has not run.
- Implemented approved game-zone reads via active Park room metadata.workArea=game_zone and canonical bookings.room_resource_id only. Room lines/catalogs/availability use the same classification, without legacy room-label inference. Existing assignment/independent broad scopes remain additive. Contact fields stay separately guarded, including availability day-booking projections.
- Fixed legacy isViewer to consume effective edit_booking, removing senior-instructor mutation controls and restoring reception controls. The old revenue dashboard now consumes view_revenue independently, preserving accountant reads and explicit finance denials. Canonical modal/mapper/source priorities and all eight protected hashes are unchanged.
- Fixed administrator profession/admission saves: strict metadata-only staff-management lane, independent financial guard and preservation of retained assignment rates/schemes/notes and profession rates. The roles button no longer sends hourly rates; profile revision/header update after success, unrelated work drafts remain dirty and late responses cannot update another card. See STAFF_PROFESSION_SAVE.md. No reported real staff/account records were queried or changed.

## Verification

- Production preset source freshness: `git diff --quiet 571a57acb80118cc6cc0e5a923c5a5bba9c09d86 c6d88d91bdc331e124ac07938e3d551563c3d8f6 -- config/permissionRegistry.js config/roles.js services/accountAccessPolicy.js` returned 0. The original 0.83.120 preset snapshot remains byte-equivalent to the current 0.84.3 upstream sources. This proves preset-source freshness only, not effective permissions or responsibility links for real accounts.
- Administrator profession follow-up on upstream c6d88d91: full `npm test` PASSED, exit 0 (`output/staff-professions-current-base-npm-test.log`), Node 22.23.4/npm 10.9.9. Unit 4036/4036; My Day 338/338; automation 54/54; UI 1324/1324; syntax 1788 files. Dedicated migrated PostgreSQL regression passed, including preserved non-null payroll scheme/rates and creator financial update. Final actual-app Chrome run passed 4/4 at 1280/390: sequential roles/footer saves plus shift-preference save all returned 200, with rate/admission preserved. See STAFF_PROFESSION_SAVE.md and `output/staff-professions-both-buttons-browser.log`.
- Node 22.23.4/npm 10.9.9; npm ci passed, no own dependency/lockfile changes.
- Full `npm test` after approved zone implementation and integration onto current upstream 7b7a77bf: PASSED, exit 0, Node 22.23.4/npm 10.9.9. Evidence: `output/game-zone-current-base-npm-test.log`. Includes verify, sys-mb, timeline-marketing and telegram-crm. Unit stage 4034/4034; My Day 338/338; CRM automation 54/54; UI smoke 1324/1324; syntax 1784 files. The final independent revenue-dashboard consumer change also passed 38/38 targeted parity/settings/timeline tests (`output/game-zone-final-consumers.log`). Earlier readiness correction passed 73/73. Final future RC still requires exact-SHA CI.
- Latest-base focused checks: baseline/isolated-runner/inventory 52 passed, 1 database test skipped without its dedicated variable; permission contracts 111 passed, 1 skipped. Dedicated disposable PostgreSQL inventory run: 2/2, no skips, verifying revoked/inactive/multi-business/historical principals and rejected writes. Evidence: `output/baseline-continuation-focused.log`, `output/baseline-continuation-permission-contracts.log`, `output/baseline-chat-inventory-postgres.log`.
- Approved-zone focused checks: 200/200 access/registry/booking/resource contracts; 150/150 resource/zone tests; 116/116 viewer/session/drawer parity; corrected signature regression 37/37. Tests failed before the implementation. One old static room-helper signature expectation was diagnosed and fixed before the successful full rerun; no unresolved failure remains.
- Focused baseline/task tests: 42/42. Latest coordination/Express-route/static checks: 96/96, including failed store probes, scoped GET export denial and legacy availability absence-category masking.
- Real sidebar fixture: six roles at 1280/390, 12/12, keyboard/clicks and old favorites. Disabled-link screenshot reviewed after drawer animation completed.
- PostgreSQL-backed actual app: all 12 schedule UI flows passed. Tasks/schedule/afisha/training APIs 200; chat 403 chat_not_migrated for all. Overall acceptance FAILED. Training module policy still reports unavailable despite legacy API success.
- Latest disposable permissions: 13/13 including all26 snapshots; timeline/direct-field/membership suite: 13/13. Integrated onboarding: fresh startup 1/1, hire 1/1, transactional account onboarding 24/24, including replay/concurrency.
- New disposable timeline/zone suite 15/15, including both instructor presets, effective extra roles, explicit grant/deny, disabled module, revoked membership, foreign/inactive/unclassified resources and room aliases, independent field gates and denied writes. Evidence: `output/game-zone-api-verified.log`. No production database was used.
- Actual-app canonical modal on current upstream: instructor, senior_instructor, reception and accountant x 1280/390, 8/8; direct detail API, Enter/click, Escape/close button, focus return and mutation-control parity. API finance/contact fields remain independent. All eight viewport screenshots reviewed; existing illustration loading states are unrelated to permission behavior. Evidence: `output/game-zone-current-base-browser.log`, `output/game-zone-actual-browser/report.json` and screenshots in that directory. The detail opener legitimately prefers its date cache; no source priority was changed merely to force a network request.
- Existing responsive schedule browser passed. HR receipt desktop/mobile keyboard/focus/inert/pending-readiness rerun passed. UI smoke rerun 1324/1324. Actual-app rerun again has 12/12 successful schedule UI flows, no page errors, and the same chat acceptance blocker. Reviewed mobile/desktop screenshots after waiting for drawer animation.
- Protected-surface guard passed again after latest integration and final consumer change (8 blocks). No protected hash or manifest changed. The approved original patch is retained as immutable review history, not a patch to apply again. Its source contract was implemented with corrected SQL binding and stronger membership/module/field/resource checks.
- No push, CI, deploy, production account audit or authenticated live QA.

## Release stops

1. EG-BASE-ZONES-20261118 was explicitly approved and implemented locally. Reviewed original proposal SHA256: ADC3BEC1A3EE6EFEBA57C87FFA84CE0B425DCFF7AFB69ECB07BF707C9E23FC43. No instructor view_all shortcut, source-priority change or protected hash update. Production resource classification remains unaudited and excluded from this approval.
2. Chat channels lack business ownership. Ownership clarification/inventory pending; never assign all legacy channels to Park by inference.
3. Training policy/API mismatch requires ownership design and consistent tenant boundaries. See MODULE_SCOPE_DEPENDENCIES.md.
4. Missing/ambiguous real structure links fail closed. No department/profession text used as authority.
5. Allowed credentials file C:/Users/Plotva/.eventgenix/codex-crm-secrets.ps1 unavailable. No substitute credentials sought. Nazar's unique staff/account pair not established; no real-person changes.
6. Upstream task-entry/session and freelance-reserve releases are integrated through c6d88d91. The schedule-modal merge preserves reserveStaff handling and per-record team guards. Refresh remote/live again before release; inherited package version is not a reserved version for this feature.
7. Authenticated API readiness is not automated by a store probe. Creation/link responses explicitly report api_not_verified. Complete target-account API verification after module/source boundaries are resolved; do not manufacture an impersonation session or infer success from a policy snapshot.

See ACCEPTANCE.md for the requirement-by-requirement gap ledger. The earlier third audit marked the Goal blocked; the later explicit zone approval resumed that local implementation. It does not resolve missing production credentials or Chat/Training ownership. Approved Second Brain project context was consulted read-only but does not establish ownership of the existing CRM channel rows. Railway connector exposes no direct SQL audit tool; no service variables or substitute credentials were retrieved.

## Web guidance

Modern Web Guidance navbar/accessibility searched and retrieved before UI changes (2026_11_10-47b4c80e). Native links stay in Tab order; no menu roles/arrow handling. Disabled links retain focus, visible reasons and capture-phase activation prevention. No new browser API/dependency requires fallback. Responsive/keyboard proof is separate from API authorization proof.

## Next action

The approved local block is implemented, verified and committed. Next obtain the approved local access needed for read-only production account/resource/channel inventories and resolve module ownership. Implement remaining module/API-readiness scope; prepare a Yellow block only when the complete candidate is ready. Goal remains unfinished until authorized release/live QA. Own disposable PostgreSQL was stopped after cleanup. Rollback is a revert of own unpublished feature commits; no production rollback is needed.
