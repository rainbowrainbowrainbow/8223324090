# Shared integration: Style Guide navigation

**Статус: integration plan READY; product application BLOCKED до прийняття integration owner.**
Це інструкція й reviewable illustrative diff; вона не застосована до продукту. Sidebar паралельно редагує інший потік.

## Мета й порядок

Після Board → internal «Стайлгайд» → /designer#styleguide → Board PASS прибрати окремий default пункт «Стайлгайд» із головної навігації. Зберегти /designer, прямі URL, пошук, page grants, статичний content owner.

1. Взяти актуальну agreed branch/SHA, прочитати всі dirty diffs. Показаний нижче local контекст не є patch для сліпого git apply.
2. Використати локальний T4/T5 PASS як попередній доказ internal entry, але перед removal повторити M13–M16 на актуальній agreed base/users із обома та різними grants; не прибирати меню раніше.
3. Інтегрувати sidebar, navigation metadata і tests атомарно.
4. Перевірити expanded/mobile/utility rail і saved favorites; виконати M21–M23.
5. Якщо тест нового internal entry не проходить — лишити/відновити старий sidebar пункт. Не міняти auth для зелених тестів.

## Чому одного рядка недостатньо

- `js/components/sidebar.js:200–201`: обидва default entries.
- `tests/ui-check.js:3332` шукає наявність /designer href.
- `config/permissionRegistry.js:250` декларує sidebarLinks:['/designer'].
- `tests/permission-registry-contract.test.js:159,166,170–171`: exact count 50 і двостороння NAV↔registry parity.
- `scripts/check-access-matrix.js` допускає page capability без NAV entry, але registry test не допускає sidebarLinks без цього entry.
- Тому видалення route/PAGE_ACCESS не потрібне; треба лише погоджений navigation metadata hunk.
- `quickAccessOnly:true` приховає item у render(), але не в `_railFlyoutGroups` (`sidebar.js:834–850`). Не використовувати його як часткове рішення або змінювати global rail filter для обходу координації.
- `visible:()=>false`/CSS-hide теж не є повним видаленням entry; не вводити приховану альтернативну policy.
- Saved favorites уже мають визначену залежність: `sidebar.js:638–695` будує selectable catalog тільки з NAV_ITEMS. Без compatibility hunk saved /designer перестане рендеритися, а наступний save може відкинути його зі storage.
- `js/search.js:263–266` теж читає NAV_ITEMS. Alias /designer є, але fallback navigation item відсутній; сам alias не створює search result. **Показані нижче hunks видалення не застосовувати без кроку 3.**

## Reviewable semantic diff — тільки для інтегратора

### 1. Sidebar NAV_ITEMS

Файл: `js/components/sidebar.js`. Вилучити тільки entry, решту файлу не відновлювати зі старої версії.

```diff
         { href: '/designs',      icon: '🖼️', label: 'Дизайн-борд',   access: 'art',            group: 'product' },
-        { href: '/designer',     icon: '📖', label: 'Стайлгайд',     access: 'art',            group: 'product' },
```

Не видаляти /designer labels/search/breadcrumb mappings механічним replace-all. Зберегти всі чужі HR profiles та нові origin menu changes. Не додавати новий globally active alias до /designs лише для підсвічування: canonical child breadcrumb достатній; зміна active-state алгоритму — окремий shared review.

### 2. Registry: navigation metadata, не permission semantics

Файл: `config/permissionRegistry.js`. Лише після окремого прийняття protected-file owner:

```diff
         key: '/designer', label: 'Стайлгайд', group: 'product', canonicalPath: '/designer',
-        defaultRoles: ART_ACCESS, risk: 'medium', sidebarLinks: ['/designer'],
+        defaultRoles: ART_ACCESS, risk: 'medium', sidebarLinks: [],
```

key/canonicalPath/defaultRoles/risk/frontendConsumers/apiConsumers та server/frontend PAGE_ACCESS не змінювати. /designer залишається окремою capability й прямим route. Навігаційне приховування не дає нових прав.

Цей файл містить permissions, тому продуктовий UI-агент його не включає. Якщо owner вважає навіть navigation metadata поза погодженим scope — лишити T6 BLOCKED, не послаблювати guard і не робити frontend-хак. Request автора не дає дозволу на auth/permissions behavior changes.

### 3. Обов'язкове збереження search і явних shortcuts

Файли: `js/components/sidebar.js`, `js/search.js`. Це proposed shared implementation, нині її немає.

