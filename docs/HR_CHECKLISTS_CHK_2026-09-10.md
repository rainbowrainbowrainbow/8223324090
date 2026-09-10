# HR → Checklists: CHK v1 / CRM-18

## CHK-01 — початкова фіксація

- База: `2f225268a85306ef66808fcaf9af84d7daa09cdb`, локальний ref `origin/codex/eventgenix-production` станом на початок роботи; fetch/live version не виконувалися.
- Гілка: `codex/hr-checklists-theme-20260910`; ізольований worktree `.codex-temp/hr-checklists-theme-20260910`.
- Спільний checkout: `5381d9a8799a7e31ab855ae586268944863a4a4f`, гілка `codex/eventgenix-production`, ahead 1 / behind 145. Чужі tracked зміни: `routes/hermes.js`, `services/taskReschedule.js`, `tests/hermes-routes.test.js` (223 вставки, 1 видалення). Чужі untracked: `.codex-remote-attachments/`, `.worktrees/` та сім audit/task документів у `docs/`. Не копіювалися в патч.
- Windows, PowerShell, Node 22.23.1 / npm 10.9.8. `npm run check:runtime`: PASS, exit 0.
- Прочитано пакет CHK, AGENTS.md спільної папки та базового commit, README, package.json, локальну реалізацію і тести. Інші задачі CRM не запускалися.
- Product code на момент baseline не змінювався.

### Карта й дозволені межі

| Екран / залежність | Реальні файли | Межа |
|---|---|---|
| `/hr#checklists`, `#tab-checklists` | `hr.html`, `js/hr-page.js` | HTML/renderers read-only; після явного дозволу користувача — один виклик очищення checklist status у `openProfessionWorkspace()` |
| Картка професії → вкладка чекліста | `#professionWorkspaceOverlay`, `renderProfessionWorkspaceChecklist()` | Checklist CSS; після явного дозволу — dark foreground лише активної вкладки `data-profession-workspace-tab="checklist"`; інші вкладки без змін |
| Локальне оформлення | `css/hr-page.css`, блок `Profession checklist templates and dashboard` | Дозволено редагувати лише цей блок із локальними селекторами |
| Теми й оболонка | `css/base.css`, `css/dark-mode.css`, інші CSS з `hr.html`, `js/auth.js` | Read-only; class `body.dark-mode`, `html[data-theme]`, `applyCrmThemeMode()` |
| Підтвердження архівування | `confirmHrAction()` → `confirmModal()` у `js/ui.js`, `css/modals.css` | Перевірити; shared portal не змінювати |
| Джерела даних | `routes/hr.js`, `services/professionChecklists.js`, `GET /api/hr/checklists/dashboard`, workspace/template API, item mutations | Read-only; mocks лише всередині тесту |
| Чинні тести | `tests/hr-profession-checklists.test.js`, `hr-onboarding-checklist-sync.test.js`, `hr-profession-checklist-migration.test.js`, `hr-profession-readiness-static.test.js` | Запуск; наявні файли не змінювати |
| Новий regression | `tests/browser/hr-checklists-theme-browser-smoke.js` | Наявний standalone Playwright pattern; залежності/lockfile без змін |
| Реальний regression після продовження | `tests/browser/hr-checklists-postgres-browser-smoke.js` | Чинний isolated runner без змін; нова disposable PostgreSQL, синтетичні записи через API; жодних product schema/auth змін |

### Bug report / baseline

Відтворення: локальний Chromium, справжні HTML контейнерів Checklists і workspace, усі CSS у порядку `hr.html`, справжні `js/ui.js` і `js/hr-page.js`; API замінено явним синтетичним fixture. Немає запуску Express, доступу до БД, зовнішніх API, реальних працівників або production. App startup/auth/sidebar не запускаються. Ширина для базового порівняння: 1440×900, однакові дані в обох темах.

Уточнення після продовження: первинний CSS bundle пропускав вкладені `@import` із `pages-shell.css`. Тому первинна перевірка кольорів відтворювала причину дефекту, але геометрія не була повною. Harness виправлено: CSS тепер завантажується окремими локальними stylesheet links зі справжніми imports; assertions підтверджують `pages-core.css` і `pages-shared-widgets.css`. Усі before/after артефакти перегенеровано. Режим `--shell` додатково використовує повний HTML `hr.html`, явний synthetic shell-ready стан і справжній click/handler HR-навігації. Auth bootstrap, динамічні sidebar widgets та backend не запускаються.

| ID | Місце / стан | Фактичний дефект | Очікуване |
|---|---|---|---|
| D1 | Dark dashboard, summary, search/select | Майже білі поверхні `rgb(249,250,251)`, другорядні світлі підписи губляться | Існуючі темні semantic surfaces і читабельний текст |
| D2 | Dark summary selected | Background, border і color збігаються з normal — вибір невидимий | Чинний selected/hover/focus видимий |
| D3 | Dark checklist editor | Темний текст `rgb(37,37,64)` на фоні `rgb(42,42,74)`; білі рядки/кнопки | Читабельні поля й узгоджені поверхні |
| D4 | Archived toggle, обидві теми | Загальні правила `.hr-profession-workspace-panel input/label` перетворюють checkbox на велике поле зі stacked label | Локальний компактний checkbox і підпис |
| D7 | Toolbar у HR-оболонці, 1101 px, обидві теми | Останній staff select виходив до x=1108 при правій межі toolbar x=1077; shared overflow приховував 31 px | Усі controls цілком у межах toolbar без зміни глобальної оболонки |

