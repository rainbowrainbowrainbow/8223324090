# Education implementation handoff — 2026-09-29

## EDU-01 — виконання

- **Статус:** EDU-01 Done. Усі п'ять education HTTP/PostgreSQL сценаріїв і Fast baseline пройшли; повний CI завершився failure через не пов'язаний із EDU-01 Omni mobile browser regression. EDU-02 не запускати автоматично.
- **Модель/effort за планом:** GPT-6 Luna, High.
- **Workspace:** `C:\Users\Plotva\.codex\worktrees\education-schedule\EventGenix`
- **Branch:** `codex/education-schedule`
- **База:** актуальний `origin/codex/eventgenix-production`, SHA `640ad3165f41d68646bc4cb841945d1fc1efdaf4`.
- **Commits:** `e75c2e173af110f1795d2b48c64f3e2b4592b158` (`test: cover education lesson schedule workflows`), `d24d75a35f562bc24648345f307b389bda003d5e` (`test: create education conflict fixtures through API`), `c22740a5714df36c90577d73396a6f9e5f3d806b` (`test: configure education resources in disposable DB`), `72f420c0770ebfba78066bd8e4aa19f84e5c81d1` (`test: run education schedule scenarios in education context`), `73accc4cbc75c0d242aa6853bf6316b50e479d7c` (`test: assert canonical education lesson title`).
- **Точний SHA для продовження:** `73accc4cbc75c0d242aa6853bf6316b50e479d7c`.
- **CI:** [GitHub Actions run 36556657964](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36556657964), подія `push`, повний результат `failure`; EDU-01 PostgreSQL крок і Fast baseline `success`.

## Результат і карта повторного використання

У наявному коді вже є education-режим таймлайна, кабінети з місткістю, форма заняття, викладачі, daily/weekly/biweekly серії та канонічна картка деталей. Заняття зберігається як `bookings` із навчальними полями в `extra_data.educationLesson`; окрема таблиця для занять не потрібна.

EDU-02 може повторно використати `js/timeline-context.js` для режиму (`timeline.mode = education` у профілі бізнесу), `services/timelineResources.js` для кабінетів/політик, `js/booking-form.js` і `js/booking.js` для форми, `js/timeline.js` для блоків, `js/api.js` для API-клієнта та канонічний `showBookingDetails(...)` у `js/booking.js`. Серії обслуговують `POST /api/bookings/education-series`, `GET /api/bookings/education-series/:seriesId` і `POST /api/bookings/education-series/:seriesId/cancel`; окремий запис створюється через `POST /api/bookings`, редагується через `PUT /api/bookings/:id`, деталі читаються з `GET /api/bookings/detail/:id`.

EDU-01 не виявила підтвердженого дефекту чинного production-коду, тому функціональні файли не змінювалися. Додано ізольовані HTTP/PostgreSQL сценарії для одиночного заняття (створення, канонічні деталі, редагування), серії (створення, редагування одного входження, читання, скасування майбутніх входжень) та rollback усієї серії при конфлікті викладача або кабінету.

## Зміни

- `tests/integration/education-series.integration.test.js` — нові сценарії на synthetic/disposable даних.
- `scripts/run-isolated-postgres-tests.js` — режим `education-series` із guard-флагом тестового раннера.
- `package.json` — команда `test:integration:education-series:isolated`; залежності й lockfile не змінювалися.
- `.github/workflows/ci.yml` — крок запуску цих тестів у чинному PostgreSQL CI job.

Міграцій, змін доступу/ролей, зовнішніх інтеграцій і production-записів немає. Канонічне ownership картки деталей і protected timeline blocks не змінювалися.

## Перевірки

