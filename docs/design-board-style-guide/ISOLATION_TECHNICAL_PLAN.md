# Design Board company/account isolation technical plan

Дата: 2026-09-12. Статус цього файлу: **READY як аудит і план; BLOCKED для реалізації**. Поточний task не дає дозволу змінювати DB schema, migrations, API/auth boundary або data ownership, тому тут зафіксовано фактичний стан і мінімальний protected implementation plan для наступного approved backend scope.

Production impact: no для цього documentation-only commit. Production impact: yes для майбутньої реалізації, бо вона змінить доступ до metadata і bytes Design Board.

## Фактичний стан

Design Board зараз має access gate за ролями, але не має company/account isolation. `routes/designs.js` застосовує `authenticateToken` і `requireRole('manager', 'art_director', 'marketer')`. Це перевіряє, що користувач може заходити в модуль, але не обмежує записи конкретною компанією, акаунтом або бізнес-контекстом.

Поточні route paths без ownership predicate:

| Endpoint | Факт | Ризик |
|---|---|---|
| `GET /api/designs` | `SELECT COUNT(*) FROM designs d ...`, list із `LEFT JOIN design_collections`, filters за tag/collection/search/pinned/date; немає `business_context`, `company_id` або `account_id` | Користувач із дозволеною роллю бачить глобальний список metadata |
| `GET /api/designs/tags` | рахує `design_tags` глобально | Tags/counts можуть змішувати матеріали різних бізнесів |
| `GET /api/designs/calendar` | читає всі designs із `publish_date` | Calendar може показувати чужі матеріали |
| `GET /api/designs/collections` | читає всі `design_collections` і глобальний count designs | Колекції та counts не ізольовані |
| `POST/PUT/DELETE /api/designs/collections` | mutation за collection `id` без scope | Можлива зміна або видалення чужої колекції, якщо id відомий |
| `POST /api/designs/upload` | вставляє `designs` без ownership column; `collection_id` не перевіряється на той самий контекст | Новий матеріал не має tenant owner; можна прив’язати до чужої collection id |
| `GET /api/designs/:id/download` | `SELECT ... FROM designs WHERE id = $1` | Metadata і bytes доступні за id для будь-якого дозволеного користувача |
| `PUT /api/designs/:id` | `SELECT * FROM designs WHERE id = $1`, потім update/tags за `id` | Чужий матеріал можна редагувати за id |
| `DELETE /api/designs/:id` | delete blob/file/design за `id` | Чужий матеріал можна видалити за id |
| `POST /api/designs/:id/telegram` | читає design і bytes за `id` | Чужий матеріал можна відправити назовні |

Storage також не має ownership boundary. `services/designStorage.js` створює `storage_key` у форматі `designs/{id}/{filename}`; ключ не містить контексту. `design_file_blobs` має `design_id` і `storage_key`, але не має `business_context`, `company_id` або `account_id`. `readDesignBlobByFilename` шукає bytes через `WHERE d.filename = $1`. Public fallback `/uploads/designs/:filename` зареєстрований як legacy preview path і може віддавати bytes без authenticated business scope, якщо файл існує локально.

Schema не дає durable isolation. `db/migrations/012_art_director.sql` створює `design_collections` і `designs` без ownership columns. `db/migrations/246_design_postgres_storage.sql` додає `design_file_blobs`, `storage_provider`, `storage_key`, `storage_migrated_at`, але теж без ownership. `design_tags` у migration 340 прив’язаний лише до `design_id`.

У репо вже є загальна модель бізнес-контексту в `services/businessContext.js`: `resolveBusinessScope`, `requireBusinessScope`, `requireWritableBusinessScope`, `pushBusinessContextCondition`, `pushBusinessScopeCondition`, `withBusinessContext`. Майбутня реалізація має використати ці helper-и, якщо owner підтвердить, що MVP isolation boundary = `business_context`.

## Рекомендована модель MVP

