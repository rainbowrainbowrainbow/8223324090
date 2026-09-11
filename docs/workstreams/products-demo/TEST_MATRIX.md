# Test matrix and baseline

## Stage B — результати приймання (2026-09-11)

Поточні результати нижче замінюють лише baseline-статуси Stage A. Рівень доказу не розширюється до DB/live.

| ID | Фактичний результат | Доказ / обмеження |
|---|---|---|
| T01 | PASS fixture | Saved kitchen → bare programs; browser sidebar → /programs |
| T02 | PASS fixture | Категорійні hashes/active state; animation/cake/menu records |
| T03 | PASS local; PARTIAL integration | jsdom hash/query/history/back, browser back/reload. Programs embedded baseline redirect незмінний, окремо не виправлявся |
| T04 | PASS jsdom | [] та null відрізняються; попередні картки очищаються |
| T05 | PASS jsdom/browser | Три ID/повний текст; details не потребують editor |
| T06 | PASS browser | Product absent/404 і catalog banner 404 без падіння |
| T07 | PASS jsdom/browser | Довгий escaped текст; HTML не виконується; missing description має повідомлення |
| T08 | PASS jsdom | Старий response і same-ID context switch не відновлюють старий record |
| T09 | PASS browser | Native summary Enter close/open, focus зберігається |
| T10 | PASS unit/browser | Product 0, null і variant presentation |
| T11 | PASS unit | Unit 100/child; cake 80/100 г × 2.5 = 200; metadata збережена |
| T12 | PASS browser fixture | Products/details light/dark screenshots |
| T13 | PASS browser fixture | 390/768/1440 без document overflow після готовності shell |
| T14 | PASS fixture / NOT_RUN DB | 3 synthetic packages; actual DB count/content не підтверджені |
| T15 | PASS jsdom/browser | Generic → graduation, races, arrows, disabled, close, reload→1/3; page permalink N/A |
| T16 | NOT_RUN export / N/A save | Graduation viewer create/save відсутні; print backend не запускали |
| T17 | PASS scope | Fixture loopback, external requests aborted; generator/bot/publish не запускали |
| T18 | PASS fixture / UNKNOWN live | Real sidebar standalone 3 destinations; synthetic parent iframe. Full Art/auth unavailable |
| T19 | PASS local info modal / PARTIAL | Info open/close + sidebar; решта write dialogs і unsaved persistence не перевірені |
| T20 | PASS browser fixture | Constructor і packages 2 themes × 3 widths; iframe controls visible; black-background defect не заявляється виправленим |
| T21 | PASS jsdom/browser | Graduation-only link, ready/allowed/single, denied/pending hidden, повторний render без дубля |
| T22 | PASS unit + unchanged blob | 10/11/15 kids × 0/10% discount, fixed/formula/entry, zero/positive package override; js/graduation.js ідентичний базі |
| T23 | PASS synthetic / NOT_RUN DB | Product ID/date/context/price snapshot; 100×10+200+50=1250; kitchen qty/subtotal; реальний UI/API/DB cross-match не виконаний |
| T24 | PARTIAL local / BLOCKED_INTEGRATION | Same-ID Park→Maysternya UI очищення PASS; Dar/profile/DB isolation не доведено |
| T25 | PASS static/local visibility / NOT_RUN runtime auth | Guard без змін; denied link fixture не є HTTP access proof |
| T26 | PASS | 55 existing + 20 new Node; 4 browser; 1312 UI; runtime/5 guards/3 parser checks |
| T27 | PASS | 5 runtime files + 4 new test files; docs/evidence окремо; staged порожній, protected blob audit |
| T28 | PASS handoff / review pending | 8 Markdown + patch/source audit + 30 PNG; незалежний reviewer ще не дав verdict |

### Точні запуски Stage B

B01–B06 повторені: runtime, 55 existing tests (шість файлів B02+B03 одним node --test), parser трьох JS, п’ять guards, test:ui. Результати збігаються з baseline; 55/55 та 1312/1312. Existing assertions не редагувалися.

```powershell
node --test tests/products-demo-flow.test.js tests/products-demo-catalog.test.js tests/products-demo-graduation.test.js
node --test tests/products-ia.test.js tests/products-cakes-catalog.test.js tests/products-detailed-tech-card.test.js tests/backoffice-foundation-v2.test.js tests/business-context.test.js tests/event-cards.test.js
npm run check:runtime
npm run check:access
npm run check:static-surface
npm run check:css-surface
npm run check:theme-surface
npm run check:timeline-protected-surface
npm run test:ui
node --check js/programs-page.js
node --check js/designs-page.js
node --check js/graduation.js
git diff --check
git apply --reverse --check -- docs/workstreams/products-demo/evidence/implementation.patch
```

