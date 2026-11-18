# Baseline access Goal state

- Date: 2026-11-18, Europe/Kyiv. Goal active and unfinished.
- Branch: codex/baseline-access-20261118; isolated worktree D:/Codex/EventGenix/baseline-access-20261118. Original dirty checkout remains untouched.
- Original base: 571a57acb80118cc6cc0e5a923c5a5bba9c09d86 (0.83.120).
- Integrated production base:859196fedb107b443719cbfc576fa9352cbee15a (0.84.8). Own24unpublished commits rebased; only Chat script-version/defer conflicts resolved, retaining upstream0.84.8 and ordered deferred private-upload/page scripts. Park account issuance recovery, freelance schedule and Telegram-unlinked task assignment preserved. No shared-history changes.
- Rebased QA/browser checkpoint378e2ad47815dfd2360894fe1a1023c622f24cf7. Historical SHAs in older evidence are superseded by this rebase. No feature version reserved; inherited0.84.8 is upstream's version. Recheck live/remote before final RC.
- Authorized: baseline role/authorization code, regressions and local feature commits; protected local zone block EG-BASE-ZONES-20261118 explicitly approved. No production classification, real-person repairs, login/session mechanism changes, secret/settings changes, push or deploy performed/authorized by that local block.

## Implemented locally

Latest local work: optional exact booking plan, canonical trusted_qa child run,
normal UI logins and instructor/admin1280/390 scenarios implemented. Initial full
CLI browser run1/1 passed (four actual UI scenarios), with child cancellation,
parent retirement, post-booking interruption and expiry recovery. Cropped
screenshots reviewed; output/baseline-registered-browser-gate.log. Focused52/52
passed (output/baseline-registered-focused.log). Expanded preference-drift
recovery assertion and final rerun remain pending. Parent registry owns at most
six exact dependent default-time rows only under booking-bound plans; five-field
plans still reject them. A DATE projection fixes existing QA execution-window
comparison on hosts east of UTC without changing booking contracts or parsers.

Parallel release859196fedb107b443719cbfc576fa9352cbee15a (0.84.8) integrated.
At the last read-only check live remained0.84.6/b0f6077d; the other release was
waiting for its last CI browser job. Revalidate convergence before final RC.

On the integrated0.84.8 code: focused53/53 (output/baseline-0848-final-focused.log),
runtime22.23.4/npm10.9.9 and8protected blocks pass. Classification helper actual
PostgreSQL1/1 passes (output/baseline-classification-pg.log): all15metadata keys,
full rollback, unrelated metadata preservation, complete rollback on one-row
drift and repeated-apply refusal. New CLI defaults to read-only and binds fixed
target, deployed SHA, exact15pairs and original metadata hash. Production preflight
read-only confirms all15rows; snapshot hash1b8e19adb248168c5be70b436db5cd3583577cface19371ff52fa41096578dd0.
No classification execution occurred. Final integrated browser/recovery and
identity reruns, one-command npm test, RC/preflight and approval remain pending.
The reviewed protected proposal was restored from checkout CRLF to the exact
approved LF bytes only after verifying normalized SHA256 equals
ADC3BEC1A3EE6EFEBA57C87FFA84CE0B425DCFF7AFB69ECB07BF707C9E23FC43.

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
- Readiness focused54/54; loopback outcomes2/2; actual disposable authenticated API4/4, no skips. Permission contracts138passed/2dedicatedDBskips. API/CSS surface checks pass. Earlier full runs exposed obsolete runner wiring, new-route API documentation, Chat poll/reminder fixtures without current membership, and defer/src static parsing; all corrected. These failed runs are not passes.
- Integrated npm test ran its complete verify stage successfully: unit4037/4037, MyDay338/338, automation54/54 and UI1324/1324, with repository guards passing. The subsequent legacy frontend stage failed2extracted-function cases because its fixture omitted the new Chat context epoch/scope helper. Fixed that fixture; full post-verify chain test:sys-mb, test:timeline-marketing and test:telegram-crm then passed, exit0 (output/baseline-0846-postverify.log). Timeline47/47, Telegram12/12. The original one-command npm test exited1 (output/baseline-0846-final-repository.log); do not call that run a full pass. A fresh one-command npm test remains required on the final candidate after live-QA tooling preparation. Earlier MyDay window fixture correction also passed338/338. No runtime guard was weakened.
- Readiness/onboarding disposable startup1/1, hire1/1, account onboarding24/24 including replay/concurrency; store probes are not authenticated API readiness.

## Remaining gates / next action