Використати існуючий `business_context` як мінімальну boundary для Design Board. Не вводити новий `account_id` або `company_id` у цьому scope, доки product/backend owner не вирішить, чи Design Board має жити в поточній business-context моделі, чи в окремій organization/company моделі.

Якщо потрібна саме company/account isolation поза `business_context`, частина лишається **BLOCKED** до рішення:

- яка таблиця є source of truth для company/account;
- як користувачі мапляться на company/account;
- чи один user може мати кілька компаній;
- як мігрувати існуючі Event Genix матеріали;
- чи мають shared/global brand assets бути видимими між контекстами.

## Мінімальний protected implementation plan

### 1. Additive migration

Створити наступну доступну migration після поточного HEAD. Не резервувати номер у documentation-only задачі. Migration має мати project-required headers `MIGRATION_KIND`, `SAFETY`, `ROLLBACK`.

Мінімум для `business_context` MVP:

- додати `business_context TEXT NOT NULL DEFAULT 'event_genix'` до `designs`;
- додати `business_context TEXT NOT NULL DEFAULT 'event_genix'` до `design_collections`;
- додати `business_context TEXT NOT NULL DEFAULT 'event_genix'` до `design_file_blobs`;
- backfill існуючих rows у `event_genix`;
- додати check constraint, сумісний із `normalizeBusinessContext`: `^[a-z][a-z0-9_]{2,63}$`;
- додати indexes для scoped reads:
  - `designs(business_context, is_pinned DESC, created_at DESC)`;
  - `designs(business_context, publish_date)`;
  - `designs(business_context, collection_id)`;
  - `design_collections(business_context, sort_order, name)`;
  - `design_file_blobs(business_context, design_id, updated_at DESC)`;
  - `design_tags(tag, design_id)` або scoped tag count через join із `designs`.

`design_tags` не обов’язково отримує окремий context column у MVP, якщо всі reads/writes tags проходять через scoped `designs`. Якщо потрібен швидший tag autocomplete на великих даних, можна додати denormalized `business_context` окремим performance follow-up, але не як frontend security fix.

`storage_key` unique можна залишити глобальним для backward compatibility. Для нових writes рекомендується включити context у key, наприклад `designs/{businessContext}/{designId}/{safeFilename}`. Legacy keys `designs/{id}/{filename}` мають читатися лише після scoped design lookup.

### 2. Routes: server-side scope everywhere

У `routes/designs.js` імпортувати наявні helper-и з `services/businessContext.js`. Для read endpoints використовувати `resolveBusinessScope(req)` + `requireBusinessScope(req, res, scope)` + `pushBusinessScopeCondition(params, scope, 'd')` або відповідний alias. Для write endpoints використовувати `requireWritableBusinessScope(req, res, scope)`.

Змінити:

- `GET /api/designs`: додати scoped condition до count і list; join із collections має враховувати `dc.business_context = d.business_context`;
- tag filter і tags aggregation мають рахувати лише tags scoped designs;
- `GET /api/designs/tags`: рахувати tags через join із `designs d` і scoped predicate;
- `GET /api/designs/calendar`: додати scoped predicate й scoped collections join;
- `GET /api/designs/collections`: scoped collections + scoped design counts;
- `POST /api/designs/collections`: writable single scope; insert із `business_context = scope.activeContext`;
- `PUT /api/designs/collections/:id`: update only where `id` і `business_context` match;
- `DELETE /api/designs/collections/:id`: null only designs у тому самому context, delete only scoped collection;
- `POST /api/designs/upload`: writable single scope; якщо `collection_id` передано, перевірити collection у тому самому context; insert design із `business_context`;
- `GET /api/designs/:id/download`: select by `id` + business scope before reading bytes;
- `PUT /api/designs/:id`: select/update by `id` + writable context; collection reassignment only within context; tags write only після scoped ownership proof;
- `DELETE /api/designs/:id`: delete blob/file/design only після scoped ownership proof;
- `POST /api/designs/:id/telegram`: select and read bytes only after scoped ownership proof.