Нові Node: **20 PASS**, 0 FAIL. Browser: **4 PASS**, 36.6 s останній запуск, команду cached Playwright наведено в [DEMO_SCRIPT](DEMO_SCRIPT.md). Новий spec існує і запускався; нижче Stage A «не існують/NOT_RUN» — історичний baseline. Browser CLI output directory останнього запуску явно заданий як `evidence/browser-run`; screenshots створюються тільки в `evidence`.

Суми constructor fixtures: kids10 → 2500/2250, kids11 → 2950/2655, kids15 → 3750/3375 (discount0/10%); per-child до discount 250/268/250. Entry відповідно 500/750/750. Package override0→120 (baseline fallback), override90→90, package subtotal210/duration90. Жодних нових цін у runtime.

B07 integration, B08 broad npm test/verify, B09 full syntax, B11 real app/live залишаються NOT_RUN. Немає підтвердженого disposable DB/auth target; зовнішні calls/production mutations заборонені. Fixture headers/auth mocks не доводять production доступ.


## Stage A — вихідний план і baseline (історія)

Base `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`, 2026-09-11. Усі виконані команди — з `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/products-demo-plan-20260911`. Stage A не змінював продуктового коду.

Рівні: **static** — текст/структура/guard; **unit/mock** — функція або DOM зі штучними даними; **integration-sandbox** — реальний Express/PostgreSQL у дозволеному disposable оточенні; **browser** — реальна навігація/рендер, із явним уточненням fixture чи app. Screenshot fixture не доводить DB/auth isolation. Код з route не є результатом HTTP запиту.

## Виконаний baseline

| ID | Точна команда | Рівень | Результат |
|---|---|---|---|
| B01 | `npm run check:runtime` | runtime | PASS: Node 22.23.1 / npm 10.9.8 |
| B02 | `node --test tests/products-ia.test.js tests/products-cakes-catalog.test.js tests/products-detailed-tech-card.test.js` | static | PASS: 17 tests, 0 failed |
| B03 | `node --test tests/backoffice-foundation-v2.test.js tests/business-context.test.js tests/event-cards.test.js` | static + unit/mock/jsdom | PASS: 38 tests, 0 failed; не browser, навіть для тесту з назвою visual smoke |
| B04a | `node --check js/programs-page.js` | syntax | PASS, exit 0 |
| B04b | `node --check js/designs-page.js` | syntax | PASS, exit 0 |
| B04c | `node --check js/graduation.js` | syntax | PASS, exit 0 |
| B05a | `npm run check:access` | static guard | PASS: 26 roles, 43 pages, 50 sidebar links |
| B05b | `npm run check:static-surface` | static guard | PASS: 42 root HTML, 3 landing, 8 redirects |
| B05c | `npm run check:css-surface` | static guard | PASS: 93 CSS files/references, 5 SW precache entries |
| B05d | `npm run check:theme-surface` | static guard | PASS: 42 pages, 16 inline debt budgets, 23 CSS budgets |
| B05e | `npm run check:timeline-protected-surface` | source hash guard | PASS: 6 protected blocks, 4 forbidden needles, 2 regression files |
| B06 | `npm run test:ui` | static/jsdom UI smoke | PASS: 1312 checks, 0 failed |
| B07 | `node --test tests/products.test.js tests/graduation.test.js` | integration-sandbox | NOT_RUN: немає підтвердженого ізольованого app/DB; тести містять writes |
| B08 | `npm test` / `npm run verify` | broad repository baseline | NOT_RUN: planning task обмежений цільовими перевірками; це значно ширший ланцюг, включно з unrelated HR/payment tests |
| B09 | `npm run check:syntax` | full parser sweep | NOT_RUN: виконано лише B04 для трьох UI scripts |
| B10 | style lint / TypeScript typecheck / build | — | NOT_APPLICABLE: відповідних штатних scripts у цьому static JS проекті немає |
| B11 | browser app / live QA / PostgreSQL proof | browser/integration | NOT_RUN: не запускались server/browser, credentials не завантажувались, actual deployed SHA не перевірявся |

