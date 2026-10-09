# EDU-CLOSE — поточне приймання і випуск


## Чинне рішення власника і стан релізу — 2026-10-09

Власник прямо доручив продовжити випуск, відклавши фізичні пристрої: «пофіг на пристрої, просто працюй сам, щоб максимально».42 кейси залишаються BLOCKED_DEVICE,0 PASS; це owner-deferred обмеження, а не повністю закритий кейс. Програмне приймання:15/15 PASS на незмінному final source. **GO_WITH_OWNER_DEVICE_DEFERRAL**, з обов’язковим exact-SHA green CI перед deploy.

Fresh read-only discovery знайшов заняття07.10.2026: видима картка відкрилася з календаря. live-readonly-discovery.json: READONLY_OBSERVATION_COMPLETE, pageErrors/failedChecks0, cabinet/profile unchanged; business writes blocked до login. Старі empty-date BLOCKED_FIXTURE докази збережені й не перейменовані. Це v0.82.74 reference; candidate postdeploy QA ще належить виконати.

Railway service list read-only повернув source:null для3fb62d4c-2dc2-4701-8e2b-09ce16e188ee: Git source не підключений, сервіс manual upload; production source branch визначає exact archive manifest і передається явно як codex/eventgenix-production. Налаштування не змінюємо. Base/live/remote72cb330ac13f8d2c1b41a8edfb8e0404d83532c3; candidate0.82.75. Yellow block EDU-CLOSE-RELEASE: поточна задача дозволяє commit/push/exact-SHA CI/helper deploy/read-only QA; production target fortunate-appreciation/production/8223324090, no migrations/real writes/settings/secrets; до2026-10-09T16:18:00Z, максимум3 спроби. Нова production-база — HOLD/integration/reverification. Rollback source72cb330 і історичний a990b668 збережені.

Owner decision: output/education-ready/close07-integrated-20261009/owner-device-deferral.json. Попередній стан документів збережено окремими pre-owner-decision-* snapshots; старий evidence-index-final.json описує саме ці bytes. Коміти/CI/deploy будуть записані в окремих release phase proofs.


## Збережений попередній checkpoint (історичний, не чинний висновок)

# EDUCATION CLOSE — sequential handoff — історичний checkpoint до owner decision

Production impact: yes, after a future authorized release.
Task04 current conclusion: TEST_INFRA_IMPLEMENTED / REQUIRED_UI_ACCEPTANCE_FAIL (NO-GO).
Task01 historical conclusion: LOCAL_TEACHER_FIX_VERIFIED / EXISTING_HR_LINK_BLOCKED_DESIGN.
No overall release GO is granted by this task.

## Verified base and workspace

- Worktree: C:/Users/Plotva/.codex/worktrees/education-close-pack/EventGenix
- Branch: codex/education-close-pack (no upstream; uncommitted scoped changes).
- Base SHA: a7d074ff0c5fde63158c81e69732c78fc317446c.
- Historical task01 live/remote production rechecked at task start and end: same SHA, v0.82.64, codex/eventgenix-production; complete live deployment manifest.
- Runtime: Node22.23.1 / npm10.9.8; check:runtime PASS.
- Dependencies: existing ready-pack node_modules junction; no installation, dependency or lockfile change.
- Historical package: C:/Users/Plotva/.codex/worktrees/education-ready-release-20261004/EventGenix. Its0.82.62 proof is historical, not the current production version.

## Tasks01–06

| Task | Scope | Actual status / next step |
| --- | --- | --- |
| 01 | Teacher canonical identity/conflicts/current HR membership | Two product bugs CLOSED LOCALLY;26 final mixed UI/API/SQL checks PASS,17 separate PostgreSQL/HTTP series tests PASS; HR linking BLOCKED_DESIGN |
| 02 | Attendance optimistic concurrency/report compatibility | CLOSED LOCALLY; atomic revision409, draft retained, canonical/legacy reports; fresh source-bound suites PASS; no release GO |
| 03 | Canonical education UX/mobile polish | Local form/navigation/reveal fixes verified in04; old late reruns INCOMPLETE; card duplication BLOCKED_PROTECTED_PRESENTATION and schedule overlap CLOSE04-V01 remain |
| 04 | Fail-closed evidence/new-child UI/core education CI | Infrastructure implemented; current13-entry matrix11 PASS /2 journey FAIL; required child date mismatch; NO-GO |
| 05 | Real iPhone/iPad/Android/VoiceOver/TalkBack | New isolated CLOSE preview/checklist prepared;42 BLOCKED_DEVICE/0 PASS; no hardware session |
| 06 | Fresh acceptance/version/commit/push/CI/deploy/live proof | NOT RUN; needs its explicit release task and all blockers assessed |

