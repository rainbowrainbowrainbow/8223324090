# EDU-READY-01: достовірність тестів і вихідний стан

## Висновок

Зелений загальний baseline не означає готовність розділу «Заняття». Нові незалежні actual-app регресії відтворили всі шість дефектів попереднього звіту. Наскрізний UI-сценарій зупинився на недоступному викладачі; залежні кроки не зараховуються як PASS.

Зміни цієї задачі стосуються лише тестів, harness і документації. Продукт, схема, auth/permissions, lockfile, версія та production settings не змінювалися. Commit/push/deploy не виконувалися.

## Перевірена база

- Worktree: `C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix`.
- Branch: `codex/education-ready-pack-20261003`.
- Base/tested SHA: `56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e`, v0.82.59.
- Live branch: `codex/eventgenix-production`; на початку та під час фінальної перевірки о 17:35 UTC live SHA збігався з remote HEAD і base SHA. Точна identity збережена у `identity-final.json`.
- Node 22.23.1 / npm 10.9.8; `check:runtime` і `npm ci --ignore-scripts --no-audit --no-fund` пройшли; встановлено 303 packages за чинним lockfile.
- Основний checkout брудний і застарілий; його файли не редагувалися. Попередній QA worktree — джерело доказів, його файли не змінювалися.
- Evidence: `C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix/output/education-ready/2026-10-03/`.

## Що показав аудит чинних тестів

| Джерело | Реальний рівень перевірки | Межа висновку |
|---|---|---|
| `education-attendance.test.js`, `education-schedule-ui.test.js`, `education-qa-context-regressions.test.js` | Unit/contract; 21 cases | Не доводять повний користувацький цикл або production persistence |
| `education-series.integration.test.js` | Справжня disposable PostgreSQL/API; 13 cases | Серії/конфлікти; не замінює проходження форм |
| `education-series.integration-acceptance.test.js` | Справжня PostgreSQL/API і частково браузер; 11 cases | Деякі edit/open викликають helper; старий edit не перевіряв незмінність duration |
| `education-context-actual-app-browser-smoke.js` | Реальний frontend/auth, контрольовані mocked education responses і прямі module calls | Stale-response contract; не повний PostgreSQL/UI lifecycle |
| `education-navigation-actual-app-browser-smoke.js` | Direct URL/reload/back/menu; custom-menu fixture задається localStorage | Збережено helper-switch contract і додано окремий switch через видимий select; не перевіряє коректність звіту |
| `education-group-submit-actual-app-browser-smoke.js` | Реальний UI save, Express і SQL; 403/409/500 fault injection | Double-submit/retry; error payloads штучні, це не доказ реальної причини HTTP помилки |
| `education-modal-actual-app-browser-smoke.js` | API fixture → реальна картка Today/day/week, keyboard/focus | Theme задається DOM; 390 px не є фізичним iPhone або повним mobile lifecycle |
| Попередній `education-full-qa-browser.js` | Змішані незалежні сценарії, SQL/API, UI, fault injection | Після failed group/lesson create використовував API fixture; downstream PASS не є lifecycle PASS |
| Попередні duration/Today supplements | Незалежні actual-app докази | Містили fixed waits; новий ready baseline замінює їх контрольованими бар'єрами |

Source inventory містить 26 записів поточних і попередніх джерел: шляхи, SHA256 та номери рядків для helper calls, fixed-delay patterns, mocks, barriers, SQL, theme DOM, fallback і слабких report assertions. Частина файлів повторюється між двома worktrees. Pattern hit потребує інтерпретації: `route.fulfill({response})` доставляє справжню відповідь; `setTimeout` може бути timeout або bounded polling. Це не 26 унікальних виконаних тестів.

Повні попередні докази збережені у `C:/Users/Plotva/.codex/worktrees/education-full-qa-20261003/EventGenix`; старі результати не переписувалися.

## Правила verdict

| Verdict | Значення |
|---|---|
| PASS | Відомі передумови й незалежні assertions виконано на заявленому рівні |
| FAIL | Передумови є, але очікувана поведінка/інваріант порушені |
| BLOCKED_FIXTURE | Немає придатних даних або їхня підготовка/перевірка не завершилася |
| BLOCKED_DEPENDENCY | Попередній обов'язковий UI-крок не пройшов; цей крок не виконується |
| BLOCKED_ENV / BLOCKED_CREDENTIALS | Немає необхідного runtime, сервісу або дозволених credentials |
| NOT RUN | Сценарій не запускали; це не PASS |

Порожній suite, FAIL і BLOCKED повертають ненульовий exit code. Первинний failure зберігається в окремому attempt; повторний прогін не видаляє його. API/SQL дозволені для незалежних передумов та перевірок, але не для ремонту невдалого UI-кроку в тому самому lifecycle.

