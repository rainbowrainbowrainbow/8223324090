# SYS-MB-D06-LOCAL — Наскрізне приймання і готовність

Локальне приймання виконано. **PARK_DAR_RELEASE_READY = HOLD (false)**. **GLOBAL_MODEL_COMPLETE = false (HOLD)**.

На повному застосунку відтворені прогалини ізоляції, тому успішні окремі сценарії не дають підстав для релізу. Це actual local app + disposable PostgreSQL + справжній Chromium із синтетичними даними; не live QA і не підсумовування старих fixture PASS. CI, commit, push, deploy та production-операції не виконувалися. Production impact цього запуску: no.

## Точний checkpoint

- База/HEAD: `a5180def01a1e47f8f4fc75e2f7a43092f205828`; гілка `codex/sys-mb-auth-p0-20260912`.
- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.
- Попередній checkpoint: [D05_VERIFICATION.json](D05_VERIFICATION.json), SHA256 `7e16b7a81e1204315e6e7ae966fb9d3583305103143e7fb003d63e0eab868075`. На вході збіглися всі 314 записів із масивів source/audit/artifact; це не кількість унікальних файлів.
- Остаточний run: **`d06_1789241525527_7d4a50`**; [result.json](../../../.codex-temp/sys-mb-d06/runs/d06_1789241525527_7d4a50/result.json), [source-state.json](../../../.codex-temp/sys-mb-d06/runs/d06_1789241525527_7d4a50/source-state.json), [browser.json](../../../.codex-temp/sys-mb-d06/runs/d06_1789241525527_7d4a50/browser.json).
- Новий checkpoint: [D06_VERIFICATION.json](D06_VERIFICATION.json). У ньому exact SHA256 cumulative sources, нових тестів, звітів, скриншотів і попередніх доказів. Окремий [D06_ONLY.patch](D06_ONLY.patch) містить тільки D06 source/test зміни від збережених D05 bytes; це не повний cumulative release patch.
- Локальний marker `0.81.132` не змінено; він не підтверджує поточну версію сайту. Implementation commit не створений, незакомічений cumulative diff D01–D05 збережено.

## Умови та повнота перевірки

Harness запускає справжній `server.js`, двофазну DB-ініціалізацію й усі **353** наявні SQL-міграції. Нових схем/міграцій у D06 немає. Створено окрему випадково названу БД; ownership перевірено перед її видаленням, cleanup підтверджено запитом до PostgreSQL. `acceptance-source-stability` — PASS, джерела під час запуску не змінювалися.

Парк і Дар належать синтетичній організації 1; `d06_other` — організації 2. Дев'ять синтетичних акаунтів охоплюють platform creator, звичайного owner/director, admin, member із різними Park/Dar ролями, учасника двох організацій, іншого owner, відкличний доступ, відсутнє membership і MD compatibility. Звичайний owner не має platform creator bypass. UI додатково створює й деактивує власний кабінет; API створює свій lifecycle fixture. Усі записи зникають із точним cleanup БД.

У браузері використано справжню форму входу, серверні профілі, lifecycle/UI та реальні HTTP/SQL-відповіді. Для race-сценарію змінюється лише час доставки фактичної відповіді; її body/status не підміняються. Windows loopback proxy пересилає байти до локального WSL app. Тестовий preload блокує нелокальний transport і підключає незмінений WebSocket-модуль після startup hold. Jobs/providers, service worker/offline та доставка зовнішніх шрифтів не сертифіковані. Секрети не завантажувалися; випадкові тестові credentials передані через пам'ять/anonymous stdin і редагуються у логах.

## Фактичні результати

| Набір | PASS | FAIL | NOT_TESTABLE | Доказ |
| --- | --- | --- | --- | --- |
| Усі записані acceptance cases | 173 | 23 | 1 | 197 cases, без подвійного додавання browser |
| API домени / lifecycle / containment / додаткові поверхні | 147 | 14 | 0 | 339 actual HTTP requests |
| Реальний браузер | 14 | 1 | 0 | 15 cases |
| npm test — окремі TAP invocation totals | 4297 | 0 | 0 | 34 TAP invocations; не унікальні сценарії/live PASS |

