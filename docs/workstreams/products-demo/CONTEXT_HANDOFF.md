# Products → Catalogs → Graduation: context handoff

Follow-up review: R04 cached constructor-link visibility and R05/S07 package count fixed locally. 75 Node / 4 browser / 1312 UI PASS. Browser uses full designs-page.js init/hash with mock HTTP. S06 direct print fallback has no tracked UI call sites; successful viewer print payload verified with spies, export remains NOT_RUN. Base and five-runtime-file ownership unchanged. See [review details](IMPLEMENTATION_REPORT.md).

## Stage B — поточний стан (2026-09-11)

Новий прямий запит власника авторизував READY PRD-02–PRD-11 без push/merge/deploy і protected змін. PLAN_ONLY нижче описує історичний Stage A, а не поточну заборону локального implementation. Base/HEAD залишився `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`; той самий ізольований worktree/branch.

PRD-02–06/08/09: DONE_LOCAL. PRD-07: VERIFY_NO_REPRO_FIXTURE; sidebar patch відсутній. PRD-10: DONE_LOCAL із BLOCKED_INTEGRATION для DB/auth/export. PRD-11: READY_FOR_REVIEW. [Фактичний звіт](IMPLEMENTATION_REPORT.md), [демо](DEMO_SCRIPT.md), [питання інтеграції](INTEGRATION_NOTES.md), [diff](evidence/implementation.patch). Нижчі вихідні task cards / baseline факти збережено як історію планування; нові статуси мають пріоритет.

### Уточнення фактичного коду під час виконання

- `loadCatalogs()` тепер повертає array/null, а не переписує global viewer payload; `openCatalog()` володіє transient state і generation.
- `renderProductPrice()` — тільки presentation wrapper; shared priceDate/booking/source contracts незмінні.
- `/graduation` standalone menu працює в fixture; `data-page-group=art` не перейменовувався. Embedded child menu прихований штатно.
- `/programs` embedded bootstrap вже перенаправляє на / до нижньої legacy branch; protected bootstrap не змінено. Не називати нижній недосяжний fallback підтриманим новим маршрутом.
- Виявлені generic print fallback/static count питання передані S06/S07 у INTEGRATION_NOTES. Реальний каталог не має підтвердженої кількості пакетів.


## Stage A — вихідний план і baseline (історія)

Дата аудиту: 2026-09-11. Етап: PRD-00/PRD-01, PLAN_ONLY. Статус: PLAN_READY з явно обмеженими доказами. Продуктовий код не змінено. Production impact: no.

## Авторизація і база

Безпосередній запит власника дозволяє аудит і п'ять документів плану. Прикріплений пакет є специфікацією потоку; його промпти IMPLEMENT/HANDOFF/REVIEW не є командою запускати наступний етап, інших агентів чи delivery. HR → Checklists не входить у роботу. Реалізація у 5.5 потребує наступного запуску власником.