Перший B02 запуск у sandbox завершився `spawn EPERM` до виконання test bodies. Через штатний escalation повтор успішний (17 PASS). Це environment failure, а не baseline product regression. B03 також запущено через дозволений escalation. Усі інші названі PASS мають фактичний exit 0. Package scripts і тестові файли прочитані до запуску; нові dependencies не встановлювались.

B03 містить і сторонні статичні assertions; їх лише прочитано/виконано, сторонні модулі/дані не змінювались. `npm run test:ui` — structural smoke, не ручна оцінка UX.

## Відтворення дефектів, фактично виконані у Node VM

R1 — saved tab, вивід **`kitchen cake`**. Функції взято без змін із фактичного source; це не завантаження всієї сторінки.

```powershell
node -e 'const fs=require("fs"),vm=require("vm");const s=fs.readFileSync("js/programs-page.js","utf8"); const c=vm.createContext({window:{location:{hash:""}},localStorage:{getItem:k=>k==="pzp_products_active_tab_park_zakrevsky"?"kitchen":null}});vm.runInContext(s.slice(s.indexOf("const PRODUCT_TAB_STORAGE_KEY"),s.indexOf("let activeBusinessContext")),c); console.log(vm.runInContext("readInitialProductTab()",c),vm.runInContext("readInitialKitchenTab()",c));'
```

R2 — graduation з чужим nonempty payload; вивід **`graduation [{"page_number":0,"title":"123"}]`**. `apiFetch` заборонено mock; renderer замінений спостерігачем. Підтверджено wrong payload ownership, а не screenshot/crash реальної сторінки.

```powershell
node -e 'const fs=require("fs"),vm=require("vm");const s=fs.readFileSync("js/designs-page.js","utf8");const c=vm.createContext({console,document:{getElementById:()=>null},apiFetch:async()=>{throw Error("Unexpected fetch");}});vm.runInContext(s.slice(s.indexOf("let catalogPackages ="),s.indexOf("function renderCatalogViewer()"))+"\nfunction renderCatalogViewer(){console.log(_viewerCatalogType,JSON.stringify(catalogPackages));}",c);vm.runInContext("catalogPackages=[{page_number:0,title:String(123)}];",c);c.target="graduation";vm.runInContext("openCatalog(target)",c);'
```

R3 — unit vs booking total, synthetic read query. Вивід **`{"zero":0,"missing":null}`** та **`{"unitPrice":100,"finalPrice":1250,"source":"price_rules","productId":"fixture-animation"}`**.

```powershell
node -e 'const p=require("./services/productPricing");const row={id:"fixture-animation",business_context:"event_genix",is_per_child:true,price:999,price_rule_code:"fixture-rule",price_rule_value:100,price_rule_unit:"child"};const b={programId:"fixture-animation",date:"2026-09-11",kidsCount:10,extraData:{bookingPackage:{positionsSubtotal:200,entrySubtotal:50}}};p.applyEffectiveBookingPrice({query:async()=>({rows:[row]})},b).then(s=>console.log(JSON.stringify({unitPrice:s.price,finalPrice:b.price,source:s.source,productId:s.productId})));console.log(JSON.stringify({zero:p.mapProductPriceFields({...row,price_rule_value:0}).price,missing:p.mapProductPriceFields({price:null}).price}));'
```

R1/R2 відповідають FAIL очікуваної продуктової поведінки; самі діагностичні команди exit 0. Після implementation створити assertions у планованих tests, не підміняти дефект «успіхом» діагностичного запуску.

## Fixtures для Stage B — створити лише всередині тестів

| Fixture | Мінімальний контракт / purpose |
|---|---|
| P-animation | synthetic string id `fixture-animation`, businessContext event_genix, domain program, category animation, description >120 chars, iconUrl synthetic served local asset, price 100, isPerChild true |
| P-cake | `fixture-cake`, domain kitchen, kitchenType/category cake, description, servingUnit; price/weight synthetic, не копіювати комерційні production-значення |
| P-menu | `fixture-menu`, domain kitchen, kitchenType menu, menuSection, description/shortDescription/promoDescription, servingUnit/weightValue/ingredients/allergens; довгий текст >180 chars |
| P-edge | параметризація price=0, price=null, priceVariantNote, відсутній/404 image, escaped HTML/Unicode; перевіряти той самий id перед/після |
| P-context | event_genix + maysternya_doli records і explicit allowed/denied Dar/profile fixtures; multi-scope read-only. Не стверджувати, що Dar має product access, якщо guard забороняє |
| C-grad | ≥2 synthetic packages: id/name/slug/description/imageUrl/minKids/maxKids/services/totalPerChild/totalDuration; services мають serviceName/durationMin/pricePerChild; banner served only locally |
| C-other | generic page_number/title/details/items/theme payload з `/api/catalogs/:id/pages`, відмінний від C-grad; delayed responses, empty, HTTP failure |
| G-formula | synthetic services/settings: fixed + formula + Entry threshold; kids 10/11/15, discount 0/10; before/after values з фактичних functions. Не копіювати Art constants |
| A-access | наявний capability contract: ready allowed, ready denied, pending; для link `canAccessPage('/graduation')`; no new role list |

