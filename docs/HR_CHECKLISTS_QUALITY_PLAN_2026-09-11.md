# HR → Checklists: перевірка й план доробок

## Оновлення після дозволу «ок дороблюй»

HR-доробки реалізовано локально на базі `2b6a51d31` із збереженням попередніх правок. Чинний звіт: [HR_CHECKLISTS_IMPLEMENTATION_2026-09-11.md](HR_CHECKLISTS_IMPLEMENTATION_2026-09-11.md).

| Задача | Чинний статус |
|---|---|
| CHK-R01 | DONE LOCAL: примітки, HR/Training/alias, явне очищення, archived/orphaned search, integer overflow — перевірено на PostgreSQL |
| CHK-R02 | DONE LOCAL: незалежні сторінки, debounce, retry, stale response, оновлення каталогу; browser 0/1/199/200/201/401, actual DB 201 |
| CHK-R03 | DONE LOCAL: native pending, пояснення lock, окремі чернетки, A→B→A, focus і duplicate guards |
| CHK-R04 | IMPLEMENTED / AUTOMATED QA PASS: keyboard, dialogs, focus; ручний screen-reader pass ще не виконаний |
| CHK-R05 | PREPARED: npm scripts, чинні CI jobs/artifacts, виправлений metadata endpoint; remote CI ще не запускався |
| CHK-R06 | LOCAL REGRESSION PASS: база оновлена без втрати правок; commit/push/deploy/live QA цього блоку не виконувалися |
| SYS-R01 | BLOCKED / OUT OF SCOPE: Wallet не змінено; потрібна окрема задача й точний дозвіл на цей захищений напрям |

Дозвіл на HR-план покриває описані локальні service/UI/CI-code доробки. Нижче збережено **початковий аудит до реалізації**: його OPEN/BLOCKED формулювання й попередні кількості тестів є історичними, а не поточним статусом. Нова перевірка: 52/52 browser assertions, PostgreSQL PASS без checklist findings, `npm test` PASS.

## Початковий аудит і вихідний план

Дата: 11.09.2026. База: `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`, v0.81.96. Гілка: `codex/hr-checklists-quality-20260911`; окремий worktree `.codex-temp/hr-checklists-quality-20260911`. Попередній CHK реліз уже міститься в цій базі. Production impact: no — цей аудит і нові виправлення локальні, не випущені.

Мета поточного запиту — перевірити розділ, виправити безпечні локальні дефекти й підготувати конкретні задачі. Перевірено Checklists, професійний workspace, пов'язаний staff-card → Training/readiness, доступ і тестову інфраструктуру. Це не повний аудит усіх модулів CRM. Дефекти відділені від неперевірених гіпотез; знайдені проблеми не приховуються за успішним exit code аудиторського скрипта.

## Що виправлено локально

| ID | До виправлення / причина | Рішення / доказ |
|---|---|---|
| FIX-01 · Перехід до працівника | Checklist button передавав staff ID у `openStaffProfile()`, який трактує число як user ID і відкриває `/profile?id=…`. Реальний browser flow не відкривав HR-картку | Виклик існуючого `openStaffEdit(staffId, { focus: 'training' })` у checklist handler. Повний click-шлях через правильну HR-картку проходить у двох темах; auth і routes не змінені |
| FIX-02 · Запізніла очистка поля | POST додавання в A → close → B → чернетка B → відповідь A стирала B input і забирала фокус | Post-await effects виконуються лише для того самого відкриття workspace й незміненого submitted input. Chromium підтвердив збереження draft/focus B в обох темах; mutex і API не змінені |
| FIX-03 · Readonly виконання | Security мав активні completion buttons, click викликав PUT, а сервер відповідав 403 | Чинний `hr.staff.manage` застосовано до disabled renderer і early guard handler. Справжній security у двох темах має disabled controls; серверні 403 й незмінність БД перевірено окремо |
| FIX-04 · Перекритий readiness dialog | Staff card з `--z-modal` перекривав readiness overlay із z-index 10000: пункт і Close не натискалися | Локальний `openStaffTrainingReadiness()` використовує наявний `ModalLayer.ensureTopLayer`. Повний шлях і натискання проходять у двох темах, нового глобального z-index правила немає |
| TEST-01 · Недостовірний baseline після commit | `--baseline` читав CSS із поточного HEAD і після релізу переставав бути станом «до» | Тепер потрібен `--baseline-ref <commit SHA>`. Results містять повний CSS baseline SHA, поточний HEAD і позначку, що HTML/JS — current working tree. Старі знімки не затверджуються автоматично |

