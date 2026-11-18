# Baseline access Goal state

- Date: 2026-11-18, Europe/Kyiv. Goal active and unfinished.
- Branch: codex/baseline-access-20261118; isolated worktree D:/Codex/EventGenix/baseline-access-20261118. Original dirty checkout remains untouched.
- Original base: 571a57acb80118cc6cc0e5a923c5a5bba9c09d86 (0.83.120).
- Integrated/last observed production: d4abaadfc45f7df53b79920d6c20ae55e51275d8 (0.84.4). All own unpublished commits rebased successfully, without conflicts or shared-history changes. Preset registry/roles/accountAccessPolicy unchanged from original snapshot through this base.
- Audit parent: 27d642c24. Training/owner-decision implementation is the commit containing this state; resolve the current branch HEAD for its SHA. No feature version reserved; inherited 0.84.4 is upstream's version.
- Authorized: baseline role/authorization code, regressions and local feature commits; protected local zone block EG-BASE-ZONES-20261118 explicitly approved. No production classification, real-person repairs, login/session mechanism changes, secret/settings changes, push or deploy performed/authorized by that local block.

## Implemented locally

- Full 26-role before/after matrix; common working pages, required navigation independent of old favorites, canonical capability consumers, active membership and explicit-denial precedence.
- Booking operations narrowed to operational roles; independent event-detail/contact/revenue fields and exports. Payroll approval/payment confirmation require explicit grants. HR/IT broad booking scope removed.
- Team tasks/schedule use authoritative active staff structure nodes and memberships. Coordination DTOs omit absence reasons, notes, personnel metadata and compensation; attendance/export remain separate.
- Account create/link/replay readiness distinguishes staff bridge, membership, role, pages, modules and store probes. Database probes never claim authenticated API proof: data remains api_not_verified. No impersonation sessions minted.
- Approved zone reads use active Park room metadata.workArea=game_zone and canonical room_resource_id. No room-label inference, booking mapper/modal/source changes or protected-manifest updates. Viewer consumes effective edit_booking; legacy revenue reads consume view_revenue.
- Administrator profession/admission save fixed without payroll capability grants; strict metadata-only payload/route lane preserves retained rates/schemes/notes. Both save buttons and subsequent revision-dependent actions verified. See STAFF_PROFESSION_SAVE.md.
- Bounded read-only account/Chat/Training inventory CLIs; safe registered-key projections, explicit truncation, repeatable read/read-only transactions and rollback. Real production audits completed. See PRODUCTION_AUDIT_20261118.md.
- Park Training API/module policy now agrees: fresh Park membership, configured module and page permission; management uses training.manage. Staff-FK progress uses the canonical active bridge; homework retains its documented account-ID contract with own-assignment/submission/privacy checks. Recipients and Telegram delivery are scoped. See TRAINING_SCOPE.md. Chat remains contained pending its complete perimeter.

## Production findings and owner decisions

- Owner supplied relocated approved credentials at C:/Users/ВОЛОДАР ШІ/Downloads/crm. Only needed literal environment assignments were parsed locally into short-lived processes; unsigned script was not executed, copied or modified. No values printed/persisted. Old Plotva path absence is no longer a blocker.
- 32 active accounts have Park membership. 14 do not have exactly one active staff bridge, 3 roles are outside registry26, 1 profession/role mismatch, 22 lack a responsibility node. These are review signals, not automatic repair instructions; technical accounts/intentional differences remain unchanged.
- Reported administrator account16 and staff756 uniquely identified read-only. Old request lacks three payroll-rule capabilities; candidate metadata save is allowed under actual current rights. Simulation only; no real save or impersonation.
- Reported instructor account75 uniquely links active staff755, effective senior_instructor. Candidate zone capability/page allowed; production currently classifies zero game-zone resources. No account change proposed.
- Owner selected all 15 existing room-* resources (database IDs8–22) as game zones. Their metadata has no workArea key. Exact production addition still requires its own bounded Red execution approval; rollback removes only this key. Of 18 historical bookings without canonical room references, zero are current/future non-cancelled: no historical backfill proposed.
- Owner assigned all 31 profession-seed Training courses (IDs1–31, 93 lectures, 7 canonical progress rows) exclusively to Park. Legacy progress/attempt/submission tables are empty; no historical identity remapping performed.
- Owner delegated Chat ownership judgment because only Park operates now. Decision: all22 existing channels (IDs1–20,27,28) exclusively Park, preserving existing membership/private rules. Mixed principal memberships are not the ownership authority. Other business statuses remain unchanged.
- Use existing exclusive-Park namespace pattern; a second business requires a separate future ownership migration. Park already configures chat/training; required module additions are empty. No configuration write needed.
- Ignored owner-review manifests preserve policy decisions against inventory hashes, with productionDataMutationAuthorized=false. No production writes, push, CI or deployment.