Не робити isolation через `created_by`. Username є attribution, а не tenant boundary.

### 3. Storage: scoped bytes, no public bypass

У `services/designStorage.js` додати context-aware path без ламання legacy:

- новий `designStorageKey` або окрема функція має приймати `businessContext` для нових writes;
- `storeDesignBlob` має записувати `business_context`;
- `readDesignBlob` має мати context параметр і перевіряти `design_id + business_context`;
- `deleteDesignBlob` має видаляти scoped row, якщо context передано;
- `readDesignBlobByFilename` не можна використовувати як tenant-safe шлях без authenticated scoped lookup;
- public `/uploads/designs/:filename` не може бути джерелом tenant-private preview.

Після цього preview/download мають іти через authenticated `/api/designs/:id/download`, як уже зроблено в локальному UI pass. Public legacy fallback можна залишити тільки як compatibility для старих явно public assets або відключити для Design Board tenant-private materials після окремого рішення owner-а.

### 4. Frontend boundary

Frontend може передавати активний business context існуючим способом, якщо цей pattern уже використовується іншими сторінками. Але acceptance isolation визначається тільки server-side predicates і storage lookup. Не ховати чужі картки frontend-фільтром як security fix.

### 5. Tests

Додати backend tests у майбутньому approved scope:

- `tests/designs-isolation.test.js`: fake або disposable PostgreSQL fixture для двох користувачів із однаковою дозволеною роллю і різними business contexts;
- list/count/tags/calendar/collections не показують чужий context;
- upload із чужим `collection_id` повертає 403 або 404 і не створює design;
- download/update/delete/telegram чужого `id` повертають 403 або 404 і не читають bytes;
- filename/public fallback не обходить API scope;
- multi/all business scope read-only: list allowed only для authorized switch roles, mutations reject;
- legacy `event_genix` rows лишаються доступними для дозволеного `event_genix` user.

Після migration додати/оновити static ownership checks, якщо в репо є guard на business-context coverage. Мінімальний command set:

```text
npm run check:runtime
npm run check:migrations
npm run check:auth-boundary
npm run check:storage-surface
node --test tests/designs-isolation.test.js
npm run test:unit
```

Якщо зміни торкнуться real PostgreSQL behavior, потрібна disposable PostgreSQL або safe live read-only verification. Не запускати production mutations для доказу isolation.

## Acceptance criteria

- Кожен Design Board API read/write має server-side business context predicate.
- Design bytes не читаються за чужим `id`, чужим `filename` або public legacy path.
- Колекції не змішуються між контекстами й не можуть бути прив’язані cross-context.
- Tags і calendar counts не містять чужих designs.
- Existing legacy rows після backfill лишаються видимими для `event_genix`.
- `/designs` і `/designer` route continuity не змінюється.
- Frontend authenticated Blob preview працює для доступних bytes; missing bytes лишається чесною помилкою, а не fallback success.

## Rollback

Rollback має бути staged. Спочатку відкочувати route/storage code, щоб зупинити регресії доступу. DB rollback виконувати тільки після перевірки, що немає production rows із non-default `business_context` або що вони експортовані/мігровані. Не drop-ати ownership columns автоматично, якщо після release туди вже записані нові scoped дані.

Не використовувати public leakage як rollback fallback. Якщо scoped preview ламається через bytes recovery B1, показати error state і відновлювати bytes окремо.

## Current verdict

| Частина | Статус |
|---|---|
| Фактичний аудит Design Board isolation | READY |
| Documentation-only technical plan | READY |
| DB/schema migration | BLOCKED: protected scope, потрібен explicit approval |
| API/server predicates | BLOCKED: protected API/auth-adjacent scope, потрібен explicit approval |
| Storage bytes isolation | BLOCKED: protected storage/data scope, потрібен explicit approval |
| Company/account модель поза `business_context` | BLOCKED: потрібне product/backend рішення source of truth |
| Frontend-only isolation | REJECTED: не закриває bytes/API leakage |
