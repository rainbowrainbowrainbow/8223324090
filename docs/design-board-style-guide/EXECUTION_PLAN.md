# Execution plan: Design Board → Style Guide

Виконавець: GPT-5.5. Scope: наявні локальні UI, читабельний перегляд, внутрішня навігація. Поточний етап — локальний UI/storage-audit implementation pass виконано; protected DB/auth/sidebar/release роботи лишаються окремими.
Production impact: no — цей пакет. Production impact: yes — будь-який майбутній release або approved storage/ownership repair.

## Вхідний gate G0

1. Перечитати AGENTS.md, цей пакет; перевірити git status, HEAD, origin і live /api/version.
2. Узгодити із власником робочої бази актуальний checkout/worktree. Поточний checkout diverged і dirty; не робити pull/reset/rebase/stash автоматично. Не втратити origin catalog fixes.
3. Зафіксувати ownership. Лише docs зараз належать цьому потоку; майбутні owned UI-файли перелічені в OWNERSHIP. Shared sidebar/tests не входять у продуктовий patch.
4. Нових dependencies, lockfile, DB, API, auth, infrastructure, тарифів, quota, brand editor, папок, file manager не додавати.
5. Ознайомитися з B1/B6/B10. Вони блокують повне acceptance, але не локальні незалежні T1–T4.

## Рішення щодо внутрішнього Style Guide

| Варіант | Плюси | Мінуси |
|---|---|---|
| **Рекомендовано: native дочірній розділ** на Board → canonical /designer, breadcrumb/return | Один HTML owner, працює звичайне посилання/нова вкладка, route збережено, не потрібно API/auth | Окрема сторінка за чинним URL, а не одночасно видимий inline content |
| Iframe як шоста вкладка Board | Content в одному екрані | Немає готового designer embedded mode; потрібні нові shell/theme/focus/history механізми й ширша QA |

Виконувати перший варіант: розділ «Стайлгайд» видимий усередині Design Board, єдиний вхід у головній IA — Board; canonical дочірня сторінка лишається /designer. Не копіювати brand content у Board. Не додавати шосту material вкладку заради цього рішення.

## T1 — стани списку й доступна картка [READY після G0]

**Goal:** Board показує loading, список, empty або помилку й дозволяє зрозуміло перейти до матеріалу.

**Точні файли:** `designs.html`, `js/designs-page.js`, `css/designs.css`; нові `tests/designs-page-ui.test.js`, `tests/browser/designs-style-guide-browser-smoke.js`.

**Змінити:** локально перевіряти HTTP status/shape items,total, collections/tags; обробляти network/parse failures; показувати retry без фальшивого empty/success. Після успішних чинних auth/page-access checks не блокувати видимий page shell через збій однієї незалежної панелі. Зберігати фільтри/offset під час закриття перегляду. Дати матеріалу явний keyboard-accessible trigger із назвою; loading/retry status доступний screen reader. У зміненому рендері title/tag/collection використовувати textContent та DOM listeners/data-attributes замість вставляння даних у executable inline onclick. Чинний esc() не захищає JavaScript-контекст; навіть HTML entity для апострофа тут недостатньо.

**Не змінювати:** API shape/endpoints, page grants, auth bootstrap/refresh, edit/upload/pin business logic, правила collections; catalog/graduation generation code; shared UI helpers. `apiFetch` 401/403 token/session policy не переписувати під видом error state — це окремий auth owner gate.

**Acceptance:** 200/empty/500/malformed/network відображають різні чесні стани; retry відновлює список; елементи фільтрації не зникають; keyboard opening працює; дані інших запитів не підміняють актуальний filter result, якщо відтворено race.

**Tests:** M03–M06, M09; unit/DOM реальної page logic з синтетичними відповідями; browser на disposable fixtures. Нові tests існують лише після реалізації, зараз PASS не заявляти.

**Залежності:** G0; T2 використовує trigger. B1 не заважає error-state роботі.
**Rollback:** окремий UI hunk/commit T1 відкочується власником; зберегти нові origin зміни і чужі файли; даних ця задача не змінює.

