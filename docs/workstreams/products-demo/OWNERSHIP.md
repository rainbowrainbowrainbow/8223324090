# Products demo ownership

Follow-up review: R04 cached constructor-link visibility and R05/S07 package count fixed locally. 75 Node / 4 browser / 1312 UI PASS. Browser uses full designs-page.js init/hash with mock HTTP. S06 direct print fallback has no tracked UI call sites; successful viewer print payload verified with spies, export remains NOT_RUN. Base and five-runtime-file ownership unchanged. See [review details](IMPLEMENTATION_REPORT.md).

## Stage B — поточний стан (2026-09-11)

Новий прямий запит власника авторизував READY PRD-02–PRD-11 без push/merge/deploy і protected змін. PLAN_ONLY нижче описує історичний Stage A, а не поточну заборону локального implementation. Base/HEAD залишився `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`; той самий ізольований worktree/branch.

PRD-02–06/08/09: DONE_LOCAL. PRD-07: VERIFY_NO_REPRO_FIXTURE; sidebar patch відсутній. PRD-10: DONE_LOCAL із BLOCKED_INTEGRATION для DB/auth/export. PRD-11: READY_FOR_REVIEW. [Фактичний звіт](IMPLEMENTATION_REPORT.md), [демо](DEMO_SCRIPT.md), [питання інтеграції](INTEGRATION_NOTES.md), [diff](evidence/implementation.patch). Нижчі вихідні task cards / baseline факти збережено як історію планування; нові статуси мають пріоритет.

### Фактична власність diff

Runtime: `css/graduation.css`, `css/pages-products.css`, `designs.html`, `js/designs-page.js`, `js/programs-page.js`. Додано тільки чотири дозволені test files та docs/evidence потоку. У shared root і HR worktree записів не було. Створення/зміна branch/commit у Stage B не виконувалися.

`source-audit.json` порівнює git blobs 16 protected files із base; усі незмінні. `git diff --cached` порожній; `git apply --reverse --check` перевіряє code+tests patch без застосування. Жодних dependencies, env чи version marker змін. PNG fixtures і власний browser report зберігаються в `evidence`.


## Stage A — вихідний план і baseline (історія)

Base: `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`. Root усіх відносних шляхів — ізольований worktree з CONTEXT_HANDOFF.md. Stage A може змінювати тільки п'ять документів цієї директорії. Нижче — allowlist для майбутнього авторизованого Stage B, а не дозвіл реалізовувати зараз.

## Точний allowlist Stage B

| Файл | Дозволена частина | Задачі |
|---|---|---|
| `programs.html` | header/category overview, existing product grid/detail host markup; local product styles у межах theme budget; жодних shell/auth/bootstrap/cache-tag змін | 02–04, 09 |
| `js/programs-page.js` | local route/tab state, read list presentation, full inline details, renderCatalogEntries graduation-only link; локальний stale-response guard | 02–04, 09 |
| `css/pages-products.css` | styles scoped до Products, нові локальні detail/overview класи; не глобальні variables/reset | 02–04, 09 |
| `designs.html` | тільки існуючий `#tabCatalogs` graduation card / `#catalogViewer` markup та вузькі styles для graduation screen viewer | 05–06 |
| `js/designs-page.js` | `loadCatalogs`, `openCatalog`, `renderCatalogViewer`, `renderCurrentPage`, `catalogNext/Prev`, `closeCatalog`, graduation branch `buildCatalogPageHtml`; shared state лише мінімально для запобігання D03 з regression іншого каталогу | 05–06 |
| `graduation.html` | локальний main-content layout і штатне підключення оболонки **лише після reproduction PRD-07**; не token inheritance/auth/embed protocol | 07–08 |
| `css/graduation.css` | grad-page/controls/service cards/summary/tabs локальні теми, spacing, overflow; не diploma/export layout | 07–08 |
| `js/graduation.js` | тільки доведений локальний navigation/overlay lifecycle дефект або presentation markup; calculation, API writes, access, quote/diploma/automation logic заборонені | 07–08 |
| `tests/products-ia.test.js` | змінити лише assertions свідомо зміненого локального UI; не послаблювати sidebar/access/source contracts | 02–04, 09 |
| `tests/products-demo-flow.test.js` (новий) | node:test + vm/jsdom локальних product route/detail fixtures | 02–04, 10 |
| `tests/products-demo-catalog.test.js` (новий) | graduation/generic switch, delayed replies, close/error/empty, без external calls | 05–06, 10 |
| `tests/products-demo-graduation.test.js` (новий) | навігаційний lifecycle після reproduction, контроль незмінних формул на synthetic inputs | 07–08, 10 |
| `tests/browser/products-demo.spec.js` (новий, optional) | наявний Playwright stack, локальна fixture page / дозволений isolated app; read/mocks only за відсутності DB | 04–10 |
| `docs/workstreams/products-demo/EXECUTION_PLAN.md` | фактичні уточнення локальної реалізації та статуси | 02–11 |
| `docs/workstreams/products-demo/CONTEXT_HANDOFF.md` | виправлення фактів із доказом | 02–11 |
| `docs/workstreams/products-demo/OWNERSHIP.md` | журнал безпечних уточнень; вихід за файл/межу не самодозволяти | 02–11 |
| `docs/workstreams/products-demo/TEST_MATRIX.md` | результати та evidence | 02–11 |
| `docs/workstreams/products-demo/SHARED_INTEGRATION.md` | потрібні owner decisions/shared patches | 02–11 |
| `docs/workstreams/products-demo/DEMO_SCRIPT.md` (новий) | точний перевірений demo flow | 06, 11 |
| `docs/workstreams/products-demo/IMPLEMENTATION_REPORT.md` (новий) | diff/tests/statuses | 11 |
| `docs/workstreams/products-demo/INTEGRATION_NOTES.md` (новий) | остаточні gaps та порядок рев'ю | 11 |