Tasks01–05 have no commit/push/deploy authorization. Future tasks do not inherit a schema/auth/permission/protected-contract authorization from historical releases. Re-read current AGENTS.md and their exact user prompts.

## Changes and boundaries

- routes/bookings.js: preserve validated teacher metadata while normalizing groupName; match stable IDs, restricting name fallback to missing-ID legacy records.
- tests/browser/education-close-teachers-browser.js: existing safe teacher UI scenarios plus new canonical-name/namesake/adjacent/legacy/atomic/HR-boundary regressions.
- tests/integration/run-education-close-teachers.js: scoped safe runner, exclusive disposable lock, retained dataset preflight, exact owned cleanup, explicit CLOSE01 evidence metadata.
- tests/static-doc-guard.test.js: explicitly required root handoff included in operating-doc inventory and actual HTTP404 checks; documentation remains private.
- docs/EDUCATION_CLOSE_01_TEACHERS.md: before-fix symptoms/root causes/results, evidence classification, limits and exact HR design blocker.
- EDUCATION_CLOSE_HANDOFF.md: this sequential operating handoff.

No schema/backfill, roles/auth, global staff surface, dependencies, package/version/lockfile, booking detail identity/source priorities/renderer or protected manifest changes. Existing6 protected blocks PASS. Product and prior dirty files were not mixed.

## Actual results and evidence

Evidence root: output/education-ready/close01.
Machine hash index: evidence-index.json. Baseline source/harness/logs and all failed diagnostic attempts remain retained.

- Real baseline-r4:6 PASS /4 FAIL, exit1, before product edits. Canonical name fails on create/edit/series; distinct same-name IDs incorrectly409 at equal SQL date/time in different rooms.
- Earlier baseline diagnostics exposed missing grid-time locator, auto-picked time and C-locale case differences; they are not reused as final acceptance.
- Final26 checks: final/regressions/closeTeachers/attempt-2026-10-04T17-08-28-318Z/verification.json, runner final/regressions/fixed-runner-result.json; allPASS, exit0. Includes visible first teacher/group/lesson assignment, reassignment, malformed outgoing UI input, namesakes, one-ID overlap/15:45 adjacency, series, retry, inactive, two businesses/direct foreign IDs, grandfathered assignments and actual SQL-lock race.
- Series: series.log;17 real HTTP/PostgreSQL tests PASS, fail0/skipped0; DST/month/year/atomic/concurrency/different teachers/businesses. Counts are not17 UI journeys.
- New visible series conflict at occurrence3: every complete booking row unchanged.
- Focused static-doc guard: static-doc-guard.log;5 PASS, exit0.
- npm initial: FAIL due newly required handoff absent from strict root-doc test inventory. Exact FAIL retained in npm-test.log; inventory updated only for that handoff and HTTP404 check added. Final repeat: npm-test-r2.log; completion recorded below.
- Two final teacher card screenshots personally reviewed; local reconnecting toast is outbound/WS hold behavior, not production failure or live synchronization proof.
- Live QA here is public read-only /api/version only. No authenticated live booking write/card acceptance is claimed.

26 checks mix UI, API/SQL, fixtures and barriers; they are not26 independent continuous journeys. PostgreSQLC locale requires a valid lower-case fictional name for the baseline name predicate; the locale-independent ID scenario is separately asserted. Legacy name comparison retains its previous locale-sensitive case semantics; no global collation change is included.

## HR workflow blocker — do not silently bypass

Current staff rows have no reliable general business owner. /api/hr/staff reads a global table; legacyBusinessSurfaceAccess permits this namespace only in Park. User business memberships do not establish arbitrary/accountless staff ownership. Existing explicit education memberships and grandfathered groups already work, but they do not prove authority to create a first membership for an unowned HR row.

Boundary checks PASS: unowned HR staff is absent in education picker; education HR GET403; arbitrary staffId linking400; zero duplicate staff or membership rows. The desired existing-HR linking workflow itself is BLOCKED_DESIGN.

Needed owner decision: authorize a bounded, auditable HR-manager assignment of a selected existing staff ID to an education business; define eligible accountless/shared/inactive people, exact existing capability checks and trustworthy ownership/audit evidence. Do not infer ownership from names, historical booking metadata or schedules, expose global /api/staff, or create a duplicate person as a workaround. This decision remains open; task01 created no new membership endpoint/UI for unowned HR staff.

## Preservation and reproducible commands

Main dirty checkout, previous ready-pack/release status and binary diff hashes remain unchanged.1542 previous evidence hashes unchanged. Retained eventgenix_education_ready_manual and eventgenix_education_ready_devices have39 bookings each and ten complete-table hashes unchanged. Final disposable public table count0. The previous manual preview at127.0.0.1:3012 is previous-package source, not a preview of this new worktree.

