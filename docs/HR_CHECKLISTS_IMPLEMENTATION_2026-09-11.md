# HR → Checklists: результат доробки

Production impact: no — зміни локальні, не опубліковані. Гілка `codex/hr-checklists-quality-20260911`, worktree `.codex-temp/hr-checklists-quality-20260911`.

Після дозволу «ок дороблюй» виконано описаний HR-блок із попереднього плану. Ізольовану гілку безпечно оновлено fast-forward із `a52725f867cbe2d21188198ce0b0e7a51a7c52d2` до `2b6a51d31` (базовий marker v0.81.100). Попередні незакомічені HR-правки збережено. Це локальна тестова база коду, не твердження про поточну live-версію. Чужі worktrees, production branch, дані та налаштування сервісів не змінювалися.

## Реалізовані рішення

### CHK-R01 · Примітки й пошук історії

- Причина втрати даних: omitted `notes` нормалізувався до null, а UPSERT безумовно перезаписував колонку.
- Canonical service тепер відрізняє пропущене поле від явного значення. SQL зберігає поточну примітку без повторного надсилання старого значення з frontend. Новий запис без notes має null; explicit null/empty зберігають наявну семантику очищення.
- У search рядків і лічильників archived/orphaned додано той самий department, який уже підтримували active feeds.
- Integer ID поза діапазоном PostgreSQL integer відхиляється як 400 до SQL замість потенційного 500. Схема, міграції та правила доступу не змінені.
- PostgreSQL підтвердив HR checkbox, Training completion, повторне Training completion без зміни completed_at, HR alias без notes та explicit clearing. Archived і orphaned department filter/search повертають по одному власному fixture; історичні notes збережені.

### CHK-R02 · Повний список і пошук

- Додано окремі «Попередні / Наступні» для assignments, archived та orphaned через чинний offset/limit contract. Перехід в одному списку не скидає інший. Розмір порції — 200; UI показує діапазон і total. Без нового backend endpoint і без необмеженого накопичення рядків.
- Зміна filters повертає початкові сторінки. Failed page retry повторює потрібну сторінку й зберігає інші списки.
- Search має debounce 250 ms; Enter і select застосовуються відразу. Старі відповіді не перезаписують нові filters/results.
- Додатково знайдено: ручне «Оновити» не перечитувало каталог професій, тому не показувало професію, створену в іншому контексті. Тепер ручне оновлення завантажує каталог; звичайний search використовує наявний кеш.
- Chromium: 0/1/199/200/201/401 рядок, відсутність пропусків/дублів, independent feeds, retry, reset, stale response. П’ять швидко введених символів створюють один dashboard request. Actual Express/PostgreSQL: перехід 200 → 201-й рядок і search reset у двох темах.

### CHK-R03 · Чернетки й pending

- CSS-блокування доповнене native readonly/disabled із відновленням попереднього стану кожного control; mouse і keyboard поводяться узгоджено.
- При відкритті іншої професії під час save показано пояснення очікування. Збережено один write mutex.
- Незбережений new-item draft належить своїй професії й відновлюється при поверненні до неї в межах поточної сторінки. Draft іншої професії не переноситься й не стирається чужою відповіддю.
- A→B→A після успішного додавання очищує тільки той самий submitted draft. Фокус не переходить до іншого workspace.
- Duplicate Enter, failed-save retry, збереження canonical item та відновлення після redraw перевірені.

### CHK-R04 · Клавіатура й діалоги

- Profession workspace і readiness використовують існуючий openModal/closeModal lifecycle: початковий focus, Tab trap, Escape і повернення focus.
- Tabs підтримують ArrowLeft/ArrowRight/Home/End. Rename/reorder/archive повертають focus до чинного control або логічної наступної цілі.
- Shared confirmModal також використовує чинний lifecycle; Escape більше не закриває underlying workspace, Tab не виходить у background. Повторний confirm коректно завершує попередній Promise.
- Нового modal manager чи глобальної теми немає. Спільна зміна обмежена confirmModal; generic replacement, checklist confirm, HR Team та HR onboarding перевірені. Ручний screen reader і всі спільні callers ще не перевірені.

### CHK-R05 · Перевірки й CI

- Додано три npm-команди: theme, quality, isolated actual-app. Використовують наявний Playwright/npm exec pattern; нових product dependencies або lockfile змін немає.
- Theme/quality підключено до чинного HR Team browser job. Actual-app test підключено після My Day actual-app у вже наявному disposable PostgreSQL/browser job; його DB очищає чинний isolated runner. Нові production сервіси чи GitHub settings не створювалися.
- Додано upload-artifact для результатів. Raw server logs, credentials, tokens і DB URLs не входять до artifacts paths.
- `--verify-local-fixes` тепер вимагає PASS усіх interaction/pagination checks. PostgreSQL regression вимагає збереження notes й пошуку; навмисний invalid-ID 400 перевіряється окремо від несподіваних UI HTTP помилок.
- Registry consumer metadata вказує чинний `/api/hr/checklists/dashboard`. Role/action grants не змінені.
- Remote CI НЕ запускався: wiring готовий локально, green CI для нового SHA ще немає.
- Окремого встановленого YAML parser на host немає; структуру workflow звірено текстово. Остаточну перевірку виконає GitHub Actions після дозволеного push.

## Фактичні результати