- Source package: `C:/Users/Plotva/Downloads/CODEX_PRODUCTS_PARALLEL_ASTRA_55_2026-09-10.md`, version 1.0. Прочитано PRD-00–11, межі та матрицю.
- Базовий commit: `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`.
- Гілка: `codex/products-demo-plan-20260911`.
- Ізольована копія: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/products-demo-plan-20260911`.
- База взята з локального remote-tracking ref `origin/codex/eventgenix-production`. Fetch та перевірка live SHA не проводились. Це не твердження про актуальний production.
- Вихідний спільний checkout: `C:/Users/Plotva/OneDrive/Документи/EventGenix`, HEAD `5381d9a8799a7e31ab855ae586268944863a4a4f`, ahead 1 / behind 156 від локального origin на початку.
- Його чужий diff: `routes/hermes.js`, `services/taskReschedule.js`, `tests/hermes-routes.test.js` — 223 additions / 1 deletion. Також untracked `.codex-remote-attachments/`, `.worktrees/` і вісім audit/task Markdown у `docs/`. Вони не переносились і не редагувались.
- Новий worktree перед документами був чистий. Sandbox спершу відхилив створення ref; повтор через штатний escalation успішно створив worktree. Спільний checkout не перемикався.
- Прочитано `AGENTS.md` саме нової бази, `README.md`, scripts у `package.json`, surface/permission configuration та наведені нижче реалізації. Відмінності від старих наданих правил враховані; вузький запит PLAN_ONLY має пріоритет над звичайним delivery workflow.

## Карта реалізації — підтверджено кодом

| Екран / URL | Власник UI | Read path / дані | Наявний доказ |
|---|---|---|---|
| Продукти `/programs`; embedded alias `/embed/programs` | `programs.html`, `js/programs-page.js`, `css/pages-products.css` | `apiGetProducts(true,{businessContext})` → `/api/products?active=true&businessContext=...` → `routes/products.js` → `products` + price-rule join | `tests/products-ia.test.js` PASS |
| Анімації `/programs#animation`, alias `#animations` | `renderProgramProducts`, `PRODUCT_CATEGORY_HASH_TO_ID` | той самий список; `domain=program`, `category=animation` | static + isolated function reproduction |
| Торти `/programs#kitchen-cakes`; старий `#kitchen` | `renderKitchenProducts`, `getKitchenType` | `domain=kitchen`, `kitchenType=cake` | `tests/products-cakes-catalog.test.js` PASS |
| Меню `/programs#kitchen-menu` | той самий renderer + наявний фільтр menuSection | `domain=kitchen`, `kitchenType=menu`; descriptions, servingUnit, weightValue | cakes + detailed-tech-card static tests PASS |
| Каталоги `/programs#catalogs` | `loadCatalogEntries`, `renderCatalogEntries` | `apiGetProductCatalogs()` → `/api/products/catalogs`; `catalog_definitions`, `catalog_pages`, `catalog_items`; response `{success,catalogs}` | products IA PASS |
| Випускні `/designs#catalog-graduation` | `designs.html`, каталогові блоки `js/designs-page.js` | hash handler → `openCatalog('graduation')` → `loadCatalogs()` → `/api/graduation/packages` | products IA deep-link static PASS; state defect reproduced |
| Інші каталоги `/designs#catalog-<id>` | той самий designs viewer + inline editor | `/api/catalogs/:catalogId/pages` → `catalog_pages`; це інший контракт | код; не розширювати функції |
| Окремий конструктор `/graduation`; alias `/embed/graduation` | `graduation.html`, `js/graduation.js`, `css/graduation.css` | `/api/graduation/services`, `/packages`, `/settings` → `graduation_services`, `graduation_packages`, `graduation_package_items`, `graduation_settings` | код + syntax PASS, browser NOT_RUN |
| Центр цін `/center`, секція `#pricesSection` в огляді | `center.html`, `js/center-page.js` | `/api/center/prices`, `/prices/positions`; `routes/center.js` | backoffice-v2 static PASS |
| Компактний вибір у бронюванні `/` | `js/config.js`, `js/booking.js`, `js/booking-form.js` | `getProducts()` / `getProductsSync()`; API products з businessContext + priceDate | read-only source trace, synthetic pricing PASS |

Не вигадувати `/products`, `/catalogs` чи новий SPA router. Маршрути монтуються в `server.js`: `/api/products` ~290, `/api/catalogs` ~301, `/api/graduation` ~342; `/graduation` ~514. Номери рядків — орієнтири бази; шукати за функціями при drift.

## Центр цін і бронювання

Центр цін не видалено. Окремого пункту «Центр цін» у `NAV_ITEMS` немає: є `/center` («Центр керування»). `pricesSection` є в HTML; `syncCenterRevenueUi()` приховує її без `view_revenue`; API також має `requireCenterRevenue`. Не плутати з вкладкою «Фінанси», яка вбудовує `/finance?embed=1`. Причина невидимості в конкретному обліковому записі UNKNOWN: його capability payload / browser state не перевірявся. Не змінювати права чи додавати пункт меню для обходу.

`services/productPricing.js` є підтвердженим механізмом ефективної ціни продукту:

- `buildProductPriceJoin()` використовує `price_rules.product_id = products.id`; за наявності `priceDate` обирає effective_from ≤ date; без дати — останній updated rule.
- `mapProductPriceFields()` повертає `priceSource=price_rules` за наявності linked value, інакше `products`; `legacyPrice`, `priceCode`, `priceUnit`, effective/next-price metadata зберігаються. `0` і `null` розрізняються.
- `routes/center.js` `/prices/positions` показує linkage. Це не означає, що всі продукти мають linked rule або що graduation/catalog page prices читають цю саму таблицю.
- `js/config.js` `getProducts()` (~469) та `getProductsSync()` (~509) тримають кеш із businessContext і timeline priceDate. `js/booking.js` `findBookingProductById`, `getSelectedProgramIdFromUi`, `getBookingFormData` пов'язують вибір із `programId`.
- Кухонні позиції: `getBookingMenuProducts()` та `normalizeBookingMenuPosition()` (~3382) зберігають `productId`, `unitPrice`, `quantity`, `subtotal`, `servingUnit`. Quantity має наявний мінімум 0.1 і округлення до 2 знаків. Не замінювати кухонний subtotal програмною ціною.
- Backend bookings викликає `applyEffectiveBookingPrice()` (`routes/bookings.js`, зокрема ~3613): program unit price × kidsCount для isPerChild, плюс positionsSubtotal та entrySubtotal; money округлюється до 2 знаків; є виняток client pinata. `extraData.priceSnapshot` фіксує productId/source/date/value.
- Синтетичний приклад фактично виконано з mock query: unit 100 × 10 дітей + positions 200 + entry 50 = booking 1250, source `price_rules`. Вітрина має показувати unit 100 у відповідній одиниці, а не 1250. Це доказ функції, не PostgreSQL.

## Фото, описи та категорії

`routes/products.js` `mapProductRow()` (~1110) повертає `id`, `businessContext`, `category`, `domain`, `kitchenType`, `iconUrl`, `description`, `shortDescription`, `promoDescription`, ingredients/techCard/allergens, servingUnit/weightValue, price metadata. List і `GET /api/products/:id` використовують цей mapper; detail потребує single-business scope і повертає 400/404 для некоректного ID/контексту. Для запланованого inline перегляду повних полів списку достатньо, нового detail request не потрібно.

Програмна велика картинка `EventCards.renderEventCardImage()` — спільна ілюстрація типу події, не гарантоване фото конкретного продукту. Індивідуальне зображення — наявний `iconUrl` (`renderProgramIconVisual`). Kitchen renderer читає `productMenuImageUrl()`; mapper фактично гарантує лише `iconUrl` із переліку його image aliases. Функція manifest lookup у файлі є, але `renderKitchenCardVisual()` її не використовує (`usesFallback=false`). Не підключати її як нове джерело фото. Галерея масиву фото контрактом не підтверджена.

Program description обрізається до 120; kitchen detail fields — до 180. Редагування не є доступним усім переглядом: `openProductForm` gated через manage/write. Найменше рішення PRD-03 — нативне локальне `<details><summary>` всередині наявної картки з повним escaped text і наявним індивідуальним зображенням. Не створювати новий редактор, завантажувач чи product table.

Зберегти також підтверджені кодом категорії quest/show/photo/masterclass/pinata/custom і окремий maysternya_doli. Їхня наявність у live DB не перевірена. Анімації/торти/меню винести у видимі локальні переходи, інші чинні категорії не прибирати.

## Каталог і конструктор: різні представлення

Graduation viewer в `/designs` читає `graduation_packages` із services; **не** `catalog_pages` навіть якщо catalog definition `graduation` існує. `routes/products.js /catalogs` може синтезувати fallback entry з кількості packages та status `ready`; це не доказ готовності сторінок і не фактичний demo count.

`buildCatalogPageHtml()` (~1512) використовує `CATALOG_DESCRIPTIONS`, `CATALOG_THEMES`, services і `/images/catalogs/graduation/${slug}-banner.png`. Репозиторій містить 5 banner assets: handmade-party, pizza-party, super-party, neon-party, science-party. Кількість assets ≠ кількість активних пакетів у БД. API також повертає `description` і `imageUrl`, але поточний graduation renderer їх не робить основним джерелом. Не замінювати approved copy/banner precedence без рішення власника.

Друк/PDF action веде в `/api/graduation/catalog/export?print=1` (в існуючому коді додається token). Це серверний друкований документ, окремий від screen renderer і generic public `/catalog/:slug/:token`. Нові public links не створювати, URL з token не записувати в докази. Screen cosmetics не є перевіркою PDF.

Конструктор використовує окремі `graduation_services/settings` та свої формули (`js/graduation.js` ~155–248): ceil(pricePark / coefficient × markup / 10) × 10; defaults 6/1.15; entryRule thresholds; selected services; discount; service costs; totalPerChild обчислюється від gross, totalAll враховує discount. Не прирівнювати catalog totalPerChild, quote total і booking total без однакових входів. `POST /api/graduation/quotes/:id/booking` читає quote, створює booking і запускає суміжну graduation automation — не косметична дія.

