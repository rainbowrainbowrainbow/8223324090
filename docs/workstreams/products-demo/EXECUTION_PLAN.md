# Execution plan: PRD-02–PRD-11

Follow-up review: R04 cached constructor-link visibility and R05/S07 package count fixed locally. 75 Node / 4 browser / 1312 UI PASS. Browser uses full designs-page.js init/hash with mock HTTP. S06 direct print fallback has no tracked UI call sites; successful viewer print payload verified with spies, export remains NOT_RUN. Base and five-runtime-file ownership unchanged. See [review details](IMPLEMENTATION_REPORT.md).

## Stage B — поточний стан (2026-09-11)

Новий прямий запит власника авторизував READY PRD-02–PRD-11 без push/merge/deploy і protected змін. PLAN_ONLY нижче описує історичний Stage A, а не поточну заборону локального implementation. Base/HEAD залишився `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`; той самий ізольований worktree/branch.

PRD-02–06/08/09: DONE_LOCAL. PRD-07: VERIFY_NO_REPRO_FIXTURE; sidebar patch відсутній. PRD-10: DONE_LOCAL із BLOCKED_INTEGRATION для DB/auth/export. PRD-11: READY_FOR_REVIEW. [Фактичний звіт](IMPLEMENTATION_REPORT.md), [демо](DEMO_SCRIPT.md), [питання інтеграції](INTEGRATION_NOTES.md), [diff](evidence/implementation.patch). Нижчі вихідні task cards / baseline факти збережено як історію планування; нові статуси мають пріоритет.


## Stage A — вихідний план і baseline (історія)

PRD-00: DONE (аудит коду й доступного локального baseline; browser/DB gaps явні).
PRD-01: PLAN_READY. Base `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`.
План для 5.5; Stage B тут не розпочато. Production impact: no.

Джерела: [CONTEXT_HANDOFF](CONTEXT_HANDOFF.md), [OWNERSHIP](OWNERSHIP.md), [TEST_MATRIX](TEST_MATRIX.md), [SHARED_INTEGRATION](SHARED_INTEGRATION.md). Код і точні функції перевірено на базі; live кількості/контент не підтверджені.

## Вибраний мінімальний підхід

Залишити `/programs` і поточні категорії/кухню/каталоги. Додати вгорі компактний огляд із переходами «Анімації», «Торти», «Меню», «Каталоги»; bare URL показує загальний Products/programs/all, не відновлює кухню неявно. Read-only деталі — inline `<details>` усередині наявних карток; повний текст і наявне індивідуальне зображення вже є у list contract. Graduation screen viewer лишається у `/designs#catalog-graduation`, конструктор — `/graduation`.

Альтернативи деталей: (1) native inline disclosure — рекомендовано, без нової бібліотеки, request та scroll lock; (2) existing modal primitives — окрема keyboard/focus lifecycle, зайва складність тут; (3) нова detail page — потребує route/access/surface integration, поза scope. Не робити повну перебудову CRM.

## Статуси та черга

READY означає, що визначений локальний scope можна виконувати після запуску Stage B і завершення попередників; це не DONE і не browser acceptance.

| Task | Статус плану | Залежності / частина, що не READY |
|---|---|---|
| PRD-02 | READY | 00/01; Park single-business UI; global menu diff не потрібний |
| PRD-03 | READY | 02; наявне iconUrl/description. Вимога додаткової галереї — BLOCKED_CONTRACT |
| PRD-04 | READY | 02/03; visual acceptance потребує browser evidence |
| PRD-05 | READY | 00/01; лише screen layout. Заміна approved catalog copy/images — BLOCKED_DECISION |
| PRD-06 | READY | 05; локальна state repair і fixture demo. Sandbox writes/export evidence — BLOCKED_ENVIRONMENT |
| PRD-07 | BLOCKED_ENVIRONMENT (fix) | Дефект standalone menu не відтворено. Діагностика read-only READY; якщо root cause shared → BLOCKED_SHARED |
| PRD-08 | READY | 01 + прочитаний діагноз 07; локальна visual inspection/cosmetics незалежні; не позначати menu repaired |
| PRD-09 | BLOCKED_ENVIRONMENT | Після 06 і успішного standalone navigation smoke 07; global move окремо BLOCKED_DECISION/SHARED |
| PRD-10 | READY | після доступних 02–09; static/mock можна завершити, DB/browser gaps залишаються BLOCKED_ENVIRONMENT до доказу |
| PRD-11 | READY | після 10, усі статуси явні; можна передати PARTIAL/BLOCKED без удаваного DONE |

