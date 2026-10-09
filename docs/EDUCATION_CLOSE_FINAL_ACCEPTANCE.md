# EDU-CLOSE — поточне приймання і випуск


## Чинне рішення власника і стан релізу — 2026-10-09

Власник прямо доручив продовжити випуск, відклавши фізичні пристрої: «пофіг на пристрої, просто працюй сам, щоб максимально».42 кейси залишаються BLOCKED_DEVICE,0 PASS; це owner-deferred обмеження, а не повністю закритий кейс. Програмне приймання:15/15 PASS на незмінному final source. **GO_WITH_OWNER_DEVICE_DEFERRAL**, з обов’язковим exact-SHA green CI перед deploy.

Fresh read-only discovery знайшов заняття07.10.2026: видима картка відкрилася з календаря. live-readonly-discovery.json: READONLY_OBSERVATION_COMPLETE, pageErrors/failedChecks0, cabinet/profile unchanged; business writes blocked до login. Старі empty-date BLOCKED_FIXTURE докази збережені й не перейменовані. Це v0.82.74 reference; candidate postdeploy QA ще належить виконати.

Railway service list read-only повернув source:null для3fb62d4c-2dc2-4701-8e2b-09ce16e188ee: Git source не підключений, сервіс manual upload; production source branch визначає exact archive manifest і передається явно як codex/eventgenix-production. Налаштування не змінюємо. Base/live/remote72cb330ac13f8d2c1b41a8edfb8e0404d83532c3; candidate0.82.75. Yellow block EDU-CLOSE-RELEASE: поточна задача дозволяє commit/push/exact-SHA CI/helper deploy/read-only QA; production target fortunate-appreciation/production/8223324090, no migrations/real writes/settings/secrets; до2026-10-09T16:18:00Z, максимум3 спроби. Нова production-база — HOLD/integration/reverification. Rollback source72cb330 і історичний a990b668 збережені.

Owner decision: output/education-ready/close07-integrated-20261009/owner-device-deferral.json. Попередній стан документів збережено окремими pre-owner-decision-* snapshots; старий evidence-index-final.json описує саме ці bytes. Коміти/CI/deploy будуть записані в окремих release phase proofs.


## Збережений попередній checkpoint (історичний, не чинний висновок)

# EDU-CLOSE-06 — фінальне приймання, 2026-10-09 — історичний checkpoint до owner decision

**NO-GO / HOLD_RELEASE. Production impact: yes. Пакет підготовлено локально; commit/push/deploy не виконано.**

Цей звіт замінює висновок r5 від08.10 для поточного пакета. Програмна матриця підтверджена на фінальному коді:15/15 gates PASS. Це два continuous UI journeys (Chromium/WebKit) та окремі змішані UI/API/SQL, HTTP/PG, component/mock і responsive suites. Внутрішні assertions та загальні unit counts не є тисячами education journeys.

Фізичних пристроїв немає: відповідь власника «Зараз фізичних пристроїв немає».42 cases — BLOCKED_DEVICE,0 PASS, без owner deferral. Доступної production-картки на перевірених датах також не було: BLOCKED_FIXTURE. Локальний PASS не замінює цих доказів. За кроком6 EDU-CLOSE-06 відкладення blocker можливе лише за конкретним явним рішенням власника; такого рішення немає.

## Фінальний код і база

- Worktree: C:/Users/Plotva/.codex/worktrees/education-close-release-20261009-r7/EventGenix
- Branch: codex/education-close-release-20261009-r7
- Base SHA:72cb330ac13f8d2c1b41a8edfb8e0404d83532c3.
- Candidate:0.82.75 (не випущено). Node22.23.1 / npm10.9.8.
- Source digest:40936ce6af400a5c1083ebf789c6658f6835458ed268960ff4efb23d434c09dc
- Harness digest:5ff61887d00dc635268acc20d6e97fba7c3c688f7c41471599446d84bbb4a447
- Full inventory SHA256:7eed5a14ee042fc144ddb0a08a0c27dbbbf7d0af8a302763d3c8a404d712f88d
- Inventory: output/education-ready/close07-integrated-20261009/final-inventory.json. Повна рівність включає додані source/harness файли.
- Свіжі live і remote: v0.82.74, SHA 72cb330ac13f8d2c1b41a8edfb8e0404d83532c3, branch codex/eventgenix-production; checked 2026-10-09T10:05:38.9060232Z. Remote HEAD:72cb330ac13f8d2c1b41a8edfb8e0404d83532c3.
- Інтеграцію виконано в окремому r7 від актуальної бази:122 конфліктні фрагменти,117 лише version/cache;5 release metadata. Upstream HR password/business-access та finance зміни збережено. Main checkout, r2–r6 і попередні докази не перезаписано.