Причина D1–D3: `dark-mode.css` вже інвертує gray tokens (`--gray-900` стає світлим, `--gray-100` темним), а пізній локальний dark override використовує їх навпаки й перекриває selected та danger styles. Скриншоти: `output/playwright/hr-checklists/before/`; числові результати: `before/results.json`.

Початкові команди:

```powershell
npm run check:runtime
node --test tests/hr-profession-checklists.test.js tests/hr-onboarding-checklist-sync.test.js tests/hr-profession-checklist-migration.test.js tests/hr-profession-readiness-static.test.js
npm exec --offline --package=playwright -c "node tests/browser/hr-checklists-theme-browser-smoke.js --baseline"
```

Node-тести: перший sandbox запуск — `spawn EPERM`, exit 1 (обмеження процесів, не продуктовий дефект); повтор із дозволеним виконанням — 36/36 PASS, exit 0. Browser baseline — exit 0, відтворені D1–D4; це збір доказів, а не PASS темної теми. Lint/typecheck/build у проєкті відсутні.

### Поточний сценарій

Є: dashboard search, profession/department/status/staff filters, summary filters, refresh/retry; відкриття професії/працівника; checklist template add, rename (включно з Enter), up/down, archive confirmation, show archived, readonly, saving/error/saved; закриття workspace і повторне відкриття. Статуси прогресу відображаються на dashboard. Відмітки виконання працівника належать training/profile, не самому dashboard/editor; профілі поза продуктовими межами патча. Окремого багаторядкового опису пункту, drag-and-drop пунктів, дедлайнів чи нових статусів немає — NOT_APPLICABLE.

План: CHK-02 — локальні поверхні/текст; CHK-03 — selected/focus/checkbox/стани; CHK-04 — матриця тем/ширин/станів; CHK-05 — чинні UI handlers із mocks і наявні unit contracts; CHK-06 — сукупний diff, артефакти, інтеграційні обмеження. Production impact: no (локальний невипущений патч).

## Фінальний результат CHK-02–CHK-06

**Загальний статус: DONE у погодженому обсязі CHK-01–CHK-06. Користувач явно дозволив дві раніше заблоковані точкові правки; обидві виконані й перевірені. UI/mock, справжній UI → Express → PostgreSQL, штатний readonly `security` та нативний browser zoom 100–200% у двох темах — PASS. Усі можливі ролі/overrides, суміжні модулі й реліз не позначаються перевіреними.**

| Задача | Статус | Фактичний результат / файли |
|---|---|---|
| CHK-01 | DONE | Карта, ізоляція, початкові дефекти, baseline; продуктового diff не було |
| CHK-02 | DONE | `css/hr-page.css`: наявні semantic surface/text/border tokens замість подвійної інверсії; контраст статусів і посилання працівника; світла палітра збережена |
| CHK-03 | DONE | Selected/hover, focus-visible, placeholder, error/saved, checkbox і confirm dialog перевірені. Додатково дозволений active Checklist tab: dark contrast 2.12→7.58; saved/error очищуються при новому відкритті без зміни даних |
| CHK-04 | DONE | Loading/empty/error/readonly, довгі тексти, 32 пункти, ширини 1440/1200/1101/1024/768/720/390 px — PASS. Окремо нативний tab zoom 100/125/150/200% у двох темах — PASS з фактичним `chrome.tabs.getZoom`, DPR, CSS viewport і viewport bounds |
| CHK-05 | DONE в межах чинного основного сценарію | Component/shell mock flow і 36 цільових тестів PASS; PostgreSQL/browser підтвердив authenticated startup, template add/rename/reorder/archive/cancel, reload і staff completion. Штатний `security` readonly UI у двох темах, 5 відхилених мутацій (403), БД незмінна. Інші ролі/overrides не перевірені |
| CHK-06 | DONE | Перевірено diff: checklist CSS-блок, один рядок у JS handler, два тести й звіт; окремі patch-файли та before/after докази підготовлено. Немає commit/push/merge/deploy |

### Дефекти й рішення

- D1–D4: виправлено. Checklist surfaces використовують `--surface`, текст — `--text-primary`; selected має власний dark surface/border; checkbox — 16×16 px та inline label. Дизайн і поведінка решти професії не переписані.
- D5, підтверджений під час keyboard regression: `outline: none` у старому input `:focus` прибирав видимий outline в обох темах. Додано локальний `:focus-visible` потрібної специфічності. У baseline `inputFocusOutline = none`, після — `solid`.
- D6: разом із темними поверхнями узгоджено семантичні completed/in-progress/orphaned, danger/saved/error та placeholder. Кольори беруться з існуючих tokens, окрема палітра не створювалася.
- D7: у `.hr-checklist-dashboard-toolbar` замінено жорсткі min widths колонок на `minmax(0, ...)` зі збереженням пропорцій і чинних breakpoints. Перевіряються bounding rectangles кожного input/select, бо document scrollWidth не знаходить обрізання всередині `overflow-x: hidden`. Після правки toolbar і всі controls закінчуються в межах x=1077 на 1101 px. Shared `pages-core.css` не змінювався.
- D8, після окремого дозволу: active Checklist tab мав hardcoded `#047857` у dark. До наявного checklist semantic success color rule додано лише selector `button[data-profession-workspace-tab="checklist"].active`; інші workspace tabs не перефарбовані.
- D9, після окремого дозволу: `openProfessionWorkspace()` не очищував DOM status попереднього відкриття. Один виклик наявного `setProfessionChecklistState()` очищує текст і `data-state` одразу при відкритті. Правила валідації, мутації, дані й API не змінені.
- Довгі profession titles зберігають попередній ellipsis у dashboard; довгі item titles — нативний однорядковий input із доступним через End кінцем рядка. Значення не скорочуються. Багаторядкової моделі пункту немає; новий editor не додавався.