- Винести єдиний descriptor /designer (той самий href/label/access/page capability) у малий окремий `INTERNAL_SHORTCUT_ITEMS` list поза default NAV_ITEMS. Це список для discovery/explicit favorites, а не нова permission registry або renderer.
- Розмістити новий list поза source slice `const NAV_ITEMS = [` → `const HR_TEAM_BUCKET_IDS =`, який читає чинний registry test; test має рахувати тільки default NAV_ITEMS.
- `_getSelectableExtraMenuItems` використовує об'єднання NAV_ITEMS + INTERNAL_SHORTCUT_ITEMS з тими самими hasAccess/business/visibility checks. Тоді `_getSelectedExtraMenuHrefs`, `_getExtraMenuItems`, save і favorites rail зберігають explicit /designer. Не додавати його в default quick-access settings.
- Експортувати descriptor list через Sidebar; `js/search.js:getNavigationIndex()` додає його до індексу через чинний `add()`/canAccessSearchNavItem/dedup шлях. Main render і `_railFlyoutGroups` далі беруть лише NAV_ITEMS, тому default дублювання не повертається.
- Якщо на актуальній базі вже є відповідний internal/discovery catalog — використати його, не створювати паралельний list. Переоцінити конкретні назви перед edit.
- Тестувати старий saved /designer до/після save, дозволений та заборонений page grant, search queries «стайлгайд»/«designer», і відсутність default main/rail item. Не змінювати grants для того, щоб тест пройшов.

Це мінімальний compatibility план у двох shared файлах. Якщо integration owner його не приймає або не довів поведінковими тестами, **T6 лишається BLOCKED і NAV entry не видаляється**. Не мовчки приймати втрату search/favorites.

### 4. Tests — exact deltas на актуальній базі

`tests/permission-registry-contract.test.js`:

- На audit base count 50; після вилучення лише одного item буде 49. **На новій базі перерахувати фактичний N і змінити N→N-1**, а не фіксувати 49 навмання.
- Зберегти bidirectional checks. Додати regression: /designer page metadata досі існує, canonicalPath/defaultRoles/access consumers не втратилися, default NAV item відсутній.
- Не видаляти assertion як спосіб приховати drift.

`tests/ui-check.js`:

- Замінити лише твердження «Sidebar has /designer» на доказ нового internal href у designs.html та збереженого /designer content/route.
- Assertions про 5 Board tabs і 5 designer tabs залишаються правильними для рекомендованого native child entry; не міняти counts без фактичної зміни.
- Чужий HR profiles assertion зберегти дослівно від актуального owner diff.
- Static string check не замінює behavioral T4 і sidebar rendering smoke.

`tests/sidebar-designs-integration.test.js` (новий лише за потреби):

- Render main-nav і utility rail не містить default /designer.
- Board entry є; internal entry веде на canonical route.
- Explicit saved favorite на /designer має лишитися usable і зберігатися після редагування інших favorites завдяки кроку 3. Чинного fallback без цього hunk немає; не стирати localStorage користувача. Це user-added shortcut, не default дублювання.
- Єдині grants не змінилися; не використовувати grant mutation для QA.
- Інші product/HR items не зникли.

`package.json`: task-2 patch уже підключає нові unit/DOM tests до `test:unit`. Browser smoke виконується operator-run на встановленому runtime й не додається до звичайного npm test job без Chromium. Наявний browser CI job має explicit script list; його розширення потребує окремого approved CI scope. Ніяких нових packages/lockfile/engine/version змін або прихованого запуску через unrelated browser script.

## Acceptance checklist

- T4 live або approved target internal-entry QA PASS до навігаційного вилучення.
- /designer direct path, #styleguide та інші визначені fragments, reload/history працюють.
- Page grants designs/designer не злиті; users із одним grant не втрачають прямий дозволений доступ.
- Один default main menu Board; немає default Style Guide дубля в expanded/compact/mobile/rail.
- User favorites/search не очищені; explicit shortcuts не плутати з default main menu.
- `npm run check:access`, registry tests, `npm run test:ui`, targeted integration test — PASS на точному combined diff.
- Продуктові UI files і shared integration reviewable окремо; жодних unrelated files.
- B1 missing files / B10 isolation не оголошені виправленими після navigation QA.

## Rollback

Повертати тільки власні sidebar + navigation metadata + test hunks разом; зберегти чужі зміни. Якщо internal entry regressions виявлено після integration, першою дією відновити default /designer nav entry. Прямий server route не видалявся, тому зміни routes або data migration для rollback не потрібні.

Поточний запит не включає commit/push/deploy. Будь-який наступний release — за окремим delivery scope з чинним проектним CI/manual Railway/live QA workflow.

## Update after local UI pass 2026-09-12

Internal Style Guide entry і `/designer#styleguide` route continuity реалізовані та covered у `tests/designer-navigation.test.js`. Це знімає тільки product-UI залежність T4 для локального patch. Shared removal лишається окремим, бо `js/components/sidebar.js` уже має чужий HR dirty hunk, а removal без search/favorites/registry compatibility втратить discoverability або зламає existing tests.

Integration owner має починати не з копіювання всього файлу, а з `git diff -- js/components/sidebar.js tests/ui-check.js` і ручного перенесення semantic hunks на актуальну базу. Якщо owner не може зберегти explicit `/designer` shortcut у search/favorites, default sidebar entry краще тимчасово лишити.
