# Питання до інтеграційного рев’ю

Base `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`. Локальний код готовий до рев’ю; shared зміни не застосовано.

| ID | Статус / питання | Власник / точна межа |
|---|---|---|
| S01 | VERIFY_NO_REPRO_FIXTURE; production symptom UNKNOWN | Shared shell owner не призначений. `graduation.html` standalone init і реальний `js/components/sidebar.js` проходять synthetic transitions/modal close. Для реального симптома потрібні route/user/console/overlay evidence; жодного speculative sidebar patch |
| S02 | BLOCKED_DECISION/SHARED: остаточне global menu placement | Product owner + navigation owner; NAV_ITEMS/order/group без рішення не змінювались. PRD-09 додає тільки локальний entry |
| S03 | BLOCKED_INTEGRATION: Dar/aggregate auth і DB isolation | Business-context/auth owner. Локальна mapping event_genix/maysternya_doli залишилася; mock same-ID/context test доводить очищення UI, не backend partition |
| S04 | BLOCKED_DECISION/CONTRACT: каталоговий copy/image source і units | Catalog owner: graduation renderer лишає CATALOG_DESCRIPTIONS/themes/banner slug; product details читають iconUrl. Немає галереї/нового contract. Unit price не прирівнюється до booking total |
| S05 | BLOCKED_ENVIRONMENT: DB/export/full Art QA | Потрібне окреме дозволене sandbox середовище. Synthetic parent iframe не є реальним Art; повний designs initialization/HTTP permissions не перевірені |
| S06 | DEFERRED_SCOPE: unused direct print fallback; export integration not verified | git grep found no UI call sites for printCatalog(). Successful openCatalog → doPrintCatalog and background metadata refresh passed VM tests; print/window.open are spies only. Existing empty/error/editor print lifecycle still needs its own scoped review. Print functions unchanged. |
| S07 | RESOLVED_LOCAL: graduation count | #catalogPackageCount uses the same loaded graduation packages array as viewer; no hardcoded count. Zero, failure and late response tested. Actual live count remains unknown. |
| S08 | REVIEW: baseline zero package override | `js/graduation.js:calcPackageTotals` використовує overridePrice || effectivePrice. Нуль не працює як override; це baseline, зафіксований тестом. Pricing rule змінювати тільки окремим погодженим завданням |

PRD-02–06/08/09 виконані в дозволених локальних межах. PRD-07 fix не додавався. PRD-10 має локальні PASS та явні integration gaps. HR, auth, backend, migration, pricing, package dependencies і global theme diff відсутній.

Для інтегратора: перевірити точну поточну цільову базу, застосовувати вузький patch по hunks. Не копіювати цілі файли зі старого worktree поверх чужих змін. Designs і HTML cache markers можуть перетинатися з release hygiene інших потоків; цей patch їх не змінює. [Source audit](evidence/source-audit.json), [actual diff](evidence/implementation.patch), [test matrix](TEST_MATRIX.md).

Жодного push, merge, deploy, production read/write, credentials loading чи зовнішніх повідомлень не виконували. Цей документ не надає дозволу на release. Наступний крок — незалежне рев’ю і вибір дозволеного sandbox QA scope.


Follow-up: R04 cached link visibility repaired with existing lifecycle events; R05/S07 count repaired from the existing viewer source. No auth/API/pricing contract changes. Self-review complete; independent review and isolated integration QA remain.
