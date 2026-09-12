# Test matrix: докази аудиту та acceptance реалізації

Дата: 2026-09-12. Local HEAD 5381d9a8799a7e31ab855ae586268944863a4a4f.
Live SHA 439510122a4f1c296c1f43cccda1f16a7568763d / 0.81.141 / codex/eventgenix-production.

## Фактично виконано

| Перевірка | Результат і практична межа |
|---|---|
| `npm run check:runtime` | PASS: Node 22.23.1 / npm 10.9.8 |
| `node --test tests/design-storage.test.js` | Runner spawn EPERM до виконання scenarios; не product failure |
| `node --test --experimental-test-isolation=none tests/design-storage.test.js` | PASS 3/3, fake SQL + loopback Express |
| `node --test --experimental-test-isolation=none tests/design-storage.test.js tests/legacy-upload-backfill.test.js` | PASS 11/11 сукупно, включає ті самі 3 storage cases; не 14 унікальних тестів |
| `npm run check:access` | PASS: 26 roles / 43 page entries / 50 sidebar links на audit base |
| `node --test --experimental-test-isolation=none --test-name-pattern="sidebar links" tests/permission-registry-contract.test.js` | PASS 2/2 matching cases |
| Node/JSDOM/VM реального frontend | Happy list→card→lightbox; 500→TypeError; PDF→IMG→favicon; hash ignored; tab click works; missing dialog semantics; wrong dark selector. Synthetic, без DB/network |
| Live version/auth/permissions | 200; QA marker перевірений; senior_manager; designs/designer grants true; no role elevation |
| Live list/collections/tags | 200; browser показав 3 картки |
| Live HEAD усіх 3 items | 3 × image/jpeg: preview 404, authorized download 404, anonymous download 401 |
| Chromium read-only smoke | Board list PASS; first item preview **FAIL**, відображено favicon; Escape PASS; internal Style Guide entry відсутній |
| Live Style Guide | /designer#styleguide фактично відкриває catalogs; click styleguide PASS |
| Live theme/viewport smoke | Fresh reload dark/light змінює card surface; неправильний light-selector matches dark; Board 1440 і Designer 390 без horizontal overflow |

Перший cached Playwright мав відсутню browser revision; використано інший уже встановлений matching runtime без install. Chromium launch у sandbox дав spawn EPERM; той самий обмежений read-only probe успішно виконано після tool approval. Ніякого approval rejection не було.

Browser перевіряв actual deployed UI, але блокував external origins і business writes, service worker вимкнений. Не зберігав screenshots/content, не робив data fixtures на production. Partial mode toggle без reload не використано для висновку про тему; достовірний результат — повтор із fresh reload.

**Не виконано:** npm test/повний test:ui, загальна API/integration suite, PostgreSQL tenant tests, live mutations, restore/backfill apply, CI нового patch, deploy, повний accessibility/contrast audit. Тестові credentials не друкувалися.

## Acceptance matrix

Статус «потрібен тест» не є поточним PASS. IDs використовуються в EXECUTION_PLAN.

