# Дашборд: швидкий фікс видимості та план завершення

Дата: 2026-09-12.

## Межі перевірки

- Актуальна база: `origin/codex/eventgenix-production`, SHA `a5180def01a1e47f8f4fc75e2f7a43092f205828`, версія `0.81.132`.
- Робоча гілка: `codex/dashboard-visibility-20260912`, ізольований worktree `.worktrees/dashboard-visibility-20260912`.
- Основний checkout відстає на 251 коміт, має власний коміт і сторонні незбережені зміни. Висновки нижче перевірені на актуальній базі, а не лише на старому checkout.
- Перевірено код дошки, збереження конфігурації, завантаження віджетів і локальне відтворення autosave. Production-запитів та перевірки реальних даних у цьому аудиті не було.
- Локально реалізовано швидкий фікс: кнопка переходу «Дашборд» справа у спільній верхній панелі. На мобільному екрані вона показує іконку з доступною назвою. Повна висувна панель не входить до цього мінімального фіксу. Зміни ще не опубліковані.

## Короткий bug report

**Симптом зі слів користувача:** дашборд недороблений, його не всюди видно та потрібне відображення праворуч.

**Очікувана поведінка:** стабільний доступ із дозволених CRM-сторінок, зрозумілий вміст і стан завантаження, збереження останніх змін, актуальні операційні віджети.

**Причина видимості:** `Sidebar.render()` пропускає групу `today` через `__skip_today__`, а саме до неї належить `/dashboard`. Посилання залишається у згорнутому меню або налаштованому обраному. Новий спільний елемент не залежить від цих станів меню та використовує ті самі перевірки доступу.

**Підтверджена додаткова проблема:** зміни дошки під час повільного autosave можуть втрачатися. Нижче наведено точний сценарій і решту ризиків із коду.

## Пріоритетні знахідки

Номери рядків відповідають базовому SHA до поточного фіксу.

| Пріоритет | Знахідка та вплив | Доказ | Статус перевірки |
|---|---|---|---|
| P1 | Відповідь старого autosave може стерти нові редагування. Користувач бачить «Збережено», хоча остання зміна вже втрачена. | `js/dashboard-page.js:1062` замінює всю `_config`; `:1086` очищує dirty, `:1090` видаляє чернетку без перевірки версії редагування. | Відтворено локально на функціях актуального коду; не live. |
| P1 | Після помилки читання конфігурації показується стандартна дошка, доступна для редагування. Наступне збереження може замінити попередню персональну дошку. | `js/dashboard-page.js:1408`–`:1412` підставляє defaults; `:1025` надсилає повний стан; `routes/dashboard.js:411`–`:415` безумовно оновлює layout. | Статично підтверджений ризик; сценарій із PostgreSQL не запускався. |
| P1 | «Не зараз» при відновленні чернетки фактично видаляє її. Користувач не може повернутися до відкладеного відновлення. | `js/dashboard-page.js:1005`–`:1012`: `cancelText: 'Не зараз'`, після відмови — `localStorage.removeItem`. | Підтверджено читанням коду; браузерне відтворення не виконувалось. |
| P2 | Кеш завантажених віджетів не має терміну актуальності. Бронювання, команда й алерти можуть лишатися старими до ручного refresh або перезавантаження. | `js/dashboard-page.js:5998`–`:6012` повертає кеш без часу; слухач `crm:tasks-updated` є в `:8807`, але підписки на `crm:alerts-updated` немає. Подію алертів публікує `js/alerts.js:97`. | Підтверджено кодом актуальної бази; тривалу браузерну сесію не перевірено. |
| P2 | Аварійний режим дошки залишає лише повідомлення, хоча вже існує плоска сітка віджетів. Окремі віджети показують загальну помилку без пояснення причини й локального retry. | `js/dashboard-page.js:1346`–`:1361` приховує grid і пропонує desktop; `:3311` містить `renderFlatWidgetGrid`; `:6034`–`:6042` зводить збої до загального тексту. | Підтверджено кодом; ризик пристроїв потребує реального браузера. |

### Локальне відтворення autosave

Використано Node `22.23.1` / npm `10.9.8`. У VM виконано без змін тіла `saveDashboardConfig` та `saveBoardNow` з актуального worktree; транспорт і допоміжні нормалізатори ізольовано від сервера. Файли коду й дані не змінювалися.