Робоча черга: 02 → 03 → 04 → 05 → 06 → 07 diagnosis → 08 → 09 (якщо знятий gate) → 10 → 11. Коли 07/09 заблоковані, продовжити 08/10/11. Не чекати завершення HR і не створювати дубль CRM-22–27.

## PRD-02 — Загальний вхід і категорії

**Goal / Scope:** прибрати відтворений D01 у локальному Products. Файли: `programs.html`, `js/programs-page.js`, `css/pages-products.css`, `tests/products-ia.test.js`, новий `tests/products-demo-flow.test.js`.

**Steps / minimal diff:**

1. У header / `productIaTabs` додати один ряд локальних переходів на чинні hashes; не додавати sidebar items. Зберегти решту program categories і kitchen subfilters.
2. `readInitialProductTab` + initial route resolution: bare Park `/programs` → programs/all; явні `#kitchen`, `#kitchen-cakes`, `#kitchen-menu`, `#animation/#animations`, `#catalogs`, усі старі program hashes зберігають значення. Не скидати org preference і не правити `CrmBusinessContext`.
3. Локальні user transitions записують history entry, початкова normalization лише replace; popstate/hashchange відновлюють таби без циклу/подвійного переходу. Старі прямі URL, query і embedded behavior зберегти. Не змінювати shared hash listener/sidebar.
4. `loadProducts`: response null від helper не перетворювати на правдиве empty; при зміні контексту прибрати попередній display та ігнорувати завершення запиту зі старою generation/context. Лише presentation cache lifecycle, без зміни бізнес-mapping.

**Done when:** bare entry не залежить від saved kitchen; три категорії та каталоги очевидні, active state відповідає URL; refresh/back/forward і пустий список працюють; інших категорій не втрачено. Dar/multi-context behavior не оголошено виправленим цим патчем.

**Checks / Live-site QA:** B01/B02/B05/B06, T01–04/T08/T24–25. Browser fixtures для bare URL зі stored kitchen, старих hash, null/error, empty і delayed response; live NOT_RUN до дозволеного QA. **Notes/Risks:** зміна preference поведінки свідома й локальна; S03 забороняє непогоджений org mapping fix.

## PRD-03 — Повні деталі без редактора

**Goal / Scope:** читати весь наявний опис і зображення без manage-products. Файли: `js/programs-page.js`, `css/pages-products.css`; `programs.html` лише за потреби локальних labels/styles; новий `tests/products-demo-flow.test.js`.

**Steps / minimal diff:**

1. Додати повторно використовуваний локальний renderer native `<details><summary>Детальніше</summary>` до `renderProgramProducts` і `renderKitchenProducts`. Прив'язка до поточного record `(businessContext,id)`, без нового product store.
2. Повний `description`; кухонні shortDescription/promoDescription та вже показувані kitchen detail fields без substring у розгорнутій частині. Порожній опис — чесний локальний стан. Escaping після обрізання summary, повний текст через escapeHtml/textContent; не виконувати HTML з API.
3. Показати тільки наявний індивідуальний `iconUrl` / чинний kitchen image resolver. Немає зображення / load error — нейтральна рамка/підпис, без повторного завантаження циклом. EventCards banner не називати фотографією продукту. Масив фотографій не вигадувати.
4. Локальний price presentation wrapper розрізняє finite numeric zero, missing і priceVariantNote; використовує чинний formatPrice, servingUnit/isPerChild/priceUnit у підтвердженому контексті. Не редагувати global formatter/прайс. Для непорівнюваних одиниць — S04.
5. Disclosure не здійснює writes/AI calls і не змінює чинні edit/delete/source-document/warehouse actions. Native keyboard/focus; при category switch DOM деталей замінюється разом із правильним record, без async detail race.

