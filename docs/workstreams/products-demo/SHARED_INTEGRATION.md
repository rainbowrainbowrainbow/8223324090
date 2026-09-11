# Shared integration and decisions

Follow-up review: R04 cached constructor-link visibility and R05/S07 package count fixed locally. 75 Node / 4 browser / 1312 UI PASS. Browser uses full designs-page.js init/hash with mock HTTP. S06 direct print fallback has no tracked UI call sites; successful viewer print payload verified with spies, export remains NOT_RUN. Base and five-runtime-file ownership unchanged. See [review details](IMPLEMENTATION_REPORT.md).

## Stage B — поточний стан (2026-09-11)

Новий прямий запит власника авторизував READY PRD-02–PRD-11 без push/merge/deploy і protected змін. PLAN_ONLY нижче описує історичний Stage A, а не поточну заборону локального implementation. Base/HEAD залишився `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`; той самий ізольований worktree/branch.

PRD-02–06/08/09: DONE_LOCAL. PRD-07: VERIFY_NO_REPRO_FIXTURE; sidebar patch відсутній. PRD-10: DONE_LOCAL із BLOCKED_INTEGRATION для DB/auth/export. PRD-11: READY_FOR_REVIEW. [Фактичний звіт](IMPLEMENTATION_REPORT.md), [демо](DEMO_SCRIPT.md), [питання інтеграції](INTEGRATION_NOTES.md), [diff](evidence/implementation.patch). Нижчі вихідні task cards / baseline факти збережено як історію планування; нові статуси мають пріоритет.

### Оновлення shared gates

S01 має позитивний fixture navigation evidence і статус VERIFY_NO_REPRO_FIXTURE; PRD-09 виконаний лише локально. Live/real-auth symptom UNKNOWN. S02–S05 не розблоковано. Нові review-only S06 generic print fallback, S07 static count, S08 zero package override описані у [INTEGRATION_NOTES](INTEGRATION_NOTES.md). Жодного спільного патча не заплановано як обов’язкову умову локального PRD-02–06/08/09.


## Stage A — вихідний план і baseline (історія)

Base: `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`. Жодну спільну зміну не застосовано. Цей документ не дозволяє їх реалізацію. Немає підтвердженої обов'язкової shared code правки для локальних PRD-02–06/08; нижче окремі умовні gates та business/contract gaps.

## S01 — Menu конструктора: спочатку точна причина

- Status: BLOCKED_ENVIRONMENT; можливий BLOCKED_SHARED, але ще не доведений.
- Depends: PRD-07 fix, PRD-09 navigation acceptance.
- Evidence: `graduation.html` standalone DOMContentLoaded викликає `Sidebar.init('#sidebarLinks')`; `js/components/sidebar.js:init()` підключає shared render/toggle/transitions. Embedded режим ховає child sidebar навмисно. Конкретний overlay/root-router дефект не відтворено.
- Exact proposed shared diff: **NONE at present**. Не вигадувати зміну registry/route. Наступний виконавець додає сюди конкретний symbol/selector і reproduction, тільки якщо local diagnosis доведе потребу.
- Potential owner: власник shared shell/navigation (людина/чат не призначені). Read-only files: `js/components/sidebar.js`, `js/auth.js`, `js/api.js`, `css/layout.css`, `css/pages-shell.css`, `css/sidebar-aurora.css`, `server.js`.
- Risk: global overlay/transition/auth fix може зачепити HR, інші сторінки та permissions.
- Acceptance: standalone + iframe menu transitions, refresh/back, modal close, denied page, existing auth lifecycle. Після окремого owner patch повторити PRD-07/08/09/10; independent local cosmetics можуть завершитись раніше.

## S02 — Остаточне місце «Випускний» у головному меню

- Status: BLOCKED_DECISION + SHARED; не блокує локальний PRD-09 після S01.
- Evidence: `js/components/sidebar.js:NAV_ITEMS` вже має `/programs`, три category links, `/programs#catalogs`, `/graduation` у group `product`; `config/permissionRegistry.js` містить відповідні sidebarLinks/page entry. Старий sidebar entry не веде безпосередньо на cakes.
- Потрібне рішення власника: залишити окремий global `/graduation` або яке точне місце/назву призначити після додавання локального входу. Пакет такого рішення не містить.
- Мінімальна пропозиція після рішення: змінити тільки existing nav item's group/order/label у `js/components/sidebar.js`; не міняти href, guards чи page roles. Якщо owner вирішить змінювати href — спочатку exact permission registry/alias contract review, не приховано в UI patch.
- Tests: `npm run check:access`, відповідні permission-registry checks, `tests/products-ia.test.js`; sidebar navigation allowed/denied ролей та HR menu regression.
- Власник shared navigation не призначений. До окремої авторизації код read-only. Локальне посилання не називати завершеним global move.