`npm test` на Node22/npm10 завершився exit0; [лог](../../../.codex-temp/sys-mb-d06/npm-test-final2.log), [exit](../../../.codex-temp/sys-mb-d06/npm-test-final2.exit), [215 source hashes](../../../.codex-temp/sys-mb-d06/baseline-source-freeze-final2.json). 0 skipped, 0 cancelled. Fast baseline містить runtime/version/access/protected-surface/migration/parser/unit/static UI gates; окремого style lint/typecheck/build у repo немає. Локальний green не підміняє CI.

Кількість acceptance cases за фактичною областю:

| Область | PASS | FAIL | NOT_TESTABLE |
| --- | --- | --- | --- |
| startup | 1 | 0 | 0 |
| lifecycle | 4 | 0 | 0 |
| readiness_profile | 6 | 0 | 0 |
| staff | 0 | 2 | 0 |
| certificates | 0 | 2 | 0 |
| art | 0 | 2 | 0 |
| payroll | 0 | 2 | 0 |
| ownership_collection | 2 | 0 | 0 |
| legacy_collection | 1 | 0 | 0 |
| compatibility_usage | 0 | 0 | 1 |
| bookings | 8 | 0 | 0 |
| timeline | 6 | 0 | 0 |
| customers | 12 | 0 | 0 |
| leads | 12 | 0 | 0 |
| tasks | 12 | 0 | 0 |
| finance | 8 | 0 | 0 |
| warehouse | 11 | 0 | 0 |
| products | 12 | 0 | 0 |
| graduation | 7 | 0 | 0 |
| auth | 8 | 0 | 0 |
| containment | 24 | 0 | 0 |
| dashboard | 7 | 0 | 0 |
| settings | 7 | 0 | 0 |
| omni | 10 | 0 | 0 |
| warehouse_residual | 0 | 14 | 0 |
| browser | 14 | 1 | 0 |
| harness | 1 | 0 | 0 |

PASS для домену означає лише перевірені входи з [D06_API_REPORT.md](D06_API_REPORT.md), не повну сертифікацію всіх адаптерів. Наприклад, dashboard перевірено для task/lead widgets, settings — cabinet/timeline display, Omni — CRM read/context/messages. Provider sends, глобальні widgets та secret configuration не покриті.

## Виправлені локальні регресії

**D06-PRODUCT-CONTEXT (P1, FIXED_LOCAL).** URL: `/programs.html`. Вхід звичайним owner з доступом до Парку/Дару → sidebar Дар → Продукти. Очікування: API запит до Дару, його записи й registry-назва. До виправлення `getProductApiBusinessContext` перетворював усі не-MD ключі на `event_genix`; екран Дару показував Park rows і MD branding/CTA. Це помилкова адресація вибраного бізнесу; server-side foreign-organization bypass цією перевіркою не стверджується. Reproducer: `d06_1789239219113_74dc2d` / `products-context-diagnostics.json` та `products-after-dar-switch.png`.

Мінімальний патч [js/programs-page.js](../../../js/programs-page.js) зберігає нормалізований context, бере label з профілю, показує нейтральний контент для Дару/custom і MD CTA тільки в MD. CSS `display:flex` перекривав лише атрибут `hidden`, тому для CTA додано page-local display; фактичну невидимість перевірено Chromium. Ціни, формули, renderer-контракти, shared auth/menu/router/theme не змінено. [tests/d06-products-context.test.js](../../../tests/d06-products-context.test.js): red 1/6 → green 6/6, плюс actual B12/B13. Реєстрація тесту — лише наявна коротка `test:unit:business-cabinets` у package.json.

Історичний `npm-test-final.log` exit255 зафіксував перевищення Windows shell command length після додавання тесту в довгу `test:unit` команду. Її відновлено точно до D05; тест перенесено в уже виконувану коротку групу. Повторний final2 baseline green. Lockfile/dependencies/version не змінювалися.

## Браузер, клавіатура та діагностика

[D06_BROWSER_REPORT.md](D06_BROWSER_REPORT.md) містить окремі результати owner/admin/member, останнього owner, default/active бізнесу, двох організацій, реальної зміни/відкликання membership зі старим JWT, cross-tab, refresh/back/forward, запізнілої відповіді та light/dark на 390/768/1440. Case-level спостереження збережено, а не замінено загальною оцінкою.