## Передумови та незалежні очікування

Мінімальний regression fixture: один вигаданий активний викладач, один представник, двоє дітей, три групи, чотири 45-хвилинні заняття та журнал із двома відмітками. Це не демонстраційний набір EDU-READY-02. Усі записи належать власній loopback disposable БД; зовнішні запити браузера блокуються, зовнішні credentials видаляються наявним runner.

| ID | Передумова | Незалежний oracle | Поточний результат |
|---|---|---|---|
| F01 | A завантажена; справжній GET B утримується бар'єром | SQL/API A незмінні при вибраній B; HTTP write target відповідає selection | FAIL: PUT змінює A |
| F02-source | Активний staff row існує в SQL; дозволений education контекст | Teacher option з цим ID доступна у видимій формі | FAIL: 0 відповідних options, реальний staff403 |
| F02-retention | Група має teacherId до rename | HTTP200, teacherId після rename збігається в API/SQL | FAIL: assigned teacher → null |
| F03 | UI journal present; окремий реальний PUT зберіг absent | API/SQL absent; після Refresh UI absent | FAIL: UI залишає present |
| F04 | Є історичний урок і verified marks; report GET200 | Суми не беруться з функції звіту: fixture + прямі SQL marks; ті самі totals видно у UI | FAIL: порожній UI |
| F05 | API/SQL duration45, canonical interval12:00–12:45 | Змінюється лише title; API/SQL duration45 збережені | FAIL: actual payload/API/SQL duration30 |
| F06 | A і B існують у SQL; real A response held; B GET200 | Selected dateB, loadingfalse, canonical B card | FAIL: loadingtrue, B card відсутня |

F03 тут перевіряє окрему API-корекцію того самого synthetic account; це не тест двох різних авторів. Окремий second-operator/history сценарій залишається для EDU-READY-05/08. Archive/enroll permutations F01, усі нові teacher endpoint permutations, багатогрупові report totals і physical-device QA теж не можна вважати виконаними цим baseline.

## Наскрізний сценарій

У новому тесті послідовність: UI group with teacher → UI child search/enroll → UI 45-minute lesson create → reload/canonical card → visible title edit → canonical journal link/mark → period/group report. Кожен крок залежить від попереднього PASS. Поточний UI group FAIL через teacher option; наступні кроки BLOCKED_DEPENDENCY. Assertions цих заблокованих гілок ще не були виконані на виправленому продукті.

Future report oracle окремо очікує scheduled1 і нуль attendance totals навіть при створеному журналі; це не підміняє сценарій історичних проведених занять. Повний acceptance з cancel, другим оператором і rich data належить EDU-READY-08.

## Початкові помилки harness та повтори

1. Sandbox блокував мережу й child-process spawn. Read-only identity, npm і дозволені локальні тести повторені з необхідним tool approval. Це не product FAIL.
2. Native bundle не містить createdb executable. Власну БД створено через наявний `pg`; жодних інших БД не змінено.
3. Перший fixture preflight отримав booking400 при створенні минулого уроку. `baseline-fixture-blocked.json` і `baseline-first.log` збережені. Історичну передумову виправлено: створити synthetic future row, перенести лише його дату в SQL до початку assertions, потім створити journal. Це не UI fallback після failure.
4. Перший navigation прогін через справжній UI-switch читав меню після зміни current context, але до завершення switch. Другий очікував Reports після повернення з Park, хоча чинний navigation contract повертає Dar Today. Третій використовував неправильний selector `#sidebar` для очікування animation. Первинні logs збережено. Очікування приведено до кінцевого стану, чинного route contract і наявного `#sidebarNav`; останній прогін PASS. Старий helper-switch Reports assertion залишено. Продукт не змінювався для отримання PASS.

## Фінальна перевірка

| Перевірка | Результат | Межа доказу |
|---|---|---|
| Новий ready baseline | Exit1: 2 PASS / 8 FAIL / 6 BLOCKED_DEPENDENCY | 16 checks; PASS — fixtures і відсутність unhandled page errors. FAIL — шість дефектів, F02 поділено на два assertions, окремо failed UI group step |
| Reporting self-tests | 4/4 PASS | Доводять чесне поширення verdict та exit semantics |
| Education-only unit | 21/21 PASS | Unit/contracts, не UI lifecycle |
| Focused education/context/access | 104/104 PASS | Змішане покриття; не 104 education-сценарії |
| Чинні PostgreSQL series suites | 13/13 + 11/11 PASS | 24 API/integration cases з частковим UI |
| Context / group-submit / modal / navigation browser smokes | Усі фінальні прогони PASS | Рівні proof описані вище; початкові navigation failures збережені |
| Загальний npm test | Exit0; 5079 TAP executions, 1327 static UI checks | Загальне покриття репозиторію, не тисячі education-сценаріїв |
| Final syntax / protected surface / diff check | PASS | 1403 JS files; protected booking/timeline source не змінено |
| Evidence verifier | 8/8 PASS | Перевірка узгодженості червоних regression доказів, identity та boundaries |
| Disposable cleanup | PASS | Public tables0; PostgreSQL stopped, listener55459 відсутній; datadir збережено |

