# EDU-CLOSE — поточне приймання і випуск


## Чинне рішення власника і стан релізу — 2026-10-09

Власник прямо доручив продовжити випуск, відклавши фізичні пристрої: «пофіг на пристрої, просто працюй сам, щоб максимально».42 кейси залишаються BLOCKED_DEVICE,0 PASS; це owner-deferred обмеження, а не повністю закритий кейс. Програмне приймання:15/15 PASS на незмінному final source. **GO_WITH_OWNER_DEVICE_DEFERRAL**, з обов’язковим exact-SHA green CI перед deploy.

Fresh read-only discovery знайшов заняття07.10.2026: видима картка відкрилася з календаря. live-readonly-discovery.json: READONLY_OBSERVATION_COMPLETE, pageErrors/failedChecks0, cabinet/profile unchanged; business writes blocked до login. Старі empty-date BLOCKED_FIXTURE докази збережені й не перейменовані. Це v0.82.74 reference; candidate postdeploy QA ще належить виконати.

Railway service list read-only повернув source:null для3fb62d4c-2dc2-4701-8e2b-09ce16e188ee: Git source не підключений, сервіс manual upload; production source branch визначає exact archive manifest і передається явно як codex/eventgenix-production. Налаштування не змінюємо. Base/live/remote72cb330ac13f8d2c1b41a8edfb8e0404d83532c3; candidate0.82.75. Yellow block EDU-CLOSE-RELEASE: поточна задача дозволяє commit/push/exact-SHA CI/helper deploy/read-only QA; production target fortunate-appreciation/production/8223324090, no migrations/real writes/settings/secrets; до2026-10-09T16:18:00Z, максимум3 спроби. Нова production-база — HOLD/integration/reverification. Rollback source72cb330 і історичний a990b668 збережені.

Owner decision: output/education-ready/close07-integrated-20261009/owner-device-deferral.json. Попередній стан документів збережено окремими pre-owner-decision-* snapshots; старий evidence-index-final.json описує саме ці bytes. Коміти/CI/deploy будуть записані в окремих release phase proofs.


## Збережений попередній checkpoint (історичний, не чинний висновок)

# EDU-CLOSE release proof / HOLD — 2026-10-09 — історичний checkpoint до owner decision

**NO-GO. Production impact: yes. Пакет не випущено.**

Candidate0.82.75, worktree C:/Users/Plotva/.codex/worktrees/education-close-release-20261009-r7/EventGenix, branch codex/education-close-release-20261009-r7, base72cb330ac13f8d2c1b41a8edfb8e0404d83532c3. Final source 40936ce6af400a5c1083ebf789c6658f6835458ed268960ff4efb23d434c09dc; harness 5ff61887d00dc635268acc20d6e97fba7c3c688f7c41471599446d84bbb4a447; inventory 7eed5a14ee042fc144ddb0a08a0c27dbbbf7d0af8a302763d3c8a404d712f88d. Software15/15 PASS; npm exit0/sourceStabletrue.42 BLOCKED_DEVICE/0 PASS, owner deferral absent; live card BLOCKED_FIXTURE.

Live reference:0.82.74, 72cb330ac13f8d2c1b41a8edfb8e0404d83532c3, codex/eventgenix-production, checked 2026-10-09T10:05:38.9060232Z; remote 72cb330ac13f8d2c1b41a8edfb8e0404d83532c3. Manifest complete/no warnings. This is current deployed reference, not candidate deploy.

Candidate release SHA/CI URL/deployment ID/postdeploy metadata: NOT RUN. Commit/push/deploy attempts0. No production mutation or settings/secrets/autodeploy changes. Existing configured Git source remains NOT_EXPOSED_BY_STATUS; confirm read-only before any release.

Rollback source reference:72cb330ac13f8d2c1b41a8edfb8e0404d83532c3; preserved historical branch codex/checkbox-hardening-release-v080103 SHA a990b668f60e6376439e80cef0a3ade7672dfe37. Rollback not executed.

Proof files: matrix-final-selected.json, matrix-validation-final.json, final-inventory.json, final-software-summary.json, npm-axis-final/npm-test.log, physical-device-final-v3.json, physical-device-final-result-v3.json, production-final-recheck.json, railway-target-recheck.json, live-readonly-reference.json, live-readonly-existing-date.json, final-visual-review.json, preservation-after.json in output/education-ready/close07-integrated-20261009. Failed/stale evidence retained.

Next: device proof or explicit owner deferral, fresh bounded Yellow release authorization, current refs/configured source, separate product/generated commits, exact-SHA required CI, release helper with explicit project/branch, read-only live QA. See EDUCATION_CLOSE_FINAL_ACCEPTANCE.md for facts and limitations.