| Browser case | Status | Observed |
| --- | --- | --- |
| D06-B01-owner-cabinet-lifecycle | PASS | {"businessContext":"d06_browser_7892415255277d4a50","businessId":5,"modules":[],"secondInitializationCreated":0} |
| D06-B02-membership-editor | PASS | Actual access-profile confirms Park animator, Dar manager and explicit Dar default; editor save/close restores focus |
| D06-B03-admin-member-boundaries | PASS | Actual browser scenario completed |
| D06-B04-cross-tab-history | PASS | Two tabs retained Dar/animator after switch, reload and browser history |
| D06-B05-two-organizations | PASS | {"context":"d06_other","organizationId":2,"role":"manager"} |
| D06-B12-products-context | PASS | Actual products HTTP/PG response and visible cards changed context; reload retained only Dar marker |
| D06-B13-custom-products-history | PASS | {"context":"d06_other","title":"Products · D06 Other Business","label":"D06 Other Business","organizationId":2,"hash":""} |
| D06-B06-late-real-response | PASS | {"actualGetFromAppPostgres":true,"delayedOnlyInTransit":true,"deliveredHttpStatus":200,"requestFinished":true,"uiFramesAfterDelivery":2,"activeBusiness":"dar","staleDirectoryCount":0} |
| D06-B10-ui-change-same-jwt | PASS | {"sameOriginalJwt":true,"roleAfterUiSave":"animator","statusAfterMembershipDeactivation":403} |
| D06-B07-layout-390 | PASS | Native form focus order, visible actionable controls, canonical theme toggle and no document overflow |
| D06-B07-layout-768 | PASS | Native form focus order, visible actionable controls, canonical theme toggle and no document overflow |
| D06-B07-layout-1440 | PASS | Native form focus order, visible actionable controls, canonical theme toggle and no document overflow |
| D06-B08-business-deactivation | PASS | {"businessId":5,"contextKey":"d06_browser_7892415255277d4a50","status":"inactive"} |
| D06-B11-last-owner-editor | PASS | Actual UI write returned 409 and fresh management still reports the same owner |
| D06-B09-browser-diagnostics | FAIL | {"actualAppApiResponses":627,"http5xx":0,"pageErrors":0,"consoleErrors":136,"http4xx":26,"blockedExternal":110,"expectedHttpDenials":21,"unexpectedHttpErrors":5,"unclassifiedConsole":5,"unclassifiedExternal":0} |

На 390px початкова геометрична перевірка вкладки History потрапляла в канонічну 0.18s анімацію sheet. Після очікування природного положення focus/selected/видимість пройшли без scroll injection і без зміни `account-access-editor.js`. Історичний run `d06_1789240335521_4b0509` мав лише B06 screenshot timeout після тодішніх assertions; доказ не видалено. Фінальний B06 додатково чекає фактичного `requestfinished`, HTTP200 та двох animation frames перед перевіркою відсутності stale directory.

У діагностичному run `d06_1789241141249_542fd3` B02 відкрився через trusted click і HTTP200, але B10 потрапив у Dar timeline замість профілю. Source і screenshot/network встановили помилку precondition тесту: `newSession` повертався відразу після збереження акаунта, тоді як `login` ще чекав hydration і виконував штатний post-login redirect. B10 не дійшов до UI role writes. Harness тепер чекає фактичний AppState, завершення busy-submit і canonical runtime/permissions/shell або видимий business-selection gate. Login/auth/redirect runtime не змінено. Початкові B10 FAIL і B09 unclassified chat403 збережено; фінальний network classifier перевіряє фактичний код відмови для конкретного chat ingress, не приховує довільні403.