### Візуальні докази

Наведені значення розраховано браузерним тестом із фактичних computed colors; це цільова перевірка тексту, а не повний accessibility audit.

| Dark текст | Контраст до | Контраст після |
|---|---:|---:|
| Summary label | 1.41:1 | 10.98:1 |
| Editor input | 1.08:1 | 13.13:1 |
| Search placeholder | 4.41:1 | 6.31:1 |
| In-progress status | 4.34:1 | 8.88:1 |
| Active Checklist tab | 2.12:1 | 7.58:1 |

Темні profession title, completed і orphaned також проходять цільовий поріг 4.5:1. Світлі computed colors/contrast основного екрану й input збережено. Актуальні `before-shell/dashboard-light.png` і `after-shell/dashboard-light.png` на 1440 px побайтово ідентичні (SHA256 `348546a6bd66bcc2dab5898a9e0ccbe7f1575e7b03d8230f680a4b085a553a8a`). У світлому editor свідомо змінені checkbox layout і keyboard focus; на 1101 px також виправлено обрізання toolbar.

Докази в worktree:

- `output/playwright/hr-checklists/before/`: dashboard-light/dark, selected-light/dark, editor-light/dark, `results.json`.
- `output/playwright/hr-checklists/after/`: ті самі порівняння плюс `loading-*`, `empty-*`, `error-*`, `focus-*`, `validation-*`, `saving-*`, `save-error-*`, `archived-*`, `readonly-*`, `empty-template-*`, `confirm-*`, `confirm-switched-from-*`, `dashboard-<width>-<theme>`, `editor-<width>-<theme>`, `long-list-*`, `results.json`.
- Baseline runner спочатку був виконаний до продуктового diff; для розширеного набору шести статусів і contrast повторено `--baseline` з CSS, прочитаним через `git show HEAD:css/hr-page.css`. База HEAD не змінювалася.
- Переглянуто фактичні PNG основних світлого/темного екранів, editor, error, readonly, confirmation і вузького editor. Скріншоти містять тільки вигадані QA назви.
- Актуальні докази HTML-оболонки: `before-shell/` і `after-shell/` з такими самими іменами PNG, `results.json` містить stylesheet inventory, геометрію toolbar і результати семи ширин. Canonical `applyCrmThemeMode()` і helper functions витягуються read-only з `js/auth.js`; copied theme implementation у тесті прибрано. Повний auth-модуль не виконується.

### Матриця приймання

| Перевірка | Light | Dark | Межа доказу |
|---|---|---|---|
| Dashboard, фони, текст, усі 6 поточних статусів | PASS | PASS | Справжній renderer, synthetic fixture |
| Completed / not-started / in-progress counters | PASS | PASS | Read-only rendering; статуси й відсотки не змінені |
| Search, усі 4 select-фільтри, summary selected, retry | PASS | PASS | UI events і query parameters; серверне filtering не перевірене |
| Поля, checkbox, buttons, focus, disabled | PASS | PASS | Tab/Shift+Tab/Enter/End, нативні disabled; up/down збережено |
| Template add/rename/reorder/archive/cancel | PASS | PASS | Лише in-memory mock; stable key і порядок перевірено |
| Saving, validation error, server rejection | PASS | PASS | Controlled pending/failure mocks; помилки не маскуються empty state |
| Empty dashboard / empty profession template | PASS | PASS | Existing empty messages; archived toggle disabled за відсутності архіву |
| Readonly, archived rows | PASS | PASS | Mock `isReadonly` і додатково справжній `security`: неeditable input, немає action buttons/add, архів доступний для перегляду |
| Confirm dialog і зміна теми з відкритим dialog/editor | PASS | PASS | Справжній `confirmModal`, click cancel/confirm; portal CSS без змін |
| Основний close/back-history шлях | PASS | PASS | Справжній close handler + fixture popstate binding; повний router не запускається |
| Довгі назви, 32 пункти, прокрутка | PASS | PASS | Item text доступний клавіатурою; останній із 32 пунктів досяжний |
| 1440/1200/1101/1024/768/720/390 CSS px | PASS | PASS | Component і HTML shell; перевірено imports і bounds кожного фільтра, виправлено D7. Shared tab strip зберігає свою прокрутку |
| Native browser zoom | PASS | PASS | `--native-zoom`: Chromium tab zoom 100/125/150/200%; 1440 physical px → 1440/1152/960/720 CSS px; не CSS zoom і не pinch/page scale |
| Повторне відкриття після mock save | PASS | PASS | State test fixture, не PostgreSQL |
| Реальне збереження / reload з БД | PASS | PASS | Новий PostgreSQL 16.15, реальні Express routes; add/rename/reorder/archive/cancel та незалежний SQL read-back. `postgres/results.json` |
| Відмітка виконання в staff training readiness | PASS | PASS | Справжній `loadTeam()` і public dialog entry point; click, PUT, reload, повторний GET та SQL `completed_at`. Повний шлях через staff card / Training onboarding не перевірений |
| HR навігація → Checklists в HTML shell | PASS | PASS | Реальні `renderHrNav`, `bindHrNavClicks`, `activateHrTab` і click; доступ задає fixture |
| Authenticated startup | PASS | PASS | Справжній login bootstrap creator у disposable БД, справжній HR HTML/scripts/sidebar; отриману сесію передано browser storage як у чинному browser stack |
| Чинний writer/readonly доступ | PASS | PASS | Справжні disposable creator і security без capability overrides; 403 на add/rename/reorder/archive/completion у security та незмінність БД |
| Решта ролей і custom overrides | NOT_RUN | NOT_RUN | Не проводився повний аудит усіх permission combinations; auth/config не змінювалися |
| Багаторядковий опис item, drag-and-drop item, нові статуси | NOT_APPLICABLE | NOT_APPLICABLE | Немає в поточному template editor |