1. Дошка містить текст `A`; запускається save із затриманою відповіддю.
2. Поки запит очікує, користувач змінює текст на `B`; нова локальна чернетка містить `B`.
3. Приходить успішна відповідь для `A`.
4. Фактичний результат: `currentText="A"`, `dirty=false`, `draft=null`, `status="saved"`.

Це підтверджує втрату локального редагування. Поведінка двох вкладок окремо не відтворювалася; поточний API також не містить перевірки конфлікту версій.

## План: 4 практичні картки

### 1. Зробити доступ до дашборда стабільним праворуч

**Goal:** дашборд легко знайти на всіх сторінках, де користувач уже має право його відкривати.

**Scope:** `js/components/sidebar.js`, `css/sidebar-aurora-rail.css`. Локальний фікс кнопки виконаний; для наступного етапу залишається доставка та live-site QA. Обидва спільні ресурси підключені на тих самих 38 CRM HTML-сторінках.

**Steps:** єдине посилання створюється через спільний Sidebar, праворуч у sticky header; повторний render оновлює його без дублів; приховування на екрані входу та чинні обмеження ролі/бізнесу збережено. Перевірити точний release SHA після майбутньої доставки.

**Done when:** на вибірці основних дозволених сторінок елемент видимий і працює; він не перекриває основні дії та не дублюється. Перевірено desktop, tablet і mobile.

**Live-site QA:** після окремо авторизованої доставки перевірити дашборд, задачі, профіль, клієнтів і таймлайн тестовим акаунтом; лише переходи та читання. Зберегти скриншоти фактичного розміщення.

**Notes/Risks:** не розширювати ролі або доступ до сторінок. «Скрізь» стосується дозволених CRM-екранів. Production impact: yes — після доставки зміна зачіпає спільний UI.

### 2. Захистити персональну дошку від втрати змін

**Goal:** повільна мережа, повторні save та відкладене відновлення не знищують останню роботу користувача.

**Scope:** `js/dashboard-page.js`, сфокусовані тести збереження; `routes/dashboard.js` лише якщо буде обраний захист конфліктів між вкладками.

**Steps:** додати послідовну чергу save і номер локальної редакції; очищати dirty/draft лише для підтвердженої редакції; не замінювати новіші локальні зміни старою відповіддю; після помилки початкового GET показати явний retry і блокувати перезапис невідомого серверного стану; залишати чернетку після «Не зараз», окремо запропонувати її явне видалення.

**Done when:** проходять сценарії A→B під час save, зміни під час другого запиту, failed GET→edit, failed PUT→retry та «Не зараз»→reload. Остання редакція відновлюється після перезавантаження, статус збереження відповідає фактам.

**Live-site QA:** лише на тестовій персональній дошці; затримати мережу, змінити нотатку під час збереження, перезавантажити та звірити результат. Жодних бізнес-записів клієнтів.

**Notes/Risks:** спочатку достатньо вузького фронтенд-виправлення. Схема БД не потрібна для захисту змін в одній вкладці. Якщо захист між вкладками вимагатиме зміни схеми або міграції, винести її на окреме явне погодження. Production impact: yes — змінюється збереження персонального стану.

### 3. Зробити актуальність і помилки віджетів зрозумілими

**Goal:** користувач бачить актуальні операційні дані та розуміє, коли їх не вдалося оновити.

**Scope:** завантаження й кеш віджетів у `js/dashboard-page.js`, наявні CRM-події, відображення станів і тести бюджету запитів.

**Steps:** зберегти об'єднання однакових одночасних запитів; додати обмежений час актуальності й оновлення при поверненні до активної вкладки; реагувати на доступні події алертів і задач; показувати час останнього оновлення; відрізняти порожній результат, відсутність доступу та мережевий збій; додати retry для конкретного віджета.

**Done when:** зміни відображаються в усіх екземплярах відповідного віджета; кеш із попереднього користувача чи бізнес-контексту не показується; повторне малювання дошки не створює потік зайвих запитів; HTTP-помилка не видається за відсутність даних.

**Live-site QA:** тестовий акаунт, читання віджетів і ручне оновлення; порівняти алерти й задачі з їхніми канонічними екранами, перевірити повернення до вкладки та стан офлайн.

