# HR Checklists — залишки та перевірка 2026-09-11

Статус: локальні виправлення готові; CI та Wallet мають окремі незастосовані пропозиції. Це продовження CRM-18 / CHK-01–CHK-06, без запуску інших задач загального пакета.

## Межі та початковий стан

- Ізольована копія: `.codex-temp/hr-checklists-residuals-20260911`.
- Гілка: `codex/hr-checklists-residuals-20260911`.
- База: `65195dd8ee9bf5dfee57e4ce5784524dc2c9a10c`, v0.81.103.
- Чужі зміни основної копії в HR, Hermes, task reschedule, тестах і документах не змінювалися.
- Поточний diff: `js/hr-page.js`, `css/hr-page.css`, `js/ui.js`, два наявні HR browser smoke та цей звіт.
- Production impact: no для виконаної локальної роботи. Push, merge, deploy, зміни auth, API, схеми БД, залежностей і production-даних у цьому проході не виконувалися.

## Відтворені дефекти та виправлення

| Симптом / відтворення | Причина | Результат |
| --- | --- | --- |
| Новий пункт → текст → reload: чернетка зникає | Чернетки лише в `Map` сторінки | `sessionStorage` з прив'язкою до акаунта та професії; успішно збережена або очищена чернетка видаляється |
| Сторінка з offset 400 → паралельне скорочення списку | Немає повернення на доступну сторінку | Остання доступна сторінка, потім перша при повторному скороченні; максимум 3 запити, помилка зберігає попередні дані та retry |
| WebKit: A → B → A → додавання, кнопку перекриває `mainApp` | Анімований контейнер обрізає fixed-панель | Панель перенесена в body за наявним modal pattern; використано `ModalLayer` |
| Курсор інколи переходить із уже обраного поля | Відкладений початковий focus у `requestAnimationFrame` | Фокусування лише верхнього активного діалогу; збереження вже обраного внутрішнього фокуса |
| Діалог не має доступної назви | Відсутній `aria-labelledby` | Назва з повідомлення, декоративна іконка прихована від accessibility tree |
| Чинні content-page виклики ігнорують `confirmText` / `danger` | Shared helper приймає тільки `okText` / `type` | Підтримано наявні варіанти; явні `okText` / `type` мають пріоритет |
| Після перенесення панелі нижні кнопки втратили стилі | HR стилі прив'язані до `.page-container` | Ті самі правила доповнено локальними селекторами панелі |
| Темна позначка джерела професії погано читається | Світлий колір тексту не мав темного перевизначення; контраст 2.16:1 | Темні кольори з чинних theme tokens, окрема перевірка обох типів позначки |

Початкові докази: `output/hr-checklists-residuals/baseline-chromium.json` (14 failures / 76 checks), `baseline-webkit.json`, `baseline-webkit.png`, `badge-baseline.json`.

## Перевірки

- Node 22.23.1 / npm 10.9.8; `npm test` — PASS, зокрема 2647 unit, 334 My Day і 1312 static UI перевірок.
- Chromium, Firefox, WebKit: по 88 interaction regressions — PASS; обидві теми, фокус, Escape, pending/retry, A→B→A, reload, різні акаунти, storage denied, пагінація 0/1/199/200/201/401, скорочення списку та обмеження повторних запитів.
- Browser theme smoke: обидві теми, 390/720/768/1024/1101/1200/1440 px, 32 пункти з доступом до останнього, нижні кнопки та контраст — PASS у трьох рушіях.
- Chromium native tab zoom 100–200% — PASS. Це справжній tab zoom, окремий від перевірки ширини.
- Express → одноразова loopback PostgreSQL: зміна/додавання/порядок/архівація, reload і DB read-back, завершення пунктів, нотатки, фільтри, browser history, readonly/403, 201 синтетичний працівник — PASS. Кластер зупинено.
- `git diff --check`, `check:css-surface`, `check:theme-surface` — PASS. Після локальних CSS доповнень повторено відповідні browser та surface checks; після перенесення кнопок також повторено static UI smoke.
- Скріншоти WebKit переглянуто вручну; це не перевірка реального Safari чи screen reader.

Основні артефакти:

- `output/hr-checklists-residuals/npm-test-final.log`
- `output/hr-checklists-quality/async/results.json`, `async-firefox/results.json`, `async-webkit/results.json`
- `output/playwright/hr-checklists/after-shell/results.json`, `after-shell-firefox/results.json`, `after-shell-webkit/results.json`
- `output/playwright/hr-checklists/after-shell-zoom/results.json`
- `output/playwright/hr-checklists/postgres/results.json`
- `output/hr-checklists-residuals/full.patch`, `product.patch`

## Межі перевірки та ризики інтеграції