### Фінальні команди й результати

| Команда | Результат |
|---|---|
| `npm run check:runtime` | PASS, exit 0 — Node 22.23.1 / npm 10.9.8 |
| `node --test tests/hr-profession-checklists.test.js tests/hr-onboarding-checklist-sync.test.js tests/hr-profession-checklist-migration.test.js tests/hr-profession-readiness-static.test.js` | PASS 36/36, exit 0; baseline і final |
| `npm exec --offline --package=playwright -c "node tests/browser/hr-checklists-theme-browser-smoke.js --baseline"` | exit 0; defect evidence, не passing theme assertion |
| `npm exec --offline --package=playwright -c "node tests/browser/hr-checklists-theme-browser-smoke.js"` | PASS, exit 0; основний flow у двох темах, контраст, геометрія, скриншоти; uncaught page errors = 0 |
| Та сама browser команда з `--shell` | PASS, exit 0; повний HTML, imports, HR tab click, семи-width geometry і чинний mock flow |
| Та сама browser команда з `--baseline --shell` | exit 0; baseline CSS із HEAD, D7 відтворено в обох темах на 1101 px |
| `npm exec --offline --package=playwright -c "node tests/browser/hr-checklists-theme-browser-smoke.js --native-zoom"` | PASS, exit 0; 8 комбінацій theme/zoom, CSS transitions завершені, toolbar у viewport, editor без horizontal overflow, скриншоти переглянуті |
| `npm exec --offline --package=playwright -c "node tests/browser/hr-checklists-postgres-browser-smoke.js --isolated"` | PASS, exit 0; Node 22.23.1/npm 10.9.8, PostgreSQL 16.15, обидві теми, HR API failures = 0, page errors = 0. Локальний launcher надав новий loopback `TEST_DATABASE_URL` і явний reset confirm |
| `node --check tests/browser/hr-checklists-postgres-browser-smoke.js` | PASS, exit 0 |
| `npm run check:css-surface` | PASS, exit 0 — 93 CSS files/references |
| `npm run check:theme-surface` | PASS, exit 0 — 42 root pages, 16 inline / 23 CSS debt budgets |
| `npm run check:syntax` | PASS, exit 0 — фінальний повтор 1101 JS files; початковий sandbox запуск блокував spawnSync EPERM, повтор із дозволеним виконанням пройшов |
| `npm run test:ui` | PASS, exit 0 — 1312 passed, 0 failed |
| `git diff --check` | PASS, exit 0; стандартне попередження про CRLF, без whitespace errors |
| Фінальний CSS + JS patch `git apply --check --directory=output/playwright/hr-checklists/integration-product-3312ace2 .../product.patch` | PASS, exit 0; ізольований `git archive` обох файлів із локального upstream `3312ace2b5dbe18eda11fd865e6a6218212ff23d`; upstream/робочу гілку не змінювали |
| Lint / typecheck / build | NOT_APPLICABLE — команд у проєкті немає |
| Full `npm test`, CI, загальні integration suites, live QA | NOT_RUN — виконано лише цільовий checklist PostgreSQL/browser сценарій; delivery/production заборонені |

У проміжному browser run тест фокуса виявив недостатню специфічність нового outline: виправлено й перевірено повторно. Діагностичний CSS `zoom:2` показав overflow, але не моделює native browser zoom (media queries лишаються на старій CSS ширині); його не використано як приймання і не внесено обхідних product styles. Фінальний тест перевіряє reflow на 720 CSS px. Логи й артефакти є локальними, не CI/deploy proof.

### Відкриті частини й інтеграція