**Notes/Risks:** частоту оновлення обмежити за видимістю вкладки та типом віджета. API права, джерела бронювань і зовнішні інтеграції не змінювати. Production impact: yes — змінюється частота читання API.

### 4. Завершити мобільний сценарій і аварійне відкриття

**Goal:** дашборд лишається корисним, коли складна дошка не відрендерилась або працює на вузькому екрані.

**Scope:** існуючий fallback, плоска сітка віджетів, стилі дошки й браузерна перевірка критичних сценаріїв.

**Steps:** за render-помилки використовувати вже наявну сітку як доступний резервний перегляд; залишити повідомлення з повторною спробою; перевірити прокрутку, масштаби, клавіатурний фокус, тач і поля введення; виконати компактний final sanity pass фіксу видимості, save/recovery і станів віджетів.

**Done when:** на 360/390, 768 і 1440 px доступні основні дії; примусова помилка render залишає доступні віджети й навігацію; немає критичних JS-помилок, горизонтального перекриття й недоступних кнопок.

**Live-site QA:** на тестовому акаунті перевірити Chromium desktop і мобільний браузер; окремо перевірити відновлення після мережевого збою. Штучні помилки render перевіряти локально або в ізольованому браузерному тесті.

**Notes/Risks:** не переписувати редактор дошки та не вводити нові залежності. Резервна сітка має використовувати ті самі дозволені віджети й API. Production impact: yes — змінюється поведінка аварійного UI.

## Рекомендована черговість

Доставити перевірений локальний фікс видимості, потім закрити втрату змін у картці 2. Після цього виконати картки 3–4. Коміт, push і deploy у межах цього аудиту не виконувалися; live-перевірки вище є критеріями майбутньої доставки, а не вже отриманими результатами.

## Перевірка швидкого фіксу

- Node 22.23.1 / npm 10.9.8: `npm run check:runtime` — PASS.
- `npm run check:access`, `npm run check:css-surface`, `node --check js/components/sidebar.js` та `git diff --check` — PASS.
- `node tests/dashboard-board-ergonomics.test.js` — 16/16 PASS. Запуск через `node --test` спочатку блокувався sandbox-помилкою spawn EPERM; прямий запуск того самого тестового файлу завершився успішно.
- Локальний Playwright smoke: `/dashboard`, `/tasks`, `/profile`, `/hr`, `/`; ширини 1440/768/390; світла/темна тема. Перевірено 30 комбінацій, перехід клавішею Enter, активний стан, повторний render без дублів, приховування на auth screen та відсутність посилання за забороненого доступу. API-записи й зовнішні запити заблоковано.
- Візуально перевірено desktop/mobile скриншоти. Кнопку перенесено з плаваючого положення у header, щоб вона не перекривала інструменти дошки.
- QA використовує синтетичний акаунт зі збереженим повним permission snapshot, а не production. Файли результатів: `output/playwright/dashboard-smoke-results.json`, `dashboard-desktop.png`, `dashboard-mobile.png`. Порожні/помилкові віджети у фікстурі не є доказом стану production API.
- Окремий ризик, знайдений під час аудиту: відкриття `/dashboard` з token/user без збереженого permission snapshot у локальній фікстурі показало `unknown_capability` і порожню навігацію. Цей ризик закрито у DASH-01 нижче через підключення `DashboardPage` до чинного shared auth bootstrap порядку.
- Межі «всюди»: лише сторінки з чинним доступом до дашборду. Контекст «Майстерня долі» зберігає наявний business allowlist; доступ не розширено.

## DASH-01: локальний результат

Статус: виконано локально у гілці `codex/dashboard-visibility-20260912`; push/deploy залишено для DASH-05.

Що змінено:

- правий header shortcut «Дашборд» збережено у shared Sidebar, без розширення ролей, business allowlist або backend access policy;
- `dashboard.html` більше не запускає окремий `apiVerifyToken()` bootstrap;
- `DashboardPage.init()` тепер виконує порядок `verify -> business profile -> permissions -> enforce access -> dashboard init`;
- init coalesces duplicate startup calls, а після transient auth/permission failure `_dashboardInitPromise` скидається, тому retry працює;
- auth/permission bootstrap errors показують відповідні shared recovery surfaces і не проходять через board-render fallback;
- додано targeted regression `tests/dashboard-bootstrap.test.js`;
- auth inventory оновлено так, щоб dashboard bootstrap owner був `js/dashboard-page.js`, а не inline script у `dashboard.html`.