Нові файли з EXECUTION_PLAN ще **не існують** і не запускались. Після їх додавання дозволені цільові команди:

```powershell
node --test tests/products-demo-flow.test.js
node --test tests/products-demo-catalog.test.js
node --test tests/products-demo-graduation.test.js
```

Наявний browser pattern: `tests/browser/event-cards-visual-smoke.spec.js` із local HTTP fixture server і @playwright/test; npm script `test:browser:event-cards` запускає цей spec через наявний npx runner. Це тест EventCards, не готовий Products flow. Для optional нового `tests/browser/products-demo.spec.js` використати той самий стек; за вже доступного runner можна `npx --no-install playwright test tests/browser/products-demo.spec.js --workers=1 --reporter=line`. Якщо runner/browser binary недоступні, NOT_RUN/BLOCKED_ENVIRONMENT; не встановлювати новий стек і не міняти dependencies/lockfile. Команда нового spec не виконувалась на Stage A.

Fixture server не стартує `server.js`; bind 127.0.0.1, port 0, усі API й external analytics/AI/network routes перехоплені в harness. Storage лише в новому browser context. Реальні secrets/контакти/зовнішні фото не використовувати. Screenshot path і fixture/app рівень записувати біля результату.

## Приймання T01–T28

Статус нижче — baseline, а не бажаний майбутній результат. «NOT_RUN; code…» означає, що сценарій ще не пройдено, попри наявний source trace.

