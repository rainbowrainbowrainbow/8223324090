# Design Board → Style Guide: фактичний контекст

Дата аудиту: 2026-09-12. Виконавець наступного етапу: GPT-5.5.
Пакет є планом і handoff, а не дозволом виконати BLOCKED-роботи.
Після первинного аудиту виконано локальний UI/storage-audit implementation pass без змін DB schema, auth/permissions, dependencies, git history або deployment.

## Межа доказів і база

- Local HEAD: `5381d9a8799a7e31ab855ae586268944863a4a4f`, `codex/eventgenix-production`; на початку ahead 1 / behind 277 від наявного origin.
- Read-only live `GET /api/version`: **200**, version **0.81.141**, SHA **439510122a4f1c296c1f43cccda1f16a7568763d**, branch **codex/eventgenix-production**. Цей SHA збігається з локально відомим origin.
- Локальну версію package.json не вважати активною production-версією. Pull/rebase/reset не виконувалися.
- `routes/designs.js`, `services/designStorage.js`, `css/designs.css`, `tests/design-storage.test.js`, `tests/designs.test.js` однакові в HEAD та перевіреному origin.
- `designer.html` відрізняється cache tags. `designs.html` і `js/designs-page.js` мають у origin суттєві нові graduation/catalog loading, error, async generation/stale-response і keyboard fixes. Не переносити старі файли повністю.
- Shared sidebar/auth/UI-check у origin істотно новіші. У поточному sidebar додатково є чужий dirty hunk для HR `profiles`.
- Посилання `file:line` нижче стосуються перевіреного local HEAD + початкового dirty worktree. Перед реалізацією знайти ті самі символи на актуальній узгодженій базі.

Позначення: **LIVE** — перевірено на живому сервісі; **SOURCE** — встановлено з коду; **SYNTHETIC** — реальний frontend-код у JSDOM/VM або service з fake SQL; **UNVERIFIED** — не підтверджено. PASS окремого рівня не означає end-to-end PASS.

## Карта реалізації

| Область | Фактичні файли та контракти |
|---|---|
| Сторінка Design Board | `server.js:452` → `/designs` → `designs.html`; `server.js:492` → `/embed/designs`; embedded chrome через `?embedded=1`, `js/designs-page.js:45` |
| Компоненти Board | `designs.html`: gallery/filter/drop zone, collections, price, calendar, catalogs, lightbox, edit/picker/Telegram modals; `js/designs-page.js`: DOM rendering і page state; framework components немає |
| Сторінка Style Guide | `server.js:612` → `/designer` → `designer.html`; navigation label «Стайлгайд», HTML title/header «Дизайнер» |
| Style Guide content | `designer.html:119–265`: catalogs, guideline, brand, styleguide, templates; статичні HTML-тексти, color swatches і typography samples |
| Головна навігація | `js/components/sidebar.js:200–201`: окремі `/designs` та `/designer` у product; short labels `:86–87`; додатково rail/favorites/search consumers |
| Search | `js/search.js:80–82` має aliases; реальний індекс `:263–266` бере NAV_ITEMS + feature/fallback descriptors. Окремого /designer fallback item немає; просте вилучення NAV зламає пошук |
| Page permissions | `config/permissionRegistry.js:248–258`: дві окремі page capabilities з ART_ACCESS; consumers у `middleware/auth.js`, `js/auth.js`, Sidebar |
| Metadata API | `server.js:294` mounts `routes/designs.js`; `:25–27` authenticateToken + requireRole(manager, art_director, marketer) |
| Розширення manager | `middleware/auth.js:319–342`: creator/director/vice_director/senior_manager/manager; extra roles підтримуються. Role access не означає company isolation |
| Storage | `services/designStorage.js`; `db/migrations/246_design_postgres_storage.sql`; Postgres BYTEA, legacy local disk fallback; окремого remote bucket для designs немає |
| Storage/page/CSS ownership | `config/storageSurface.js:83–99`, `config/staticSurface.js:123–135`, `config/cssSurface.js:293`, `config/themeSurface.js:30–31` |
| Theme | `js/config.js:275–310`: pzp_dark_mode, HTML data-theme, body.dark-mode; shared `css/base.css`, `css/dark-mode.css`, `css/pages-shell.css`; локальні `css/designs.css` та inline styles обох HTML |
| Тести | `tests/design-storage.test.js`, `tests/designs.test.js`, `tests/route-smoke.test.js:7046`, `tests/ui-check.js:1388,1486,3332`, `tests/permission-registry-contract.test.js:152–173` |

