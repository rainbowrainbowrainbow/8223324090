# WALLET-HARDEN-02 — виправлення та межі перевірки

Оновлення: виправлення сумісності live/migration схем і бонусу сьомого дня описане в `WALLET_INVENTORY_03_2026-09-11.md`. Нижче збережено результати попереднього етапу; актуальний release-статус перевіряється окремо.

Статус: локальні виправлення виконано; **випуск Wallet заблокований WALLET-INVENTORY-03**. Зелений regression suite перевіряє також безпечний rollback відомої помилки сьомого дня, а не успішне отримання цього бонусу.

Production impact: yes — якщо цей код буде випущено, зміняться обробка некоректного вводу та виконання чинних винагород. У цьому блоці production не змінювався; міграції, auth, суми винагород, залежності й API responses не змінено.

Ізольована гілка: `codex/hr-checklists-residuals-20260911`; база цього блоку — `1f170d11b6fcab6cf8a16b15d65faa03d5dbb8e7`. Основна робоча копія містить сторонні зміни та не редагувалася.

## Початкові дефекти та рішення

| Симптом / відтворення | Причина | Зміна |
|---|---|---|
| Два одночасні перші GET створюють два starter entries при одному балансі 500 | Перевірка `coins=500` не визначає власника INSERT | `ON CONFLICT DO NOTHING RETURNING` визначає, який запит створив гаманець |
| Рядковий власний ID проходить self-transfer; earned/spent штучно збільшуються | Порівнюються різні JS типи | Нормалізація ID перед перевіркою себе |
| Boolean, array, object, дробові/нечислові або завеликі значення доходять до SQL | Перевірки truthiness і `< 1` не перевіряють тип | Ціле додатне число в межах PostgreSQL INTEGER; коректні числові рядки залишаються сумісними |
| Streak скидається після вчорашнього входу; same-day DATE ненадійний | `pg` повертає DATE як Date, код порівнює його з рядком | Локальний SQL alias `last_login_reward::text`; глобальні pg parsers не змінюються |
| Резервна перевірка ledger помиляється біля UTC-півночі | JS UTC-дата змішана з `CURRENT_DATE` timezone БД | Один UTC-день на запит; межі ledger перетворюються в чинну timezone БД |

До виправлень нові regressions відтворили **15 невдалих підсценаріїв**. Два перші GET синхронізовано через коротке блокування таблиці тільки disposable БД, щоб обидва гарантовано прочитали відсутній гаманець до INSERT.

Файли: `routes/wallet.js`, `tests/integration/wallet-ledger.integration.test.js`, `.github/workflows/ci.yml`, цей звіт. CI додає лише два кроки до наявного disposable PostgreSQL job: Wallet integration у UTC та America/Los_Angeles і upload evidence. Існуючі HR artifact paths, job permissions, application runtime і service settings незмінні.

## Перевірки

- Node 22.23.1 / npm 10.9.8; PostgreSQL 16.15.
- Остаточні disposable HTTP/auth/Express/PostgreSQL прогони: **31 PASS, 0 FAIL, 0 SKIP** у кожній із UTC, Europe/Kiev та America/Los_Angeles. Це 30 підсценаріїв і батьківський Node test.
- Покриття: конкурентне створення; числові типи; self-transfer; перекази з наявним/новим отримувачем; ownership журналу; DATE continuity/reset/цикл; UTC-інтервали ledger; повторні daily claims; rollback при відмові starter/daily/sender/recipient INSERT; недостатній баланс.
- Окремий підсценарій підтверджує **500 і атомарний rollback** сьомого дня. `results-*.json` містить `blockers: WALLET-INVENTORY-03`; PASS цього safety test не закриває дефект бонусу.
- YAML parse та структурне порівняння з базою — PASS: тільки два Wallet steps.
- Parser обох JS-файлів, API surface guard, `git diff --check` — PASS.
- Повний `npm test`: остаточний результат і точний feature SHA фіксуються в `output/hr-checklists-residuals/wallet-harden-delivery.json`. Початкова sandbox-спроба з `spawn EPERM` не є результатом перевірки коду.
- Нового UI diff немає; нові скриншоти цього backend-блоку не створювалися. Попередні HR browser evidence не замінюють перевірку нового feature SHA у CI.