## Що змінено і чому

1. **Викладачі.** routes/bookings.js зберігає validated ID/name при підстановці groupName; різні ID з однаковими іменами не конфліктують. Name fallback лише для legacy без ID. Чужі ID/inactive призначення перевіряються з чинними business boundaries.
2. **Існуючий HR-працівник.** services/educationHrMembership.js, routes/hr.js, hr.html, js/hr-page.js, css/pages-hr-foundation.css: погоджений EDU-HR-LINK дозволяє явне призначення active global/accountless staff з Park HR. Потрібні current Park membership, hr.staff.manage та fresh права створення в target education business. Чинна membership таблиця й audit записуються атомарно, staff не дублюється.201/200 idempotency, concurrent assignment, inactive, чужий target/staff ID, revoked permissions і503 retry перевірені. Legacy /api/staff не відкрито; глобальні права/schema/backfill не змінено.
3. **Журнал і звіти.** services/educationAttendance.js, routes/education-attendance.js, js/education-attendance.js: revision check під чинним lock; stale409 не змінює відмітки/історію, локальний draft зберігається. Explicit refresh/reapply, усі статуси/clearing/frozen roster, history author/time та idempotency перевірені. Canonical/legacy нормалізація узгоджена; held визначається завершенням Europe/Kyiv, attendance totals включають held. Текстова groupName не підмінює linked group. Date/linked group після початку журналу захищені.
4. **Реальна дитина через UI.** services/customerChildren.js зберігає цивільну PostgreSQL DATE без UTC-зсуву. Обидва continuous journeys створюють нового representative і дитину через Customers UI; seeded child не підставлено.
5. **Форма й канонічна картка.** js/booking.js — тема та core fields без дублів, нерелевантні education labels/декорація й порожній generic package прибрані. Реальні notes/customer/status/actions та financial250₴ збережені. Renderer один, identity/detail source priorities незмінні. Лише booking-detail-safe-open manifest оновлено за explicit EDU-CARD-PRESENTATION approval09.10; focused regression і protected guard PASS.
6. **Навігація та layout.** js/education-schedule.js, js/ui.js, js/global-task-timer.js, js/timeline-visibility.js: stale request/lifecycle guards, optional GET keepalive для native WebKit unload без прихованих pageerror exemptions; response hidden/exiting/context-stale не оновлює storage/UI. Mini-map/loading/errors/retry, education time axis, compact tabs/filters і draft states перевірені.
7. **Свіжо знайдені week дефекти.** js/timeline.js, css/education-schedule.css: тема замість «ІНШ Заняття», keyboard Enter/Space → чинна canonical card, focus return,44px targets із54px lanes. Week використовує education getTimeRange після завантаження scoped cache: ранній09:30 урок не заходить на cabinet label. Park opening hours/labels/identity збережені. Фото й незалежна geometry assertion підтверджують виправлення.
8. **Чесні тести та CI.** tests/helpers/education-close-evidence.js/contracts, actual-app browser/PG harness і .github/workflows/ci.yml:15 Linux disposable PG/browser entries. Перевіряються required IDs, ненульове execution, skips/BLOCKED/NOT RUN, attempt/log/proof hashes, повна inventory equality. Negative fail-closed checks відхиляють empty suite, missing case, доданий source, змінений harness/stale log/fixture та UI failure із API repair. Dependencies/CI settings/secrets/permissions не змінено.

## Фактична final-source матриця

| Gate | Результат | Виконані checks | Клас доказу |
|---|---|---:|---|
| teachers/chromium | PASS | 27 | MIXED_VISIBLE_UI_API_SQL |
| hrLink/chromium | PASS | 3 | VISIBLE_HR_UI_API_SQL_WITH_NEGATIVE_CAPABILITY_TESTS |
| hrLink/webkit | PASS | 3 | VISIBLE_HR_UI_API_SQL_WITH_NEGATIVE_CAPABILITY_TESTS |
| groups/chromium | PASS | 15 | MIXED_VISIBLE_UI_API_SQL |
| lifecycle/chromium | PASS | 12 | MIXED_VISIBLE_UI_API_SQL |
| date/chromium | PASS | 13 | MIXED_VISIBLE_UI_API_SQL |
| async/chromium | PASS | 18 | MIXED_VISIBLE_UI_API_SQL_BARRIERS |
| journal/chromium | PASS | 6 | VISIBLE_UI_API_SQL_TWO_OPERATORS |
| attendance/chromium | PASS | 7 | HTTP_POSTGRESQL |
| series/chromium | PASS | 17 | HTTP_POSTGRESQL |
| acceptance/chromium | PASS | 11 | MIXED_COMPONENT_API_SQL_BROWSER_MOCK |
| journey/chromium | PASS | 18 | VISIBLE_UI_API_SQL_ONE_CONTINUOUS_JOURNEY |
| journey/webkit | PASS | 18 | VISIBLE_UI_API_SQL_ONE_CONTINUOUS_JOURNEY |
| responsive/chromium | PASS | 1069 | SYNTHETIC_BROWSER_EMULATION_UI_WRITES |
| responsive/webkit | PASS | 1069 | SYNTHETIC_BROWSER_EMULATION_UI_WRITES |