Перевірка DASH-01:

- `node --check js/dashboard-page.js` — PASS.
- `node --check tests/dashboard-bootstrap.test.js` — PASS.
- `node tests/dashboard-bootstrap.test.js` — PASS, 5/5.
- `node tests/auth-frontend-session.test.js` — PASS, 69/69.
- `node tests/dashboard-board-ergonomics.test.js` — PASS, 16/16.
- `npm run check:runtime` — PASS, Node 22.23.1 / npm 10.9.8.
- `npm run check:access` — PASS, 26 roles / 43 page entries / 50 sidebar links.
- `npm run check:css-surface` — PASS, 93 CSS files / 93 referenced files / 5 Service Worker precache entries.
- `npm run check:syntax` — PASS, 1146 files. Перший sandboxed запуск упав на `spawnSync ... EPERM`; повторний запуск поза sandbox завершився успішно.
- `git diff --check` — PASS; були лише стандартні CRLF warnings.
- Локальний Chromium smoke через фікстурний сервер — PASS: `/dashboard`, `/tasks`, `/profile`, `/hr`, `/`; 1440/768/390 px; світла/темна тема; прямий `/dashboard` без cached permissions; порядок API до config; Enter navigation; active state; repeated render без дублів; приховування на auth screen; видалення shortcut за забороненого dashboard access; 0 write-запитів.

Примітка щодо SHA: цей розділ входить у сам DASH-01 commit, тому точний immutable SHA фіксується після створення commit і наведений у фінальному звіті через `git log -1`.

## DASH-02: локальний результат

Статус: виконано локально після DASH-01 у гілці `codex/dashboard-visibility-20260912`; push/deploy залишено для DASH-05.

Коміт фіксу save/recovery: `a11f9183386da82496ceb8931d877a358d7bc8e1` (`fix: prevent dashboard save data loss`).

Що змінено:

- `DashboardPage` більше не запускає конкурентні full PUT для `/api/dashboard/config`: усі збереження проходять через одну послідовну чергу.
- Кожен save має immutable payload, локальний revision, captured auth/session context і captured board recovery key.
- Успішна відповідь старого save не замінює новіші локальні правки; dirty/draft очищуються тільки для підтвердженої актуальної редакції.
- `saveBoardNow` після stale response лишає статус dirty, зберігає draft і планує наступне збереження; після PUT 500/offline dirty draft лишається доступним для retry.
- Невдалий або некоректний початковий GET конфігурації блокує PUT default-стану і показує retry surface замість перезапису невідомого серверного стану.
- «Не зараз» при recovery переносить чернетку у deferred storage key і не видаляє її; нові правки й наступний успішний save чистять тільки активний draft, а deferred draft можна відновити або явно видалити окремо.
- Відкладені/queued save не відправляються, якщо змінився користувач, token, session generation або recovery key.
- Додано regression suite `tests/dashboard-save-recovery.test.js` для сценаріїв A→B, послідовних board/settings save, PUT retry, GET failure, deferred recovery і зміни акаунта.

Перевірка DASH-02:

- До фіксу `node --test tests/dashboard-save-recovery.test.js` падав на сценарії A→B: фактичний текст повертався до `A` замість `B`.
- `node --check js/dashboard-page.js` — PASS.
- `node --check tests/dashboard-save-recovery.test.js` — PASS.
- `git diff --check` — PASS; були тільки стандартні CRLF warnings.
- `npm run check:runtime` — PASS, Node 22.23.1 / npm 10.9.8.
- `node --test tests/dashboard-save-recovery.test.js` — PASS, 6/6.
- `node --test tests/dashboard-save-recovery.test.js tests/dashboard-bootstrap.test.js tests/auth-frontend-session.test.js` — PASS, 80/80.
- `npm run check:syntax` — PASS, 1147 files.

Межі й ризики:

- Backend API, auth policy, ролі, permission registry, middleware, токени, міграції, залежності й бізнес allowlists не змінювалися.
- Поточний захист закриває втрату змін в одній вкладці та stale session/queued request сценарії. Конфлікти двох активних вкладок одного акаунта без серверної версії залишаються обмеженням і мають іти окремим явно погодженим завданням, якщо потрібен повний міжвкладковий conflict editor.
- `Abort` як і раніше не вважається доказом, що серверний запис не відбувся; клієнт не застосовує stale response до новішого локального стану.

## DASH-03: локальний результат

Статус: виконано локально після DASH-02 у гілці `codex/dashboard-visibility-20260912`; push/deploy залишено для DASH-05.

Коміт фіксу widgets refresh/error states: `b20ad3cb21bd6e11ac179b932c08dd0ac129aa45` (`fix: refresh dashboard widgets safely`).

Що змінено:

- Збережено чинне об’єднання одночасних widget-запитів через `_widgetDataRequests` і чинні ключі `user / role / sessionGeneration / business`.
- До widget cache додано metadata `fetchedAt`, TTL 90 секунд і `invalidationVersion`, щоб старі відповіді після події або зміни контексту не могли відновити застарілі дані.
- Повернення до вкладки через `visibilitychange` / persisted `pageshow` оновлює лише застарілі видимі widget types, без polling і без таймерів.
- Підключено чинні події: `crm:tasks-updated`, `crm:alerts-updated`, `app:user-changed`, `timeline:business-context-changed`, `rolePreviewChanged`, `workingRoleChanged`.
- `refreshWidget(type)` оновлює всі видимі екземпляри одного віджета, але зберігає один coalesced request на type/context.
- Loading, denied, API/network error і stale last-successful-data тепер мають окремі стани, retry-кнопку та час останнього успішного оновлення.
- При failed refresh з уже наявними даними користувач бачить останні успішні дані як stale, а не порожню статистику.
- Funnel 401/403 лишається окремим denied станом. Financial widgets зберігають чинний `canViewDashboardRevenue()` guard і не роблять forbidden fetch для недозволеної ролі.
- Додано стилі widget state/retry/meta у `css/dashboard-widgets.css`.

Перевірка DASH-03:

- `node --check js/dashboard-page.js` — PASS.
- `node --check tests/dashboard-hydration-request-budget.test.js` — PASS.
- `git diff --check` — PASS; були тільки стандартні CRLF warnings.
- `npm run check:runtime` — PASS, Node 22.23.1 / npm 10.9.8.
- `npm run check:css-surface` — PASS, 93 CSS files / 93 referenced files / 5 Service Worker precache entries.
- `node --test tests/dashboard-hydration-request-budget.test.js` — PASS, 11/11.
- `node --test tests/dashboard-hydration-request-budget.test.js tests/dashboard-widgets-recovery.test.js tests/dashboard-bootstrap.test.js tests/dashboard-save-recovery.test.js tests/auth-frontend-session.test.js` — PASS, 103/103.
- `npm run check:syntax` — PASS, 1147 files.
- `node --test tests/dashboard-hydration-request-budget.test.js tests/dashboard-widgets-recovery.test.js tests/dashboard-widgets.test.js tests/dashboard-bootstrap.test.js tests/dashboard-save-recovery.test.js tests/auth-frontend-session.test.js` — BLOCKED by live/API suite credentials only: `tests/dashboard-widgets.test.js` requires `TEST_USER` and `TEST_PASS`; all self-contained tests in that run passed before the credential-only failures.

Request-budget evidence:

- Cold default-board hydration: each enabled endpoint once.
- Saved board with duplicate live containers: repeated render reuses current-context data; one request for duplicate widget type.
- Explicit refresh: compatibility + board containers update through one fresh request.
- Visibility return: only expired visible widget refreshed; fresh visible widgets were not fetched again.
- `crm:tasks-updated` and `crm:alerts-updated`: visible task/alert widgets refreshed without full reload.
- Context/invalidation stale response: older in-flight response did not overwrite newer data.
- Hidden-tab polling: no polling/timer was added; updates happen on events, manual retry, render, or visible-tab return only.

Межі й ризики:

- API contracts, financial permissions, booking sources, external integrations, roles, middleware, migrations and dependencies were not changed.
- Production data was not read or mutated. Live-site QA remains for DASH-05 with test credentials and read-only comparison against canonical Tasks/Alerts screens.
- Synthetic fixture errors in tests prove UI state handling; they are not production defect evidence.