1. Complete the dedicated live-QA browser/canonical-booking scenario in LIVE_QA_DESIGN.md. Identity/API lifecycle is now implemented and locally verified (BASELINE_QA_PROTOCOL.md), without production execution. Bind the exact booking/date/resource plan and browser write guard; do not count the identity-only tool as full instructor modal/HR UI proof. Fresh one-command npm test remains required on the final candidate.
2. Refresh latest remote/live and parallel release markers. Further drift requires semantic integration and proportionate affected checks before RC.
3. Recheck remote/live/parallel releases and prepare final RC/version/manifest. Exact15resource metadata action and production delivery require concrete separate authorizations under the runbook; do not ask again for the already recorded policy decisions.
4. After valid release envelope: exact-SHA CI, documented manual Railway helper, bounded disposable live QA/cleanup. Goal complete only after behavior/release/live proof.

## Live QA preparation dependency

Read-only credential-alias preflight found two approved accounts: creator4 is a
real owner with an active staff bridge; isolated test48 is senior_manager/member,
with no active staff bridge, hr.staff.manage=true, manage_accounts=false and
hr.payroll.view=false. No login, lease or account mutation occurred. Names,
passwords and tokens were not printed or persisted. Existing HR fixture QA
requires two preconfigured isolated owner/delegate accounts and permits animator
fixtures only; these credentials cannot satisfy that protocol. Do not bypass its
guards, use a real employee session for the scenario, or silently grant owner
rights. The dedicated bounded registered instructor/admin identity workflow and
cleanup/TTL proof now pass locally. CLI-only creation leaves operator48 unchanged,
uses existing login and never exports its generated passwords/tokens. Finish the
browser/booking scope before the final production approval question. Creating production
test identities/roles still needs the exact envelope; no production action is
authorized here. Existing sys-mb-auth-cutover controller mode already covers the
candidate's reviewed policy paths and sole Red path routes/auth.js; no controller
policy exception is needed. Its only auth-route change skips incidental profile
achievement grants during the read-only work check.

New QA evidence: final focused64/64 (output/baseline-qa-final-unit.log); expanded
actual PostgreSQL/API/CLI10/10, no skips (output/baseline-qa-operator-expanded.log),
including atomic rollback, actual profession save with zero financial rows,
drift rejection, expiry watchdog/session retirement, repeated cleanup and API
interruption finally cleanup. Existing HR fixture actual browser/API1/1
(output/baseline-qa-hr-compatibility.log). Full permissions integration gate passed
54/54 across six suites, no skips, exit0 (output/baseline-qa-permission-gate.log).
Final contact-drift assertion and cleanup guard pass10/10, exit0 in
output/baseline-qa-operator-complete.log. Shift-preference rows are also an explicit
unexpected dependency for this identity-only protocol; final rerun passes10/10,
exit0 in output/baseline-qa-identity-final.log. Maximum lifetime retains millisecond
precision and has a dedicated pre-lock rejection regression.
Runtime and all8protected timeline blocks pass. No production writes.

Next implementation details: extend the CLI one-shot flow to exercise the browser
while its generated credentials still exist in memory, before finally cleanup.
The current API helper returns sanitized outcomes, not reusable sessions. Bind a
separate canonical booking fixture (existing product/line/room, exact free date and
time, no real customer) into the approved hash and generic booking QA registry;
retire that booking before the identity run. Prefer normal browser login, block
cross-origin/socket/notification/unexpected writes and crop only synthetic modal
content. Preserve both profession save paths. The HR work footer can legitimately
send a companion shift-preferences PUT when profession changes dirty that scope;
do not fake a success or silently leave those rows. If the real browser scenario
needs it, add exact registered/bounded preference ownership and cleanup proof,
then include that dependency in the final QA envelope. Current five-field plan
authorizes no booking/shift writes. No UI or booking QA was executed by the new
identity-only CLI, so neither is a completed live proof.

Owned local PostgreSQL17 cluster remains running for tests at output/staff-professions-pg-final/data, port55442, baseline_access_disposable_test. Never use production credentials in this runner. Stop the exact owned cluster after tests with pg_ctl fast and verify completion; do not stop during running suites.

Chat verification: actual authenticated PostgreSQL/HTTP8/8, socket/task/namespace parity70/70, focused perimeter38/38, final file/record11/11, actual-app private file browser1280/3902/2 with final screenshots reviewed. See CHAT_SCOPE.md. Integrated six-role common-work/readiness12/12 passes. Final one-command baseline remains pending as explained above. Modern Web Guidance security/performance guides were applied to private attachments and accessibility to readiness; all three guides read in full, final mobile/desktop screenshots reviewed. Local rollback is reverting own unpublished feature commits; production remains unchanged.