Продуктовий файл — тільки `js/hr-page.js`: чотири локальні виправлення через чинні helpers. Немає змін CSS/global theme, меню, route definitions, auth/permission registry, БД/міграцій, API-контрактів, бізнес-правил, залежностей, CI або version markers. Додано/розширено тести, цей звіт і ignored evidence. Чужі робочі копії не чіпалися; commit/push/merge/deploy цього продовження не виконувалися.

## Фактичні перевірки

| Перевірка | Результат і межа доказу |
|---|---|
| Node/npm | PASS: Node 22.23.1 / npm 10.9.8 |
| Повний `npm test` | PASS, exit 0; зокрема 2627 unit, 334 My Day, 1312 UI checks. Лог `output/hr-checklists-quality/full-npm-test.log`; це локальний baseline, не новий CI |
| Дані/HR contracts | 57/57 PASS; permission/registry/bootstrap contracts 61/61 PASS. Перетин suites можливий, кількості не підсумовувати |
| Статична executable матриця доступу | 26 ролей + 10 boundary/override cases × 10 route decisions = 360 PASS. Це policy/route probe, не 360 браузерних сесій |
| Theme HTML-shell browser | PASS: дві теми, loading/error/empty/readonly, control states, 32 items, long text, widths 1440/1200/1101/1024/768/720/390 |
| Native browser zoom | PASS: 100/125/150/200% × 2 теми; Chromium, тимчасовий profile, без глобального browser settings change |
| Baseline capture | PASS з явним `2f225268a85306ef66808fcaf9af84d7daa09cdb`; це CSS comparison, не повний історичний застосунок. Запуск без ref правильно відхилено до browser startup |
| Async/keyboard audit | 13 сценаріїв × 2 теми. Після FIX-02: 8 PASS observations / 18 DEFECT observations, тобто 9 відкритих унікальних проблем. Вісім обов'язкових assertions FIX-02/duplicate/refresh/retry — PASS, uncaught errors = 0 |
| Login form | Справжній browser submit username/password до локального Express — PASS; creator browser session не підмінена через init script |
| UI → Express → PostgreSQL | Дві теми: add, rename Enter, reorder, archive/cancel, reload/SQL read-back; Back/Forward; staff card → Training → readiness → completion → reload. Додатковий цикл 50% → 100% → 50% → 0% → 50% через кнопки UI: кожний стан підтверджений API filter/summary і SQL. Після FIX-01/FIX-04 — PASS; uncaught page errors = 0 |
| Серверні фільтри | PASS: profession, search staff name, staff ID, department, комбіновані filters, відсутня пара profession/staff, порожній completed, in-progress після toggle. Рядки/лічильники звірені з окремими QA fixtures |
| Справжній доступ | Admin, security, waiter, security explicit action deny. 12 прямих GET; admin same-title rename; 18 заборонених writes і ще 5 у попередній security-перевірці — очікувані 403, snapshots БД незмінні. Обидві теми; no-view URL/tab denied; readonly completion disabled |
| Межа 200/201 та пошук історії | Серверна pagination PASS: 201 запис → 200 + 1, 201 унікальний assignment; offset 201 повертає 0. UI pagination відсутня, браузерного переходу між сторінками немає. Archived department filter: 1 запис, text search: 0; archive зберігає completion/notes |
| CI / deploy / live | NOT_RUN у цьому продовженні. Попередній реліз не є доказом цих нових локальних правок |

PostgreSQL 16.15 щоразу запускався як новий loopback кластер із випадковим паролем; чинний isolated runner виконував migrations лише у власній новій БД. Providers/outbound side effects утримувалися; зовнішні browser requests заблоковано. Test passwords/DB URLs не потрапляють до звіту. Після кожної спроби PostgreSQL штатно зупинений. Є штатні migration seeds із іменами — це нова локальна БД, не копія production.