| ID | Сценарій / acceptance | Доказ зараз | Майбутній тест / залежність |
|---|---|---|---|
| M01 | Точна база і live SHA; owned diff без чужих файлів | PASS snapshot, checkout stale | Перед T1/G0 і integration повторити git/version read-only |
| M02 | Metadata→blob/key/disk/backup source inventory | READ-ONLY PASS: scanned 3, ok 0, `SOURCE_MISSING: 3`, recoverableFromLocal 0 | T5/B1, потрібен external backup/source root; apply тільки окремо |
| M03 | Board auth + 200 items,total → картки | LIVE PASS для одного QA role | T1, tests/designs-page-ui.test.js; не proof усіх grants |
| M04 | Порожній список відрізняється від помилки | SOURCE empty існує; UX не перевірений | T1, 200 items=[]/total=0; ясний empty без new manager logic |
| M05 | 500/malformed/network → error/retry; shell доступний | SYNTHETIC FAIL, TypeError | T1, реальний loadDesigns/initPage з fake API; retry→200 |
| M06 | Search/tag/collection/pinned/load-more, швидкий filter change, return | SOURCE реалізовано; live не проганяли | T1, synthetic 51+ items, out-of-order responses; current filter wins; апострофи/HTML у tags — інертний текст |
| M07 | JPEG/PNG/WebP/GIF/SVG preview bytes + missing 404 | LIVE 3/3 JPEG FAIL; synthetic happy PASS | T2, безпечні fixture images; error без favicon; B1 для live success |
| M08 | PDF preview і завжди видимий Download fallback, без підміни зображенням | SYNTHETIC FAIL; live PDF відсутній | T2, synthetic PDF, desktop/touch; не вважати iframe load доказом PDF view; без converter dependency |
| M09 | Keyboard card, dialog focus/label/trap, Escape, return focus | Escape LIVE PASS; semantics SOURCE/SYNTHETIC FAIL | T1/T2, Tab/Enter/Space/Escape, backdrop, focus return |
| M10 | Authorized download: header, MIME/name, no token URL, cleanup | SOURCE mismatch; live anonymous HEAD401/authorized404 | T2, fake endpoint bytes + 401/403/404/500, desktop/touch; 401 policy auth owner не переписувати |
| M11 | Theme state після reload/toggle, card/filter/picker/catalog/viewer/error | LIVE main card switch PASS, selector FAIL | T3, modes dark/light, computed styles + visual review, no global changes |
| M12 | Responsive 390/768/1440, zoom і focus visibility | Вузький live overflow smoke PASS | T3, всі змінені surfaces; не тільки closed gallery |
| M13 | Board internal Style Guide entry → styleguide panel → Board | READY локально: `tests/designer-navigation.test.js` PASS | Browser smoke після deploy/live target |
| M14 | /designer, fragments, refresh, Back/Forward, unknown hash | READY локально: `/designer#styleguide` і fallback covered | Browser smoke після deploy/live target |
| M15 | Різні персональні grants designs/designer, deny і pending | PARTIAL READY: entry visibility uses existing `canAccessPage('/designer')`; multi-account live grants UNVERIFIED | Тестові акаунти без role/grant mutation або approved disposable fixture |
| M16 | Board hashes і catalog viewer/deep links не регресують | SOURCE існують, origin fixes новіші | T4/T6: #gallery/#collections/#price/#calendar/#catalogs/#catalog-graduation/#catalog-* |
| M17 | A/B однакова роль, різні company/account: list/count/tags/collections/calendar | SOURCE scope відсутній; BLOCKED | T5/B10, disposable PostgreSQL ownership fixtures; no frontend filter |
| M18 | B id/filename через download/preview/update/delete/Telegram не доступний A | SOURCE public bytes/unscoped; BLOCKED | T5/B10, server негативні 401/403/404; live mutations заборонені |
| M19 | Logout/account/context switch, browser cache/public legacy URL | UNVERIFIED, policy BLOCKED | T5/B10, два isolated contexts + private cache acceptance, public catalog compatibility |
| M20 | Pin/unpin preserves date/collection; explicit null clears | SOURCE data-loss defect; live не натискали | T5/B6, tests/designs-update-contract.test.js, fake/disposable DB |
| M21 | Єдиний default main-nav Board, internal Guide, direct route/search/favorites | INTEGRATION PLAN READY; product removal BLOCKED | T6 shared hunk за `SHARED_INTEGRATION.md`; compatibility descriptor, saved /designer лишається usable і не зникає після save |
| M22 | Registry/sidebar parity, актуальний count, grants без змін, HR profiles збережено | Baseline PASS; prospective deletion needs coordination | T6, check:access, full registry tests, ui-check, new integration test за потреби |
| M23 | Unit/DOM tests wired у CI, operator browser smoke, syntax/theme/CSS/static guards | READY локально: `test:unit` wiring додано, targeted tests і UI/surface checks PASS; browser smoke лишається operator-run | npm test/CI після дозволеного push |

## Команди майбутньої вузької перевірки

Для isolation після окремого protected approval див. `docs/design-board-style-guide/ISOLATION_TECHNICAL_PLAN.md`. Мінімальні майбутні checks: `npm run check:migrations`, `npm run check:auth-boundary`, `npm run check:storage-surface`, `node --test tests/designs-isolation.test.js`, `npm run test:unit`. Не зараховувати frontend-фільтр або одну QA-роль як proof M17–M19.

Спочатку `npm run check:runtime`. Після створення тестів:

```text
node --test tests/designs-page-ui.test.js tests/designer-navigation.test.js
node tests/browser/designs-style-guide-browser-smoke.js
npm run check:syntax
npm run check:theme-surface
npm run check:css-surface
npm run check:static-surface
```