**D06-UI-01 / P2 / OPEN_UNCONFIRMED_ROOT_CAUSE.** У run `d06_1789240691369_eeb5a9` B02 не відкрив editor після pointer click: access-profile API-запит не був зафіксований, dialog wait15s завершився помилкою, залежний B10 став NOT_TESTABLE. URL `/profile?tab=settings&businessContext=event_genix`; owner → ID синтетичного акаунта10 → «Призначити доступ акаунту». Очікування — видимий canonical editor; фактично лишилась заповнена форма. Доказ: [failure screenshot](../../../output/playwright/sys-mb-d06/d06_1789240691369_eeb5a9/D06-B02-membership-editor-failure.png) і browser diagnostics цього run. Candidates: `js/business-membership-manager.js` openMember/mount, `js/profile-page.js` page readiness/remount, `tests/acceptance/sys-mb-browser-scenarios.cjs` goProfile/openMember. У фінальний діагностичний harness додано лише спостереження trusted pointer/click, readiness і реального HTTP, без retries/заміни handlers/нових ready-waits. Навіть успішний останній run не встановлює причину попереднього збою і не закриває цей ризик. Runtime editor/auth не змінювався за припущенням; потрібен окремий стабільний reproducer до патчу.

Фінальна браузерна діагностика: **FAIL**, 627 API responses, 0 HTTP5xx, 0 page exceptions, 136 console errors. Це не «нуль помилок»: 21 очікуваних denial responses, 110 заблокованих зовнішніх font/analytics requests; 5 некласифікованих HTTP errors, 5 console та 0 external events. Точні actor/context/method/path/status: [browser-diagnostics.json](../../../output/playwright/sys-mb-d06/d06_1789241525527_7d4a50/browser-diagnostics.json).

**D06-NET-01 / P2 / OPEN:** `POST /api/wallet/daily-login` повернув400 після штатного входу owner/admin/worker/worker-cross-tab. У proof збережено метод, actor, phase/status; response body цих400 не збирався. Candidates: `routes/wallet.js` daily-login та `js/auth.js` checkDailyLogin. Не стверджуємо конкретну причину або втрату балів без body/стабільного reproducer; reward/formula не змінювалися. **D06-NET-02 / P3 / OPEN:** `GET /api/chat/unread` для multiOrg повернув403 з фактичним `business_context_required`, коли request не мав контексту. Серверна відмова захисна; зайвий polling/error noise не закритий. Це інший код, ніж `chat_not_migrated`, тому його не приховано classifier-ом. Candidate — caller chat unread у shared shell + готовність business context; shared behavior в D06 не змінюється. Усі14 функціональних browser cases пройшли; B09 FAIL залишається окремим суворим diagnostic case, а не п'ятьма новими isolation exploits.

Безпечні синтетичні скриншоти: [Дар](../../../output/playwright/sys-mb-d06/d06_1789241525527_7d4a50/products-dar-only.png), [custom business](../../../output/playwright/sys-mb-d06/d06_1789241525527_7d4a50/products-custom-history.png), [390 light History](../../../output/playwright/sys-mb-d06/d06_1789241525527_7d4a50/membership-390-light-history-viewport.png), [768 cabinet](../../../output/playwright/sys-mb-d06/d06_1789241525527_7d4a50/cabinet-768-light-viewport.png), [1440 membership](../../../output/playwright/sys-mb-d06/d06_1789241525527_7d4a50/membership-1440-dark-viewport.png). У звітах і PNG немає реальних клієнтів або credentials. Канонічний темний компонент редактора збережено і в light theme; зовнішні шрифти були заблоковані.

## Access, denial, orphan та compatibility matrices

- [D06_SCENARIO_MATRIX.md](D06_SCENARIO_MATRIX.md): кожен фактичний case, expected/observed і PASS/FAIL/NOT_TESTABLE.
- [D06_ACCESS_MATRIX.md](D06_ACCESS_MATRIX.md): реальні effective roles/профілі та 339 API receipts.
- [D06_DENIAL_MATRIX.md](D06_DENIAL_MATRIX.md): очікувані відмови та неприйнятні HTTP200; невидимий модуль не вважається API guard.
- [D06_ORPHAN_CONFLICT_MATRIX.md](D06_ORPHAN_CONFLICT_MATRIX.md): read-only before/after, 24 declared tables, 20 edges, 2 membership metrics, completeness та detector sensitivity. Dedicated unknown owner і cross-context sentinel дали точну delta1; жодного нового bad link після звичайних сценаріїв у перевірених edges. NULL product owner відхилено 23502 на `business_context`, missing parent — 23503; читання неможливого стану лишено NOT_TESTABLE, constraints не послаблювалися.
- [D06_COMPATIBILITY_MATRIX.md](D06_COMPATIBILITY_MATRIX.md): спостережено synthetic membership/MD compatibility traffic. Повні ingress/job/provider лічильники та реальне вікно спостереження відсутні: **NOT_TESTABLE**, не zero usage. CRM profile не вправлявся. Обидва наступні бізнеси залишаються NOT_MIGRATED.
- [D06_MATRICES.json](D06_MATRICES.json): ті самі raw cases для машинного порівняння.