## T2 — preview та чинний authenticated download [READY локально; end-to-end BLOCKED]

**Goal:** матеріал або коректно відкривається, або UI повідомляє про недоступність.

**Точні файли:** `js/designs-page.js` (openLightbox, setupLightbox, downloadDesign), `designs.html` (lightbox markup), `css/designs.css`; ті самі два нові test-файли T1.

**Змінити:** розділити image/PDF/unsupported/error стани. При missing file прибрати підміну favicon як успішний preview; одне повідомлення й retry/close. Для PDF використати native browser PDF view через Blob URL із отриманих чинним authorized download endpoint bytes; завжди показувати окрему дію «Завантажити», оскільки iframe/object load не доводить підтримку PDF. Download робити authorized fetch → status check → Blob/object URL з коректним MIME/filename та cleanup. Зберегти підтримку touch/new-tab без втрати user gesture. Додати dialog role/label, initial focus, focus trap/return, Escape/backdrop поведінку.

**Не змінювати:** routes, middleware, public file policy, token URL/query, нові preview endpoint або конвертер, storage schema; не використовувати public /uploads як обхід авторизації download. Не будувати нову detail-page/material deep-link систему. Не компенсувати B6 full-row PUT.

**Acceptance:** image/PDF synthetic fixture показує фактичні bytes; error ніколи не маскується favicon; 404/500 не завантажуються як файл; object URLs звільняються без передчасного обриву; desktop/touch/keyboard поведінка перевірена. Existing images source не називати tenant-safe. Повне LIVE PASS неможливе, доки B1 не усунено; isolation має окремий gate B10.

**Tests:** M07–M10; Authorization header, відсутність token у URL, 401/403/404/500, filename/MIME, PDF fallback; fake endpoints для успішного файлу, read-only live HEAD для реального стану. На production не експортувати реальні матеріали як тест download.

**Залежності:** T1; B1 recovery для live successful view; B10 для private material acceptance.
**Rollback:** revert лише T2 UI/тести; revoke створені object URLs при close/navigation; жодного data rollback.

## T3 — локальна презентабельність light/dark [READY після G0]

**Goal:** узгоджені локальні surfaces, читабельність і фокус без глобального ребрендингу.

**Точні файли:** `designs.html` (page style, особливо light overrides), `css/designs.css`, `designer.html` (лише local CSS/довідковий текст); `tests/browser/designs-style-guide-browser-smoke.js`.

**Змінити:** виправити body:not([data-theme="dark"]) відповідно до існуючого HTML data-theme/body.dark-mode contract; локально узгодити gallery/filter/cards/viewer/picker/error surfaces через наявні tokens. Закрити EOF comment у css/designs.css, якщо туди додаються правила. Перевірити cascade пізнього inline style. Вирівняти відступи/типографіку/контраст локально; довідковий текст Style Guide звірити з чинними tokens.

**Не змінювати:** css/base.css, css/dark-mode.css, css/sidebar-*, js/config.js, shared shell; theme persistence; кольори самих бренд-зразків, image/catalog artwork; не переносити весь inline CSS у нову архітектуру.

**Acceptance:** fresh reload light/dark та перемикання не змішують overrides; картки, фільтри, open viewer/picker й error text читабельні; focus видимий; 390/768/1440 px без небажаного overflow; канонічна тема інших сторінок не змінена.

**Tests:** M11–M12, computed styles + visual review на synthetic non-sensitive fixtures; check:theme-surface та check:css-surface без підняття debt budgets.
**Залежності:** T1/T2 markup перед фінальною visual QA.
**Rollback:** лише local CSS/style hunks T3, без rollback глобальної теми.

## T4 — Style Guide як дочірній розділ + route continuity [READY після G0]

**Goal:** Board → «Стайлгайд» → canonical content → повернення до Board.

**Точні файли:** `designs.html`, `designer.html`, `js/designs-page.js` (лише локальне оновлення видимості entry, якщо потрібне); новий `tests/designer-navigation.test.js`; browser test T1.