Matrix: matrix-final-selected.json; strict validation: matrix-validation-final.json. Усі reference hashes і required IDs перевірені; mandatory skips0. F01/F02 — groups/teachers; F03/F04/F06 — async/journal/reports; F05 і30/45/60/90 permutations — lifecycle; date-only — date та journeys. Series/DST/atomic conflicts/concurrency — окремі HTTP/SQL tests плюс видимі series create/cancel у journeys. Acceptance suite містить component/browser mocks і так позначений.

API/SQL дозволені для prerequisites та independent assertions. Сценарій написання не ремонтується API після невдалого UI. Controlled503 і response barriers позначені як fault injection; outbound hold захищає локальні зовнішні side effects і не доводить live synchronization.

npm test: exit0, sourceStable=true; log SHA256:d76356d82a1ac723b3489f07053c3c083afa95b4090c50710ba10ace3d43260d. Це загальний baseline. Focused card/validator/visibility/week:30 PASS,0 fail/skip (focused-axis-final.log). Protected guard:6 blocks,4 forbidden needles,2 regressions PASS. No migrations/dependency churn; lockfile лише top/root version74→75. Product і generated51-file markers мають залишитися окремими commits при майбутньому дозволеному релізі.

## Visual / accessibility / physical

Особисто переглянуті before/after кадри перелічені з hashes у final-visual-review.json (22 файлів); це точний перелік, а не твердження про перегляд кожного автоматичного кадру. Chromium/WebKit responsive emulation:7 profiles кожен, desktop/320/390/landscape/tablet/reflow, light/dark. Контраст вимірювався за computed colors: normal4.5, large3, input boundaries3; visible enabled controls і geometry checks не порожні. Disabled controls позначені окремо. Це не physical VoiceOver/TalkBack certification.

Перепідключення на локальних кадрах пов’язане з контрольованим outbound hold/background sync. Його не приховано і не названо production failure чи live sync PASS. Week має горизонтальне прокручування; keyboard focus прокручує до вибраного уроку, повна назва є в ARIA/title. Real device keyboard/native pickers/safe-area/VoiceOver/TalkBack:42 BLOCKED_DEVICE,0 PASS. Physical preview/LAN listener не відкрито, anchor date null; старі device/manual DB не використано для записів.

## Live read-only та реліз

Live smoke — deployed v0.82.74 reference, НЕ candidate postdeploy proof. Business writes заблоковано до login. П’ять вкладок/видимий schedule/nonempty CRM controls/Park перевірено. На09.10 та03.10 картки не було — BLOCKED_FIXTURE. Page errors0, unclassified failures0; legacy staff403 — EXPECTED_ACCESS_DENIAL; POLICY_OUTBOUND_HOLD32/POLICY_WRITE_HOLD2. Cabinet/profile fingerprints before/after однакові. Secrets/production PII/screenshots/body logs не зберігались.

Railway read-only target: fortunate-appreciation / production /8223324090; project bc28b46c-d4bc-491c-893a-d8401c633668, environment d9f9b984-d54d-4620-a8bf-c48882ad5158, service3fb62d4c-2dc2-4701-8e2b-09ce16e188ee. CLI status не exposes configured Git source: NOT_EXPOSED_BY_STATUS. Deployed branch доведено manifest, configured branch не оголошено підтвердженою. Settings/secrets/auto-deploy policy не змінено.

| Етап | Статус |
|---|---|
| Local final-source software matrix | PASS15/15 |
| Actual release-SHA required CI | NOT RUN — candidate не pushed |
| Physical device acceptance | BLOCKED_DEVICE42 |
| Read-only live card | BLOCKED_FIXTURE |
| Commit / production push / manual deploy | NOT RUN — NO-GO |
| Candidate /api/version + postdeploy QA | NOT RUN |

Попередні FAIL/stale attempts збережено. Один lifecycle епізод мав diagnostic evaluate, який приховав початкову помилку; now diagnostic failure не замінює original UI error. Після нього lifecycle пройшов повторно й у final-source matrix. Початкову причину не встановлено; не заявляємо, що її продуктово виправлено. Це залишковий ризик timing harness, не прихований PASS.

## Збереження та наступний крок