**Done when:** на synthetic animation/cake/menu відкривається повний текст потрібного ID, нуль видно як 0, null не видається за 0, image failure не ламає картку; read-only користувач бачить деталі; склади/ціни/записи не змінюються.

**Checks / Live-site QA:** B02/B03/B06; T05–11/T23. Fixtures: long Unicode text + `<script>` як текст, quoted image attributes, empty description, broken image, 0/null/priceVariantNote, однаковий ID у різних дозволених fixture contexts. Browser keyboard/focus NOT_RUN до виконання. **Risks:** відсутня галерея — обмеження контракту, не завдання backend.

## PRD-04 — Дві теми вітрини

**Goal / Scope:** перевірити й виправити лише локальну читабельність після 02/03. Файли: `css/pages-products.css`, локальні existing style blocks `programs.html`; `tests/browser/products-demo.spec.js` optional.

**Steps:** використовувати вже підключені CRM variables, знайти computed-style причину перед CSS fix; зберегти selected/focus/disabled/loading/error; wrap довгі назви, object-fit contain для detail image, без зміни shared EventCards. Уникати body-level overflow locks. Inline styles не збільшують theme budget; budget override заборонений.

**Done when:** ті самі записи читабельні у light/dark, 390/768/1440 px (перевірки навколо наявних responsive breakpoints); viewport не переповнюється, detail не накриває menu; немає global diff.

**Checks / Live-site QA:** B04/B05/B06, T09/T12/T13; порівнювані screenshots fixture UI до/після. Наявність CSS media rules не є browser PASS. **Risks:** спільні токени походять також із HR release; їх не «повертати» до старих значень.

## PRD-05 — Оформлення наявного graduation screen catalog

**Goal / Scope:** довести чинний перегляд до демо без створення нового каталогу. Файли: catalog-only markup/styles `designs.html`, `buildCatalogPageHtml` у `js/designs-page.js`, новий `tests/products-demo-catalog.test.js`.

**Steps:** використовувати `/api/graduation/packages` response; виправити лише typography/wrapping/spacing/media proportions у graduation viewer. Додавати CSS лише під `body.catalog-graduation-viewer-open` / `data-catalog-viewer-type=graduation` у локальний style block designs.html. `css/catalog.css` read-only через screen/print/public consumers. Зберегти theme, banner slug path, approved description constants, services filtering, duration/kids/price semantics. Перевірити no-image та довгі services. Не замінювати дані дизайнерським макетом.

**Done when:** синтетичний package із тим самим shape читається на широкому/вузькому екрані, ціни/склад незмінні; generic catalog, design board, print CSS не отримали змін. Наявність п'яти banner assets не проголошується п'ятьма active demo packages.

**Checks / Live-site QA:** B02/B04/B05/B06, T14/T15/T17. Browser fixture для ≥2 packages; actual package count і data matching — NOT_RUN без sandbox read. **Risks:** джерела description/image у API й renderer відрізняються; їх заміна BLOCKED_DECISION (S04), backend export поза local diff.

## PRD-06 — Стан каталогу і відтворюване демо

**Goal / Scope:** усунути D03 і перевірити реальні підтримувані дії. Файли: названі catalog functions `js/designs-page.js`, catalog host `designs.html` за потреби; `tests/products-demo-catalog.test.js`, `docs/workstreams/products-demo/DEMO_SCRIPT.md`.

**Steps:**

1. Спершу regression: generic pages → graduation не може використати generic shape. Мінімально розділити transient viewer payload ownership / freshness по catalog type або явно перезавантажити правильний endpoint. Це cache UI, не друга система даних. Request generation не дозволяє повільному старому response перемкнути поточний catalog.
2. Loading/empty/error показувати в current viewer; не залишати попередній package при failure, не маркувати ready за fallback API entry. Back/close прибирає keyboard listener і повертає чинний list/inline mode. Зберегти generic viewer behavior.
3. Refresh чинного `/designs#catalog-graduation` відкриває graduation з початку; окремого page-index permalink немає. Не додавати новий URL контракт заради T15. Сторінки проходити next/prev/arrows; число зафіксувати по фактичному response.
4. Action inventory: screen view/next/prev/close — існують; package page create/save у graduation viewer — NOT_APPLICABLE; generic `/api/catalogs/:id/pages` editor не є graduation package editor. Print/PDF action існує, перевіряти окремо на synthetic sandbox із чинними export/revenue permissions. Публікація, generation, Telegram — не запускати.

