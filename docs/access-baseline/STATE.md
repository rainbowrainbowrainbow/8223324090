# Baseline access Goal state

- Date: 2026-11-18, Europe/Kyiv. Goal active and unfinished.
- Branch: codex/baseline-access-20261118; isolated worktree D:/Codex/EventGenix/baseline-access-20261118. Original dirty checkout remains untouched.
- Original base: 571a57acb80118cc6cc0e5a923c5a5bba9c09d86 (0.83.120).
- Integrated production base: b0f6077df31ae1eb5dbd6e5753dcb24619253a79 (0.84.6). Own20unpublished commits rebased; only Chat script-version conflict resolved, retaining upstream0.84.6 and defer. Latest freelance schedule and Telegram-unlinked task assignment preserved; canonical team guards retained. No shared-history changes.
- Last committed Chat SHA27341f3c2; Training29d8a9b19. Readiness implementation is the commit containing this state; resolve HEAD for its SHA. No feature version reserved; inherited0.84.6 is upstream's version. Recheck live/remote before final RC.
- Authorized: baseline role/authorization code, regressions and local feature commits; protected local zone block EG-BASE-ZONES-20261118 explicitly approved. No production classification, real-person repairs, login/session mechanism changes, secret/settings changes, push or deploy performed/authorized by that local block.

## Implemented locally

- Full 26-role before/after matrix; common working pages, required navigation independent of old favorites, canonical capability consumers, active membership and explicit-denial precedence.
- Booking operations narrowed to operational roles; independent event-detail/contact/revenue fields and exports. Payroll approval/payment confirmation require explicit grants. HR/IT broad booking scope removed.
- Team tasks/schedule use authoritative active staff structure nodes and memberships. Coordination DTOs omit absence reasons, notes, personnel metadata and compensation; attendance/export remain separate.
- Account create/link/replay readiness distinguishes staff bridge, membership, role, pages, modules and store probes. Database probes never claim authenticated API proof. Own Profile now offers an explicit check of six real authenticated APIs, with fixed loopback destinations, bounded reads, fresh policy before/after and no stored private bodies or impersonation sessions. See WORK_READINESS.md.
- Approved zone reads use active Park room metadata.workArea=game_zone and canonical room_resource_id. No room-label inference, booking mapper/modal/source changes or protected-manifest updates. Viewer consumes effective edit_booking; legacy revenue reads consume view_revenue.
- Administrator profession/admission save fixed without payroll capability grants; strict metadata-only payload/route lane preserves retained rates/schemes/notes. Both save buttons and subsequent revision-dependent actions verified. See STAFF_PROFESSION_SAVE.md.
- Bounded read-only account/Chat/Training inventory CLIs; safe registered-key projections, explicit truncation, repeatable read/read-only transactions and rollback. Real production audits completed. See PRODUCTION_AUDIT_20261118.md.
- Park Training API/module policy now agrees: fresh Park membership, configured module and page permission; management uses training.manage. Staff-FK progress uses the canonical active bridge; homework retains its documented account-ID contract with own-assignment/submission/privacy checks. Recipients and Telegram delivery are scoped. See TRAINING_SCOPE.md.
- Park Chat perimeter now includes HTTP, DM/assistant identity, current recipients, linked bookings, WebSocket/presence, scheduled delivery and authenticated blob/legacy attachments. Future messages stay hidden; delivery rechecks sender access and allocates fresh sequence numbers. Browser file leases use existing sessions and are revoked on context changes. See CHAT_SCOPE.md.

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
- On integrated0.84.6, actual six-role sidebar/schedule/common-data12/12: tasks/staff/chat/afisha/training all200. Readiness extension and final styling rerun also12/12, including own-profile check by Enter and all seven positive groups; both final readiness screenshots reviewed. output/work-readiness-six-role-browser-final.log. Full common-work acceptance now passes locally.
- On0.84.6, Chat actualAPI8/8, Training4/4 and administrator/creator profession-save Chrome4/4 pass (output/baseline-0846-*.log). Real-person cards remain untouched.
- Readiness focused54/54; loopback outcomes2/2; actual disposable authenticated API4/4, no skips. Permission contracts138passed/2dedicatedDBskips. API/CSS surface checks pass. Final full npm test running; earlier runs exposed obsolete runner wiring assertion and missing new-route API documentation, both corrected. UI guard identified defer/src attribute-order parsing; markup reordered without removing defer. These failed runs are not passes.
- Readiness/onboarding disposable startup1/1, hire1/1, account onboarding24/24 including replay/concurrency; store probes are not authenticated API readiness.

## Remaining gates / next action

1. Finish current full npm test/UI run on integrated0.84.6; investigate failures rather than weakening gates. Readiness and six-role actual UI/common-data now pass. Commit the complete verified local readiness stage.
2. Refresh latest remote/live and parallel release markers. Further drift requires semantic integration and proportionate affected checks before RC.
3. Recheck remote/live/parallel releases and prepare final RC/version/manifest. Exact15resource metadata action and production delivery require concrete separate authorizations under the runbook; do not ask again for the already recorded policy decisions.
4. After valid release envelope: exact-SHA CI, documented manual Railway helper, bounded disposable live QA/cleanup. Goal complete only after behavior/release/live proof.

Owned local PostgreSQL17 cluster remains running for tests at output/staff-professions-pg-final/data, port55442, baseline_access_disposable_test. Never use production credentials in this runner. Stop the exact owned cluster after tests with pg_ctl fast and verify completion; do not stop during running suites.

Chat verification: actual authenticated PostgreSQL/HTTP8/8, socket/task/namespace parity70/70, focused perimeter38/38, final file/record11/11, actual-app private file browser1280/3902/2 with final screenshots reviewed. See CHAT_SCOPE.md for evidence and guidance. Final integrated full baseline and six-role common-work acceptance remain pending. Modern Web Guidance security/performance guides were retrieved and applied to private attachments; no product browser code changed in the Training API step. Local rollback is reverting own unpublished feature commits; production remains unchanged.