## Verification

- Runtime Node22.23.4/npm10.9.9, no own dependency/lockfile changes.
- Full npm test passed on prior integrated 0.84.3: unit4036/4036, MyDay338/338, automation54/54, UI1324/1324, syntax1788. Evidence output/staff-professions-current-base-npm-test.log. Fresh full npm test on0.84.4 PASSED, exit0: output/park-training-npm-test.log. Unit4036/4036, MyDay338/338, automation54/54; all repository/post-verify stages passed. Final additional focused regression28/28.
- On0.84.4: permission contracts118 passed/2 dedicated-DB skips; staff recovery138/138; grouping regressions54/54. Administrator/creator actual-app Chrome1280/390:4/4, all three saves200, rates/admissions preserved. Final administrator desktop/mobile screenshots reviewed. Logs output/baseline-0844-*.log and output/staff-professions-browser/report.json.
- New Training focused28/28; final actual-app authenticated disposable PostgreSQL4/4, no skips (output/park-training-actual-api-final.log). Includes path normalization, organization/account revocation and management-denied recipient assertions. Initial fixture column mismatch corrected before pass. See TRAINING_SCOPE.md.
- Actual PostgreSQL inventories: minimal Chat/Training5/5 and fully migrated Training1/1, no skips. Rejected INSERT proved read-only mode. Permission audits contain no names/messages/URLs/secrets.
- Earlier approved-zone actual PostgreSQL15/15; actual-app canonical modal instructor/senior_instructor/reception/accountant x1280/390:8/8, click/Enter/Escape/focus/control/field checks, screenshots reviewed. Protected8hash guard unchanged/passed.
- Six-role sidebar/schedule UI12/12; tasks/schedule/afisha reads passed. Full common-work acceptance still fails while Chat is contained. Do not count this as a complete baseline pass.
- Readiness/onboarding disposable startup1/1, hire1/1, account onboarding24/24 including replay/concurrency; store probes are not authenticated API readiness.

## Remaining gates / next action

1. Finish Chat Park perimeter before module enablement: channel/private/DM target rules, uncached fresh recipients, linked-booking context, socket subscriptions/events/presence, notifications and authenticated attachment access including legacy static files. Current attachment route is public; do not expose real contents during QA.
2. Complete authenticated API-readiness reporting without impersonation; rerun six-role actual UI/common-data acceptance and relevant final checks.
3. Recheck remote/live/parallel releases and prepare final RC/version/manifest. Exact15resource metadata action and production delivery require concrete separate authorizations under the runbook; do not ask again for the already recorded policy decisions.
4. After valid release envelope: exact-SHA CI, documented manual Railway helper, bounded disposable live QA/cleanup. Goal complete only after behavior/release/live proof.

Owned local PostgreSQL17 cluster remains running for tests at output/staff-professions-pg-final/data, port55442, baseline_access_disposable_test. Never use production credentials in this runner. Stop the exact owned cluster after tests with pg_ctl fast and verify completion; do not stop during running suites.

Modern Web Guidance was applied to prior navigation/forms work. No product browser code changed in the Training API step. For upcoming Chat attachments, searched authenticated image fetch and retrieved/read security in full (temporary mwg-guide-17564-1795017985027.md); no product browser changes applied yet. Unwired Chat record/upload ACL groundwork and five passing unit regressions are local work in progress, separate from the Training stage. Local rollback is reverting own unpublished feature commits; production remains unchanged.