Докази: `output/hr-checklists-residuals/wallet-harden-baseline.log`, `wallet-harden-final-{utc,kyiv,la}.log`, `wallet-harden-npm-test-full.log`, `wallet-harden-ci-validation.json`; `output/wallet-ledger/results-{UTC,Europe_Kiev,America_Los_Angeles}.json`.

Відтворення: задати процесу `TEST_DATABASE_URL` на окрему loopback test-БД, `TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE`, за потреби `PGOPTIONS=-c timezone=UTC`, потім виконати `node tests/integration/wallet-ledger.integration.test.js --isolated`. Runner скидає тільки перевірену disposable schema. Production URL/дані не використовувати.

## План залишків

### WALLET-INVENTORY-03 — BLOCKED, до випуску Wallet

**Goal:** чинний бонус сьомого дня має успішно видати 50 монет і належний предмет атомарно.

**Scope:** writer сьомого дня, фактичні `shop_items` / `character_items` / `user_inventory` contracts та відповідні regressions. Спочатку узгодити контракт; не створювати нову модель валюти.

**Steps:** перевірити підтримувану live-схему read-only; узгодити відбір доступного предмета, mapping `shop_items.item_id → character_items.id`, власника inventory та повторне отримання вже наявного предмета; виправити writer за наявною моделлю або окремо погодити міграцію. Замінити нинішню перевірку відомої помилки сьомого дня на успішний сценарій; додати випадки порожнього каталогу, вже отриманого предмета, конкурентних claims і відмови inventory INSERT.

**Done when:** дні 6→7→8 проходять; нагорода й предмет не дублюються; усі записи відкочуються разом при помилці; artifact більше не містить цей blocker.

**Live-site QA:** спочатку read-only schema/status; reward writes лише для окремо погоджених QA акаунтів.

**Notes/Risks:** міграція 039 створює `shop_items.is_active`, `user_inventory(username, item_id, acquired_via)` з FK на `character_items`. Wallet очікує відсутній `is_available` та `user_inventory(user_id, item_id, quantity, obtained_from)` із shop ID. Міграція 040 додає rarity/equip_slot, але не виправляє цей контракт. Підміна ID чи мовчазне пропускання предмета змінили б правила винагороди. Виправлення streak робить шлях сьомого дня досяжним, тому **не випускати поточний Wallet diff до закриття цього блоку**.

### WALLET-RESILIENCE-04 — заплановано, ризики з code review

**Goal:** підтвердити передбачувану поведінку при недоступній БД і граничних балансах.

**Scope:** Wallet connection acquisition, error/rollback paths, INTEGER arithmetic; без нових лімітів або сум винагород.

**Steps:** відтворити `pool.connect()` rejection у daily/transfer (зараз поза try), переповнення сукупного balance/earned і зустрічні одночасні перекази; визначити чинний контракт помилок; виправити лише підтверджені дефекти. Окремо перевірити timestamp history при зміні timezone БД: TIMESTAMP без timezone не зберігає оригінальний offset.

**Done when:** немає unhandled rejection/часткових записів; перевірено rollback та стабільну відповідь; історичну timezone assumption підтверджено або задокументовано шлях міграції.

**Live-site QA:** read-only; аварії/переповнення відтворювати тільки локально.

**Notes/Risks:** ці сценарії ще не відтворено; це не твердження про доведені production-помилки. Зміна типів колонок, HTTP-контракту чи бізнес-лімітів потребує окремого погодження. Поточний UTC fix припускає, що старі ledger timestamps записані за тим самим timezone convention БД.

### HR-CHK-QA-02 / завершальний інтеграційний прохід — PARTIAL

**Goal:** закрити залишки platform QA та довести точний release SHA.

**Scope:** Safari/iOS, NVDA/VoiceOver, інші споживачі спільних діалогів; сумісність feature branch із актуальною production-гілкою.

**Steps:** повторити keyboard/focus/cancel/pending у реальних платформах; перевірити CI та artifacts точного SHA; після закриття Wallet blocker і дозволу на release інтегрувати актуальну базу, виконати version/cache sync, CI та live smoke.

**Done when:** є platform/version/scenario evidence, exact-SHA CI і дозволені live checks; не залишено непозначених неперевірених сценаріїв.

**Live-site QA:** read-only/cancel; жодних реальних бізнес-записів.

**Notes/Risks:** Playwright WebKit не замінює Safari/iOS/VoiceOver. Незмінний snapshot для offset pagination потребує окремого API-рішення й не входить у цей diff. Повну відсутність техборгу або перевірку всієї CRM цей звіт не стверджує.