**Змінити:** додати помітний native internal entry на /designer#styleguide та breadcrumb/return у designer. Реалізувати локальне whitelist відображення #catalogs/#guideline/#brand/#styleguide/#templates на існуючі panels, hashchange, click→hash, Back/Forward; bare /designer зберігає catalogs default, unknown hash не ламає сторінку. Додати tablist/tab/tabpanel semantics та keyboard behavior. Перевіряти existing canAccessPage('/designer') і для return existing /designs grant; pending permission стан не має показувати дозволений вхід наперед.

**Не змінювати:** server.js /designer route, canonical capability keys, permissions/defaultRoles, API; не redirect /designer на /designs; не дублювати контент, не підключати brand CRUD, не додавати «Змінити». Статичні catalogs/templates не видавати за відкривані файли.

**Acceptance:** internal entry працює, styleguide panel відкривається, return працює для дозволеної пари grants. Прямий /designer й legacy URL із query/hash лишаються на цьому route; defined fragments/reload/history працюють. Користувач із дозволом лише на одну сторінку зберігає чинний доступ і не отримує нового grant. Existing /designs#gallery/#collections/#price/#calendar/#catalogs/#catalog-* збережено.

**Tests:** M13–M16; новий navigation behavioral test. Sidebar ще лишається видимим під час цієї QA.
**Залежності:** G0; T3 local styling; T6 дозволений лише після підтвердження T4.
**Rollback:** відкочувати internal entry/hash UI одним узгодженим hunk; /designer route ніколи не видалявся. Якщо T6 вже інтегровано — спершу відновити main menu entry, щоб не осиротити розділ.

## T5 — backend/data blockers: лише мінімальний технічний план [BLOCKED для реалізації]

### B1: недоступні збережені bytes

**Точні існуючі файли для читання:** `routes/designs.js`, `services/designStorage.js`, `scripts/backfill-legacy-upload-blobs.js`, `tests/legacy-upload-backfill.test.js`, `db/migrations/246_design_postgres_storage.sql`. Джерело backup ще не встановлене — не вигадувати його шлях.

**Мінімум після окремого дозволу:** read-only manifest трьох записів і blob/storage_key/checksum/disk availability; знайти існуючі legacy upload/backup bytes; звірити checksum; запропонувати bounded recovery через наявний backfill tool. Спочатку читання, потім окремо погоджений apply конкретних записів. Якщо джерела немає — чесний unrecoverable verdict, без повторного створення фальшивих файлів.

**Не змінювати:** metadata/delete/reupload/DB/raw backup/apply автоматично, не запускати CRM startup migrations.
**Acceptance:** для погоджених записів bytes відповідають джерелу, authorized download/preview PASS або явно погоджений unrecoverable результат.
**Tests:** M02/M07 + safe existing recovery tests; live HEAD + safe test fixture preview після repair.
**Залежності:** доступне read-only source inventory і recovery approval; T2 сам bytes не відновлює.
**Rollback:** snapshot точних записів/keys до apply, reversible manifest; збереження оригінальних bytes. Git revert не відновлює production data.

### B10: company/account isolation

**Точні існуючі target areas:** `routes/designs.js`, `services/designStorage.js`, `services/businessContext.js`, `server.js`, `config/storageSurface.js`; read-only schema у `db/index.js` + migrations. Новий `tests/designs-isolation.test.js` потрібен лише в окремому approved backend scope. Номер/ім'я майбутньої migration визначає DB owner після рішення моделі; зараз migration не створювати й номер не резервувати.

**Мінімум після окремого дозволу:** визначити tenant/company/business-context/account contract; зіставити існуючі матеріали/колекції з власниками; additive ownership schema; server-scoped list/count/tags/calendar/collections/item operations і bytes; authorized preview та private cache policy; вирішити compatibility public catalog/file links. Перевірити всі id/filename paths, не лише list.