Початкові невдалі browser спроби виявили FIX-01 і FIX-04. Очікування PUT без обробки одночасної помилки click виправлено в тесті через `Promise.all`. Guard scale helper виправлено з `inet_server_addr()::text` на `host(inet_server_addr())`, щоб порівнювати адресу без маски `/32`; перевірки loopback/disposable лишилися. Sandbox `spawn EPERM` і cached Playwright resolution відділені від продуктових помилок; залежностей не встановлювали.

## Відкриті проблеми та межі впевненості

| ID / пріоритет | Спостереження | Доказ / статус | Задача |
|---|---|---|---|
| Q01 · P1 | Toggle без поля notes стирає наявну примітку | Service probe й справжній checkbox → PUT → SQL: QA note стає null у двох темах. `services/professionChecklists.js`, `toggleStaffProfessionChecklistProgress()` | CHK-R01 |
| Q02 · P2 | Після 200 записів dashboard не показує весь результат і не повідомляє про обмеження | Actual renderer при total201/returned200 не має offset/next; backend має independent-feed pagination. `professionChecklistDashboardQuery()`, `renderProfessionChecklists()` | CHK-R02 |
| Q03 · P2 | Search department text і department filter мають різну семантику для archived | PostgreSQL: filter знаходить 1 archived запис, search — 0. У SQL archived/orphaned search fields не включають department; runtime orphaned ще не перевірено. Очікування семантики уточнити до зміни | CHK-R01 |
| Q04 · P2 | Запит на кожну введену літеру | Browser input listener без debounce; service probe — 7 SQL на unfiltered request, 5 на status-specific. Це кількість запитів, не виміряна latency або доказ production перевантаження | CHK-R02 |
| Q05 · P2 | Pending блокує mouse через CSS, але keyboard draft доступний і губиться після redraw | Controlled pending rename, Chromium у двох темах; захист від повторного HTTP write працює | CHK-R03 |
| Q06 · P2 | A pending → B успадковує заблокований editor без пояснення | Глобальний mutex лишається активним, status очищений. Додавати паралельні writes для усунення симптому не потрібно | CHK-R03 |
| Q07 · P2 | Чернетка нового пункту переходить з A у B | Shared input не має ownership/reset при відкритті; FIX-02 виправляє пізню очистку, але не цей незалежний сценарій | CHK-R03 |
| Q08 · P2 | Escape у confirm закриває також workspace | Два document Escape handlers; мутації немає | CHK-R04 |
| Q09 · P2 | Rename втрачає keyboard focus | Row innerHTML замінено, activeElement стає BODY | CHK-R04 |
| Q10 · P2 | Workspace dialog не встановлює початковий focus і не утримує Tab/Shift+Tab | Реальні role=dialog/aria-modal, browser focus виходить у background | CHK-R04 |
| Q11 · P2 | Неактивні workspace tabs недоступні клавіатурою | Role=tab/tablist, tabindex=-1 без Arrow/Home/End handler | CHK-R04 |
| Q12 · P2 · shared | Confirmation не утримує focus | Tab з OK переходить на BODY; `js/ui.js` — спільна область, не редагувалася | CHK-R04 |
| Q13 · P2 | Нові browser scripts не виконуються поточним CI | Немає їхнього підключення у package scripts/workflow. Local green не означає CI coverage | CHK-R05 |
| Q14 · P3 | Registry metadata містить застарілий API consumer | `/api/hr/profession-checklists` замість чинного dashboard endpoint; runtime auth не обходиться | CHK-R05 |
| Q15 · P2 · поза HR | Wallet daily-login падає на NOT NULL username | Відтворено при локальному login; `routes/wallet.js:98` INSERT не передає username, хоча auth payload його має. Production прояв не перевірено | SYS-R01 |

Неперевірене не названо багом: всі можливі permission combinations; literal `%`/`_` у search; staffId поза PostgreSQL integer; inactive/freelance/reserve видимість; orphaned history department search; реальна performance під навантаженням; усі browser engines, screen-reader output; всі shared modal consumers. Вибірка стандартних filters і representative access пройшла, повне доведення всіх комбінацій не заявляється.