1. **DONE після явного дозволу:** active tab «Чекліст» виправлено вузьким dark selector; новий контраст 7.58:1, світлий 4.94:1 збережений. Інші вкладки workspace поза цим дозволом.
2. **DONE після явного дозволу:** старий saved/error скидається при відкритті. Mock перевіряє saved та server-error reopen; справжній PostgreSQL тест перевіряє saved на тій самій професії, validation error → інша професія → повернення, без втрати збереженої назви. Дозвіл користувача «дозволяю працюй» стосується саме цих двох попередньо описаних правок.
3. **Попередній блокер PostgreSQL усунено:** Docker Desktop запускали, але backend впав під час ініціалізації `dockerInference` socket. Docker не скидали й не переналаштовували. Офіційний portable PostgreSQL 16.15 розпаковано окремо; через обмеження кириличного шляху `initdb` runtime скопійовано у новий `C:\tmp\eventgenix-chk-pg-2a6cac1696f049d5941ebc3e92d3e43e`. Кожна спроба створювала власний кластер, loopback port і випадковий SCRAM пароль. Чинний runner застосував наявні міграції тільки до нової disposable БД, виконав тест, очистив schema; launcher штатно зупинив PostgreSQL (exit 0). Production credentials/дані не використовувалися. Windows-службу й залежності CRM не встановлювали.
4. `css/hr-page.css` — спільний фізичний файл. Diff обмежений checklist selectors, але при інтеграції перевірити паралельні HR CSS зміни, порядок завантаження та конфлікти саме цих hunks. Нові файли тесту/звіту не конфліктують з чужими dirty Hermes/task файлами.
5. База — локально наявний remote-tracking ref, без нашого fetch. На фінальній перевірці ref — `3312ace2b5dbe18eda11fd865e6a6218212ff23d`, наша гілка behind 4. Наш HEAD не змінений; між базою й цим ref `css/hr-page.css` та `js/hr-page.js` не змінилися, `hr.html` має лише 26 version/cache-tag substitutions. Актуальність майбутньої інтеграційної гілки потрібно перевірити повторно. Cache/version markers патча навмисно не змінені: реліз не готується.
6. Global theme/sidebar/routes/backend/auth/DB schema/lockfiles/dependencies/permissions/business logic **не змінені у продуктовому diff**. Дозволений виняток shared UI: колір лише активної вкладки Checklist і очищення її status при відкритті. Product diff: `css/hr-page.css` (+42/−6), `js/hr-page.js` (+1); також два tests і report. Чинні міграції й мутації тестових записів виконувалися лише у власних disposable кластерах.

### Передача й відкат

`output/playwright/hr-checklists/product.patch` містить CSS + один JS рядок; `hr-checklists.patch` — product diff + два tests + report. Артефакти screenshots/results залишаються в ignored `output/` і доступні для review в цій копії. Portable runtime і локальний launcher до patch не включені. Гілка існує, HEAD лишився базовим; зміни не комітилися.

Під час фінального guard повтору literal Git revision `HEAD:css/hr-page.css` у тесті було помилково класифіковано як runtime CSS reference; аргумент формується з уже знайденого stylesheet path, guard не змінювався. Повторний guard пройшов. Сукупний patch також перевірено через `git apply --reverse --check` без внесення змін.

Для інтеграції спочатку перевірити `git apply --check <patch>` у чистій цільовій копії. Для відкочування вже застосованого власного патча — спочатку `git apply --reverse --check <patch>`, потім reverse лише цього патча після перегляду. Не використовувати reset/clean і не видаляти чужу роботу.

Передати у **CRM-34**: цей звіт, patch, before/after PNG, native zoom і PostgreSQL/readonly results; на інтеграційній базі повторити HR navigation, дві теми, zoom, readonly, template save/reopen і повний staff-card/Training entry path. CRM-18 деталізована цим CHK потоком; весь реліз та інші CRM задачі готовими не позначалися. Дозволений локальний обсяг завершено, блокерів CHK після окремого дозволу не лишилося. Наступна дія — рев’ю/інтеграційна регресія патча; інтеграцію/реліз не виконувати автоматично.

Продовження за запитом «давай далі працюй»: HTML-shell navigation, canonical theme helper, CSS imports і локальний D7 закриті. Наступне «окей роби далі» додало реальний PostgreSQL proof, описаний нижче. Production impact: no. Нові продуктові зміни першого продовження — один рядок grid у тому самому локальному CSS-блоці; етап PostgreSQL змінював лише tests/report. Після окремого дозволу виконано також D8/D9.

### Реальний PostgreSQL proof — продовження 2026-09-10