**Не змінювати:** global roles/defaults/session policy без окремого обґрунтування; не припускати, що creator або однаковий role дає cross-tenant доступ; не frontend-фільтр.
**Acceptance:** A/B fixture accounts з однаковою дозволеною роллю не читають і не змінюють metadata/bytes одне одного; anonymous path не обходить policy; account switch не показує cached A.
**Tests:** M17–M19, disposable PostgreSQL, rollback compatibility.
**Залежності:** окреме погодження DB/API/auth/data mapping; account ≠ автоматично company.
**Rollback:** additive staged rollout, backup mapping, preserve ownership і bytes. Не відкочувати до public leakage як автоматичного fallback.

### B6: pin/unpin destructive partial update

**Точні файли майбутнього approved fix:** `routes/designs.js`; новий `tests/designs-update-contract.test.js`.
**Змінити після дозволу:** відрізняти omitted collection_id/publish_date від explicit null; зберігати omitted, дозволяти explicit clear за чинним контрактом.
**Не змінювати:** frontend full-row PUT, auth/schema, масовий repair історичних даних без доказів.
**Acceptance/tests:** M20; pin/unpin preserves collection/date/title/tags; explicit clear працює; stale frontend payload не потрібний.
**Залежності:** окремий API дозвіл; не натискати pin на live під час поточного аудиту.
**Rollback:** окремий backend commit; уже стерті значення потребують окремого recovery, git revert їх не поверне.

## T6 — shared integration та final sanity pass [BLOCKED до T4 QA / shared owner]

**Точні файли:** майбутній integration-only `js/components/sidebar.js`, `js/search.js`, `tests/ui-check.js`, `tests/permission-registry-contract.test.js`, navigation metadata у `config/permissionRegistry.js`; unit/DOM test wiring у `package.json` тільки integration owner. Новий `tests/sidebar-designs-integration.test.js`, якщо немає поведінкового тесту на актуальній базі.

**Змінити:** лише погоджені hunks SHARED_INTEGRATION після T4 PASS; прибрати default main-nav дубль, зберегти route/page grants і актуальні чужі sidebar зміни; зберегти пошук/saved favorites окремим navigation descriptor, який не рендериться в main-nav. Підключити unit/DOM tests до test:unit; browser smoke виконувати operator-run на встановленому runtime, автоматизація нового browser CI окремо.
**Не змінювати:** auth semantics, HR hunk profiles, count guards навмання, global cleanup, lockfile/version/deploy зараз.
**Acceptance:** один default main-nav entry Board; Style Guide доступний всередині, direct /designer і search збережені; expanded/mobile/rail/favorites поведінка визначена; регресій інших меню немає.
**Tests:** M21–M23 + check:access, registry/sidebar contracts, test:ui, syntax/theme/CSS guards; фінальний diff ownership check.
**Залежності:** T1–T4 релевантні tests, internal-entry QA; registry nav metadata потребує protected-file owner review. B1/B10 не дозволяють оголосити весь продукт готовим.
**Rollback:** узгоджено повернути тільки власні nav/metadata/test hunks; не restore файлів цілком. Новий internal entry можна залишити.

## Завершення майбутнього виконання

Для T1–T4 можливий окремий готовий UI patch із чесно переліченими blockers. Не називати його виправленням storage/isolation. Commit/push/deploy цей запит не авторизує. Якщо згодом буде явний delivery scope, використати проектний CI→manual deploy→live QA workflow й окрему version hygiene, не додавати release churn до UI diff.

## READY / BLOCKED за цілями користувача

READY нижче означає локально реалізовану або готову до isolated handoff частину, але не production release.

| Частина | Статус | Підстава / наступний gate |
|---|---|---|
| 1. Презентабельний наявний Board | READY для T1–T3 | Без API/DB/auth змін; загальний working-files acceptance залежить від B1 |
| 2. Доступ до збережених матеріалів | BLOCKED для виправлення end-to-end | Перевірку виконано: 3/3 preview/download 404; local transport T2 READY, recovery B1 окремо |
| 3. Company/account isolation | BLOCKED | Відсутня в schema/SQL/public preview; потрібне окреме ownership/security рішення B10 |
| 4. Локальні light/dark проблеми | READY | Встановлено конкретний selector defect, T3 |
| 5. Style Guide усередині IA Design Board | READY | Native internal entry + canonical дочірня сторінка, T4 |
| 6. Збереження Style Guide route/deep links | READY | /designer зберегти; підтримку fragment tabs явно додати, T4 |
| 7. Прибрати default main-nav дубль | BLOCKED до T4 QA + shared integration | T6; окремі sidebar/registry/test hunks |
| Додатково: pin/unpin без втрати metadata | BLOCKED | B6, потрібен API дозвіл; не включати frontend workaround |