Незалежні page/action grants є чинним контрактом. Наприклад, посилання на HR може лишатися видимим при забороненій конкретній вкладці; це окреме UX питання, не доведений auth-bypass. Багаторядковий editor, drag-and-drop, нові статуси та нова мобільна CRM не потрібні для виправлення знайденого.

## Задачі для доробки — рекомендований порядок

### CHK-R01 · P1 · Збереження приміток і однакова семантика історії

**Мета:** прибрати втрату даних Q01 та узгодити Q03 після визначення очікуваного пошуку.

**Scope:** canonical checklist service, його наявні routes/contracts/tests; жодної нової схеми чи міграції за замовчуванням. **Кроки:** зафіксувати regression note → toggle без notes; відрізнити omitted notes від явного очищення; перевірити HR readiness і Training callers. Зіставити search fields для active/archived/orphaned feeds; окремо перевірити `%`, `_`, invalid staff ID та поточну семантику inactive/freelance/reserve.

**Оптимальне рішення:** зберігати наявні notes в canonical service, коли поле відсутнє. Передавання старої примітки з кожного frontend caller дублює відповідальність і може перезаписати новішу примітку. Для search використати однаковий погоджений набір полів у чинних запитах; не додавати новий search service.

**Done when:** omitted notes збережені; explicit clearing працює лише за погодженим контрактом; toggle/archive/reorder не втрачають історію; GET/SQL read-back і два UI callers підтверджені; invalid input не створює 500; доступ незмінний. **Live-site QA:** після окремо дозволеної доставки — read-only перевірка; mutation regression на disposable БД. **Межі/ризики:** зміна серверної семантики/API або бізнес-правил поза поточним локальним UI-патчем — BLOCKED для реалізації до окремого дозволу на цей блок.

### CHK-R02 · P2 · Повний список і бюджет пошукових запитів

**Мета:** усунути Q02/Q04 без завантаження необмеженої кількості записів.

**Scope:** checklist dashboard UI + поточний pagination contract. **Кроки:** додати керування наявними independent feeds pagination й видимий returned/total; скидати cursor/offset при зміні filters; зберегти request sequence guard. Застосувати невеликий debounce до search, негайне оновлення при Enter/select і коректне скидання pending timer. Виміряти request count, SQL count і latency на власних fixtures до/після.

**Оптимальне рішення:** використати вже наявний offset/limit і окремі totals feeds. Просто підняти серверний limit або завантажити все — приховає симптом і збільшить роботу БД. Нові індекси пропонувати тільки після query plan/вимірювання, не припускати їхню необхідність.

**Done when:** 0/1/199/200/201/401 записів доступні без пропусків/дублів, search/filter reset повертає правильний початок, summary відповідає погодженій семантиці, швидкий набір не створює запит на кожну літеру, error/retry не видає неповний список за повний. **Live-site QA:** read-only після релізу. **Межі/ризики:** це окрема UI-доробка до існуючого API, не частина завершеного theme patch; DB/contract changes не робити без окремої підстави.

### CHK-R03 · P2 · Чернетки та очікування збереження

**Мета:** Q05–Q07; FIX-02 лишити захищеним regression-тестом.

**Scope:** локальний checklist state/rendering; поточна серіалізація writes. **Кроки:** зробити pending стан однаковим для mouse і keyboard через native control state з точним відновленням наявних disabled/readonly; показати очікування, якщо відкритий B успадкував чинний global lock. Визначити ownership поля нового пункту: мінімальний варіант — очищення при новій професії з явною політикою незбереженого вводу; зберігання draft по професіях лише якщо воно справді потрібне продукту.

**Оптимальне рішення:** зберегти один write mutex і виправити представлення стану. Abort/retry сам по собі не доводить, що сервер не завершив запис; нова паралельна write-архітектура тут зайва.

**Done when:** A→same/A→B/A→B→A, success/error/retry, повільний save, Enter/double click, changed draft, close/reopen — без втрати вводу, прихованого lock, чужого focus або duplicate writes; збережені значення перевірені через reload. **Live-site QA:** затримки/помилки створювати тільки локально. **Межі/ризики:** поведінку незбережених draft погодити як частину задачі; API, access і request concurrency не змінювати автоматично.