## DASH-04: локальний результат

Статус: виконано локально після DASH-03 у гілці `codex/dashboard-visibility-20260912`; push/deploy залишено для DASH-05.

Коміт фіксу mobile/fallback: `46f08b183a415d9e0ab8e9e73591ae82e11c158e` (`fix: improve dashboard mobile fallback`).

Що змінено:

- `renderDashboardOpenFallback` більше не ховає всі віджети й не лишає тільки safe-mode текст: при render-помилці він показує резервну плоску сітку.
- Джерело fallback — видимі дозволені widget items з поточного підтвердженого `boardState` плюс legacy `_config.widgets`; віджети, додані через board constructor і відсутні у старому списку widgets, тепер не губляться.
- Hidden board widgets не потрапляють у fallback; `canUseWidget` лишається чинним gate для ролі/доступу.
- Якщо початковий GET config невдалий або config не підтверджений, fallback не відкриває дані з невідомого стану й делегує до retry surface з DASH-02.
- Додано `retryDashboardBoardRender()`: повторює тільки малювання board, без повторного логіну, autosave, reset дошки або серверного запису.
- Успішний retry прибирає fallback marker, ховає compatibility grid і повертає ту саму board scene.
- CSS прибирає mobile horizontal overflow на shell/header/toolbar/actions, зберігає внутрішній scroll великого canvas і робить fallback warning/grid придатними для 360–390 px.
- Додано реальний Chromium smoke `tests/browser/dashboard-mobile-fallback-browser-smoke.js` для viewport/theme/sidebar/fallback/retry.
- Додано JSDOM regression `tests/dashboard-mobile-fallback.test.js` для fallback source, no-mutation, retry і failed GET guard.
- Оновлено існуючий `tests/dashboard-board-ergonomics.test.js` під актуальний DASH-02 save queue contract і DASH-03 explicit denied widget state.

Перевірка DASH-04:

- `node --check js/dashboard-page.js` — PASS.
- `node --check tests/browser/dashboard-mobile-fallback-browser-smoke.js` — PASS.
- `node -e "require('./tests/dashboard-mobile-fallback.test.js')"` — PASS, 3/3. Стандартний `node --test` у sandbox блокується на `spawn EPERM` до виконання тесту; прямий запуск того самого файлу пройшов.
- `node -e "require('./tests/dashboard-board-ergonomics.test.js')"` — PASS, 16/16. Стандартний `node --test` у sandbox блокується на `spawn EPERM`; прямий запуск пройшов.
- `npx --yes --package playwright node tests/browser/dashboard-mobile-fallback-browser-smoke.js` — PASS: 16 layout combinations (`360/390/768/1440` × light/dark × sidebar expanded/collapsed) плюс forced render fallback/retry. Browser smoke запускався поза sandbox, бо локальний npm cache не мав Playwright і sandbox давав `ENOTCACHED`.
- `npm run check:runtime` — PASS, Node 22.23.1 / npm 10.9.8.
- `npm run check:css-surface` — PASS, 93 CSS files / 93 referenced files / 5 Service Worker precache entries.
- `npm run check:syntax` — PASS, 1149 files. Sandboxed запуск спочатку впав системно на `spawnSync ... node.exe EPERM` для всіх файлів; повторний запуск поза sandbox завершився успішно.
- `git diff --check` — PASS.

Browser QA evidence:

- Основні дії на 360/390/768/1440 px не виходять за viewport: header actions, `Додати віджет`, `Налаштувати`, toolbar, rail, save status і board shell лишаються видимими.
- Великий canvas лишається scrollable всередині board shell; page-level horizontal overflow не з’являється.
- Перевірено фокус/Enter/Escape на board tool і введення у note textarea на mobile viewport.
- Forced render error показує корисні widgets (`weather` з board-only item і `tasks` з config.widgets), не мутує `boardState`, а retry повертає board widget на canvas.

Межі й ризики:

- Auth/permission policy, backend API, ролі, permission registry, business allowlists, міграції, залежності й production config не змінювалися.
- Fallback не є новим збереженим режимом і не створює паралельну модель дошки; це тільки read-only аварійне відображення поточних дозволених віджетів.
- Live-site QA на реальних test credentials, mobile device emulation і production deploy залишено для DASH-05.