HTML shell routes самі по собі не є серверним tenant boundary. Page visibility/enforcement використовують frontend capabilities, а API має окрему серверну перевірку. Не плутати успішний GET HTML із правом читати metadata/bytes.

## API та джерела файлів

| Операція | Поточний endpoint / source |
|---|---|
| Список | GET `/api/designs`, `routes/designs.js:116`; `{items,total}`; search/tag/collection/pinned/publish_from/publish_to/limit/offset; UI page size 50, server max 200 |
| Метадані списків | GET `/api/designs/tags` `:177`; `/calendar` `:190`; `/collections` `:229` |
| Колекції | POST/PUT/DELETE `/api/designs/collections[/id]` уже реалізовані; нову систему папок не будувати |
| Upload | POST `/api/designs/upload` `:300`; до 20 файлів, 20 MB кожен; jpg/jpeg/png/gif/webp/svg/pdf; width/height при upload null |
| Download | GET `/api/designs/:id/download` `:377`; Bearer required; attachment; blob first → legacy disk, `:68–84` |
| Зміни | PUT/DELETE `/api/designs/:id` `:400,453`; POST `/:id/telegram` `:478`; не запускати в цьому аудиті |
| Preview | GET/HEAD `/uploads/designs/:filename`: DB blob → express.static uploads/designs → 404, `server.js:184–191` |
| Preview cache | `services/designStorage.js:101–117`: inline MIME, public max-age=300, stale-while-revalidate=86400 |
| Metadata schema | `db/migrations/012_art_director.sql:5–29`: designs/design_collections; design_tags у `340_db_startup_schema_ownership.sql:100–104` |
| Blob schema | `246_design_postgres_storage.sql:23–31`: design FK, storage_key, data, checksum; metadata storage_provider/key/migrated_at |
| Upload data flow | `routes/designs.js:312–359`: metadata → blob → mark stored → tags → COMMIT → cleanup temporary files |

**Не реалізовано:** окремий GET `/api/designs/:id` для detail, material detail route/deep link, server thumbnail/PDF rendering. Material у UI — запис із уже завантаженого масиву; не планувати непотрібний новий endpoint.

Каталоги — окрема існуюча гілка Board: `routes/catalogs.js:70,751` — definitions/pages; `/api/products/catalogs` у `routes/products.js:1217`; public viewer `/catalog/:slug/:token` у `server.js:620`. Catalog SQL теж не має tenant predicates; context-aware products wrapper цього не виправляє. Зберегти `/designs#catalogs`, `#catalog-*`, особливо `#catalog-graduation`, і нові origin fixes.

Style Guide не читає design/brand API. Окремий `routes/art-director.js` має brand CRUD і `brand_guidelines`; підключення його до `designer.html` було б новою функціональністю, виключеною користувачем.

## Фактичний сценарій Design Board → список → матеріал → перегляд