### CHK-R04 · P2 · Клавіатура й вкладені діалоги

**Мета:** Q08–Q12 і повна keyboard-регресія FIX-04.

**Scope:** спочатку локальний profession workspace/readiness; спільний confirm — окремий підкрок у цій задачі. **Кроки:** використати існуючий modal lifecycle для initial focus, trap, restore і topmost Escape; зберегти checklist key для focus після redraw; додати чинний tab keyboard pattern Arrow/Home/End. Для shared confirm пройти representative callers перед зміною `js/ui.js`.

**Оптимальне рішення:** доповнити використання наявних `openModal`/`closeModal`/`ModalLayer`, а не створювати другий global manager або набір великих z-index. Не змінювати поведінку збереження через keyboard patch.

**Done when:** dialog focus не потрапляє в background; Escape закриває тільки верхній шар; усі tabs доступні клавіатурою; focus після rename/archive/close має логічну ціль; two themes, 1101 px і 100–200% zoom проходять. Screen-reader check виконаний і задокументований. **Live-site QA:** read-only keyboard pass після дозволеного релізу. **Межі/ризики:** shared modal behavior поза локальним CHK scope; перед правкою назвати affected callers і окремо погодити спільний підкрок.

### CHK-R05 · P2 · Автоматичні тести та доступ

**Мета:** Q13/Q14; зробити локальні докази відтворюваними й не втратити FIX-01–FIX-04.

**Scope:** наявний browser/isolated test stack, репозиторні docs; CI wiring тільки окремо дозволеним кроком. **Кроки:** включити два тематичні smokes і focused async assertions у чинний job; окремо позначити diagnostic findings, які ще не є passing acceptance. Прив'язати results до SHA/версій runtime/browser і зберігати screenshots як artifacts. Перевірити чистий checkout без персонального cached runtime. Звірити registry metadata з реальними endpoints, не змінюючи дозволи. Зберегти representative admin/security/no-page/explicit-deny tests і прямі API запити.

**Оптимальне рішення:** використати існуючі PostgreSQL runner, guard, Playwright і jobs; не заводити новий framework або CI-сервіс. TEST-01 вже усуває implicit HEAD baseline; лишилося підключення й перевірка перенесення.

**Done when:** чисте середовище запускає задокументовані команди; exact-SHA CI реально виконує відповідні smokes; permissions parity і rejected-write snapshots проходять; baseline має явний SHA; artifacts доступні рев’юеру. **Live-site QA:** цей блок не потребує production writes. **Межі/ризики:** CI settings/dependencies і permission registry — захищені області; зміни дозволів не включати в metadata cleanup.

### CHK-R06 · P1 перед доставкою · Остаточна інтеграційна регресія

**Мета:** доставити лише погоджені виправлення й повторити результати на точній інтеграційній базі.

**Scope:** review поточного локального diff і результатів CHK-R01–R05 у міру їхньої готовності. **Кроки:** звірити branch/live SHA, паралельні HR hunks, API/schema scope; прогнати базовий тест, actual staff-card flow, дві теми, filters, readonly і масштаб. Під час дозволеної доставки виконати окремий version/cache commit, exact-SHA CI, штатний deploy helper і read-only live proof. Усі незакриті findings явно залишити у release notes/plan.

**Done when:** кожний випущений fix має baseline і after evidence, чужі зміни збережені, live assets/metadata збігаються з SHA, scope й rollback зрозумілі. **Live-site QA:** read-only тестовим акаунтом; запис — тільки в окремо дозволених registry-owned QA fixtures, якщо потрібний. **Межі/ризики:** попередній завершений дозвіл на v0.81.95 не запускає deploy цього аудиту. Не змішувати дрібний UI fix із непогодженими backend/shared changes.

Під час аудиту `origin/codex/eventgenix-production` продовжувала рухатися: контрольний snapshot — `4ec3f0c12f45cb64df2d9fc5b853a325c0701d73`, чотири коміти після нашої бази (Omni v0.81.97 і PARK/DAR v0.81.98). Між цими двома SHA `js/hr-page.js`, `css/hr-page.css` і два змінені browser smokes не відрізняються, але є зміни спільних shell CSS і `hr.html`. Чотири fixes не переносилися поверх чужої активної роботи. Перед інтеграцією заново звірити branch/live SHA і повторити theme/browser checks на новій базі; локальний PASS на `a52725f…` не доводить стан майбутнього merge чи production.

