# EDU-ASTRA — фінальне функціональне й візуальне приймання

Локальний програмний аудит завершено. Виправлено 4 підтверджені P2 UX/accessibility дефекти та недоліки тестового стенда. **SOFTWARE_MATRIX_PASS** на точних фінальних source/harness hashes. Фізичне приймання: **42 BLOCKED_DEVICE /0 виконано /0 PASS**.

## База, межі та рішення

Production impact: yes, after a future release. У цій задачі commit/push/deploy не виконувалися. Кандидат — незакомічені зміни у гілці codex/education-astra-audit, worktree C:/Users/Plotva/.codex/worktrees/education-astra-audit/EventGenix, поверх b47704b7e0472e436bf30e3dee41fa262528aad9 /v0.82.93. Нового booking renderer, schema/auth/permissions/dependency/lockfile/protected-manifest/hosting змін немає.

Свіжа read-only перевірка 2026-10-14T20:01:27.1159136Z: live і remote на тій самій базі. Railway fortunate-appreciation/production/8223324090, deployment 0a4a2179-44b8-4eb6-bde2-da2a2c2c179c SUCCESS, repo/image source null; live manifest complete. Exact receipts: [live identity](../output/education-ready/astra/final-live-identity-confirmation.json), [Railway](../output/education-ready/astra/final-railway-receipt.json).

**GO для передання програмного кандидата на окреме release review. NO-GO для безумовного повного приймання:** фізичні 42 cases відкриті, release не авторизовано цією задачею. Для наступного випуску потрібне окреме рішення власника щодо фізичного gap і дозволений release процес із новою версією/cache markers. Старі release approvals не використовуються.

## Що виправлено

| ID | Причина → результат | Файли |
| --- | --- | --- |
| ASTRA-01 P2 UX/a11y | Однакові ПІБ були нерозрізненними. Group/lesson/Today options додають ID для однакових активних імен; поточне inactive fallback-призначення завжди має ID; manager показує ID та accessible target. Canonical teacherName не містить suffix. | js/education-groups.js, js/booking.js, js/education-schedule.js |
| ASTRA-02 P2 UX | Два capacity409 повідомлення були технічними англійськими. Український текст пояснює причину й відновлення; SQL, HTTP409 та draft/retry поведінка збережені. | services/educationGroups.js |
| ASTRA-03 P2 visual | Desktop time column176.859px не вміщувала196px controls: overflow19.141px, overlap9.141px. Education grid auto-fit/min220px прибрав перекриття без зменшення шрифту. | css/education-schedule.css |
| ASTRA-04 P2 accessibility | Global important date border з alpha0.35 перекривав education solid border. Actual-app rendered contrast1.46:1. Scoped solid #64748b для дат і #94a3b8 для dark time selector відновили видиму межу; Park scope незмінний. | css/education-schedule.css |

Pre-edit symptom/expected/actual/reproduction/root cause/impact/verification і точні before paths: [bug reports](EDUCATION_ASTRA_BUG_REPORTS.md). Final after evidence: [suite summary](../output/education-ready/astra/suite-summary.json), [reviewed frames +SHA256](../output/education-ready/astra/visual-review.json). Перші FAIL, interrupted baseline і stale attempts збережено; вони не перейменовані в PASS.

Harness H01–H08: terminal manager response; explicit education fixture prerequisite; timer/navigation waits; обидві теми на кожному профілі; Promise.all для click+response без зміни12s timeout; synthetic failure diagnostics; alpha/background/gradient compositor для boundaries; реальний wheel-scroll до offscreen Save перед звичайним click. Pageerrors не whitelist-ились. Пропозиція для repository AGENTS.md після повторних timing помилок: Browser QA must await terminal runtime reads before navigation, explicitly scroll offscreen submit controls into view with normal user input, and retain every failed attempt; never use force clicks or API repair to obtain PASS. До H07 старий RGB-only contrast PASS був хибним для прозорих date borders. ASTRA04 baseline зупинено після зафіксованих strict FAIL; це targeted reproduction, не завершена baseline matrix.

## Дані та методи

Actual-app → Express → disposable PostgreSQL16; власні loopback clusters55472/55473/55474, exact database eventgenix_education_ready_fixture_test. Ніяких write workflows на production/retained DB. Node22.23.1/npm10.9.8; cached Playwright1.64, Chromium156.0.8078.4, WebKit27.2 на Windows.

Fixture anchor2026-10-03, Europe/Kyiv, report clock2026-10-03T09:00:00Z; series fixed UTC clock2026-10-13T10:00:00Z. Dataset:4 staff/5 memberships,14 представників,26 дітей,7 груп,33 memberships,4 resources,39 занять,80 attendance,63 history;0 relationship violations,0 reachable contacts. Dar/secondary education/Park control; додаткові synthetic new/duplicate/inactive/HR teachers і2 оператори створюються конкретними cases. Дані2030/2036 у browser scenarios — synthetic future fixtures.

