# EDU-CLOSE — поточне приймання і випуск


## Чинне рішення власника і стан релізу — 2026-10-09

Власник прямо доручив продовжити випуск, відклавши фізичні пристрої: «пофіг на пристрої, просто працюй сам, щоб максимально».42 кейси залишаються BLOCKED_DEVICE,0 PASS; це owner-deferred обмеження, а не повністю закритий кейс. Програмне приймання:15/15 PASS на незмінному final source. **GO_WITH_OWNER_DEVICE_DEFERRAL**, з обов’язковим exact-SHA green CI перед deploy.

Fresh read-only discovery знайшов заняття07.10.2026: видима картка відкрилася з календаря. live-readonly-discovery.json: READONLY_OBSERVATION_COMPLETE, pageErrors/failedChecks0, cabinet/profile unchanged; business writes blocked до login. Старі empty-date BLOCKED_FIXTURE докази збережені й не перейменовані. Це v0.82.74 reference; candidate postdeploy QA ще належить виконати.

Railway service list read-only повернув source:null для3fb62d4c-2dc2-4701-8e2b-09ce16e188ee: Git source не підключений, сервіс manual upload; production source branch визначає exact archive manifest і передається явно як codex/eventgenix-production. Налаштування не змінюємо. Base/live/remote72cb330ac13f8d2c1b41a8edfb8e0404d83532c3; candidate0.82.75. Yellow block EDU-CLOSE-RELEASE: поточна задача дозволяє commit/push/exact-SHA CI/helper deploy/read-only QA; production target fortunate-appreciation/production/8223324090, no migrations/real writes/settings/secrets; до2026-10-09T16:18:00Z, максимум3 спроби. Нова production-база — HOLD/integration/reverification. Rollback source72cb330 і історичний a990b668 збережені.

Owner decision: output/education-ready/close07-integrated-20261009/owner-device-deferral.json. Попередній стан документів збережено окремими pre-owner-decision-* snapshots; старий evidence-index-final.json описує саме ці bytes. Коміти/CI/deploy будуть записані в окремих release phase proofs.


## Збережений попередній checkpoint (історичний, не чинний висновок)

# Approved education follow-up — 2026-10-09 — історичний checkpoint до owner decision

Production impact: yes. Candidate only; no commit/push/deploy.

Owner explicitly approved EDU-CARD-PRESENTATION and EDU-HR-LINK with “Погоджую роботу, працюй.” The current canonical card edits and the booking-detail-safe-open manifest update are bounded by that decision. No identity/source/renderer ownership change is authorized.

HR policy: an actor with current Park HR membership and hr.staff.manage may explicitly assign an existing active global/accountless staff ID to an education business only when their fresh target membership also permits create_booking/timeline create. The operation inserts the existing education_teacher_memberships row and an atomic audit, preserving staff identity. No ownership inference, schema/backfill, duplicate staff or global permission expansion. Existing inactive membership is not silently revived. Repeated applied assignment returns200 without extra history; concurrent first assignments serialize on the existing staff row, returning201 then200.

Canonical presentation: topic heading once, date/start/duration/teacher/group/cabinet once; empty generic package and decoration omitted only for education. Genuine package/financial data, notes, customer/status/actions remain; Park unchanged. Focused unit, visible UI and Park regressions required.

Controlled WebKit baseline: an actual timeline-visibility GET response held during visible sidebar navigation produced native cancellation/access-control pageerror. beforeunload abort did not close it. The optional GET alone now uses keepalive; hidden/exiting/context-stale responses cannot update storage/UI. No pageerror exemptions. Component tests prove late-result discard/restored-page reload. The actual native-fetch WebKit journey passed18 checks in the focused diagnostic; final15-entry source-bound matrix still required.

The owner reports physical devices unavailable. All42 physical cases remain BLOCKED_DEVICE/0 PASS; this is not owner deferral. LAN preview not opened. Old retained device/manual databases and previous evidence are preserved.

Current isolated worktree: education-close-release-20261009-r6/EventGenix; branch codex/education-close-release-20261009-r6; base9667c381781e83f6a484f3718ad6c36a2ac07fc9; candidate0.82.73. Historical copied reports are superseded only by the fresh current acceptance when finalized.

Evidence root: output/education-ready/close07-approved-20261009. Required matrix now15 entries, including HR assignment in Chromium and WebKit. Scenario classifications are unchanged; general unit/probe counts are not education journeys.


## Final r7 result

The r6 checkpoint above is historical. Current worktree C:/Users/Plotva/.codex/worktrees/education-close-release-20261009-r7/EventGenix; branch codex/education-close-release-20261009-r7; base72cb330ac13f8d2c1b41a8edfb8e0404d83532c3; candidate0.82.75 unreleased.15/15 current-source gates PASS with exact inventories; new week topic/keyboard/touch targets and loaded-range fixes validated. No further protected manifest change. Devices unavailable,42 BLOCKED_DEVICE/0 PASS; no owner deferral. Final acceptance NO-GO; no commit/push/deploy. See current final acceptance/release proof and evidence root close07-integrated-20261009.