Optional screenshot files: тільки `docs/workstreams/products-demo/evidence/` або окрема output directory цього потоку; імена й перелік записати у IMPLEMENTATION_REPORT. Без PII/credentials/private URLs. Нові `.js/.css` runtime assets не плануються: вони потребували б surface/version registration; використовувати існуючі локальні файли.

## Shared-only / read-only

- `server.js`; `middleware/auth.js`; `js/auth.js`; `config/permissionRegistry.js`, `config/permissionTestContracts.js`; middleware/business-context guards, `services/businessContext.js`.
- `js/components/sidebar.js`, `js/sidebar-smart-menu.js`; `js/api.js` (включно з CrmBusinessContext), `js/config.js`, `js/ui.js`, `js/event-cards.js`, `js/kitchen-menu-images.js`.
- `css/base.css`, `css/layout.css`, `css/pages-shell.css`, `css/pages.css`, `css/dark-mode.css`, `css/responsive.css`, `css/modals.css`, `css/sidebar-aurora.css`, `css/assistant-rail.css` та інші shared/shell styles.
- `css/catalog.css` — **feature-shared** за `config/cssSurface.js`: screen/print/public catalogs. Не вважати весь файл локальним. Використовувати graduation-specific override в дозволеному designs.html у межах бюджету; необхідна загальна зміна → SHARED_INTEGRATION.
- `config/staticSurface.js`, `config/cssSurface.js`, `config/themeSurface.js`, `config/timelineProtectedSurface.js` і відповідні governance docs — не міняти guards/budgets заради зеленого тесту.
- `center.html`, `js/center-page.js`, `routes/center.js`, `routes/products.js`, `routes/catalogs.js`, `routes/graduation.js`, `services/productPricing.js`, `services/graduationOpsAutomation.js`, `services/graduationDiplomas.js`.
- Усі booking/timeline файли, зокрема `routes/bookings.js`, `js/booking.js`, `js/booking-form.js`, `js/booking-banquet-selector.js`, `js/booking-banquet-detail.js`, `js/booking-package-renderer.js`, `js/timeline.js`.
- `art-director.html`, `js/art-director-page.js`, `js/catalogs.js` (generation/publish/Telegram), designs board/editor/price sheet/AI/inline generic catalog blocks поза дозволеними секціями.
- `db/index.js`, `db/migrations/**`, `data/graduation-packages.json`, `data/graduation-services.json`, images/uploads, price rules та реальні дані. Read-only seeds — історичний доказ, не live truth.
- `package.json`, `package-lock.json`, runtime pins, `sw.js`, `.github/**`, hosting/env/secrets. Версію і cache tags не синхронізувати в цьому пакеті.

## Інші власники і перетини

HR → Checklists: `hr.html`, `js/hr-page.js`, HR/checklist CSS, `routes/hr.js`, HR services/tests, професії, onboarding, payroll — поза allowlist незалежно від конкретних назв. `tests/browser/hr-checklists-theme-browser-smoke.js` не використовувати для запуску чужого flow. HR worktree не змінювати і його checkout не перемикати.

HR release HEAD `86402ee666246ffb48bb31f7e88c49db5eb3b0d1` містив cache/version правки в `programs.html`, `designs.html`, `graduation.html`, `js/designs-page.js`, а також shared shell CSS. Вони вже в базі. Це реальна file-level collision, а не доказ одночасних незакомічених правок. Новий release іншого потоку може знову зачепити ті самі файли. Перед Stage B та перед передачею перевірити refs/status; не переносити всю версійну синхронізацію і не перезаписувати файл копією зі старої бази.

Файли Products змінювати послідовно 02 → 03 → 04 → 09; designs — 05 → 06; graduation — 07 diagnosis → 08. Не делегувати паралельне редагування тих самих файлів. Інших task/agent запусків цей план не вимагає.

## Ізоляція ресурсів

Не використовувати shared root dev-server/DB як тестовий sandbox. Для browser fixture server — bind loopback, `PORT=0` із записом обраного вільного порту, закриття власного listener; DB/external API mocks лише в test harness. Для реального integration app окрема disposable DB і explicit sandbox connection; відсутність DB означає BLOCKED_ENVIRONMENT. Не копіювати `.env` і не запускати `npm start` із успадкованими production credentials: startup виконує migrations/schedulers/integrations.

Усі команди запускати з exact worktree. `check:syntax` рекурсивно обходить директорії; запуск з shared root, де є `.worktrees`, може захопити чужі дерева. Власний worktree не містить вкладених worktrees.

## Diff gate

```powershell
git rev-parse HEAD
git status --short --branch
git diff a52725f867cbe2d21188198ce0b0e7a51a7c52d2 --name-only
git diff --name-only
git diff --cached --name-only
git ls-files --others --exclude-standard
git diff --check
```

Перевіряти не тільки назви, а й дозволені blocks у multi-owner файлах. Untracked документи не видно у `git diff`; оглядати окремо. Не робити commit/push/merge/deploy чи cleanup у цьому planning task. Майбутні логічні патчі передавати незакоміченим diff або погодженим окремим delivery stage, без припущення дозволу на commit.