- Чернетка нового пункту зберігається в межах вкладки; це не серверна чернетка й не автозбереження змін назв існуючих пунктів. Ліміт — 50 останніх професій по 500 символів на акаунт. При заблокованому сховищі працює пам'ять сторінки, але reload її не зберігає.
- Offset pagination не гарантує незмінного snapshot під час зовнішніх вставок/видалень між сторінками. Виправлено лише відновлення недоступної сторінки. Повна гарантія потребує окремого API-контракту і виходить за поточні межі.
- Зміни `js/ui.js` спільні для CRM. Перевірено helper, типові параметри чинних споживачів і HR інтеграцію; не виконано всі сценарії кожної сторінки CRM.
- Реальні Safari/iOS, NVDA/VoiceOver та оголошення live regions — NOT_RUN; Playwright WebKit та accessibility locators цього не замінюють.
- Новий diff не має CI/deploy/live-site доказів; докази v0.81.103 стосуються попереднього релізу.

## Наступні задачі

### HR-CHK-CI-02 — BLOCKED, підготовлено patch

**Goal:** прибрати застарілий action runtime з двох HR artifact steps.

**Scope:** тільки дві заміни `actions/upload-artifact@v4` → `@v7` у `.github/workflows/ci.yml`; назви артефактів, paths, jobs, permissions, application Node 22 та secrets залишаються чинними.

**Steps:** застосувати `output/hr-checklists-residuals/HR-CHK-CI-02.proposed.patch` після окремого дозволу; перевірити YAML; запустити CI для точного SHA; перевірити завантажені артефакти та відсутність runtime warning.

**Done when:** required checks зелені та обидва HR artifacts доступні. `git apply --check` пропозиції вже PASS; віддалений запуск ще не виконано.

**Live-site QA:** зміна action не потребує production writes; при спільному product release виконати HR smoke.

**Notes/Risks:** CI/CD — захищена область за інструкціями користувача. Action v7 використовує власний Node 24; runtime застосунку не змінюється. Джерела: [official action metadata](https://raw.githubusercontent.com/actions/upload-artifact/v7/action.yml), [v7 release](https://github.com/actions/upload-artifact/releases/tag/v7.0.0).

### WALLET-LEDGER-01 — BLOCKED, підготовлено та перевірено SQL patch

**Goal:** усунути `username NOT NULL` помилку журналу монет.

**Scope:** чотири чинні INSERT у `routes/wallet.js`: starter bonus, daily login, sender gift, recipient gift. Username читається за user_id з `users` у тому самому SQL. Схема, суми винагород, auth, responses та production-дані не змінюються.

**Steps:** після окремого дозволу застосувати `output/hr-checklists-residuals/WALLET-LEDGER-01.proposed.patch`; додати route-level integration regressions на disposable PostgreSQL для всіх чотирьох операцій, rollback та ownership; перевірити наступну задачу до випуску.

**Done when:** усі чотири транзакції записують відповідного власника; суми балансу/журналу узгоджені; невдала операція повністю відкочується.

**Live-site QA:** спочатку read-only; запис монет дозволений лише окремо погодженим QA акаунтам.

**Notes/Risks:** чотири початкові SQL помилки `23502` відтворено, чотири запропоновані INSERT пройшли на тимчасових таблицях нового PostgreSQL. Це SQL contract proof, не повна перевірка routes. Доказ: `output/hr-checklists-residuals/wallet-sql-proof.json`. Patch не застосовано до Wallet.

### WALLET-HARDEN-02 — BLOCKED, перевірити перед Wallet release

**Goal:** перевірити знайдені в коді додаткові ризики чинної валюти.

**Scope:** starter bonus concurrency, типи transfer input, date/streak handling. Без нових валютних функцій і без зміни сум винагород.

**Steps:** відтворити два паралельні перші GET wallet (перевірка `coins=500` не доводить створення саме поточним INSERT); перевірити self-transfer з рядковим ID, дробові/нечислові значення; відтворити PostgreSQL DATE проти string та межу дня UTC/DB. Підготувати мінімальні зміни після підтвердження потрібного календарного правила.

**Done when:** рівно один starter ledger entry, self-transfer однаково відхиляється для різних JSON типів, помилки вводу повертають 4xx, streak/day boundaries мають однозначні регресійні тести. Це ризики з code review, ще не повні integration reproductions.

**Live-site QA:** без реальних переказів; disposable PostgreSQL і синтетичні акаунти.

**Notes/Risks:** захищені грошові/нагородні правила потребують окремого дозволу. Не випускати SQL-only patch як твердження про повну справність Wallet.

### HR-CHK-QA-02 — PARTIAL, завершальний ручний прохід

**Goal:** закрити неперевірені платформи й shared UI consumers.

**Scope:** реальні Safari/iOS, NVDA/VoiceOver, cancel/confirm/focus у content, art-director та профільних діалогах, що використовують helper.

**Steps:** пройти keyboard-only відкриття, tab trap, Escape, повернення фокуса, оголошення назви/помилки/pending; у спільних діалогах перевірити default і legacy options без реального видалення чи збереження бізнес-даних.

**Done when:** додано platform/version та результати для кожного сценарію; дефекти відтворені окремо.

**Live-site QA:** лише read-only/cancel до окремої дозволеної QA операції.

**Notes/Risks:** native app control у поточному середовищі недоступний; Safari/VoiceOver потребують Apple-платформи. Зміни API для snapshot pagination не входять до цього QA блоку.