**Done when:** regression D03 проходить, pending-response race покрита, demo script відрізняє fixture view від DB-backed/export proof. Failed persistence не має success toast.

**Checks / Live-site QA:** B02/B04/B05/B06 + новий catalog test; T14–17/T27. Sandbox write/print backend підтвердження BLOCKED_ENVIRONMENT, якщо його не підготовлено. **Risks:** loadCatalogs використовується price bridge; тестувати її read-only виклик, не ремонтувати прайс.

## PRD-07 — Штатна навігація конструктора

**Статус fix: BLOCKED_ENVIRONMENT.** Пакет містить скаргу; точна standalone root cause на цій базі невідома. Діагностика дозволена, speculative fix — ні.

**Goal / files:** inspect `graduation.html`, `js/graduation.js`, `css/graduation.css`; read-only `js/components/sidebar.js`, `js/auth.js`, `js/api.js`, shared shell CSS; optional regression `tests/products-demo-graduation.test.js` після встановлення причини.

**Steps:** відтворити `/graduation` top-level без embed query, окремо `?embedded=1`/iframe; capture DOM, menu click target, overlay bounds, computed z-index/pointer-events, console/network failures без secrets. Порівняти до/після modal open-close. Очікування: sidebar transitions з top-level; у embedded меню батьківської сторінки, без дубля child menu.

У standalone вже викликається Sidebar.init; `data-page-group=art` не є доведеною причиною. Не перейменовувати атрибут навмання, не міняти token inheritance, не видаляти embedded hide CSS, не приховувати menu. Якщо причина в локальному overlay/init timing/layout — мінімальний patch лише в allowlist після regression. Якщо shared render/guard/transition — записати exact symbol у S01 й залишити BLOCKED_SHARED.

**Done when:** baseline issue відтворено й після local fix top-level menu → `/programs`, `/designs`, `/center` (лише якщо дозволено) → back/refresh працює; embedded parent menu збережене; поля/формули незмінні. Якщо на базі дефект відсутній — завершити VERIFY_NO_REPRO з доказом, без patch.

**Checks / Live-site QA:** T18/T19/T25; B04/B05/B06; keyboard/modal lifecycle та existing unsaved-data behavior (beforeunload guard у graduation.js не знайдений; новий не вигадувати). **Gate PRD-09:** потрібен позитивний standalone navigation evidence, навіть якщо fix не потрібний.

## PRD-08 — Локальний стиль конструктора

**Goal / Scope:** READY на inspection і підтверджені cosmetics; не залежить від зміни global menu. Файли: `css/graduation.css`, main-content `graduation.html`, presentation-only markup `js/graduation.js` за потреби; `tests/products-demo-graduation.test.js`.

**Steps:** computed-style audit grad-page + page-container padding; controls/cards/tabs/summary в обох темах; поправити лише локальні overrides із наявних CRM tokens. Зберегти semantic category accents. Не змінювати diploma screens, services/package selectors, write/export/access helpers. Перед JS presentation diff записати fixture totals; після порівняти ті самі inputs. Якщо CSS вже відповідає прийманню, дозволено закінчити перевіркою без churn.

**Done when:** light/dark, 390/768/1440, long package names і summary units читабельні; немає double padding/viewport overlay; standalone та Art iframe не отримали регресії. Formula block `getCoefficient`…`calcTotals` і pricing inputs незмінні; результат fixtures збігається.

**Checks / Live-site QA:** B04/B05/B06, T18/T20/T22; screenshot + extracted-function fixture comparison. PRD-07 menu status зберігається окремо. **Risks:** baseline black-background complaint ще не відтворена; не замінювати всі кольори наперед.

## PRD-09 — Один локальний вхід до конструктора

**Статус: BLOCKED_ENVIRONMENT** до 06 + PRD-07 navigation gate. Семантична відповідність підтверджена спільним graduation packages API; ID binding не потрібний.