На цій базі `art-director.html:377` вбудовує `/graduation?embedded=1`, `js/art-director-page.js` lazy-loads iframe. Це той самий поточний модуль. Існування іншого історичного Art calculator не доведене; нічого з нього не переносити. Локальні зміни graduation CSS зачеплять і iframe, тому smoke обох режимів обов'язковий, Art-файли read-only.

## Дефекти і межі доказів

| ID | Симптом / expected → actual | Причина і reproduction | Статус доказу |
|---|---|---|---|
| D01 | Загальний Products має зрозумілий overview; натомість відкриваються торти | `/programs` без hash + `pzp_products_active_tab_park_zakrevsky=kitchen`: `readInitialProductTab()` → kitchen, `readInitialKitchenTab()` → cake. Sidebar href вже `/programs`, не cakes | Відтворено Node VM на функціях бази; browser NOT_RUN |
| D02 | Перегляд повного опису без write permission; натомість скорочені рядки | renderProgramProducts / renderKitchenDetailPanel substring, універсального read-only full detail немає | Код; функціональна UI-перевірка NOT_RUN |
| D03 | Після іншого каталогу graduation має завантажувати graduation packages | `openCatalog` змінює `_viewerCatalogType`, але не завантажує packages, якщо спільний `catalogPackages.length>0`; synthetic catalog page залишається при type=graduation | Відтворено Node VM, network заблоковано mock; browser NOT_RUN |
| D04 | Штатне меню конструктора дозволяє вихід | standalone викликає `Sidebar.init('#sidebarLinks')`, embedded навмисно ховає власне меню. Перекривальний шар/проблема доступів/помилка shell на standalone не відтворені | UNKNOWN; PRD-07 fix BLOCKED_ENVIRONMENT |
| D05 | Дві теми й відступи читабельні | CSS містить локальні gray variables і body.dark-mode rules; явні скарги на чорні блоки не підтверджені browser evidence | NOT_RUN visual; PRD-08 лише локальна перевірка/підтверджені косметичні правки |
| D06 | Error не має виглядати як справжня порожня категорія | `apiGetProducts()` повертає null при failure, caller робить `|| []`; catalog helper теж може перетворити failure на [] | Код; локально відрізнити product null, catalog [] неоднозначність — CONTRACT blocker |

На широкому бізнес-контексті є додатковий ризик: shell підтримує `dar`/aggregate scopes, локальний `PRODUCT_BUSINESS_CONTEXTS` описує тільки event_genix/maysternya_doli, `getProductApiBusinessContext(dar)` повертає event_genix. Наявні shared guards/profile можуть забороняти такий вхід; конкретна поведінка Dar UNKNOWN. Не «виправляти» mapping чи permissions у PRD-02. Контекстні тести мають зафіксувати allowed/denied flow і відсутність витоку, а не автоматично вимагати продаж продуктів у Dar.

## Ізоляція і передача

HR worktree знайдений read-only: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/hr-checklists-theme-20260910`, branch `codex/hr-checklists-theme-20260910`, HEAD `86402ee666246ffb48bb31f7e88c49db5eb3b0d1`, чистий на момент перевірки. Його release commit уже є в ancestry нашої бази; містить також shell CSS і cache tags у programs/designs/graduation. Тому перетин можливий навіть без правок HR-файлів. Не скасовувати ці зміни.

DB, dev server і браузерна сесія не запускались; порти не резервувались; credentials не завантажувались. Sandbox DB для цього потоку не підтверджена. Browser/DB NOT_RUN є прогалиною доказів, не доказом відсутності інструментів. Node modules для виконаних тестів резолвились у наявному середовищі без install; новий worktree не має власної встановленої копії dependencies.

Документи в цій копії: `docs/workstreams/products-demo/{EXECUTION_PLAN,CONTEXT_HANDOFF,OWNERSHIP,TEST_MATRIX,SHARED_INTEGRATION}.md`. Вони uncommitted; зміна моделі в цьому самому task/worktree зберігає доступ. Для іншого середовища перенести ці п'ять документів і source package, checkout exact base на окремій гілці, перевірити статус. Не cherry-pick чужі HR/Hermes зміни і не починати з застарілого root HEAD.

Перша задача після запуску реалізації власником: PRD-02. PRD-07/09 та DB-підтвердження мають окремі блокери. Див. [план](EXECUTION_PLAN.md), [ownership](OWNERSHIP.md), [матрицю](TEST_MATRIX.md), [shared integration](SHARED_INTEGRATION.md).