### SYS-R01 · P2 · Окрема передача Wallet daily-login

**Мета:** класифікувати й усунути Q15 поза HR без розширення цієї задачі.

**Scope:** окремий власник Wallet, його writer/schema contract і regression. **Кроки:** на disposable БД увійти користувачем із валідним username, викликати daily-login, перевірити ledger/balance; повторити без дубля й перевірити rollback при помилці. Порівняти runtime INSERT із чинною schema; starter bonus із подібним INSERT поки лише гіпотеза.

**Оптимальне рішення:** спочатку виправити підтверджену неузгодженість writer/schema; не послаблювати NOT NULL і не підставляти довільний username. **Done when:** успішна транзакція, idempotent repeat та failure rollback доведені. **Live-site QA:** production баланс не змінювати для тесту. **Межі/ризики:** поза розділом; фінансові/балансові правила й schema потребують окремого дозволу. У цьому worktree Wallet не змінено.

Рекомендований порядок: спочатку рев’ю чотирьох готових UI fixes; далі CHK-R01 (дані), CHK-R03 (чернетки), CHK-R04 (keyboard), CHK-R02 (обсяг/запити), CHK-R05 (CI), CHK-R06 (доставка). SYS-R01 передати окремому власнику. Це шість HR-задач і одна окрема системна знахідка, а не новий план перебудови CRM.

## Команди й артефакти

Перед запуском — Node 22/npm 10 і `npm run check:runtime`. Для Playwright використовувався вже наявний package/browser; персональні runtime paths не є залежностями продукту. Команди `node` нижче потребують доступного Playwright. Точна підготовка PATH для цього локального прогону в PowerShell (на іншій машині ці cache paths не переносити; portable setup входить у CHK-R05):

```powershell
$chkPlaywrightBin = 'C:\Users\Plotva\AppData\Local\npm-cache\_npx\0a39fd6751d7cf55\node_modules\.bin'
$chkRuntimeBin = 'C:\Users\Plotva\.local\eventgenix-node22-runtime\shims'
if (!(Test-Path -LiteralPath $chkPlaywrightBin)) { throw 'The verified local Playwright cache is unavailable' }
$env:PATH = "$chkRuntimeBin;$chkPlaywrightBin;" + $env:PATH
```

```text
npm test
node tests/browser/hr-checklists-theme-browser-smoke.js --shell
node tests/browser/hr-checklists-theme-browser-smoke.js --native-zoom
node tests/browser/hr-checklists-theme-browser-smoke.js --baseline --baseline-ref 2f225268a85306ef66808fcaf9af84d7daa09cdb --shell
node tests/browser/hr-checklists-async-browser-smoke.js --verify-local-fixes
node tests/browser/hr-checklists-postgres-browser-smoke.js --isolated
```

Остання команда вимагає власного loopback `TEST_DATABASE_URL` і `TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE`; runner очищує тільки свою disposable БД. Не підставляти спільний або production URL. Реальний локальний launcher: `output/hr-checklists-postgres-runtime/run-checklists.ps1`; логи прогонів — `run-accepted-audit.log` та `run-state-cycle-audit.log`.

Докази: `output/hr-checklists-quality/{async,access,data}/`, `output/playwright/hr-checklists/{postgres,after-shell,after-shell-zoom,before-shell}/`. Async `results-baseline.json`/`results-after.json` відокремлені. `postgres/results.json` містить findings окремо від passing scenario results; `COMPLETED_WITH_FINDINGS` не означає, що відкриті проблеми виправлені. Product diff: `output/hr-checklists-quality/product.patch`; повний diff разом із новими тестами й планом: `full.patch`; SHA-256 manifest: `artifacts-manifest.json` у тому самому каталозі. Вони зберігаються лише в ignored output і не містять секретів. Знімки `completion-reloaded-dark.png` / `completion-reloaded-light.png` візуально переглянуто; старі `failure.png` / `nested-readiness-light.png` не включені до manifest завершального прогону.