Нові reporting self-tests не входять до чинного hardcoded `npm test` allowlist; їх виконано окремою командою. Новий red baseline запускається окремим safe wrapper і не під'єднаний до CI. CI у цій задачі не запускалася, оскільки push заборонений. Збережені snapshots дозволяють перевірити результати після зупинки БД.

Авторитетний фінальний attempt: `output/education-ready/2026-10-03/attempt-2026-10-03T17-35-07-100Z/`. Кореневий `baseline.json` відповідає цьому attempt; попередні attempts не видалені.

## Візуальний перегляд нових доказів

Усі шість PNG фінального attempt відкрито й переглянуто. Це Chromium desktop на synthetic даних; physical mobile/iPhone перевірка не виконувалася.

| Screenshot | Що видно та межа доказу |
|---|---|
| F01-group-selection | Стан після помилкового save. Початковий вибір B доводить JSON trace; screenshot сам по собі не доводить selection перед write |
| F02-teacher-retention | Teacher placeholder після rename; видимі synthetic учні й дрібні native action buttons |
| F03-journal-refresh | UI лишається present; незалежний absent доводять API/SQL, не pixels |
| F04-report-direct | Заповнені дати й порожня область результатів; totals доводять fixture/SQL |
| F05-duration-edit | Editor частково поза видимою областю. Duration45→30 доводять payload/API/SQL; цей PNG не є самостійним доказом видимого duration control |
| F06-today-date-race | Обрана дата B, попередній заголовок і loading; terminal state та B fixture доводять JSON/SQL |

Банер «Перепідключення…» спричинений навмисним блокуванням WebSocket у harness; його не зараховано як новий connectivity defect. Кнопки та компонування залишаються в scope EDU-READY-06; візуальних продуктових виправлень задача01 не містить.

## Production read-only

Credentials завантажувалися лише process-local з дозволеного secrets-файлу. Interceptor встановлено до login; дозволені тільки GET/HEAD/OPTIONS та auth login/refresh/verify. Service workers і WebSocket заблоковані. Production screenshots, response bodies, customer/child contents, логіни, паролі й токени не зберігалися.

- `/api/education/groups` і `/api/staff`401 зафіксовано до login.
- Авторизований Dar probe: groups200, staff403 `staff_not_migrated`; group teacher options1 — тільки placeholder.
- Reports direct/reload: GET200, dates set, summary не відображено, status порожній.
- Automatic POST `/api/wallet/daily-login` заблоковано до відправлення.
- Профіль/cabinet fingerprints до й після збігаються; unhandled page errors0.
- Status `READONLY_OBSERVATION_COMPLETE` означає завершене безпечне спостереження, а не product PASS.

## Матриця для наступних задач

| Область | Уже доведено | Що лишається | Задача |
|---|---|---|---|
| Test reporting | FAIL/fixture/dependency exit semantics, окремі рівні proof | Виконати заблоковані гілки після виправлень | 03–08 |
| Дані | Мінімальний synthetic preflight | 4 teachers, 6 groups, 24 children, 30–40 lessons; повторюваний demo seed; складні report oracles | 02 |
| Групи/викладачі | F01/F02 actual-app FAIL, submit/retry contract | Виправлення, archive/member actions, isolation, inactive teacher | 03 |
| Заняття | F05 actual-app FAIL; чинні PG series checks | Visible duration, повний UI create/edit/cancel, series wizard | 04 |
| Today/journal/report | F03/F04/F06 actual-app FAIL | Fixes, двоє авторів, filters, direct/back/forward, stale errors/finally | 05 |
| Візуал | Попередні screenshots як evidence; дефекти кнопок/форм відомі | Повний design pass, штатний theme switch, виміряний contrast, before/after | 06 |
| Пристрої | Раніше Chromium390 geometry і modal keyboard | Phone/tablet full cycle, WebKit, physical iPhone/Safari, zoom/screen reader | 07 |
| Acceptance | Чесний червоний baseline | Повний набір на одному SHA, без обходів і прихованих пропусків | 08 |

Рекомендована наступна дія: EDU-READY-02 у цьому самому worktree. Seed не виправляє F01–F06; після наповнення переходити до функціональних задач 03–05.