preservation-after.json:3 retained DB по39 bookings, усі tables row/count/hash без змін;546 r5 artifacts і source/harness r5 збережені. Власні disposable55470/55471 після collectors зупинено;55469 retained preview збережено. Main/попередні worktrees не очищались.

**Висновок NO-GO.** Потрібна фізична сесія з42-case доказами або конкретне явне рішення власника відкласти physical blocker, не називаючи кейс повністю закритим. Live card потребує доступного safe read-only record; production seed не дозволений. Перед майбутнім release заново перевірити refs/version collisions/configured Railway source, отримати чинний Yellow envelope (попередній прострочений), зробити окремі product/version commits, exact-SHA required green CI, helper deploy з explicit project/branch і read-only postdeploy proof. Нових Red/protected змін цей звіт не дозволяє.

## Selected attempt references

Evidence root: output/education-ready/close07-integrated-20261009.

- teachers/chromium: `axis-core-reruns/final-matrix/attempt-2026-10-09T09-58-05-345Z-teachers-chromium-20a474/record.json` (attempt `attempt-2026-10-09T09-58-05-345Z-teachers-chromium-20a474`).
- hrLink/chromium: `axis-core-reruns/final-matrix/attempt-2026-10-09T10-01-25-968Z-hrLink-chromium-1df200/record.json` (attempt `attempt-2026-10-09T10-01-25-968Z-hrLink-chromium-1df200`).
- hrLink/webkit: `corrected-core-a/final-matrix/attempt-2026-10-09T09-53-15-776Z-hrLink-webkit-0405e1/record.json` (attempt `attempt-2026-10-09T09-53-15-776Z-hrLink-webkit-0405e1`).
- groups/chromium: `corrected-core-a/final-matrix/attempt-2026-10-09T09-54-09-738Z-groups-chromium-4a7037/record.json` (attempt `attempt-2026-10-09T09-54-09-738Z-groups-chromium-4a7037`).
- lifecycle/chromium: `corrected-core-a/final-matrix/attempt-2026-10-09T09-55-58-194Z-lifecycle-chromium-9f9151/record.json` (attempt `attempt-2026-10-09T09-55-58-194Z-lifecycle-chromium-9f9151`).
- date/chromium: `corrected-core-a/final-matrix/attempt-2026-10-09T09-58-18-746Z-date-chromium-44bcc2/record.json` (attempt `attempt-2026-10-09T09-58-18-746Z-date-chromium-44bcc2`).
- async/chromium: `corrected-core-a/final-matrix/attempt-2026-10-09T10-00-39-910Z-async-chromium-85bcfb/record.json` (attempt `attempt-2026-10-09T10-00-39-910Z-async-chromium-85bcfb`).
- journal/chromium: `axis-core-reruns/final-matrix/attempt-2026-10-09T10-03-03-926Z-journal-chromium-762b22/record.json` (attempt `attempt-2026-10-09T10-03-03-926Z-journal-chromium-762b22`).
- attendance/chromium: `axis-core-reruns/final-matrix/attempt-2026-10-09T10-04-22-887Z-attendance-chromium-2fd2dc/record.json` (attempt `attempt-2026-10-09T10-04-22-887Z-attendance-chromium-2fd2dc`).
- series/chromium: `axis-core-reruns/final-matrix/attempt-2026-10-09T10-04-41-612Z-series-chromium-825b85/record.json` (attempt `attempt-2026-10-09T10-04-41-612Z-series-chromium-825b85`).
- acceptance/chromium: `axis-core-reruns/final-matrix/attempt-2026-10-09T10-05-14-209Z-acceptance-chromium-5d1193/record.json` (attempt `attempt-2026-10-09T10-05-14-209Z-acceptance-chromium-5d1193`).
- journey/chromium: `corrected-core-b/final-matrix/attempt-2026-10-09T09-53-35-624Z-journey-chromium-e8f6d7/record.json` (attempt `attempt-2026-10-09T09-53-35-624Z-journey-chromium-e8f6d7`).
- journey/webkit: `corrected-core-b/final-matrix/attempt-2026-10-09T09-55-10-405Z-journey-webkit-cdff9f/record.json` (attempt `attempt-2026-10-09T09-55-10-405Z-journey-webkit-cdff9f`).
- responsive/chromium: `axis-responsive-chromium/final-matrix/attempt-2026-10-09T10-01-20-493Z-responsive-chromium-f91509/record.json` (attempt `attempt-2026-10-09T10-01-20-493Z-responsive-chromium-f91509`).
- responsive/webkit: `axis-responsive-webkit/final-matrix/attempt-2026-10-09T10-04-01-452Z-responsive-webkit-f37dce/record.json` (attempt `attempt-2026-10-09T10-04-01-452Z-responsive-webkit-f37dce`).