Очікувані report totals обчислені з fixture specification/SQL незалежно від product report function. [Case matrix](../output/education-ready/astra/case-matrix.json) містить передумови, executable actions/assertions із source line, actual, proof і статус кожного check. Exact full manifest/preflight — у proofs. **Кількість checks/assertions не є кількістю journeys.** Два continuous journeys виконано окремо в Chromium і WebKit.

| Suite | Метод | Обсяг | Результат |
| --- | --- | --- | --- |
| teachers/chromium | MIXED_VISIBLE_UI_API_SQL | 31 checks | PASS |
| hrLink/chromium | VISIBLE_HR_UI_API_SQL_WITH_NEGATIVE_CAPABILITY_TESTS | 3 checks | PASS |
| hrLink/webkit | VISIBLE_HR_UI_API_SQL_WITH_NEGATIVE_CAPABILITY_TESTS | 3 checks | PASS |
| groups/chromium | MIXED_VISIBLE_UI_API_SQL | 16 checks | PASS |
| lifecycle/chromium | MIXED_VISIBLE_UI_API_SQL | 12 checks | PASS |
| date/chromium | MIXED_VISIBLE_UI_API_SQL | 13 checks | PASS |
| async/chromium | MIXED_VISIBLE_UI_API_SQL_BARRIERS | 18 checks | PASS |
| journal/chromium | VISIBLE_UI_API_SQL_TWO_OPERATORS | 6 checks | PASS |
| attendance/chromium | HTTP_POSTGRESQL | 7 checks | PASS |
| series/chromium | HTTP_POSTGRESQL | 18 checks | PASS |
| acceptance/chromium | MIXED_ACTUAL_APP_UI_AND_HTTP_SQL | 11 checks | PASS |
| journey/chromium | VISIBLE_UI_API_SQL_ONE_CONTINUOUS_JOURNEY | 18 checks | PASS |
| journey/webkit | VISIBLE_UI_API_SQL_ONE_CONTINUOUS_JOURNEY | 18 checks | PASS |
| responsive/chromium | SYNTHETIC_BROWSER_EMULATION_UI_WRITES | 2148 checks | PASS |
| responsive/webkit | SYNTHETIC_BROWSER_EMULATION_UI_WRITES | 2148 checks | PASS |
| astraLayout/chromium | VISIBLE_UI_BROWSER_EMULATION_GEOMETRY | 16 checks | PASS |
| astraLayout/webkit | VISIBLE_UI_BROWSER_EMULATION_GEOMETRY | 16 checks | PASS |
| teachers/webkit | MIXED_VISIBLE_UI_API_SQL | 31 checks | PASS |

15 mandatory suites +3 supplementary suites validated з required IDs,0 required skips, exact attempt/log/proof hashes та завершальними markers. [Mandatory validation](../output/education-ready/astra/final-matrix-validation.json), [supplement](../output/education-ready/astra/supplemental-matrix.json), [усі final-спроби](../output/education-ready/astra/all-final-attempts-index.json).

Повний npm test на фінальному коді: exit0; runtime/version/syntax/protected gate та repository tests пройшли. [Npm proof](../output/education-ready/astra/npm-final-validation.json). Protected 6 blocks незмінні. Unit/mock counts не додаються до education journeys.

F01/F02 — group/teacher selection і draft; F03/F04/F06 — два оператори, direct report/reload і керовані A→B→A races; F05 — field-preserving edits. Окремо:30/45/60/90 хв, date/month/year/Kyiv DST, create/create/create-edit/create-series barriers, atomic rollback, adjacent slots, foreign isolation, frozen roster, усі marks/clear, lost-response retry, stale409/history, held/cancelled/future/no-journal independent reports. Settings і Park перевірені у scoped UI/API та emulation suites; component/mock evidence позначено окремо.

## Візуальне приймання

Обидва engines: desktop1440, phone320/390, phone landscape, tablet768/landscape, reflow640 як емуляція200% layout; light/dark на кожному —14 combinations/engine. Перевірено п’ять вкладок, settings, canonical card/create/edit/series, labels/actions, keyboard/focus return, ARIA, scroll і доступ до Save. CRM орієнтири: btn-submit/panel.css, modal secondary/destructive actions, education-action tokens. Виправлення не зменшують шрифт.

| Engine | Normal text min (>=4.5) | Large text min (>=3) | Measured input boundary min (>=3) | Profile/theme combinations |
| --- | --- | --- | --- | --- |
| chromium | 4.68:1 | 3.48:1 | 3.07:1 | 14 |
| webkit | 4.68:1 | 3.48:1 | 3.07:1 | 14 |

Метод: computed styles, alpha compositing, внутрішня/зовнішня поверхні,21 sample/gradient segment, conservative minimum. [Числовий звіт](../output/education-ready/astra/contrast-summary.json). Це software measurement, не фізичний colorimeter або повна сертифікація WCAG.

Особисто переглянуто **17 фінальних кадрів**, рівно перелічених у visual-review.json; інші screenshots мають тільки фактично виконані автоматичні checks. Before frames збережені окремо. Reconnect toast у synthetic frames — навмисний local socket/outbound hold; він не є production failure або synchronization PASS. Narrow schedule ellipsis має доступний canonical detail; landscape card вимагає scroll під sticky actions.