- Офіційне джерело: [EDB PostgreSQL binaries](https://www.enterprisedb.com/download-postgresql-binaries?lang=en), Windows x64 16.15, fileid `1260494`; SHA256 архіву `5e8afffe67daf949aeeb03b74951f1ec2324e1888f73fbd036ab0e567ab004d9`. PostgreSQL 16 відповідає major-версії наявного CI. Runtime у тимчасовій папці, без системної інсталяції.
- `output/hr-checklists-postgres-runtime/run-checklists.ps1` — фактично використаний локальний launcher; генерує окремий кластер, випадковий порт і пароль, відмовляє при успадкованому DB URL, запускає наявний `runSuite`, у `finally` зупиняє БД. Секрети не записані у звіт або test source; тимчасовий password file поза repo видалено. `BACKUP_OUTBOUND_HOLD=true` і `PAYMENT_OUTBOX_WAKEUP_DISABLED=true`; браузер пропускає лише локальний origin.
- Повна команда launcher: `powershell -NoProfile -ExecutionPolicy Bypass -File output/hr-checklists-postgres-runtime/run-checklists.ps1`. Фінальний exit 0; stdout/stderr — `output/hr-checklists-postgres-runtime/run.log`. Звичайне повторення на іншому власному disposable PostgreSQL: задати його loopback `TEST_DATABASE_URL`, `TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE`, потім виконати наведену `npm exec ... --isolated` команду. Runner очищує schema: не підставляти спільну або production БД.
- Fixtures: дві нові QA-професії, два QA-працівники, їхні активні profession assignments і пункти створюються через чинні API. Міграції також містять штатні seed-імена; це нова локальна БД, не копія production. Основні dashboard скриншоти відфільтровані до QA-професії. Auth — справжній випадковий bootstrap creator, session injection у браузер за наявним repo pattern; password/login-form UI не перевірявся.
- PASS для light і dark: rename через Enter, add, reorder, cancel archive, archive, close, повний reload, show archived, SQL read-back title/order/is_active; click completion у чинному readiness dialog, PUT через Express, повний reload, повторне завантаження й SQL completed_at. CSS class і `data-theme` додатково перевірені після reload.
- Фінальний `output/playwright/hr-checklists/postgres/results.json`: `status=PASS`, дві теми, `apiFailures=[]` (HR routes), `pageErrors=[]`. Фінальний shutdown PostgreSQL — exit 0. General websocket reconnect/інші shell API не є критерієм цього тесту; toast «Перепідключення…» на частині PNG не приховано.
- PNG 1440×960: `postgres/dashboard-light.png`, `dashboard-dark.png`, `editor-reloaded-light.png`, `editor-reloaded-dark.png`, `completion-reloaded-light.png`, `completion-reloaded-dark.png`. Після фінального дозволеного виправлення перегенеровані; checklist input/row/archive й active tab читабельні. Канонічне before/after порівняння — `before-shell`/`after-shell` з однаковими synthetic даними.
- Початкові невдалі спроби відокремлені від продукту: кириличний шлях `initdb`; очікування дерева процесів у PowerShell launcher; неповний fixture без `position`/role assignment; перехід на той самий hash лишав відкритим попередній dialog; test init на `about:blank` потребував origin guard. Усе виправлено тільки у launcher/test, останній запуск успішний. Жодного backend/auth workaround не додано.

### Додаткове приймання readonly та масштабу — 2026-09-10

- На етапі readonly/zoom нових product edits не було; наступний явний дозвіл і фінальні два рядки описані нижче. `security` вибрано за незміненим `config/permissionRegistry.js`: `hr.staff.view=true`, `hr.staff.manage=false`. Тест створює одного QA staff/account через наявні API у новій disposable БД, використовує справжній login і стандартний preset, не змінює role/permission config.
- Фінальний PostgreSQL/browser повтор — exit 0: попередній writer сценарій повторно PASS, readonly light/dark PASS; add, rename, reorder, archive, completion — усі 403; template/progress snapshot БД до і після тотожні. `postgres/results.json` містить `readonly`, загальний PASS, `apiFailures=[]`, `pageErrors=[]`. Очікувані 403 окремо перелічено в `readonly.rejectedMutations`. PNG: `postgres/readonly-security-light.png`, `readonly-security-dark.png`.
- Native zoom працює через документовані [Chromium extension у Playwright](https://playwright.dev/docs/chrome-extensions) і [chrome.tabs.setZoom/getZoom](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom). Мінімальний helper генерується лише в ignored test output; temporary persistent Chromium profile створюється самим Playwright і закривається після тесту. Особистий browser profile, розширення користувача, глобальна тема/типографіка й залежності CRM не змінюються.
- `after-shell-zoom/results.json`: 100/125/150/200% × light/dark — 8 PASS. Native `getZoom`, DPR 1/1.25/1.5/2 і ширина CSS viewport 1440/1152/960/720 підтверджені. Перевірено межі toolbar відносно viewport і всіх filters відносно toolbar, editor horizontal overflow, фокус/End, досяжність поля додавання через scroll та close. При 200% обидві теми мають toolbar x=24…696 у viewport 720 CSS px.
- Ранній zoom run не використовується як приймання: вимірювання потрапляло всередину `margin-left` transition оболонки, а Playwright fullPage capture обрізав PNG через CSS/physical px різницю. Фінальний тест очікує завершення finite animations, перевіряє viewport bounds і знімає physical viewport через CDP `Page.captureScreenshot`. PNG 1440×900 переглянуті; фінальний результат PASS. Це виправлення тестового доказу, не CSS workaround.
- Фінальні докази: `after-shell-zoom/dashboard-zoom-200-light.png`, `dashboard-zoom-200-dark.png`, `editor-zoom-200-light.png`, `editor-zoom-200-dark.png`; інші масштаби — у тій самій папці. Це справжній browser zoom на HTML/CSS shell із synthetic data; backend proof і readonly залишаються окремим справжнім Express/PostgreSQL тестом.
- Інтеграційний dry run: CSS із `3312ace2b5dbe18eda11fd865e6a6218212ff23d` експортовано в окрему output-папку; `git apply --check` прийняв product.patch без конфліктів. Це перевірка застосування CSS, не merge і не загальна регресія нової гілки. `check:css-surface`, parser обох тестів і `git diff --check` — PASS.

### Фінальний дозвіл і закриття D8/D9

Користувач відповів «дозволяю працюй» на конкретне питання про колір active Checklist tab у shared workspace та очищення старого saved/error. Це точкове розширення початкових меж; інші protected області не відкриваються.

- CSS: один доданий selector у наявному success/text token rule; dark tab contrast 2.124→7.582, light 4.945→4.945. Світлий dashboard before/after лишився побайтово ідентичним, SHA256 наведений вище.
- JS: один доданий `setProfessionChecklistState()` у `openProfessionWorkspace()` після binding. Очищується тільки відображення попереднього status, без нової логіки збереження чи зміни поточної валідації.
- Фінальні повтори: component browser, повний HTML-shell browser, native zoom, PostgreSQL writer/readonly і 36 цільових unit/static tests — PASS. PostgreSQL evidence містить `statusResetSameAndOtherProfession=PASS` в обох темах; unexpected HR API/page errors = 0; 5 очікуваних readonly 403 окремі. Тестовий PostgreSQL штатно зупинений.
- `check:syntax`: 1101 files PASS; `check:css-surface`: 93 PASS; `check:theme-surface`: 42 pages PASS. Усі after screenshots перегенеровані. Попередні PARTIAL/BLOCKED висновки щодо D8/D9 замінені цим фактичним DONE.
- Фінальний `product.patch` містить обидві продуктові зміни: CSS і JS. `git apply --check` на окремому експорті обох файлів із `3312ace2b5dbe18eda11fd865e6a6218212ff23d` — PASS; це dry run без merge або зміни цільової гілки. Оновлений темний editor PNG переглянуто: active tab, назви, поля й дії читабельні.

## План доробок після CHK — оновлено 2026-09-10

За запитом користувача «всі слабкості … додай в план» нижче зібрано відкриті обмеження доказів і помічені ризики. D1–D9 уже виправлені; повторно відкривати їх без регресії не потрібно. NOT_RUN означає прогалину перевірки, а не підтверджену поломку. P1 — перед інтеграційним прийманням; P2 — наступне посилення регресії. Ці картки не запускають інші задачі загального пакета й не надають дозволу на захищені зміни, CI configuration, push/merge/deploy або production-дані.

### CHK-F01 · P1 · Приймання на актуальній інтеграційній базі

**Мета:** підтвердити сумісність патча з цільовою версією CRM. **Статус:** PLANNED; dry run на локальному `3312ace2` уже PASS, повна регресія цільової версії NOT_RUN.

**Слабкість / доказ:** робоча гілка behind 4; два продуктові файли фізично спільні для HR. Безконфліктне застосування не перевіряє поведінку, каскад CSS або майбутні паралельні правки. Cache/version markers і service-worker поведінка після релізу не перевірялися.

**Обсяг і кроки:** у погодженій чистій інтеграційній копії зафіксувати точний SHA; переглянути нові hunks `css/hr-page.css`, `js/hr-page.js` і порядок CSS у `hr.html`; перевірити застосування патча; повторити цільові тести й дві теми, 1101 px, 100–200% zoom, readonly та save/reopen. Перед прийманням виконати доречний загальний baseline; повний `npm test` у CHK не запускався. Зберегти SHA, команди, exit codes і порівнювані screenshots.

**Готово коли:** власний diff збережений, сторонні зміни не втрачені, регресія пройшла саме на цільовому SHA. **Live-site QA:** NOT_RUN; після окремо дозволеного релізу перевірити актуальні assets/cache та HR сценарій. **Межа / ризик:** інтеграція й реліз не виконуються цим планом; передати картку до CRM-34, не запускати її автоматично.

### CHK-F02 · P1 · Повний користувацький шлях і серверні фільтри

**Мета:** закрити розрив між перевіреними handlers і повним шляхом користувача. **Статус:** NOT_RUN для перелічених доповнень.

**Слабкість / доказ:** справжній login API перевірений, але сесію передано storage; login-form UI не перевірено. Completion відкривали через public readiness entry point; повний click-шлях через staff card / Training onboarding відсутній. Search/select/summary перевіряють UI events і query parameters; повна матриця серверної фільтрації не доведена. Back/history покрито fixture, не повним router.

**Обсяг і кроки:** розширити існуючий PostgreSQL browser smoke на disposable fixtures: login form → HR → Checklists → професія → збереження → reload; dashboard → staff card → чинний Training/readiness → completion → повернення; browser Back/Forward і deep link. Для search, profession, department, status, staff і їхніх комбінацій створити мінімальні різні QA записи та звірити набір рядків/лічильники з очікуваними даними після скидання фільтрів.

**Готово коли:** обидві теми проходять шлях кліками, дані підтверджені reload/SQL, фільтри не показують сторонні QA записи. **Live-site QA:** NOT_RUN; у поточній задачі лише disposable локальний backend. **Межа / ризик:** зміни router, backend, API або бізнес-правил при виявленій помилці — BLOCKED поза чинним обсягом; спочатку оформити конкретне відтворення.

### CHK-F03 · P1 · Доступ за чинними ролями й overrides

**Мета:** розширити доказ доступу, зберігши поточні правила. **Статус:** creator/security PASS; решта комбінацій NOT_RUN.

**Слабкість / доказ:** одна штатна readonly роль і writer не покривають інші presets, відсутність view-доступу та custom overrides. Наявні п'ять 403 і незмінність БД залишаються дійсним доказом тільки перевіреного security сценарію.

**Обсяг і кроки:** read-only скласти матрицю з фактичного permission registry: view/manage, no-view, legacy readonly та чинні overrides; вибрати представників різних результатів доступу без дублювання еквівалентних ролей. На окремих QA accounts звірити HR навігацію, прямий URL, видимість/disabled дій і відповіді API; після відхилених мутацій перевірити незмінність template/progress.

**Готово коли:** кожен різний підтримуваний результат дозволу має очікування з чинного registry та фактичний browser/API результат. **Live-site QA:** NOT_RUN; реальні облікові записи не змінювати. **Межа / ризик:** зміна auth/roles/permissions або налаштувань доступу — BLOCKED без окремого точного дозволу; тестові fixtures не мають ставати змінами продуктового registry.

### CHK-F04 · P2 · Повторне відкриття під час збереження

**Мета:** перевірити поведінку незавершеного запиту при зміні workspace. **Статус:** HYPOTHESIS / NOT_RUN; це не підтверджена втрата даних.

**Слабкість / доказ:** `runProfessionChecklistMutation()` перевіряє `open` і profession key, але не окремий сеанс відкриття. Глобальна `professionChecklistMutationPromise` зберігається до завершення запиту. D9 очищує вже наявний текст; він не змінює завершення запиту, що ще виконується. Пізнє повідомлення при повторному відкритті тієї самої професії може бути очікуваним результатом незавершеної дії — це потрібно перевірити перед змінами.

**Обсяг і кроки:** у наявному mock browser тесті затримати success/error; запустити save → close → та сама професія, потім інша професія, а також A→B→A; завершити запит. Перевірити текст status, disabled/saving, актуальні назви, відсутність підміни даних іншої професії й повторних мутацій. Окремо перевірити retry після failure. Якщо дефект підтвердиться — записати очікувану поведінку та мінімальний варіант виправлення.

**Готово коли:** усі комбінації мають відтворюваний результат; підтверджені проблеми відокремлені від очікуваного pending save. **Live-site QA:** навмисні затримки/збої тільки локально. **Межа / ризик:** нове скасування запитів, зміна concurrency або правил збереження не входять до дозволеного косметичного патча; реалізація такого виправлення BLOCKED до окремого погодження обсягу.

### CHK-F05 · P2 · Суміжна оболонка й доступність довгого вмісту

**Мета:** перевірити помічені UX обмеження без редизайну. **Статус:** цільові контрасти й клавіатура PASS; ширший аудит NOT_RUN.

**Слабкість / доказ:** виправлено active Checklist tab, але не решту shared workspace tabs. У частині локальних PostgreSQL PNG видно «Перепідключення…»; general WebSocket/інші shell API не входили до критеріїв тесту, причина не встановлена. Довгі назви мають чинний ellipsis/однорядкове поле, tab strip — власну прокрутку. Перевірено Chromium; інші браузери й screen reader не перевірялися.

**Обсяг і кроки:** виміряти контраст інших вкладок і перевірити focus/повернення фокуса після dialog, доступні назви та оголошення status у чинній розмітці; перевірити досяжність довгих назв і прокрутку клавіатурою. Зіставити reconnect toast із локальними WS/network подіями, відділивши обмеження fixture від дефекту застосунку. Інші браузери перевіряти за фактичною політикою підтримки, без встановлення нових залежностей у межах CHK.

**Готово коли:** є виміряний перелік конкретних проблем або підтверджена штатна поведінка; toast не прихований заради screenshots. **Live-site QA:** NOT_RUN; production діагностику цим планом не запускати. **Межа / ризик:** глобальна тема, типографіка, shared modal/sidebar/WS поза межами — BLOCKED для змін; multiline editor, drag-and-drop і нові статуси не додавати.

### CHK-F06 · P2 · Відтворюваність тестів і передача доказів

**Мета:** зберегти регресійні докази після інтеграції та зробити повторення незалежним від цього комп'ютера. **Статус:** локальні прогони PASS; автоматичне підключення й чисте середовище NOT_RUN.

**Слабкість / доказ:** обидва нові browser scripts не згадані в `package.json` або workflows, тому їхня наявність не означає виконання в CI. Використано cached Playwright; portable PostgreSQL launcher має локальний ASCII runtime path і не входить у patch. Screenshots/results лежать у ignored `output/`. `--baseline` читає CSS із HEAD: після коміту це вже не первинна база; JS у такому режимі лишається поточним, отже режим є CSS-порівнянням, не повним історичним застосунком. Synthetic harness витягує фрагменти HTML/theme helpers із source і потребує актуалізації при їхньому переміщенні.

**Обсяг і кроки:** зберегти нинішні before/after та їхній manifest; при майбутній зміні тесту явно задавати перевірений baseline SHA і записувати CSS/JS provenance у results, без автоматичного приймання нових snapshots. Перевірити команди на чистому Node 22/npm 10 з наявним Playwright і власною disposable PostgreSQL через чинний runner; не копіювати приватні URL або паролі. Підготувати мінімальне підключення до наявного browser/isolated CI job як окрему пропозицію з runtime і артефактами; не створювати нову тестову архітектуру.

**Готово коли:** інший checkout може повторити команди й відтворити визначену базу; before/after/results прив'язані до SHA та доступні рев’юеру, CI виконання підтверджене тільки після його фактичного підключення й запуску. **Live-site QA:** не потрібна для цієї картки. **Межа / ризик:** CI/settings/dependencies не змінювати в поточному патчі. Timed clusters і runtime не видаляти широким cleanup; за потреби спочатку інвентаризація власних абсолютних шляхів і окреме погодження видалення.

Порядок передачі: F01 → F02 → F03 для інтеграційного приймання; F04–F06 — наступні обмежені доробки. Спочатку виконувати перевірку, потім пропонувати виправлення лише підтверджених проблем. Відсутні lint/typecheck/build і нові продуктові можливості не перетворюються на задачі цього плану.