| ID | Сценарій / expected | Дані / перевірка | Baseline і gate |
|---|---|---|---|
| T01 | Загальний вхід Products не підміняється тортами | R1; fresh context vs saved kitchen; потім browser sidebar → /programs | FAIL unit/function (D01); browser NOT_RUN |
| T02 | Три категорії та active state відповідають ID | P-animation/cake/menu, B02 + новий flow test | NOT_RUN behavior; static contracts PASS |
| T03 | Старі URL, query, refresh/back/forward | hashes з CONTEXT; maysternya/embedded; local history stack | NOT_RUN browser; B02 deep-link assertions PASS |
| T04 | Порожня категорія не підміняється чужими даними | [] vs null failure, delayed old response | NOT_RUN; D06 code confirmed |
| T05 | Деталі правильного ID в усіх 3 категоріях | P fixtures; readonly user | NOT_RUN; PRD-03 не реалізовано |
| T06 | No image / 404 image нейтральні | P-edge; network mock, alt/fallback | NOT_RUN browser |
| T07 | Довгий/порожній опис, текстовий HTML | >120/>180 chars; `<script>` rendered as text, не exec | NOT_RUN; truncation source confirmed |
| T08 | Швидке перемикання не показує попередній record/context | controlled delayed promises + context switch | NOT_RUN; new behavior test needed |
| T09 | Close/collapse, focus, scroll | native details keyboard + switch category | NOT_RUN browser; не додавати modal заради тесту |
| T10 | 0 відрізняється від null | R3 + future presentation test P-edge | PASS map function; UI NOT_RUN |
| T11 | Валюта/одиниця/тариф незмінні | R3 + source metadata; кухонна порція, per-child | PASS synthetic unit vs booking; presentation NOT_RUN |
| T12 | Дві теми Products/details | 390/768/1440, same fixture | NOT_RUN browser; B05 theme guard PASS |
| T13 | Підтримувані responsive ширини без overlap | ті самі records, keyboard focus, long name | NOT_RUN browser |
| T14 | Всі фактичні graduation pages з правильним контентом | C-grad + sandbox response list; count from response | NOT_RUN; 5 repo banners не DB count |
| T15 | Каталог switch/next/prev/close/refresh | R2 + C-grad/C-other; URL лише catalog-level | FAIL unit payload ownership (D03); browser NOT_RUN; individual page permalink NOT_APPLICABLE |
| T16 | Лише реально існуючі save/export дії | graduation viewer print endpoint; generic editor окремо | NOT_RUN export; graduation viewer create/save NOT_APPLICABLE; DB operations blocked без sandbox |
| T17 | Не запускались paid/external генерації | audit actions / network block у future harness | PASS Stage A scope: таких викликів не було; це не generator feature test |
| T18 | Штатне меню standalone й parent menu embedded | /graduation vs ?embedded=1; allowed pages/back | NOT_RUN; PRD-07 fix BLOCKED_ENVIRONMENT |
| T19 | Modal close/unsaved behavior збережені | локальні dialogs; поточний lifecycle; жодних writes | NOT_RUN; спеціальний beforeunload guard не знайдено, не створювати |
| T20 | Graduation controls/cards/summary у двох темах | G-formula, 390/768/1440 + iframe | NOT_RUN browser |
| T21 | Один локальний constructor link | graduation catalog card, A-access | NOT_RUN; PRD-09 gated T18 |
| T22 | Формули до/після незмінні | G-formula exact snapshot, immutable source calculation block | NOT_RUN behavior; code formulas audited |
| T23 | List/detail/booking IDs і порівнювана ціна | R3 + P fixtures, kitchen productId/quantity | PASS synthetic pricing mapping; full UI/API matching NOT_RUN |
| T24 | Park/Dar context isolation | allowed/denied profile + sandbox requests; clear old UI | NOT_RUN integration/browser; S03; B03 business-context unit PASS не доказ product isolation |
| T25 | Guards не змінені й не обійдені link | B05a, capability fixtures, direct denied route | PASS static matrix; runtime allowed/denied NOT_RUN |
| T26 | Реальні команди перевірок | B01–B11 | PASS виконані B01–06; решта явно NOT_RUN/N/A |
| T27 | Diff тільки в дозволеному scope | OWNERSHIP diff gate; inspect untracked docs | PASS Stage A final readback: tracked product diff відсутній, рівно п'ять нових Markdown; повторити у Stage B |
| T28 | Передача доступна й повторювана | п'ять docs + base + commands; Stage B reports | PASS planning package: усі п'ять файлів існують, внутрішні links цілі; implementation report/demo NOT_RUN до Stage B |

## Integration safety і repeat policy

`tests/helpers.js` читає TEST_URL (default localhost:3000), TEST_USER, TEST_PASS і вміє `REQUIRE_ISOLATED_TEST_TARGET=true` → `scripts/test-db-safety.js`. Це URL guard, не повна гарантія disposable DB. Перед B07 підтвердити окремий server/DB, відсутність external side effects та synthetic credentials; значення не друкувати. Не направляти B07 на production і не запускати app з production `.env`. Немає sandbox — B07 залишається NOT_RUN, unit mocks не замінюють його.

Graduation quote→booking має супутні child-pack/ops side effects; його не натискати для косметичного demo без окремого дозволеного isolated dataset. Аналогічно заборонені payment, fiscal, warehouse write-off, public link, publish та Telegram. Генераційні кнопки не тестувати реальними викликами.

Після кожного локального patch запускати потрібний focused test; повтор B01–06 у PRD-10. Broad `npm test` — за новою потребою/ризиком, не вимога виконувати unrelated work. Не змінювати існуючі assertions, guards чи theme budgets, щоб приховати failure. Якщо перевірка блокується середовищем, записати command + точну причину + next permissible check.

Для нового результату: task/test ID, точна команда або browser steps, fixture/context, рівень доказу, PASS/FAIL/NOT_RUN/NOT_APPLICABLE, observed output, artifact path, defect/blocker. Зберігати screenshots і звіти тільки у потоці; ніяких credential-bearing URL.

## Follow-up review evidence

R04 stale permission link: new test FAIL before local repair, PASS after. R05 count: FAIL before span/load metadata patch, PASS after including delayed response. 20 new tests: 10 Products, 6 catalog, 4 pricing/graduation. Browser now uses full designs-page.js/init/hash on mock HTTP; 4 PASS. Generic print payload and graduation export dispatch use VM spies only, not real printing/export. S07 resolved locally; DB/access integration gates remain. See IMPLEMENTATION_REPORT for exact boundaries.