## Production reference, статуси та gaps

Read-only observer на явній даті07.10.2026: п’ять Dar tabs, direct/reload report, schedule/canonical card і Park;0 failedChecks,0 blockedFixtures,0 pageErrors, identity/profile/cabinet unchanged. Guard business writes встановлено ДО login. Creator role:2 explicit staff403 diagnostics (конкретний legacy probe),20 outbound holds,2 blocked wallet/daily-login diagnostics; не blanket whitelist. PII screenshots/response bodies не зберігались. [Live proof](../output/education-ready/astra/live-readonly-20261007.json). Це reference production-бази, не live proof невипущених fixes.

- PASS: фінальна software matrix, supplementary geometry/teachers, npm test, protected gate, scoped live reference.
- FAIL: первинні ASTRA reproductions і harness failures збережені як історичні; current selected records не містять FAIL.
- BLOCKED_DEVICE: ті самі 42 device/case IDs,0 executed/0PASS; [physical matrix](../output/education-ready/astra/physical-device-matrix.json). Native keyboard/pickers, VoiceOver/TalkBack, safe areas і реальний pinch/browser zoom не доведені emulation.
- NOT RUN: provider synchronization, новий GitHub CI run, commit/push/PR/deploy, physical sessions. Outbound holds не є sync evidence.
- Обмеження: WebKit при фокусі duration показав1px oscillation offscreen Save; explicit real wheel-scroll відновив trusted click/submit без force чи API repair. Harness H08 покриває цей користувацький крок; сам browser scroll jitter не названо виправленим у продукті. Окремий r9 journey/Chromium pending-request timeout і BLOCKED_DEPENDENCY збережено; успішні повтори не доводять причину того timing failure. Історичні FAIL та targeted interrupted diagnostics не приховані. Майбутні code/harness/version changes роблять цей пакет stale.

Main dirty checkout, попередні FAIL/BLOCKED artifacts і retained manual DB збережено. Retained DB не відкривалась для fresh SQL count; такого підтвердження тут не заявлено. Три власні кластери перевірено як порожні та зупинено без видалення каталогів: [cleanup PASS](../output/education-ready/astra/cleanup.json). Перша спроба зупинки отримала permission denied через невірно обраного OS-власника; її receipt збережено у cleanup-first-attempt-permission-fail.json. Повтор виконався від фактичних власників каталогів plotva/plotva/postgres.

## Продовження аудиту 15.10.2026 за Києвом

На незміненому r11 закрито попередню прогалину settings Save → reload. Два окремі суцільні сценарії, Chromium і WebKit, по 7 required steps: visible login; візуальна назва → Save → reload; compactBlocks → Save → reload; контрольований HTTP503 → збережена чернетка → UI retry → reload; ізоляція іншого бізнесу; незалежні SQL hashes занять/груп/журналів; класифікація console/network diagnostics. API/SQL використовувалися як setup та read-only oracle, без ремонту невдалого UI-кроку. Продуктові settings/auth/permission файли не змінювалися.

Додатково повторено первинний continuous journey у Chromium та WebKit: по 18 required checks, PASS. Pending-request timeout r9 у цих повторах не відтворився; це не доводить усунення його першопричини. Основна матриця 15+3 та npm test залишаються чинними через точну незмінність source/repository-harness inventories. Нові зовнішні audit scripts мають окремі SHA256 і включені до review package; вони не видаються за новий CI gate.

Повторний ручний review п'яти продуктових файлів не знайшов нових підтверджених дефектів. Перевірено відокремлення canonical teacherName від ID suffix, escape для accessible names, inactive fallback, education CSS scope, незмінність HTTP409/business logic та protected booking contract. Це review тим самим агентом, не незалежний reviewer.

Особисто переглянуто ще 2 settings-кадри: Chromium visual label після reload та WebKit system feature після reload; спостереження й SHA256 у [followup summary](../output/education-ready/astra/followup-summary.json). У ньому також exact records/log/proof hashes, required IDs, diagnostics та зовнішній harness inventory. [Свіжа live/remote identity](../output/education-ready/astra/followup-live-identity.json), [окремий cleanup нового кластера](../output/education-ready/astra/followup-cleanup.json). Старі редакції acceptance/handoff збережені. Фізичні 42 cases і provider synchronization залишаються відкритими.

## Ідентичність та пакет для окремого випуску

Source files1331, digest 86c7f550968a6452a92b1b664075d6553c07c1341abc3cc6d4eb3df7f60577d8; harness files1028, digest 9c44b459decb1c8ed328ecebbdf600c3c22ac21d211d08783aa25e1b4d6049ec. [Повні inventories](../output/education-ready/astra/final-source-harness-inventory.json). Зміни docs/evidence не входять у runtime inventory.

[Review package](../output/education-ready/astra/review-package/README.md): tracked patch, повні new/modified files, hashes, required matrix references, verification commands і межі release. Нічого не закомічено й не опубліковано.

**Один рекомендований наступний крок:** окреме рев’ю цього пакета з рішенням власника щодо 42 BLOCKED_DEVICE перед авторизацією випуску.