1. **LIVE PASS:** тестовий акаунт із senior_manager, QA-marker перевірений; login/verify 200, permissions для designs/designer true. Секрети завантажені локально; role elevation не виконувалося.
2. **LIVE PASS:** `/designs` відкрився в Chromium; GET list/collections/tags повернули 200. Список показав **3 картки**. Внутрішнього входу на `/designer` у page-container не знайдено; SOURCE підтверджує відсутність.
3. **SOURCE + SYNTHETIC:** клік по thumbnail викликає `openLightbox(id)`, `js/designs-page.js:486`; дані з масиву designs; окремого detail fetch немає.
4. **LIVE FAIL:** перший матеріал відкрив lightbox із favicon fallback. `img.complete/naturalWidth` були успішними лише для favicon, не для матеріалу.
5. **LIVE FAIL, ширша перевірка:** кожен із 3 повернутих записів мав MIME image/jpeg; HEAD public preview **404**, HEAD authenticated download **404**, HEAD anonymous download **401**. Назви, IDs, URL файлів і bytes не записувалися у звіт.
6. **LIVE PASS:** Escape закрив lightbox.
7. Це доводить недоступність усіх трьох перевірених матеріалів через чинні endpoints у момент аудиту. Не доводить фізичного знищення файлів, стану backup або доступності всіх історичних матеріалів. DB/backup inventory не виконано.

Браузерний probe використовував наявний cached Playwright/Chromium, окремий ephemeral context, serviceWorkers blocked, external requests blocked, усі бізнес-записи заблоковані. У виконаному probe blockedWrites=0. Не запускали upload/pin/edit/delete/Telegram, не зберігали screenshots чи customer content. Вхід тестового акаунта — єдиний необхідний POST; дані CRM не змінювалися. Це обмежений read-only browser smoke, не повна QA всіх UI-сценаріїв.

Джерело credentials для повторної дозволеної QA: `C:\Users\Plotva\.eventgenix\codex-crm-secrets.ps1`. Завантажувати локально в пам'ять, не друкувати values й не переносити в repo/artifacts. Не запускати готовий `scripts/live-authenticated-surface-qa.js` цілком у цьому scope: його main() тимчасово змінює QA role через creator lease; read-only probe цього не робив.

## Bug report / відсутні можливості

| ID | Симптом → очікування | Факт / причина / відтворення | Межа |
|---|---|---|---|
| B1 | Збережений матеріал має відкриватися | LIVE: 3/3 preview і authorized download 404. SOURCE: readers не знайшли доступні bytes; точну DB/disk/backup причину ще треба встановити | Recovery BLOCKED |
| B2 | Помилка файлу має бути явною | `openLightbox` `:491` підміняє error favicon; LIVE показав цю підміну | Local UI READY |
| B3 | Download має передавати чинну авторизацію | `downloadDesign` `:336–349` — naked anchor/new-tab; `middleware/auth.js:240–248` приймає Bearer header. LIVE anonymous HEAD 401, authorized HEAD 404 розділяє auth і missing-file проблеми | Transport READY; bytes BLOCKED |
| B4 | Підтриманий PDF має читабельний preview/fallback | PDF завжди присвоюється IMG → error → favicon. SYNTHETIC підтверджено; live PDF не було | Local preview READY |
| B5 | API 500/network має показувати error/retry | `loadDesigns` `:178–212` не перевіряє res.ok/payload; 500 {error} дає TypeError на designs.length; Promise.all у initPage зриває завершення shell | SYNTHETIC FAIL; READY |
| B6 | Pin має зберігати collection/date | frontend `:367–373` надсилає лише is_pinned; backend `:411–420` пише omitted collection_id/publish_date як null | SOURCE defect; API BLOCKED; не перевіряли live mutation |
| B7 | Dark UI не має отримувати light override | `designs.html:1150–1196`: body:not([data-theme="dark"]) matches dark body, оскільки атрибут стоїть на HTML | SOURCE + SYNTHETIC + LIVE selector mismatch; READY |
| B8 | Preview доступний із клавіатури | Thumbnail IMG tabIndex=-1, lightbox без role/dialog, aria-modal і focus management; Escape/backdrop уже існують | SOURCE/SYNTHETIC; READY |
| B9 | Fragment Style Guide має відкривати потрібну вкладку | `designer.html:309–318` лише toggles classes. LIVE `/designer#styleguide` відкриває catalogs; click styleguide працює. SYNTHETIC click не оновлює hash | Tab deep links НЕ РЕАЛІЗОВАНО; READY |
| B10 | Company/account isolation | Design SQL і schema не мають ownership scope; public preview не питає користувача | NOT IMPLEMENTED; BLOCKED |