PowerShell from this worktree; owned PostgreSQL must already be running on127.0.0.1:55469:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55469/eventgenix_education_ready_fixture_test'
$env:TEST_DATABASE_RESET_CONFIRM='RESET_DISPOSABLE_TEST_DATABASE'
$env:EDU_QA_PLAYWRIGHT='C:/Users/Plotva/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright'
$env:EDU_READY_RUN_ROOT='output/education-ready/close01/next-verification'
node tests/integration/run-education-close-teachers.js
npm run check:timeline-protected-surface
node --test tests/static-doc-guard.test.js
npm test
```

The safe runner creates its own random synthetic test credentials process-locally. No live credentials or provider secrets are needed. Use only the fixed disposable database; never replace it with manual/device/production. Full preserved evidence index includes source/harness hashes and runner cleanup proof.

Historical task01 next step: EDU-CLOSE-03 in this exact worktree. Preserve the explicit HR BLOCKED_DESIGN for its separately authorized decision; do not treat this handoff as release acceptance.

## Final completion — 2026-10-04

Final CLOSE01 runner:26/26 PASS, exit0. npm test repeat:PASS, exit0 (npm-test-r2.log); initial root-doc failure remains retained. Focused static-doc guard5/5 PASS; protected6-block guard PASS; series17/17 PASS, skipped0; git diff --check exit0. Hash-bound results cover the final routes/teacher harness; evidence-index.json distinguishes every prior diagnostic attempt from the final run.

Software fixes are verified locally. Existing HR linking is BLOCKED_DESIGN. No commit/push/deploy, release bump or production business mutation occurred.

## EDU-CLOSE-02 completion — 2026-10-04T17:47:19.756Z

Read docs/EDUCATION_CLOSE_02_ATTENDANCE.md and output/education-ready/close02/evidence-index.json.

The authorized journal-only concurrency contract now requires revision. Missing400; stale409 EDUCATION_JOURNAL_STALE before any insert/update; old identical retry409/no history; current identical save200 changes0. GET/PUT coherent locks, durable history IDs prevent ABA, own transaction response retained.

Frontend keeps original-revision draft, blocks stale Save, explains explicit reload/reapply, preserves keep/discard confirmation, focuses visible conflict message. No auto merge or force.

Reports resolve the same canonical/legacy object priorities; held uses end time Europe/Kyiv, totals held only, archived/no-journal/unmarked/text-only semantics and date/group protection retained.

Fresh final: Chromium6 and WebKit phone6 scoped checks; attendance PG7, series17, mixed acceptance11, continuous journey14 assertions, async17; allPASS exit0/sourceStable, no skipped PG tests. npm testPASS; focused unit21PASS; protected6PASS. General counts are not education journeys.

Failed baseline/diagnostics remain: real stale200/legacy omission, incorrect fixture key, missing-revision legacy test, login/navigation cancellations, source-drift guard and wrong report response predicate. Final scoped AND bootstrap page errors0. Final async matcher includes business/period/group and waits terminal DOM.

Main/prior worktrees and1542 prior evidence unchanged; CLOSE01 indexed logs/source unchanged except this intentionally updated handoff. Retained manual/device39/39 bookings and ten table hashes unchanged; disposable tables0. Existing manual preview belongs to the previous ready package; it is not this code.

No schema/auth/protected/dependency/lockfile/version/commit/push/deploy changes. No production write or authenticated live QA. Task01 HR BLOCKED_DESIGN and physical NOT RUN remain release limitations.

Command: use the existing TEST_DATABASE_URL/reset-confirm/Playwright settings, fresh EDU_READY_RUN_ROOT, optional EDU_CLOSE_SUITE (default closeAttendance), then node tests/integration/run-education-close-attendance.js. Continue03;04–06 still require fresh task-specific work and authorization.



## EDU-CLOSE-04 completion checkpoint — 2026-10-07

Production impact: indirect — harness/CI. No product fix was made in04. Test infrastructure is implemented; the Done-when requirement of all key local commands passing is NOT met. Current conclusion NO-GO. Historical READY acceptance is not approval for this dirty CLOSE candidate.

Worktree/branch/base remain as above. Current live and remote production are v0.82.70 / ea635cf690ca95a5ff265dbbe90bd71849ffbf47 / codex/eventgenix-production; current candidate stays on v0.82.64 base. No destructive update or integration. Future06 must integrate current production in a separate release worktree and reverify affected contracts.

Read docs/EDUCATION_CLOSE_04_TEST_MATRIX.md. Explicit manifest output/education-ready/close04/matrix-final.json; complete source/harness/record/proof/log hash index output/education-ready/close04/evidence-index.json. Exact final inventory1316 source/973 harness files, not scenario counts. Selected attempts sourceStable; no latest-log/latest-proof pairing.

Local CI-entry statuses11 PASS /2 FAIL. Teachers26, groups15, lifecycle12, date13, async17, journal6, attendance HTTP/PG7, series HTTP/PG17, mixed acceptance11; Chromium/WebKit responsive7 profiles/1041 low-level probes each PASS. These numbers are named checks/probes, not education journeys. New continuous journeys execute17 gates each:16 lifecycle gates PASS, mandatory child-date gate FAIL (SQL2020-05-14, API/UI2020-05-13); both exit1. No API repairs, hidden skips or substituted seeded child. Duration permutations are a separate lifecycle suite.

31 fail-closed validator/portability tests PASS; current source-bound npm test PASS; protected6-block guard, CI YAML13 distinct entries and diff check PASS.13 key education jobs configured via existing synthetic PG/browser pattern; actual green CI on a release SHA is NOT RUN because no commit/push. Portable fixture switch affects only exact verified owned disposable DB; manual/device targets remain guarded. Exclusive lock includes cleanup/proof; all disposable public tables0.

Final additional component commands PASS, classified MOCK_COMPONENT_API_SQL. Earlier two minimap uncaught failures plus diagnostic stack remain: ui.js renderMinimapAsync fire-and-forget -> getLinesForDate stale rejection. A later PASS does not close this intermittent defect; future fix needs a minimap-specific barrier regression. CLOSE04-F01 customer date-only conversion requires a separately authorized service/UI regression fix. Personally reviewed final WebKit tablet/reflow frames still show09:30 lesson covering first cabinet label: CLOSE04-V01, beyond passing vertical geometry/contrast probes. All three findings documented; no product workaround.

Live creator/Dar/Park read-only observation complete on v0.82.70; visible schedule/card/nonempty controls, classified policy/staff-denial diagnostics, no unexplained failure. Business writes blocked before login. Policy outbound holds are neither production failure nor live synchronization PASS. No production business writes.

Preservation PASS: manual/device39/39 bookings and ten-table hashes unchanged;1542 previous evidence hashes and main/ready/release checkout status/diff hashes unchanged. Previous manual preview belongs to old ready source. No dependency/lockfile/schema/auth/permissions/protected-manifest/version/commit/push/deploy changes in04.

Next: bounded product fixes for child date-only conversion and minimap stale lifecycle; verify/fix observed education schedule overlap within its protected boundaries. Rerun explicit matrix; physical task05 remains42 NOT RUN/BLOCKED_DEVICE. HR link BLOCKED_DESIGN and canonical card BLOCKED_PROTECTED_PRESENTATION remain. Release06 cannot treat this checkpoint as GO.

## EDU-CLOSE-05 preparation checkpoint — 2026-10-07

Read docs/EDUCATION_CLOSE_05_DEVICES.md and docs/EDUCATION_CLOSE_05_OPERATOR_CHECKLIST_UK.md. Status TECHNICAL_PREPARATION_COMPLETE / BLOCKED_DEVICE; task05 acceptance is incomplete. Exact42 iPhone/iPad/Android cases remain BLOCKED_DEVICE,0 PASS, CLI actual exit2. No operator session/model/OS/browser/physical evidence supplied; keyboard/native pickers/safe areas/VoiceOver/TalkBack/retest NOT RUN. Desktop loopback proof is explicitly not hardware proof.

Separate owned DB eventgenix_education_close_devices; anchor2026-10-07 Europe/Kyiv;39 bookings, realistic primary4/6/24/3/36 fixture and second business/Park. Full source/harness/attempt/manifest and independent reports: output/education-ready/close05/manifest.json. Never reset or reused retained manual/old devices for writes. Shared PG cluster remains loopback55469. Separate app3015 and optional same-subnet gateway3016 with unchanged CRM authentication/outbound hold, explicit private interface/lease and verified PID stop. Wi-Fi192.168.1.106/24 observed; future URL in checklist, LAN NOT OPENED in05. Current preview STOPPED; no3015/3016 listeners. Second operator must be prepared through existing local synthetic Users workflow; no physical history-author proof claimed.

Actual17 focused guard tests PASS,3 named desktop technical checks PASS (visible5 terminal tabs/anonymous401/independent SQL), parser and6-block protected guard PASS. All5 current desktop frames personally reviewed; Schedule11:30 card over cabinet2 label remains CLOSE04-V01. Initial Reports-loading screenshot preserved as navigation diagnostic; corrected terminal waits, no API repair/sleep/CSS overrides.42-case current physical validator verifies exact source/harness inventory/attempt/manifest/IDs/time/evidence. Inventory drift is stale, not PASS.

All public-table hashes of retained manual/devices unchanged;2515 immutable prior CLOSE artifacts and3 other checkout status/diff hashes unchanged; shared active PG daemon log only appended, original byte prefix verified unchanged. Prior04 evidence remains historical;05 added harness files intentionally make its strict inventory stale, requiring a fresh final software run. No product/schema/auth/permission/protected-manifest/dependency/lockfile/version/commit/push/deploy change in05. Existing child date/minimap/schedule/HR/protected-card blockers and NO-GO remain.

Next: actual operator-assisted30-minute device session with per-case results and real spoken output, then scoped fix/retest and owned LAN teardown. Do not advance to release06 by substituting this preparation for physical acceptance.


## EDU-CLOSE-06 — актуальний фінальний checkpoint (2026-10-07T14:21:26.254Z)

**NO-GO / HOLD_ACCEPTANCE. Production impact: yes. Пакет не випущений.**

Актуальний worktree для продовження: C:/Users/Plotva/.codex/worktrees/education-close-release-20261007-r2/EventGenix; branch codex/education-close-release-20261007-r2; base c74832b847c2cb6a8fdf680e62cc63c3b3dababb; локальна версія0.82.72, не production. Production на момент фінальної звірки: 0.82.71/c74832b847c2cb6a8fdf680e62cc63c3b3dababb/codex/eventgenix-production.

Під час06 production просунувся з ea635cf…/0.82.70 до c74832b…/0.82.71. Перший clean candidate education-close-release-20261007 збережено з13 entries11 PASS/2 FAIL як superseded; його PASS не переносились на r2. Другий candidate чисто інтегрує новий customer release, без конфліктів; product/generation diffs окремі. Нових dependencies/schema/auth/settings/protected-manifest changes немає; lockfile лише version markers.

Read docs/EDUCATION_CLOSE_FINAL_ACCEPTANCE.md та output/education-ready/close06/{acceptance-summary,evidence-index,release-hold,matrix-final,final-inventory}.json у r2. Свіжа r2 матриця 10 PASS/3 FAIL entries, npm testPASS exit0/sourceStable;48 focused unit guardsPASS, строгий matrix validator exit1. Source digest 894189563896f4484f7f819fb5599be444238cadd6dc0e1d395c626325e8ed49; harness digest 6f0690c80d3aaeeab11ea0fbb125e30df7d8c40f0618383768103beb2d0af150. Counts gates/probes/unit/file inventories не є кількістю education journeys.

01: stable teacher ID/name, namesakes та isolation verified; existing HR linking BLOCKED_DESIGN.02: journal revision409 atomic stale/draft/history/retry і canonical/legacy reports verified.03: education forms/navigation responsive scoped PASS, canonical duplicates/menu0₴ та schedule overlap OPEN; protected presentation blocked.04: fail-closed validator і13 CI entries configured/local commands; continuous new-child birthday FAIL, minimap intermittent not deterministically closed, final WebKit responsive bootstrap pageerrorFAIL (CLOSE06-F01), candidate green CI NOT RUN.05:42 BLOCKED_DEVICE/0 physical PASS.06: final software acceptance NO-GO; commit/push/candidate CI/deploy/post-release liveQA NOT RUN.

Fresh pre-release Dar/Park read-only smoke на поточному production, business writes blocked до login; visible schedule/card/nonempty controls, classified staff403/policy outbound diagnostics. Local outbound holds не production failure або sync proof. Baseline CI green для production c74832b… не є новими education gates. Railway target/project/environment/service підтверджено; configured repo/source branch CLI null, фактичний manual manifest branch/SHA достовірний.

Release blockers без owner deferral: child birthday2020-05-14 SQL→2020-05-13 API/UI; minimap stale lifecycle; cabinet-label schedule overlap; explicit HR membership eligibility/design; protected canonical education card duplication/0₴; physical42 cases; new WebKit bootstrap fetch pageerror with undetermined request cause (not proven HTTP403/production failure). Потрібні bounded authorizations/design/device operator, потім нові source/harness hashes/full matrix. Не обходити FAIL API-записом або прихованим staff дублем.

Preservation PASS до цього intentional append:3 retained databases all-table hashes unchanged, по39 bookings;4 dirty checkout status/diff hashes unchanged; prior immutable QA unchanged, active daemon log лише append зі збереженим byte prefix. Disposable tables0; LAN3015/3016 listeners відсутні, shared PG55469 збережений. Retained preview — старий READY source.

Команди з current r2 (owned disposable PG55469; ніколи manual/device/production): env TEST_DATABASE_URL postgres://postgres@127.0.0.1:55469/eventgenix_education_ready_fixture_test; TEST_DATABASE_RESET_CONFIRM RESET_DISPOSABLE_TEST_DATABASE; EDU_QA_PLAYWRIGHT local installed path з report. node tests/integration/run-education-close-ci.js <suite> <chromium|webkit>; node tests/tools/verify-education-close-pack.js <explicit-matrix>; npm test. Кожний повтор — новий output/attempt, не overwrite indexed evidence.

Наступний крок: scoped child-date/minimap/schedule fixes і WebKit bootstrap diagnostic, конкретне HR/protected presentation рішення та actual device session; після GO повторити identity/version/source checks, product commit→generated hygiene commit→push confirmed production branch→green exact-SHA CI→explicit-project/branch helper deploy→read-only live proof. Чинний rollback reference c74832b847c2cb6a8fdf680e62cc63c3b3dababb; historic rollback branch не змінена.

## EDU-CLOSE follow-up — робочий checkpoint 2026-10-08

Production impact: yes. Нове продовження: C:/Users/Plotva/.codex/worktrees/education-close-release-20261008-r3/EventGenix; branch codex/education-close-release-20261008-r3; base a397e368e9279e10d3fbfbc94794a64cc9dc164a. Пакет r2 та його докази залишені незмінними. Remote financial release0.82.72 інтегрований як база, education product patches застосовано без конфліктів; український фінансовий changelog збережений. Education version0.82.73 підготовлена локально, не випущена.

Виправлено date-only pg DATE mapping, lifecycle/memo мінікарти, education axis до ранніх/пізніх занять, перенесення cabinet labels, scope/promise lifecycle optional visibility loader, concurrent shared timer read. Timer baseline actual FAIL fulfilled/rejected, minimal catch для другого hydrate caller; endpoints/write/auth unchanged.178 focused component tests PASS. Нова13-entry matrix і source-bound npm test виконуються. Попередні r2 PASS не є final r3 acceptance; r2 WebKit journey FAIL збережений.

NO-GO_PENDING_FINAL_ACCEPTANCE. Pending exact Red decisions: EDU-CARD-PRESENTATION та EDU-HR-LINK; proposals у output/education-ready/close06-followup-20261008. Фізичні42 кейси BLOCKED_DEVICE/0 PASS, оператор не надав доказів. Немає consent/owner deferral за замовчуванням. Commit/push/exact-candidate CI/deploy/post-release smoke NOT RUN.

Production source повторно перевірити перед наступним delivery: під час drift-check live0.82.71/c74832b… і remote0.82.72/a397e368… ще не збігалися. Не називати old read-only smoke доказом нового фінансового deploy або candidate education release. Не починати upload до дозволеного GO, green exact-SHA CI та identity convergence.

## EDU-CLOSE-06 — актуальне продовження r5, 2026-10-08

Production impact: yes. Поточний worktree: C:/Users/Plotva/.codex/worktrees/education-close-release-20261008-r5/EventGenix; branch codex/education-close-release-20261008-r5; base9667c381781e83f6a484f3718ad6c36a2ac07fc9. Це exact live/remote production0.82.72 на09:51UTC. R2/r3/r4 та їхні QA-докази збережені; dirty checkouts не очищалися. Інтеграція scoped education patch відr4 без конфліктів; dependencies не встановлювалися. Candidate0.82.73 локальний, не випущений.

R4 final-r4b завершено12/13 software-gates PASS, WebKit journey FAIL: no-page-errors, dependent birthday assertion BLOCKED. Bootstrap timer request почався за22мс до нової документної навігації; harness чекав mainApp/auth/networkidle, але не terminal state lazy timer. R5 harness тепер чекає реально hydrated/loading=false/pending=false та фіксує цей стан. Pageerror gate не послаблений, API repair немає. Focused actual-app WebKit journey17/17 PASS; нова повна final-r5 матриця та hash-bound npm test RUNNING, старі PASS не підставляються.

Education-only CSS виправив narrow cabinet word splitting та vertical title/time clipping. Новий mandatory geometry oracle відтворив4–8px title замість14.16px; baseline exit1. Обидві r4b responsive engines1055 probes PASS після scoped title/subtitle fix, але це BEFORE новогоr5 source/harness і не final acceptance.

Fresh live read-only observation0.82.72/9667c381…: failedChecks0/pageErrors0, доступні canonical card,5 tabs/schedule та Park. Бізнес-записи блокуються до login, secrets process-local, outbound hold не production failure/sync PASS. Base CI8/8 green для9667c381…; старийf87 HR/payroll fixture failure вже закритий зовнішнім production commit. Candidate exact-SHA CI NOT RUN, candidate SHA ще не committed.

Залишаються EDU-CARD-PRESENTATION OPEN_PENDING_EXACT_RED_APPROVAL, EDU-HR-LINK BLOCKED_DESIGN_PENDING_OWNER_DECISION, фізичні42 cases BLOCKED_DEVICE/0 PASS. Owner proposals у output/education-ready/close06-followup-20261008. Існуюча eventgenix_education_close_devices належить retained попередній сесії; її не можна reseed/reuse для нового owned preview. LAN listener не відкривався. Потрібен оператор і окремий owned preview з перевіреним manifest; planned anchor не називати prepared dataset.

Commit/push/deploy NOT RUN через NO-GO. Немає автоматичного owner deferral. Остаточний звіт буде docs/EDUCATION_CLOSE_FINAL_ACCEPTANCE.md, fresh matrix output/education-ready/close06-followup-20261008/final-r5/. Усі шляхи попередніх блоків цього handoff є історичними; для продовження використовувати лишеr5 та новий final verdict.
## EDU-CLOSE-06 — остаточний checkpoint r5 (2026-10-08)

**NO-GO / HOLD. Production impact: yes. Пакет не випущений.** Цей checkpoint замінює попередній RUNNING щодо r5; історичні блоки залишені як докази.

Продовжувати в C:/Users/Plotva/.codex/worktrees/education-close-release-20261008-r5/EventGenix, branch codex/education-close-release-20261008-r5, base 9667c381781e83f6a484f3718ad6c36a2ac07fc9. Candidate 0.82.73 локальний. Live/remote на 2026-10-08T10:31:32Z: 0.82.72 / 9667c381781e83f6a484f3718ad6c36a2ac07fc9 / codex/eventgenix-production. Base CI 8/8 green; candidate exact-SHA CI NOT RUN. Немає commit, push або deploy; release attempts 0.

Фінальний inventory незмінний після тестів. Source digest 209168cbdaf5e7e73c93a470f609aff009bdad9a38ae8ec8b2f9cd657725e1de; harness digest e83fecf583a33c87e99b6560baff9dbe804f5254fbc554ba280f7f090f6baf54. npm test PASS, exit 0/sourceStable. Final-r5: 13 gates, 12 PASS / 1 FAIL_OR_BLOCKED. Chromium continuous journey: 17 assertions PASS. Required WebKit journey: 15 PASS / 1 FAIL / 1 BLOCKED_DEPENDENCY, не completed PASS. Обидва responsive engines: по 1055 probes PASS, це не journeys. Negative evidence/DB guards: 31 PASS / 0 skips.

Фактичний tests/tools/verify-education-close-pack.js на selected matrix повернув exit 1, FAIL_OR_BLOCKED_EVIDENCE. Release acceptance gate також exit 1, deliveryAllowed=false. Raw failed proof має null pointer у незміненому runner record; sidecar selected-matrix-result.json прив'язує raw verification/log/attempt/inventory hashes. Окремі diagnostic PASS не замінюють цей FAIL.

Поточні чотири blockers:
- WEBKIT_JOURNEY FAIL: same-origin optional timeline-visibility fetch pageerror; точна причина не доведена. Controlled loopback і instrumented actual-app diagnostic не відтворили збій. Не застосовано blanket exemption, API repair або непідтверджений product fix.
- EDU-CARD-PRESENTATION: canonical duplicate rows / empty menu 0; потрібен окремий дозвіл на конкретний protected block, proposal готовий.
- EDU-HR-LINK: BLOCKED_DESIGN existing global HR staff ownership; потрібне конкретне рішення manager-controlled membership policy, proposal готовий.
- PHYSICAL_DEVICE: 42 BLOCKED_DEVICE / 0 PASS; оператор/фактичні device докази або явне owner deferral не отримані. Новий owned preview NOT PREPARED; retained стару device DB не можна reseed/reuse.

01: teacher identity/name/isolation PASS, HR workflow blocked. 02: atomic journal revision/conflict/draft/history та canonical/legacy reports PASS. 03: scoped UX/responsive improvements PASS, protected card OPEN. 04: fail-closed validators і CI jobs додані, current WebKit required gate FAIL. 05: physical blocked. 06: NO-GO.

Особисто переглянуто 19 свіжих synthetic кадрів. Виміряні мінімальні contrast ratios: normal text 4.68, large text 3.48, input boundaries 3.08; scoped computed-CSS evidence, не повний WCAG або physical proof. Park smoke PASS. Pre-release read-only production smoke: visible tabs/schedule/card/controls, page errors 0; writes blocked до login. Outbound hold не є production failure або synchronization PASS.

Preservation: три retained DB по 39 bookings, усі table fingerprints незмінні; disposable public tables 0. 2566 історичних артефактів незмінні; один старий runtime log має відомий append зі збереженим exact original prefix. Main diff змінився у попередній перерві з невідомої зовнішньої причини; since-resume checkout proofs стабільні. R2/r3/r4 source/status/diff та попередні selected proofs збережені. LAN 3015/3016 закритий; shared PG лише loopback 55469.

Докази: docs/EDUCATION_CLOSE_FINAL_ACCEPTANCE.md; docs/EDUCATION_CLOSE_RELEASE_PROOF.md; output/education-ready/close06-followup-20261008/final-r5/matrix-final.json, selected-matrix-result.json, final-validation-cli.log, release-acceptance-gate.json, preservation-after.json, r4-preservation-after.json, visual-review-final.json та evidence-index.json.

Повторні команди лише з цим worktree, Node 22 / npm 10, owned disposable PG: npm test; node tests/integration/run-education-close-ci.js <suite> <chromium|webkit>; node tests/tools/verify-education-close-pack.js <explicit-matrix>. Кожен прогін має новий attempt/output; історичні FAIL не переписувати. Не запускати seed/reset у retained або production DB.

Наступний крок: кероване відтворення та закриття WebKit failure, два окремі Red-рішення за готовими proposals, фактична device session на окремому owned preview. Після fixes — нова повна hash-bound матриця. Тільки при дозволеному GO: повторна перевірка live/remote/Railway configured source, чинний bounded envelope, окремі product/generated commits, push confirmed production branch, exact-SHA required CI, explicit project/branch helper deploy, fresh read-only live proof. Rollback reference: 9667c381781e83f6a484f3718ad6c36a2ac07fc9.

## 2026-10-09 approved follow-up — r6

Active worktree C:/Users/Plotva/.codex/worktrees/education-close-release-20261009-r6/EventGenix; branch codex/education-close-release-20261009-r6; base9667c381781e83f6a484f3718ad6c36a2ac07fc9. Owner approval of EDU-CARD-PRESENTATION and EDU-HR-LINK is satisfied. See docs/EDUCATION_CLOSE_APPROVED_FOLLOWUP_2026-10-09.md. Current final software verification pending; copied r5 acceptance is historical, not r6 PASS. Physical42 BLOCKED_DEVICE/0 PASS; owner says devices unavailable, no waiver. Commit/push/deploy remain NOT RUN.


## 2026-10-09 production drift — r7 active

Production moved during r6 diagnostics: live0.82.73/63fc31375ce696750766572d7a22841df53b8704, remote0.82.74/72cb330ac13f8d2c1b41a8edfb8e0404d83532c3. New isolated C:/Users/Plotva/.codex/worktrees/education-close-release-20261009-r7/EventGenix, branch codex/education-close-release-20261009-r7, base72cb330ac13f8d2c1b41a8edfb8e0404d83532c3. Preserved r6; integrated current upstream HR account-status/finance changes.122 conflicts:117 pure version markers; remaining release/changelog metadata merged preserving upstream history. Candidate0.82.75 prepared with canonical bump; not released. New final-r7/npm-r7 evidence pending. Physical42 BLOCKED_DEVICE/0 PASS/no deferral. No production writes/commit/push/deploy.


## Authoritative r7 checkpoint — 2026-10-09

NO-GO/HOLD. Worktree C:/Users/Plotva/.codex/worktrees/education-close-release-20261009-r7/EventGenix; branch codex/education-close-release-20261009-r7; base72cb330ac13f8d2c1b41a8edfb8e0404d83532c3; unreleased candidate0.82.75.

Approved EDU-HR-LINK and EDU-CARD-PRESENTATION completed. New education week topic/keyboard/44px/loaded-axis fixes; canonical owner/identity/detail sources preserved, Park focused checks pass. Software15/15 and npm test exit0/sourceStabletrue. Source:40936ce6af400a5c1083ebf789c6658f6835458ed268960ff4efb23d434c09dc; harness:5ff61887d00dc635268acc20d6e97fba7c3c688f7c41471599446d84bbb4a447.42 physical BLOCKED_DEVICE/0 PASS, owner says devices unavailable, no deferral. Live card BLOCKED_FIXTURE. Required exact-release-SHA CI/commit/push/deploy NOT RUN.

Final authoritative docs: docs/EDUCATION_CLOSE_FINAL_ACCEPTANCE.md and docs/EDUCATION_CLOSE_RELEASE_PROOF.md. Evidence output/education-ready/close07-integrated-20261009.3 retained databases39 bookings each and546 r5 artifacts preserved. Disposable55470/55471 stopped after collectors; no LAN listener opened.

Commands (Node22/npm10): npm test; node tests/integration/run-education-close-ci.js <suite> <engine> with verified loopback disposable TEST_DATABASE_URL + RESET_DISPOSABLE_TEST_DATABASE + existing EDU_QA_PLAYWRIGHT; node tests/tools/verify-education-close-pack.js <matrix-path> (see actual CLI usage before invocation). Final15 references live in matrix-final-selected.json and validated in matrix-validation-final.json. Do not substitute old r2–r6 PASS.

Next owner step: physical session or explicit specific deferral. Then fresh production refs/version/source and valid Yellow envelope before release. No implicit approval to change Railway settings/production real data/new protected surfaces.
