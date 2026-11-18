# Baseline access Goal state

- Date: 2026-11-18 (Europe/Kyiv).
- Branch: `codex/baseline-access-20261118`; worktree `D:/Codex/EventGenix/baseline-access-20261118`.
- Original base: `571a57acb80118cc6cc0e5a923c5a5bba9c09d86`, production 0.83.120.
- Integrated upstream: `83cd47962bc932f842e49e539d8b8d0398a64efa` (compensation release). Own code/test tip: `114c5b16d`, following `ff735e77c`, `b2fee3ff3`, `284f1db9d`. One runner-mode conflict resolved retaining both modes; HR UI auto-merge reviewed.
- Latest observed remote: `9d2074466478a5e0a053517906527a0ffecdeedf`, a later compensation retry. It changes package/runner/browser harness contracts; integration is deferred until source dependencies resolve. Latest live read still original base. No version reserved; local package inherits upstream 0.84.0, not a baseline-access release.
- Candidate: local implementation, not release-ready. Goal remains active.
- Authorization: user permits baseline authorization/preset code, regressions and local feature commits. No production writes, login/session changes, secrets or protected booking source changes are authorized.

## Implemented locally

- Captured production registry and generated full 26-role before/after matrix.
- Shared page presets include waiter and training for every role. Timeline presets include instructors, reception and relevant read-only roles; page permission remains distinct from data/module availability.
- Booking operations limited to operational roles; reception creates/edits without cancellation. Working details, contacts and revenue have independent capabilities and GET response/banquet summary/PDF boundaries.
- HR/vice-director payroll approval and payment confirmation need explicit grants. Accountant unrelated blanket pages and HR/IT all-booking scope removed.
- Invalid membership fails closed. Active membership supplies extra roles/overrides; explicit denials win.
- Tasks use canonical capabilities. Team SQL uses active staff structure nodes and business/organization memberships; ambiguous actor links fail closed.
- Schedule coordination hides absence reasons, notes, personnel/account metadata and compensation. Attendance is separate. Team edits need structure links; full XLSX export requires business scope.
- Mandatory work links survive old favorites. Unavailable modules remain findable with accessible disabled states, visible reasons and prevented activation.
- Account creation/link/replay/workspace reports profile, active state, membership, role, pages, modules and data checks. Database probes return no rows and are explicitly distinct from HTTP/browser QA.
- Read-only audit CLI uses a read-only transaction and reports account-ID-only preset impact/exceptions; no automatic record fixes.

## Verification

- Node 22.23.4/npm 10.9.9; npm ci passed, no own dependency/lockfile changes.
- Final integrated `npm test`: PASSED, exit 0, Node 22.23.4/npm 10.9.9. Evidence: `output/baseline-final-npm-test.log`. Includes verify, sys-mb, timeline-marketing and telegram-crm. Unit stage: 4034/4034; My Day 338/338; CRM automation 54/54; UI smoke 1324/1324. Previously obsolete department-SQL and waiter-denial expectations were corrected to authoritative structure/membership scope and waiter access plus explicit-deny containment; no unresolved baseline failures remain.
- Focused baseline/task tests: 42/42. Latest coordination/Express-route/static checks: 96/96, including failed store probes, scoped GET export denial and legacy availability absence-category masking.
- Real sidebar fixture: six roles at 1280/390, 12/12, keyboard/clicks and old favorites. Disabled-link screenshot reviewed after drawer animation completed.
- PostgreSQL-backed actual app: all 12 schedule UI flows passed. Tasks/schedule/afisha/training APIs 200; chat 403 chat_not_migrated for all. Overall acceptance FAILED. Training module policy still reports unavailable despite legacy API success.
- Latest disposable permissions: 13/13 including all26 snapshots; timeline/direct-field/membership suite: 13/13. Integrated onboarding: fresh startup 1/1, hire 1/1, transactional account onboarding 24/24, including replay/concurrency.
- Existing responsive schedule browser passed. HR receipt desktop/mobile keyboard/focus/inert/pending-readiness rerun passed. UI smoke rerun 1324/1324. Actual-app rerun again has 12/12 successful schedule UI flows, no page errors, and the same chat acceptance blocker. Reviewed mobile/desktop screenshots after waiting for drawer animation.
- Integrated protected-surface/migration checks passed, syntax 1779 files passed. No protected hashes changed. The final full baseline passed after the latest code/test edits; only this state documentation changed afterward.
- No push, CI, deploy, production account audit or authenticated live QA.

## Release stops

1. Instructor game-zone projection needs protected approval. Proposed patch SHA256: ADC3BEC1A3EE6EFEBA57C87FFA84CE0B425DCFF7AFB69ECB07BF707C9E23FC43. Block EG-BASE-ZONES-20261118 requested, no answer. Patch NOT applied; never grant view_all as a shortcut. Real resource classification remains excluded.
2. Chat channels lack business ownership. Ownership clarification/inventory pending; never assign all legacy channels to Park by inference.
3. Training policy/API mismatch requires ownership design and consistent tenant boundaries. See MODULE_SCOPE_DEPENDENCIES.md.
4. Missing/ambiguous real structure links fail closed. No department/profession text used as authority.
5. Allowed credentials file C:/Users/Plotva/.eventgenix/codex-crm-secrets.ps1 unavailable. No substitute credentials sought. Nazar's unique staff/account pair not established; no real-person changes.
6. Compensation upstream overlaps HR UI/package scripts/isolated runner. Integrate only own commits and repeat checks. Parallel Tasks/My Day/Telegram overlaps task policy/contracts; refresh remote before release.

## Web guidance

Modern Web Guidance navbar/accessibility searched and retrieved before UI changes (2026_11_10-47b4c80e). Native links stay in Tab order; no menu roles/arrow handling. Disabled links retain focus, visible reasons and capture-phase activation prevention. No new browser API/dependency requires fallback. Responsive/keyboard proof is separate from API authorization proof.

## Next action

Await exact protected approval/module ownership clarification, then implement the remaining scope, integrate latest upstream and repeat affected gates. Prepare Yellow production block only after acceptance/source dependencies resolve. Goal remains unfinished until authorized release/live QA. The own disposable PostgreSQL cluster was stopped after runner cleanup; no production database was used. Rollback of this unpublished implementation is a revert of its own feature commits; no production rollback is needed.
