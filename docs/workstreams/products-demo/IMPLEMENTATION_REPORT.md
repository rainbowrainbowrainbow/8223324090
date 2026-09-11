# Реалізація продуктового потоку — рев’ю

Дата: 2026-09-11. Base/HEAD: `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`.
Branch: `codex/products-demo-plan-20260911`.
Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/products-demo-plan-20260911`.
Production impact: no (локальні незакомічені зміни; не розгорнуто).

## Результат

| Task | Фактичний статус | Результат / межа |
|---|---|---|
| PRD-02 | DONE_LOCAL | Bare /programs відкриває програми, явні hashes збережено; локальні переходи, history, null/error і request generation |
| PRD-03 | DONE_LOCAL | Native details для програм/тортів/меню: повний escaped текст, наявне фото або чесна відсутність; 0 і null відрізняються |
| PRD-04 | DONE_LOCAL | Локальні стилі та keyboard/focus; 390/768/1440, light/dark |
| PRD-05 | DONE_LOCAL | Graduation screen CSS: довгий текст, повна висота, прихований список лише під час перегляду; disabled/focus/ARIA. Дані й print CSS незмінні |
| PRD-06 | DONE_LOCAL / BLOCKED_INTEGRATION | Generic → graduation більше не повторно використовує чужий payload; loading/empty/error/late response/close. DB/export не перевірені |
| PRD-07 | VERIFY_NO_REPRO_FIXTURE | Штатний sidebar → /programs, /designs, /center, back/reload і після info-modal close працює. Shared patch не потрібний у fixture; live симптом не спростований |
| PRD-08 | DONE_LOCAL | Прибрано дубль відступів, обрізання назв послуг і mobile clipping панелі пакетів; JS/formulas незмінні; constructor/packages браузерні screenshots |
| PRD-09 | DONE_LOCAL | Єдина локальна ссылка /graduation у graduation catalog card; лише ready + allowed + Park single scope. Global move не виконано |
| PRD-10 | DONE_LOCAL / BLOCKED_INTEGRATION | 75 Node tests, 4 browser scenarios, 1312 UI checks і guards PASS. PostgreSQL/auth/production proof відсутній |
| PRD-11 | READY_FOR_REVIEW | Diff, матриця, сценарій та інтеграційні питання збережені. Незалежне рев’ю ще не виконане |

DONE_LOCAL — виконаний погоджений локальний scope, не дозвіл на release і не DB acceptance. Реалізацію не починали заново: PRD-00/01 і їх allowlist залишилися основою. PRD-09 розблокований позитивним fixture navigation smoke PRD-07; дефект меню не вигадували.

## Фактичний diff

[implementation.patch](evidence/implementation.patch) містить п’ять змінених runtime-файлів і чотири нові тестові файли. Документи та PNG окремі від patch. Patch має застосовуватися до вказаної бази; на поточному дереві перевірено reverse --check, без застосування.

| Файл | Мінімальна зміна |
|---|---|
| js/programs-page.js | Route/tab presentation, read-list lifecycle, details/price labels, graduation-only link |
| css/pages-products.css | 50 рядків локальних overview/details/focus/wrapping styles |
| js/designs-page.js | Тільки catalog transient state/load/open/render/close; cache generation і чесні error/empty стани |
| designs.html | Screen-only graduation viewer styles та ARIA/buttons у #catalogViewer |
| css/graduation.css | .page-container > .grad-page padding, .grad-service-name wrapping та .grad-packages-kids-row wrapping/input tokens |
| tests/products-demo-flow.test.js | 10 jsdom tests: routes, access link, details, context/request isolation |
| tests/products-demo-catalog.test.js | 6 jsdom tests: count, payload ownership, races, lifecycle, print spies |
| tests/products-demo-graduation.test.js | 4 unit tests: unchanged formulas, package overrides, kitchen subtotal, pricing metadata/booking |
| tests/browser/products-demo.spec.js | 4 Playwright scenarios, кожен по 3 ширини; реальні markup/CSS/scripts з fixture auth/API |

Немає diff у HR, shared menu/router/theme, DB, auth, dependencies, pricing/formulas, booking, Art, generation/bot. `programs.html`, `graduation.html`, `js/graduation.js`, `css/catalog.css` незмінні. Staged diff порожній. Інші незакомічені роботи shared root не переносилися.

## Перевірки

- Node 22.23.1 / npm 10.9.8 — PASS.
- 55 existing Node tests + 20 new — PASS (75); tests на synthetic data, без DB.
- 4 Playwright scenarios — PASS, останній запуск 36.6 s; light/dark × 390/768/1440. Console page errors відсутні.
- access/static-surface/css-surface/theme-surface/timeline-protected-surface — PASS без правок manifest/budget.
- test:ui — 1312 PASS, 0 FAIL; parser check трьох UI scripts — PASS.
- git diff --check і patch reverse --check — PASS. [source-audit.json](evidence/source-audit.json) містить base, hash patch і 16 незмінених protected sources.
- npm test / verify / full parser sweep / general API integration / CI / live QA — NOT_RUN. Цільові перевірки достатні для цього review scope; повної перевірки release не заявлено.

Перші browser спроби виявили помилки harness: неправильну межу source slice, lowercase assertion для uppercase заголовка, selector закритої sidebar group, перевірку overflow до завершення shell animation. Вони виправлені у тесті. CSS-патчі відповідають видимим обрізаним назвам/подвійним відступам і catalog layout, а не цим test failures. Sandbox Node spawn EPERM обійдено штатним дозволеним escalation; dependencies не встановлювалися.

## Межі доказу та інтеграція

Browser fixture використовує реальні HTML/CSS, Products JS, graduation JS та незмінний sidebar. Auth/API mocked; designs запускає повний js/designs-page.js зі штатним init/hash lifecycle, inline generic editor не включений. Parent iframe — synthetic parent із native link, не весь Art screen. /center — synthetic destination, не перевірка фінансового UI. Скріншоти не доводять реальні permissions, package counts, DB persistence чи повну Art інтеграцію.

Наявний Programs bootstrap перенаправляє embedded вхід на /; недосяжний нижній fallback не «ремонтувався». Package override 0 досі використовує ефективну ціну через існуюче `||`; тест фіксує baseline, бізнес-правило не змінювалось. Generic print fallback переданий окремо; source-count gap S07 закрито локально. Деталі в [INTEGRATION_NOTES](INTEGRATION_NOTES.md).

Наступний крок: незалежне code review цього diff і рішення щодо дозволеного isolated DB/auth/export QA. Commit/push/merge/deploy не виконані.


## Повторне рев’ю після запиту «працюй далі»

Статус: SELF_REVIEW_COMPLETE, пакет готовий для незалежного рев’ю. Це перевірка в тому самому потоці, не зовнішній reviewer verdict.

1. **Виправлено R04 — stale constructor link.** Відкрити каталоги з allowed capability → перейти на програми → змінити permission snapshot → повернутися до кешованих каталогів. Посилання лишалося, хоча очікувалося його приховування. Regression спочатку FAIL, після локального rerender PASS. `updateProductTabPanels` повторно рендерить кеш; `bindProductRouteNavigation` слухає існуючі `permissions:lifecycle`/`roleSwitched`. Auth-політика не змінена, нових запитів до API немає.
2. **Виправлено R05/S07 — статичні «7 пакетів».** `#catalogPackageCount` використовує довжину того самого response `/api/graduation/packages`, який уже споживає viewer. 0 — справжній порожній результат; — — loading/error; старий запит не переписує metadata нового. Початковий page indicator 0/0. Regression пройшов FAIL → PASS; бізнес-правила і дані не змінені.
3. **Уточнено S06.** `git grep` по tracked JS/HTML знайшов тільки визначення `printCatalog()`, без UI call sites. Реальний editor path — `printCatalogFromEditor → openCatalog → doPrintCatalog`; успішний generic payload і паралельний graduation metadata refresh перевірені у VM, `window.print` замінено spy. Graduation print dispatch перевірено через `window.open` spy, HTTP export не виконувався. Empty/failure/editor print lifecycle лишається окремим scope; print-функції не змінено.
4. **Посилено browser evidence.** Тепер fixture завантажує весь `js/designs-page.js`, включно з `initAuth/initPage/setupTabs` і hash handling. Авторизація mocked; HTTP loopback повертає synthetic packages/designs/tags/collections та відхиляє non-GET. Inline generic editor, external integrations і реальний Express/PostgreSQL не включені.

Повторно: **75 Node tests PASS (55 existing + 20 new), 4 browser scenarios PASS (36.6 s), 1312 UI checks PASS**, Node 22.23.1/npm10.9.8, access/timeline/theme guards і parser двох змінених JS PASS. Styles не змінювались у цьому повторному рев’ю; попередні CSS/static guards залишаються чинними. Оновлено patch/hash та скриншоти.