| Перевірка | Результат |
|---|---|
| Runtime | Node 22.23.1 / npm 10.9.8 — PASS |
| `npm test` | Exit 0; 2645 unit, 334 My Day, 1312 UI checks; ownership/access/version/migration guards PASS. Кількості різних suites не підсумовувати |
| Focused checklist service tests | 10/10 PASS, включно з omitted/explicit/fresh notes та overflow |
| Browser quality | 52/52 PASS у двох темах; uncaught errors = 0. Контрольовані synthetic requests, не реальна БД |
| Theme shell | PASS; light/dark, error/loading/empty/readonly, long text, widths 390–1440 px |
| Native zoom | PASS; 100/125/150/200% у двох темах |
| Actual app → PostgreSQL | PASS, checklist findings = []; HR edit/add/reorder/archive, history/reload, staff card/readiness, цикл 0/50/100%, filters, notes, Training/alias, 201 rows |
| Доступ | Admin/security/no-page/explicit-deny, 12 GET, 18+5 відхилених writes; readonly disabled, SQL snapshots незмінні |
| HR Team browser | PASS |
| HR onboarding cross-surface browser | PASS |
| CI / deploy / live QA | NOT_RUN для цього нового блоку |

Усі записи створені у нових локальних PostgreSQL 16.15 кластерах із loopback і випадковими credentials. Це не копія production. Outbound hold активний; зовнішні browser requests заблоковані. Після прогонів PostgreSQL зупинений. Попередні невдалі прогони збережені як діагностика; актуальний accepted cross-surface log має exit 0.

Тест довгого тексту тепер чекає завершення focus lifecycle та browser caret scrolling; сам keyboard assertion збережений. Первинний scale test відтворив stale catalog через ручне оновлення — виправлено продукт. Наступний прогін зупинився через навмисний 400, який помилково потрапив у список неочікуваних UI помилок — виправлено класифікацію тесту, не послаблено серверну перевірку.

## Межі й наступні задачі

1. **CHK-R06 · Доставка:** перевірити свіжі source/live SHA й конфлікти, підготувати окремий release/version commit, виконати exact-SHA CI і дозволений deploy. Production permission цього локального блоку не оголошено; push/deploy не виконано.
2. **CHK-R04 · Manual QA:** NVDA/VoiceOver, Safari/Firefox і representative shared confirm consumers. Chromium automation не замінює screen reader.
3. **SYS-R01 · Wallet — BLOCKED / OUT OF SCOPE:** login знову підтвердив локальний daily-login INSERT без обов’язкового username. Wallet, баланси й schema не змінені. Окреме виправлення writer/schema contract потребує свого точного дозволу відповідно до Red boundaries AGENTS.md.

Контрольний upstream snapshot наприкінці — `cc85e3c3f` (ще три коміти, Omni v0.81.101). Серед runtime/CI файлів нашого блоку upstream змінив лише `package.json`; checklist service/UI/CI code не перетинаються. Перед релізом потрібно зберегти нові npm scripts разом зі свіжим release marker і повторно перевірити точну інтеграційну базу. Поточний diff лишається незакоміченим у власному worktree.

Старі вже втрачені notes не відновлюються автоматично. Чернетки живуть лише до перезавантаження сторінки. Literal `%`/`_`, усі permission combinations, поведінка всіх inactive/freelance/reserve наборів і навантаження production окремо не атестовані; їхня семантика не змінена. Пагінація залишається offset-based, тому одночасна зовнішня зміна/видалення даних може змінити склад сторінок — перед масовою звіркою слід оновити список. Нова глобальна theme/navigation/auth/schema/API структура не вводилася.

## Файли й докази

Runtime: `js/hr-page.js`, `css/hr-page.css`, `js/ui.js`, `services/professionChecklists.js`. Test/CI metadata: `config/permissionRegistry.js`, `package.json`, `.github/workflows/ci.yml`. Tests: `tests/hr-profession-checklists.test.js` і п’ять `tests/browser/hr-checklists-*.js`. Docs: цей звіт і початковий quality plan.

Артефакти в ignored output:

- `output/hr-checklists-quality/implementation-npm-test.log`, `implementation-unit.log`, `implementation-async.log`, `implementation-theme.log`, `implementation-zoom.log`, `implementation-hr-team.log`, `implementation-onboarding.log`;
- `output/hr-checklists-quality/async/results-implementation.json` — 52/52; попередні `results-baseline.json` і `results-after.json` залишені окремо;
- `output/playwright/hr-checklists/postgres/results.json` — поточний PASS; `results-audit-before-implementation.json` — старі findings;
- `output/hr-checklists-postgres-runtime/run-implementation-cross-surface.log` — accepted PostgreSQL run;
- `output/playwright/hr-checklists/postgres/page-201-light.png`, `page-201-dark.png` — переглянуті screenshots actual UI;
- `output/hr-checklists-quality/product.patch`, `full.patch`, `artifacts-manifest.json` — review diff і SHA-256 доказів.

Повторний запуск: `npm test`, `npm run test:browser:hr-checklists:theme`, `npm run test:browser:hr-checklists:quality`. Для `npm run test:browser:hr-checklists:isolated` потрібна власна loopback disposable `TEST_DATABASE_URL` та `TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE`; не використовувати спільну або production БД. Персональний portable launcher попереднього аудиту використаний лише локально; CI використовує вже наявний service container.