## S03 — Dar/aggregate business scope і capability boundaries

- Status: BLOCKED_ENVIRONMENT для доказу, BLOCKED_CONTRACT для будь-якого виправлення protected mapping.
- Evidence: `services/businessContext.js` описує dar та aggregate scope; локальний `PRODUCT_BUSINESS_CONTEXTS` лише event_genix/maysternya_doli; `getProductApiBusinessContext()` мапить інше в event_genix. Shared `js/api.js:addProductBusinessContextParam()` передає scope; `routes/products.js` list supports scoped reads, detail/catalog endpoints вимагають single scope. `routes/graduation.js` services/packages читають окремі graduation tables без такого самого product-context predicate.
- Не підтверджено: чи current user/profile взагалі може пройти в Products/Graduation під Dar; витік даних не заявляється як доведений.
- Мінімальний наступний крок: read-only permission/profile + request/response scenario у дозволеному sandbox; labels, headers і display source звірити. Denied route є припустимим результатом чинного контракту, не підстава додати права.
- Якщо дефект підтверджений: exact patch proposal для owner business-context/auth із impacted endpoints і focused isolation tests. У цьому потоці не змінювати `js/api.js`, `services/businessContext.js`, `middleware/auth.js`, permissionRegistry, API contracts або локальні field priorities, що визначають scope.
- Blocks: лише claim повної T24/T25/PRD-10 ізоляції та будь-яке виправлення scope. Park single-context UI незалежний.

## S04 — Дані каталогу, медіа й ціни

- Status: BLOCKED_DECISION/CONTRACT лише для зміни джерел, local read UI READY.
- `buildCatalogPageHtml` бере approved description/theme constants і banner за slug; graduation API також має description/imageUrl. Питання власнику при потребі заміни: який з двох матеріалів має бути основним для цього демо? До рішення зберегти precedence і всі commercial values.
- Product contract дає одну iconUrl, не photo gallery. Немає фото — нейтральний стан. Для нових photos/API fields потрібна окрема задача, не fallback stock image чи генерація.
- Наявні `priceUnit`, `servingUnit`, `isPerChild`, `priceVariantNote` не об'єднувати в нове правило. Якщо вони суперечать у реальному записі — потрібен конкретний дозволений record і бізнес-рішення; не виправляти прайс або одиниці за аналогією.
- `apiGetProducts` null можна чесно обробити локально. `apiGetProductCatalogs` failure → [] в shared helper не відрізняється від empty. За відсутності помилки у response не вдавати конкретний backend success/failure. Зміна helper return shape — CONTRACT/SHARED, залежний error acceptance позначати обмеженим.
- Owner: products/catalog content або data/API owner, не призначені. Tests: відповідний ID/image/unit response проти screenshot + source test; жодних DB writes.

## S05 — Каталогові стилі і print

- `css/catalog.css` має category `feature-shared` в `config/cssSurface.js`, використовується також public viewer із `server.js` та print. У локальному плані він read-only.
- Мінімальна дозволена альтернатива: graduation screen-only scoped styles у `designs.html`, без збільшення theme debt budget. Generic catalog/print/public consumers не чіпати.
- Якщо browser reproduction доведе, що виправлення вимагає загальних selectors або окремого нового CSS asset: BLOCKED_SHARED, owner catalog/style governance має окремо погодити diff і реєстрацію у `config/cssSurface.js` / документах surface. Не міняти budget/manifest лише щоб тест проходив.
- Друк graduation генерується `routes/graduation.js` `/catalog/export`; screen polish не означає print polish. Backend export defect передати окремо. Tests: screen 390/768/1440, generic catalog unchanged, synthetic print layout з чинними export permissions. Production tokenized URLs не зберігати.

## Порядок інтеграції

1. Завершити локальний diff і PRD-10 із явними NOT_RUN/BLOCKED.
2. Для підтверджених shared gaps — власник погоджує точний patch scope та base. Не включати потенційні зміни «про запас».
3. Врахувати HR theme release `86402ee...`, що вже є в базі, й усі нові commits, які зачепили shared/allowlist files. Не відкотити cache tags або themes при конфлікті.
4. Після окремої інтеграції повторити названі сценарії та guards. Push/merge/deploy тут не авторизовані.

Готовність локального демо, повне завершення menu relocation і готовність усієї CRM до продажів — три різні висновки. Цей план підтверджує лише готовність до обмеженої реалізації.