Рекомендований наступний крок: передати GPT-5.5 T1–T4 на узгодженій актуальній базі, залишивши T5/T6 gates явними.

## Current implementation status 2026-09-12

T1 list resilience/render safety: **READY локально**. Реалізовано в `js/designs-page.js`, `designs.html`, `css/designs.css`; тести `tests/designs-page-ui.test.js` і `npm run test:ui` проходять.

T2 preview/authenticated download: **READY локально; live success BLOCKED by B1 bytes**. Download тепер використовує authenticated fetch/Blob, PDF/image preview читає ті самі authorized bytes, missing source показує помилку. Не змінювали `routes/designs.js`, public preview policy або storage schema.

T3 local light/dark UI: **READY локально**. Виправлено локальний selector/cascade для Design Board, додано scoped lightbox/error/card styling. Global theme files не змінювалися.

T4 Style Guide internal child + route continuity: **READY локально**. Board має internal entry, `/designer#styleguide` відкриває Style Guide, `/designer` лишається default catalogs, breadcrumb повертає до `/designs`.

T5 storage investigation: **READY як read-only audit; recovery BLOCKED**. Додано `scripts/audit-design-material-storage.js` і unit tests. Production read-only manifest показав 3 metadata rows без bytes/source. Наступна дія потребує source backup або operator-provided restored snapshot.

T6 sidebar duplicate removal: **BLOCKED/не виконано**. `js/components/sidebar.js` dirty у паралельному HR потоці, а removal потребує shared integration у `js/components/sidebar.js`, `js/search.js`, `config/permissionRegistry.js` navigation metadata і tests. Використати `SHARED_INTEGRATION.md`; не включати sidebar автоматично в UI patch.

B6 pin partial update: **BLOCKED/не виконано**. Вимагає API contract fix у protected backend route; не обходити full-row frontend PUT без окремого scope.

B10 company/account isolation: **BLOCKED/не реалізовано**. Поточна schema/API не має company/account predicates для designs, collections або blob preview. Потрібне product/security рішення і protected DB/API/auth plan; frontend filtering не є виправленням.

## Recommended next sequence

1. **B1 storage recovery discovery.** Owner/operator має надати explicit external backup root або archive, який може містити старий `uploads/designs`. Без цього не можна довести “material → view” до PASS. Команди починаються з read-only audit; apply backfill тільки після окремого approval.
2. **B10 isolation technical design.** Обрати ownership model: existing `business_context` чи інша company/account сутність. Мінімальна правильна реалізація потребує schema columns, migration/backfill defaults, route predicates, blob preview/download scope, collection/tag joins і tests із двома contexts. Це protected DB/API/auth scope.
3. **B6 pin metadata API fix.** Виправити partial update contract у backend або окремому endpoint так, щоб pin/unpin не зануляв collection/date. Не робити full-row frontend workaround.
4. **T6 sidebar integration.** Після перевіреного internal entry і прийнятого shared owner прибрати default `/designer` з main nav, зберігши direct route, search і explicit favorites. Це окремий diff за `SHARED_INTEGRATION.md`.
5. **Release path.** Коли B1/B10/T6 scope буде узгоджений або чесно відкладений як known blocker, тоді окремий delivery owner робить CI/manual deploy/live QA за проектним workflow. Поточний patch не містить commit/push/deploy.

Чому саме так: sidebar cleanup і UI polishing не відновлять файли та не створять tenant boundary. Якщо спочатку прибрати menu duplicate, продукт виглядатиме акуратніше, але головний сценарій saved material preview залишиться червоним, а data isolation — невизначеною. Тому порядок має йти від data availability/security до navigation cleanup.