- PASS — `npm run check:runtime`: Node `22.23.1`, npm `10.9.8`.
- PASS — `node --test tests/timeline-resources.test.js tests/timeline-context.test.js tests/timeline-week-parity.test.js`: 161/161.
- PASS — `npm run check:syntax`: 1341 JS-файлів.
- PASS — `npm run check:timeline-protected-surface`: 6 protected blocks, 4 forbidden needles, 2 regression files.
- PASS — `git diff --check` і `node --check` змінених JS-файлів.
- NOT RUN locally — новий API/PostgreSQL сценарій: у локальному середовищі немає `TEST_DATABASE_URL`, Docker Linux engine відповідає `permission denied`. Тест підключений до disposable PostgreSQL CI; production DB не використовувалася.
- PASS — CI run `36556657964`, isolated PostgreSQL: 5/5 сценаріїв — одиночне заняття (create/canonical detail/edit); weekly серія (три входження, edit one, canonical details/list, cancel future); daily та biweekly календарні дати зі сталим локальним часом; rollback серій при конфлікті викладача й кабінету.
- PASS — CI run `36556657964`, Fast baseline (`npm test`) і HR/payroll PostgreSQL job; також успішні Certificate, Checkbox, My Day PostgreSQL/browser та HR Team browser jobs.
- FULL CI FAILURE — Omni browser regression упав на viewport `390×844`: shell закінчився на `y=847`, тобто на 3 px нижче вікна браузера. Діагностика вказує на `tests/browser/omni-workspace-navigation-fixtures.js`; EDU-01 не змінював Omni-файли, тому це зафіксовано як сторонній CI-ризик і не розширювалося в EDU-01.
- CI run `36554756560` показав, що education-режим EventGenix у чистій базі намагається розв'язувати кабінет через захищений каталог типу `room`, тоді як education ресурси мають тип `cabinet`. Щоб не змінювати protected identity mapping, інтеграційна fixture запускає API сценарії у вже підтриманому `dar` контексті з `timeline_display:dar = education` та `initializeTimelineResources(..., { types: ['cabinet'] })` лише у disposable DB.
- CI run `36553414345` відхилив прямий SQL seed через `chk_bookings_active_room_identity_v332`; усі тестові заняття тепер створюються канонічним API шляхом.
- Локальний `node --test tests/timeline-resources.test.js tests/timeline-context.test.js tests/timeline-week-parity.test.js` не зміг стартувати дочірні процеси в sandbox (`spawn EPERM`). Локальні синтаксис, `git diff --check` і runtime перевірки пройшли; поведінковий доказ — ізольований PostgreSQL CI.
- NOT RUN — live write QA: для EDU-01 дозволено лише read-only перевірку за потреби; мутаційні сценарії належать disposable DB/CI.

## Наступна задача

Наступна окрема задача за execution pack — EDU-03: групи та склад дітей, additive schema/API, optional `groupId` у заняттях і фільтр розкладу. Не запускай EDU-03 автоматично; потрібен окремий task.


## EDU-02 — реалізація

- **Статус:** EDU-02 Done. Локальний `npm test` і весь CI успішні; production deploy не виконувався.
- **Гілка/worktree:** `codex/education-schedule` — `C:\Users\Plotva\.codex\worktrees\education-schedule\EventGenix`.
- **EDU-02 code commit:** `c206c71ac221296700096fa20a6d624f859af21c` (`feat: add education schedule workspace`).
- **Handoff commit pushed:** `94395998d69d4a371b3c8a5100d419b4131b5c77` на `origin/codex/education-schedule`.
- **Вхід:** `/?educationSchedule=today`; зберігає поточний `businessContext`, доступний лише для профілю з `timeline.mode = education`. Використовує root page guard `/` і чинні booking action/API guards.
- **UI:** вкладки «Сьогодні / Розклад» у спільному index/timeline shell. «Сьогодні» читає чинний `getBookingsForDate(...)`/timeline cache, показує topic/time/teacher/group/cabinet/studentCount і фільтри викладача та кабінету. Кількість позначається як учні у занятті, не як attendance/список зарахованих дітей. Відкриття користується `showBookingDetails(...)`. «Розклад» відкриває наявний день/тиждень timeline. Дубліката сторінки, API, booking modal або calendar engine немає.
- **Доступ:** додано education-only sidebar visibility і `/?educationSchedule=today` до `PAGE_PERMISSIONS` root entry `sidebarLinks`. Ролі, action permissions, API guards та auth/session не змінювалися.
- **Файли EDU-02:** `index.html`, `js/components/sidebar.js`, `js/education-schedule.js`, `css/education-schedule.css`, `config/cssSurface.js`, `docs/CSS_SURFACE.md`, `config/permissionRegistry.js`, `tests/education-schedule-ui.test.js`, `tests/permission-registry-contract.test.js`, `package.json`.
- **Перевірки на цей момент:** PASS — `node --check js/education-schedule.js`; PASS — `node --test tests/education-schedule-ui.test.js tests/permission-registry-contract.test.js` (15/15); PASS — `node tests/ui-check.js` (1327/1327); PASS — CSS surface, theme surface, access matrix, API surface, static surface, timeline protected surface. PASS — повний `npm test` (runtime/version, access/action/permission contracts, syntax, unit та UI checks). PASS — `git diff --check`. PASS — повний GitHub CI [36562989860](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36562989860): усі jobs зелені, включно з Fast baseline, browser suites та education-series PostgreSQL integration.
- **QA/реліз:** production deploy не виконувався. Live-site QA не виконувався; він належить EDU-05. Real desktop/mobile screenshot review пропущено: browser tool відхилив локальний `file://` preview як недозволений протокол і заборонив обхід через іншу поверхню/протокол; Playwright недоступний у worktree. Не трактувати це як візуальний pass. CI run `36562989860` пройшов; production deploy не виконувався.