**Goal / files:** `renderCatalogEntries` в `js/programs-page.js`, styles `css/pages-products.css`, `tests/products-demo-flow.test.js`. Мінімальне місце — graduation card у `/programs#catalogs`, поряд із чинним «Відкрити каталог». Не вставляти constructor кнопку до generic catalogs чи price sheet.

**Steps після gate:** для `catalog.id === 'graduation'` показати одну native link «Конструктор випускного» → `/graduation`. Поточний `canAccessPage('/graduation')` після ready permissions lifecycle визначає видимість; без ready/allow не показувати. Врахувати чинний дозволений business scope; не створювати role arrays. Перевірити повторний render/lifecycle — немає duplicate link. Не змінювати API `secondaryHref` і не передавати package/service/query selection.

**Done when:** дозволений користувач переходить на перевірений route; denied не бачить локальної дії і не отримує доступ; старий sidebar `/graduation` лишається. **Checks / Live-site QA:** T21/T25/T03, B02/B04/B05; allowed/denied fixtures, refresh/back. **Risks:** остаточне місце у головному меню не погоджене; це S02, не локальна задача.

## PRD-10 — Регресія джерел, цін і контексту

**Goal / Scope:** READY для local evidence; жодних booking/price/backend fixes. Файли: тільки три нові tests із allowlist та `TEST_MATRIX.md`; existing contract tests запускати без редагування.

**Steps:** B01–B06 і виконані нові tests; при дозволеному isolated app B07. Порівняти `(businessContext,id,priceDate)` у list/details/booking і окремо kitchen productId/unit/qty; synthetic нуль/null, effective/next rule, per-child total, kitchen subtotal. Graduation formulas до/після на одному services/settings response: fixed/formula, entry thresholds, discount 0/10%, kids 10/11/15, package override без зміни правил. Зберегти базовий результат навіть якщо він виглядає нелогічно; окремий defect/blocker, не прайс-fix.

Dar/aggregate: спочатку реальний permission/profile contract; denied case не перетворювати на нову функцію. Test mocks не доводять backend isolation. Якщо sandbox доступний — без платежів і зовнішніх побічних дій, тільки явно дозволені synthetic records. Production mutations заборонені.

**Done when:** кожен T01–28 має evidence/status, source ID/date/unit preserved; власні regressions усунені в allowlist; backend/shared issue записано окремо; unavailable DB/browser не приховано. **Live-site QA:** NOT_RUN до безпечного середовища/сценарію; для демонстраційної готовності browser proof потрібний. **Risks:** наявні products.test.js/graduation.test.js мутують app; не запускати їх на довільному TEST_URL.

## PRD-11 — Пакет на рев'ю

**Goal / Scope:** READY після 10 з відомими статусами. Файли: `IMPLEMENTATION_REPORT.md`, `DEMO_SCRIPT.md`, `INTEGRATION_NOTES.md`, статуси у поточних п'яти документах; code diff тільки оглянути.

**Steps:** diff від base, staged/unstaged/untracked окремо; whitelist blocks і HR/shared check; список task outcomes і відтворюваних команд/артефактів; порівнювані screenshots лише справжнього fixture/app UI з рівнем доказу. Записати незроблене global move та sandbox gaps. Не створювати PR/commit/push/deploy. Збереження документа не підтверджує успіх реалізації.

**Done when:** reviewer може відкрити diff і повторити перевірки; demo script називає дані/URL/expected results та не рекламує неперевірені записи/PDF/generation. Вердикт наступного незалежного review: ACCEPT_LOCAL / CHANGES_REQUIRED / BLOCKED_INTEGRATION; це не release approval.

**Checks / Live-site QA:** T27/T28, `git diff --check`, команди ownership gate; демо лише за фактичними PASS. **Next action:** передати файли і diff Astra/власнику, не запускати повну CRM-34.

Рядок для власника головної черги (не внесено в неї): «CRM-22–CRM-27 винесено в окремий потік PRD-00–PRD-11. PRD-00/01 PLAN_READY; реалізацію ще не розпочато. Не запускати дубль. HR/CRM-18/CHK — окремий потік».