Перевірка B1: read-only source/backup inventory і зіставлення metadata→blob→disk; B2–B9: детальні сценарії в TEST_MATRIX. Не маскувати B1/B6/B10 frontend-фільтрацією, full-row PUT або public-download fallback.

## Company/account context

Детальний plan: `docs/design-board-style-guide/ISOLATION_TECHNICAL_PLAN.md`.

- Загальна система має `services/businessContext.js:3–52,84–92`; body/query/x-business-context і доступні контексти користувача в `middleware/auth.js:64–111`.
- Design router не використовує цей scope. SQL list/count/tags/calendar/collections глобальний; item operations шукають лише id; blob preview — лише filename.
- designs/design_collections не мають company_id/account_id/business_context. created_by — attribution username, не ізоляція.
- Storage key `designs/{id}/{filename}` не містить ownership boundary.
- Preview зареєстрований перед API auth boundary й має public cache. Приховування карток або додавання company query param на frontend не захистить bytes.
- Статичний Style Guide однаковий для всіх дозволених користувачів: hardcoded Event Genix / Парк Закревського Періоду. Немає company-specific брендів, switcher чи API; не подавати його як персональний бренд компанії.
- Немає перевірених двох QA tenant/account fixtures. Не стверджувати, що production витік між двома компаніями був продемонстрований.
- Слід визначити, чи company isolation означає існуючий business_context, чи справжній tenant, і чи account — user або організація. Не прирівнювати ці сутності без рішення власника.

## Theme і навігаційні застереження

- Live reload із dark/light показав правильне перемикання основної картки: dark rgba(15,23,42,0.92), light rgba(255,255,255,0.5). Це не глобально зламана тема.
- Хибний light-selector matches в обох режимах. Повний contrast/modal visual audit ще не виконано.
- Desktop 1440 px Board та mobile 390 px Style Guide: horizontal overflow не виявлено; це вузький smoke, не повна responsive QA.
- `designs.html` inline CSS дублює `css/designs.css` і стоїть пізніше. Не виправляти неефективне правило лише в ранньому файлі.
- `css/designs.css:374` закінчується незакритим comment opener. Перед додаванням CSS локально закрити/прибрати саме цей EOF comment.
- Style Guide typography prose про Nunito main font не збігається з `css/base.css:151` Inter. За потреби поправити довідковий текст, не змінювати глобальну типографіку.
- Канонічний deep link — `/designer`. `#catalogs/#guideline/#brand/#styleguide/#templates` реалізовані локально як hash-tab navigation; `/designer` лишається catalogs default, `/designer#styleguide` відкриває Style Guide.
- Рекомендація: видимий внутрішній розділ/картка «Стайлгайд» на Board + canonical `/designer#styleguide` + breadcrumb/return. Один content owner, без iframe і копії бренду.
- Sidebar cleanup застосовано в Task 1 integration: default `/designer` прибрано з `NAV_ITEMS`, direct `/designer` збережено через `INTERNAL_SHORTCUT_ITEMS` для search/favorites; див. SHARED_INTEGRATION.
- Saved favorites більше не залежать тільки від default NAV_ITEMS для `/designer`: selectable catalog читає `NAV_ITEMS.concat(INTERNAL_SHORTCUT_ITEMS)`. Не прибирати internal descriptor без повернення default menu entry.
- У `renderTagChips` (`js/designs-page.js:445–447`) tag вставляється в inline onclick. `esc()` (`:270–272`) — HTML escape, не JavaScript escape. Для змінених місць T1 потрібні DOM listeners/textContent, з тестом апострофів і HTML-подібного тексту.

## Передача

Читати в порядку: CONTEXT_HANDOFF → OWNERSHIP → EXECUTION_PLAN → TEST_MATRIX → SHARED_INTEGRATION.
READY означає готовність обмеженої локальної реалізації, а не дозвіл на release. Повний сценарій має BLOCKED через недоступні bytes та відсутню ізоляцію.

## Implementation update 2026-09-12

Локально реалізовано презентабельний UI pass для Design Board/Style Guide:

- `designs.html`, `css/designs.css`, `js/designs-page.js`: recoverable list error/retry, безпечний render карток/tag chips без inline data handlers, authenticated Blob download через чинний `/api/designs/:id/download`, image/PDF lightbox з явною missing-file помилкою, ARIA dialog/focus return/Escape cleanup, локальні light/dark fixes, внутрішній entry «Стайлгайд» у Design Board.
- `designer.html`: breadcrumb назад до Board, `main-content` для skip-link, whitelist hash tabs; `/designer` лишається catalogs default, `/designer#styleguide` відкриває Style Guide, unknown hash безпечно повертає catalogs.
- `tests/designs-page-ui.test.js`, `tests/designer-navigation.test.js`: додано DOM/VM regression coverage для list error, render safety, authenticated Blob download, PDF/missing lightbox і Style Guide hash navigation.
- `tests/ui-check.js`: оновлено тільки релевантний Design Board guard на authenticated Blob transport. У цьому файлі також є чужий HR dirty hunk; не зараховувати його до Design Board patch.
- `scripts/audit-design-material-storage.js`, `tests/design-material-storage-audit.test.js`: додано read-only redacted storage manifest для metadata/blob/local legacy source inventory. Script виконує CLI-запуск у PostgreSQL `BEGIN READ ONLY` транзакції й не друкує filenames/content.

Read-only production storage audit через локальні EventGenix secrets повторно показав: generatedAt `2026-09-12T18:04:38.835Z`, scanned 3, `SOURCE_MISSING: 3`, ok 0, recoverableFromLocal 0, keyMismatches 0, manifestHash `6ee18d80c03ab89775a31652b562704f18bf93eda5bb5864b1fb7668d5cb282c`. У всіх трьох metadata rows немає `storage_provider`/`storage_key`; matching `design_file_blobs` bytes не знайдено. Локальний `uploads/designs` містить лише `.gitkeep` нульового розміру, а `.gitignore` і `docs/UPLOAD_DURABILITY_DISCOVERY_2026-06-28.md` підтверджують, що реальні legacy upload bytes не версіонуються.

Тому B1 після UI pass лишається BLOCKED саме на відсутність source bytes. Мінімальний recovery шлях: знайти operator-owned backup/snapshot із legacy `uploads/designs`; запустити `node scripts/audit-design-material-storage.js --source-root <restored-snapshot-root> --limit 50 --json`; якщо manifest покаже `LEGACY_DISK_SOURCE_PRESENT`, тоді окремо dry-run існуючого `scripts/backfill-legacy-upload-blobs.js --segment designs --source-root <restored-snapshot-root> --json`, review manifestHash/expected count, і лише після explicit approval виконувати apply backfill. Без реальних bytes не створювати placeholders і не маскувати проблему frontend fallback.

Додаткова звірка з `docs/STORAGE_SURFACE.md` підтвердила, що це вже відомий external-backup gate: Task 30 мав `designs` scanned 3, `UNRECOVERABLE_SOURCE_MISSING` 3; Task 35 зафіксував `EXTERNAL_BACKUP_ROOT_NOT_PROVIDED`. Project runbook також каже, що database backup artifact не містить external uploaded assets. Отже наступна задача не “написати ще код”, а отримати/перевірити конкретний backup root/archive з файлами.

B10 уточнено з коду: `routes/designs.js` використовує role middleware, але SQL list/count/tags/calendar/collections/download/update/delete/telegram lookup не має business/company/account predicate. `designs`, `design_collections`, `design_tags`, `design_file_blobs` не мають `business_context`/company/account columns. Існуючі helpers у `services/businessContext.js` можна використати тільки після schema decision. Правильний fix — protected DB/API/auth task, не frontend filter.

Гілка перебазована на `origin/codex/eventgenix-production` commit `7de2d4d61` (`Fix payment progress projection test harness`). Після цього локальні Design Board targeted tests, surface checks, `npm run test:ui` і повний `npm run test:unit` проходять. Push/deploy/live QA ще не виконувалися.