## Залишкові блокери та рішення

| Проблема | Доведено | Severity / наступний scope |
| --- | --- | --- |
| Contractors/procurement | 14 FAIL: unassigned lists + foreign stock через direct/procurement order-context | P1. routes/contractors.js, routes/procurement.js; precise reproducer у D06_API_REPORT. Перед router-wide guard відокремити provider handlers. |
| Staff / certificates / Art | 6 FAIL: Dar та інша організація читають independent unowned sentinels | P1. D05 protected contracts + D06_READINESS_REPORT; exact containment/ownership scope, не ownership за role. |
| Payroll settlement | 2 FAIL: HTTP200 на unsupported membership входах; amount disclosure не доведено | P1 containment blocker. Не змінювати зарплатні правила/формули й не відкривати доступ за здогадкою. |
| Generic booking linkedTo | Попередній actual D04 reproducer, захищений fix не виконано; не D06 PASS | BLOCKED_PROTECTED_CHANGE. LINKEDTO_PROTECTED_SCOPE.md, потім окремий actual-app regression. |
| Історичні catalogs/templates/recurring/assets/jobs | OWN-01–08 PENDING, real mapping UNPOPULATED; Task4 BLOCKED | Погоджене read-only джерело, mapping і public/private policy до durable migration. |
| Compatibility / MD / CRM / jobs/providers | Виміряна локальна частина не доводить повноту чи нуль usage | NOT_TESTABLE/NOT_MIGRATED. Повна telemetry й окремі cutover-и. |

Парк/Дар і custom business мають HOLD через виміряні залишкові поверхні. MD/CRM не завершені як membership cutover; global model — false. Точні file candidates, protected межі, task ownership та мінімальні наступні патчі: [D06_REVIEW_SCOPE.md](D06_REVIEW_SCOPE.md). Незалежний продуктовий дефект виправлено; захищені прогалини не обійдено й не замасковано зміною очікувань тесту.

Додатковий борг: поза стандартним npm baseline `tests/products-demo-flow.test.js` має старий cached-catalog fixture drift — 32 PASS/1 FAIL у ширшому affected sweep; той самий case падає на збереженому D05 (10 PASS/1 FAIL). Фікстура не задає matching context cache key. Це не зелений broader sweep. Окремо server.log фіксує відсутню `title_definitions` у fresh DB quest path; D06 не додавав вигадану DDL і не прирівнював background log до browser HTTP500.

## Передача далі

Задача 6 завершена як локальне приймання з явними блокерами; задача 7 **BLOCKED_BY_D06_FINDINGS**. Наступна дія — review та найменший конкретно дозволений containment пакет для доведених глобальних читань, паралельно рішення власників/linkedTo/telemetry; після змін повторити цей harness і перевірити нові hashes. Не починати production release з цього HOLD checkpoint.

Для майбутньої задачі 7 у [D06_READINESS_REPORT.md](D06_READINESS_REPORT.md) підготовлено точний **пропонований** envelope: 11 access/lifecycle entities + 12 operational fixtures, максимум 24 години, cleanup тільки повернених run-scoped IDs, нуль нових bookings/finance/payroll/Art/provider objects. Це не активний дозвіл і не автоматична TTL-служба; мінімальний envelope не сертифікує непокриті live booking/graduation-write/finance/другу production-організацію. Потрібні поточний release manifest, exact SHA/CI/deploy та окрема live evidence.

Команда повторного локального acceptance (наявні Node22, WSL PostgreSQL і локальний Chromium):

```powershell
wsl -d Ubuntu -u postgres -- env SYS_MB_D06_LOCAL=true node '/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-auth-p0-20260912/tests/acceptance/run-sys-mb-local.cjs'
```

Exit0 harness означає, що збір і cleanup завершилися, **не** що всі cases пройшли. Рішення визначається записами result.json та matrices.