Інтерфейс нового browser smoke має бути safe-by-default: local synthetic/disposable target, без production writes; live read-only mode потребує явного target. Не покладатися на production як default. Використати наявний browser harness/runtime; не інсталювати dependency/оновлювати lockfile. Якщо installed runtime недоступний — конкретно повідомити blocker.

Після shared integration:

```text
npm run check:access
node --test tests/permission-registry-contract.test.js
node --test tests/sidebar-designs-integration.test.js
npm run test:ui
```

Третя команда потрібна лише якщо інтегратор створив цей новий файл. Не видавати її за наявний baseline. Якщо runner знову має sandbox EPERM, in-process test isolation можна використати для тих вузьких suites, де fixtures не конфліктують; у звіті вказати точну команду, не підміняти повний CI результат.

## Що покриває чинний CI

- `.github/workflows/ci.yml:51` → npm test → package.json verify.
- test:unit включає `design-storage`, `design-material-storage-audit`, `designs-page-ui` і `designer-navigation`; `tests/designs.test.js` у цьому списку немає.
- tests/designs.test.js потрапляє до широкого test:integration; окремого designs isolated PostgreSQL target не знайдено.
- route-smoke для designs перевіряє лише tags: waiter 403 / art_director 200.
- ui-check перевіряє DOM/кількість tabs та наявність sidebar href. Це не browser navigation/storage/isolation QA.
- Нові unit/DOM tests підключені до `test:unit` без dependencies/lockfile змін.
- Звичайний npm test job не встановлює Chromium. Наявний browser job встановлює його, але викликає конкретний список scripts, а не всі browser-файли. Новий browser smoke — operator-run на встановленому runtime; окремий approved workflow wiring потрібен лише для додавання його в автоматичний browser CI. Не додавати його до unrelated старого smoke як обхід CI ownership.

**Не запускати tests/designs.test.js проти production для цього плану:** він створює, редагує і видаляє collection та виконує upload POST. TEST_URL сам по собі не є гарантією безпеки; isolation guard у helpers умовний.

## Release acceptance

Локальний UI PASS можливий окремо. Повний «saved materials accessible and isolated» PASS потребує B1 і B10. Sidebar removal потребує T4→T6 PASS. Не замінювати ці gates успішним HTTP200 list, favicon, зеленим unit test або однією QA-роллю.

## Executed verification 2026-09-12

Пройшли:

- `npm run check:runtime` — PASS, Node 22.23.1 / npm 10.9.8.
- `node --check scripts/audit-design-material-storage.js`
- `node --check tests/design-material-storage-audit.test.js`
- `node --check js/designs-page.js`
- `node --check tests/designs-page-ui.test.js`
- `node --check tests/designer-navigation.test.js`
- `node --check tests/ui-check.js`
- `node --test --experimental-test-isolation=none tests/designer-navigation.test.js` — PASS 5/5 для T4/T5 route continuity.
- `node --test --experimental-test-isolation=none tests/design-material-storage-audit.test.js tests/designs-page-ui.test.js tests/designer-navigation.test.js tests/design-storage.test.js` — PASS 14/14.
- `npm run test:ui` — PASS 1312/1312 після T4/T5/T3 updates.
- `node scripts/audit-design-material-storage.js --limit 500` — READ ONLY PASS; scanned 3, ok 0, `SOURCE_MISSING: 3`, recoverableFromLocal 0, keyMismatches 0, manifestHash `6ee18d80c03ab89775a31652b562704f18bf93eda5bb5864b1fb7668d5cb282c`.
- `npm run check:storage-surface` — PASS.
- `npm run check:static-surface` — PASS.
- `npm run check:theme-surface` — PASS.
- Попередньо в цьому ж pass також проходили `npm run check:access`, `npm run check:css-surface`, `npm run check:api-surface`.

Не зараховувати як PASS:

- Broad `npm run check:syntax` у цьому dirty checkout: команда заходила в паралельні `.worktrees/*` і впала/була перервана через sandbox `EPERM` spawn помилки, не через змінені Design Board файли. Для локального доказу використано targeted `node --check` по змінених JS/test files.
- Full live material preview: production read-only audit і попередній browser smoke показують missing bytes/source для всіх трьох перевірених saved materials.
- Company/account isolation: відсутня schema/API ownership boundary; тести із двома tenant fixtures не існують.
- Sidebar duplication removal: не виконано; shared integration ще не застосований.
