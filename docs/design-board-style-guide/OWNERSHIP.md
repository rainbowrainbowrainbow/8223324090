# Ownership і межі паралельної роботи

Дата: 2026-09-12. Потік: Design Board → Style Guide.
Після аудиту виконано локальний UI/storage-audit pass. Наведений нижче ownership відділяє вже змінені локальні файли від protected/shared робіт, які не погоджені автоматично.

## Власник цього handoff/audit patch

- `docs/design-board-style-guide/EXECUTION_PLAN.md`
- `docs/design-board-style-guide/CONTEXT_HANDOFF.md`
- `docs/design-board-style-guide/OWNERSHIP.md`
- `docs/design-board-style-guide/TEST_MATRIX.md`
- `docs/design-board-style-guide/SHARED_INTEGRATION.md`
- `docs/design-board-style-guide/ISOLATION_TECHNICAL_PLAN.md`

Жодні git commit/push/PR/deploy, release marker або cache-tag зміни не входять до поточного запиту.

## Власник локального UI/storage-audit implementation pass

| Файли | Статус і межа |
|---|---|
| `designs.html` | Internal Style Guide entry, lightbox markup, local light selector fixes |
| `css/designs.css` | Scoped Board/entry/lightbox/error styles, EOF comment hygiene |
| `js/designs-page.js` | List error/retry, safe DOM rendering, authenticated Blob download, image/PDF/error lightbox, focus cleanup |
| `designer.html` | Breadcrumb, `main-content`, hash tabs for `/designer#styleguide` while preserving `/designer` default |
| `tests/designs-page-ui.test.js` | New focused Design Board DOM/VM regressions |
| `tests/designer-navigation.test.js` | New focused Style Guide route/hash regressions |
| `scripts/audit-design-material-storage.js` | New read-only redacted storage inventory; no DB writes |
| `tests/design-material-storage-audit.test.js` | New fake-DB storage audit tests |
| `tests/ui-check.js` | Only the Design Board download guard belongs here; existing HR hunk remains foreign/shared |

## Майбутній продуктовий UI patch GPT-5.5

| Файли | Дозволена локальна зона після переходу до реалізації |
|---|---|
| `designs.html` | Board markup/error/dialog/internal Style Guide entry, page CSS; не переписувати весь inline style або catalog scripts |
| `js/designs-page.js` | List state, material preview/download, локальний entry; зберегти актуальні catalog async fixes та auth/session semantics |
| `css/designs.css` | Scoped page styling, EOF comment hygiene; без global theme |
| `designer.html` | Internal hierarchy/breadcrumb, fragment tabs, ARIA, local theme, чинний статичний контент |
| `tests/designs-page-ui.test.js` | Новий, вузькі поведінкові UI tests; файл уже додано локально |
| `tests/designer-navigation.test.js` | Новий, route/hash/history і grants visibility без зміни auth; файл уже додано локально |
| `tests/browser/designs-style-guide-browser-smoke.js` | Новий, synthetic/disposable fixtures; заборона production mutation за замовчуванням |

Усі чотири продуктові файли перевірити на dirty diff і свіжість ще раз перед першим edit. На початку аудиту вони не були dirty, але designs.html/js/designs-page.js відставали від origin.

## Shared — тільки integration owner, не автоматично в UI patch

| Файли | Причина / правило |
|---|---|
| `js/components/sidebar.js` | Уже dirty, інший потік HR; entry, utility rail, favorites, navigation для всієї CRM |
| `js/search.js` | Пошуковий індекс бере NAV_ITEMS; після вилучення /designer потрібен окремий shared compatibility hunk |
| `tests/ui-check.js` | Уже dirty; shared HR/navigation assertions |
| `config/permissionRegistry.js` | Захищений permission registry. Для T6 пропонується тільки navigation metadata sidebarLinks, окремо на review; жодної зміни доступу |
| `tests/permission-registry-contract.test.js` | Bidirectional NAV↔registry parity, fixed link count; зміни лише разом із актуальним integration diff |
| `tests/sidebar-designs-integration.test.js` | Запропонований новий тест належить інтегратору, якщо потрібен на актуальній базі |
| `package.json` | Unit/DOM wiring до `test:unit` для нових Design Board tests. Не міняти version/deps |
| `config/themeSurface.js`, `config/cssSurface.js`, `config/staticSurface.js` | Read-only guards; не піднімати budgets/не регіструвати новий surface для обходу failing check |

Збереження permission registry метаданих і видалення NAV entry не можна роз'єднувати. Якщо protected owner не дозволяє navigation-only hunk, T6 залишається BLOCKED. T1–T4 можуть бути завершені окремо.

## Protected / read-only

`routes/designs.js`, `services/designStorage.js`, `routes/catalogs.js`, `routes/products.js`, `routes/art-director.js`, `server.js`, `db/index.js`, `db/migrations/**`, `middleware/auth.js`, `js/auth.js`, `js/api.js`, `js/config.js`, `services/businessContext.js`, `config/authBoundary.js`, `config/storageSurface.js`, `.github/workflows/ci.yml`, `package-lock.json`, env/secrets/hosting files.

Також read-only shared CSS `css/base.css`, `css/dark-mode.css`, `css/pages-shell.css`, `css/sidebar-*.css`. Ніяких auth/page-role/default grant, API integration, migrations, new dependencies, quota/billing/storage plan/brand editor змін.

B1 data repair, B6 API partial update, B10 ownership/security потребують окремого explicit scope. T5 описує мінімум, не видає дозвіл.

Для B10 поточна дозволена робота завершена як documentation-only audit/plan у `ISOLATION_TECHNICAL_PLAN.md`. Реальні зміни в `routes/designs.js`, `services/designStorage.js`, `db/migrations/**`, `db/index.js`, `middleware/auth.js` або permission/access helpers лишаються protected і не входять у цей patch.

## Dirty worktree на вході

- **Shared і релевантні:** `js/components/sidebar.js`, `tests/ui-check.js`. Чужий HR hunk додає `profiles` до payroll activeHashes; відповідний test змінений синхронно.
- **Чужа HR робота:** `css/hr-page.css`, `js/hr-page.js`, `tests/hr-payroll-profiles-service.test.js`; untracked `tests/browser/hr-payroll-profiles-browser-smoke.js`.
- **Чужа Hermes/tasks робота:** `routes/hermes.js`, `services/taskReschedule.js`, `tests/hermes-routes.test.js`.
- **Чужі untracked матеріали:** `.codex-remote-attachments/`, `.worktrees/`, документи audit/tasks у docs, `docs/viber-personal-bridge/`. Не очищати, не включати до цього diff.

Це snapshot початку аудиту, не постійний lock. Паралельні зміни можуть з'явитися пізніше.

## Передача shared integration

1. GPT-5.5 передає owned UI diff, список тестів/результатів і доказ T4 PASS.
2. Інтегратор читає актуальні sidebar/registry/test diffs і SHARED_INTEGRATION.
3. Інтегратор вручну переносить лише semantic hunks на свою актуальну базу; цілі файли не копіює.
4. Перевіряє основне меню, rail/mobile, explicit user favorites, direct links, права на дві сторінки.
5. Тести й rollback hunks належать тому самому integration change.
6. Якщо release надалі авторизований — окремий release owner перевіряє точний SHA/branch, CI, version hygiene і live QA.

Rollback завжди стосується власних змін. Заборонені whole-file restore, hard reset, stash/cleanup або переписування чужих змін без explicit authorization.
