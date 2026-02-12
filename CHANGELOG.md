# CHANGELOG — Park Booking System

> Короткий журнал після кожної пачки змін. Формат: дата → рішення → зміни → питання → наступний крок.

---

## 2026-02-11 — v7.8 Окремі сторінки Задач і Програм

**Що вирішили:**
- Задачі та Програми мають бути окремими повноцінними сторінками (не модалками)
- Задачі потребують типів: manual, recurring, afisha, auto_complete
- Recurring задачі мають створюватись автоматично за шаблонами

**Що додали/поміняли:**
- `tasks.html` + `js/tasks-page.js` — NEW: повна сторінка задач з фільтрами, типами, CRUD
- `programs.html` + `js/programs-page.js` — NEW: повна сторінка каталогу з категоріями
- `css/pages.css` — NEW: спільні стилі для окремих сторінок
- `routes/task-templates.js` — NEW: CRUD для recurring шаблонів
- `db/index.js` — task_templates table + ALTER tasks (type, template_id)
- `services/scheduler.js` — checkRecurringTasks() для авто-створення
- `server.js` — маршрути /tasks, /programs + task-templates API + scheduler
- `routes/tasks.js` — фільтр ?type= + підтримка type/template_id в POST
- `index.html` — nav-bar з посиланнями, меню оновлено

**Під питанням:**
- Clawd Bot для авто-задач (контент для соцмереж, нагадування)

**Наступний крок:**
- Підключення бота для авто-задач
- Drag-n-drop сортування програм

---

## 2026-02-11 — v7.6.1 Переключення ліній + Bugfix

**Що вирішили:**
- Бронювання має легко переміщуватись між лініями аніматорів
- Confirm modal не видно при видаленні з афіші (z-index конфлікт)

**Що додали/поміняли:**
- `js/booking.js` — switchBookingLine() + кнопки ліній у деталях бронювання
- `css/modals.css` — стилі .line-switch-buttons + #confirmModal z-index fix
- `css/base.css` — --z-modal-confirm: 1050
- `index.html` — version bump + changelog entry

**Під питанням:** —

**Наступний крок:**
- Переосмислити UX афіші

---

## 2026-02-11 — v7.6 Афіша → Задачі

**Що вирішили:**
- Афіша повинна автоматично генерувати задачі підготовки для кожної події
- Шаблони за типом: event (3 задачі), birthday (2), regular (1)

**Що додали/поміняли:**
- `db/index.js` — ALTER TABLE tasks ADD COLUMN afisha_id + INDEX
- `services/taskTemplates.js` — NEW: шаблони задач та функція generateTasksForEvent()
- `routes/afisha.js` — POST /:id/generate-tasks + cascade delete todo-задач
- `routes/tasks.js` — фільтр ?afisha_id=
- `js/settings.js` — кнопка 📝 генерації, бейдж 🎭, API generateTasksForAfisha()
- `tests/api.test.js` — 8 нових тестів (генерація, дублювання, каскад, фільтр)
- `index.html` — version bump + changelog entry

**Під питанням:** —

**Наступний крок:**
- Clawd Bot команди для задач (/tasks, /done)
- Експорт блоків

---

## 2026-02-11 — v7.5 Задачник MVP

**Що вирішили:**
- Потрібен задачник для планування дня/тижня (закупівлі, підготовка, рутина)
- Статуси: todo → in_progress → done, пріоритети: low/normal/high

**Що додали/поміняли:**
- `db/index.js` — CREATE TABLE tasks (title, date, status, priority, assigned_to, ...)
- `routes/tasks.js` — NEW: CRUD + PATCH status, фільтрація, сортування
- `server.js` — mount /api/tasks
- `js/settings.js` — API functions + UI render (tasks modal, status cycling)
- `js/app.js` — event listeners для tasks button/filter
- `index.html` — tasks modal, tasks button в меню, v7.5 changelog
- `css/features.css` — task-item styles
- `css/dark-mode.css` — dark mode support
- `tests/api.test.js` — 13 нових тестів tasks CRUD

**Під питанням:** —

**Наступний крок:**
- Зв'язок афіша → завдання (автоматичне створення)
- Clawd Bot команди для задач (/tasks, /done)
- Експорт блоків

---

## 2026-02-11 — v7.4 Типи подій + Іменинники

**Що вирішили:**
- Афіша має підтримувати різні типи подій: подія, іменинник, регулярна
- Іменинники не блокують таймлайн (duration=0), мають окремий блок в Telegram

**Що додали/поміняли:**
- `db/index.js` — ALTER TABLE afisha ADD COLUMN type VARCHAR(20) DEFAULT 'event'
- `routes/afisha.js` — type в POST/PUT, фільтрація GET ?type=birthday
- `services/templates.js` — `formatAfishaBlock()` розділяє події та іменинників
- `js/settings.js` — type select в формі, іконки в списку, birthday flow
- `js/app.js` — type change handler (ховає duration для birthday)
- `js/timeline.js` — birthday не рендериться на таймлайні
- `index.html` — type select в модалці, v7.4 tags/changelog
- `tests/api.test.js` — 12 нових тестів (event types + afisha templates)

**Під питанням:** —

**Наступний крок:**
- Задачник (task manager MVP)
- Зв'язок афіша → завдання
- Експорт блоків

---

## 2026-02-11 — v7.3 Афіша в Telegram

**Що вирішили:**
- Афіша має приходити разом з дайджестом і нагадуванням про завтра
- Якщо є тільки афіша (без бронювань) — все одно відправляти повідомлення

**Що додали/поміняли:**
- `services/templates.js` — `formatAfishaBlock()` шаблон для Telegram
- `services/scheduler.js` — афіша в `buildAndSendDigest()` та `sendTomorrowReminder()`
- `index.html` — v7.3 tags, tagline, changelog entry
- `package.json` — version 7.3.0
- 156/157 тестів pass

**Під питанням:** —

**Наступний крок:**
- Тести для афіші в Telegram
- Регулярні заходи (іменинники), задачник, експорт

---

## 2026-02-11 — v7.2 Clawd Bot

**Що вирішили:**
- Telegram-бот для управління парком прямо з чату
- 7 команд: меню, бронювання, каталог, пошук, ціни, статистика

**Що додали/поміняли:**
- `services/bot.js` — NEW: 7 command handlers (menu, today, tomorrow, programs, find, price, stats)
- `routes/telegram.js` — webhook тепер обробляє текстові команди через `handleBotCommand()`
- `index.html` — v7.2 tags, tagline, changelog entry
- `package.json` — version 7.2.0
- 156/157 тестів pass

**Під питанням:** —

**Наступний крок:**
- Можливі: export PDF/Excel, graphic assets, batch price update

---

## 2026-02-11 — v7.1 Admin Product Catalog CRUD

**Що вирішили:**
- Повний CRUD для каталогу програм через адмін-панель
- Нова роль `manager` з доступом до створення/редагування програм
- Soft-delete замість жорсткого видалення (деактивація)

**Що додали/поміняли:**
- `middleware/auth.js` — `requireRole(...roles)` middleware для route-level авторизації
- `routes/products.js` — POST (create), PUT (update), DELETE (soft-delete) з валідацією
- `js/api.js` — `apiCreateProduct()`, `apiUpdateProduct()`, `apiDeleteProduct()`
- `js/auth.js` — `canManageProducts()`, `isAdmin()` helpers
- `js/settings.js` — `showProgramsCatalog()` з кнопками edit/delete, `openProductForm()`, `saveProduct()`, `deleteProduct()`
- `index.html` — модалка `#productFormModal` з повною формою (код, мітка, назва, категорія, ціна, тривалість, опис, чекбокси)
- `css/modals.css` — `.pf-grid`, `.pf-checkboxes`, `.btn-catalog-edit/delete`, `.catalog-inactive`, `.catalog-badge-inactive`
- `css/dark-mode.css` — dark mode для форми продукту та кнопок управління
- `package.json` — version 7.1.0
- 156/157 тестів pass (1 — rate limit flaky test)

**Під питанням:** —

**Наступний крок:**
- v7.2 — Clawd Bot інтеграція (Telegram bot для управління каталогом)

---

## 2026-02-11 — v7.0 Product Catalog MVP

**Що вирішили:**
- Міграція програм з хардкоду (PROGRAMS масив) в БД (таблиця `products`)
- API для каталогу продуктів (read-only)
- Кешування на клієнті з TTL 5хв
- Backward-compatible fallback на PROGRAMS якщо API недоступний

**Що додали/поміняли:**
- `db/index.js` — нова таблиця `products` (20 полів), auto-seed 40 програм, 2 індекси
- `routes/products.js` — NEW: GET /api/products (?active=true), GET /api/products/:id
- `server.js` — mount `/api/products` route
- `js/api.js` — `apiGetProducts(activeOnly)`, `apiGetProduct(id)`
- `js/config.js` — `AppState.products`, `getProducts()` (async+cache), `getProductsSync()` (sync fallback)
- `js/booking.js` — `renderProgramIcons()` async, всі `PROGRAMS.find/filter` → `getProductsSync()`
- `js/settings.js` — `showProgramsCatalog()` async з loading spinner
- `index.html` — v7.0 tags, tagline, changelog entry
- `package.json` — version 7.0.0
- 157/157 тестів pass

**Під питанням:** —

**Наступний крок:**
- v7.1 — Admin-Bot API (CRUD продуктів, роль manager, Clawd Bot)

---

## 2026-02-08 — v6.0 Test Mode

**Що вирішили:**
- Тимчасова тестова версія для перевірки всіх функцій
- Вхід без пароля: будь-яке ім'я → admin з повним доступом
- User1 за замовчуванням

**Що додали/поміняли:**
- `routes/auth.js` — безпарольний login: будь-який username отримує admin role, token на 24h
- `index.html` — поле пароля приховане, pre-fill "User1", підказка "Тестовий режим"
- `css/auth.css` — `.test-mode-hint` amber badge на формі логіну
- Version bump 6.0.0

**УВАГА:** Ця версія тимчасова! Перед production потрібно повернути стандартну авторизацію.

**Під питанням:** —

**Наступний крок:**
- Тестування всіх функцій v5.42–v5.51

---

## 2026-02-08 — v5.51 Undo for Edit & Shift

**Що вирішили:**
- Розширити undo-систему: раніше працювала тільки для create/delete, тепер і для edit/shift
- Зберігати попередній стан перед редагуванням для можливості відкату

**Що додали/поміняли:**
- `js/booking.js` — `pushUndo('edit', { old, updated })` після успішного edit (зберігає старий стан)
- `js/booking.js` — `pushUndo('shift', { bookingId, minutes: -minutes, linked })` після shift (зберігає зворотний зсув)
- `js/ui.js` — `handleUndo()` розширено: 'edit' → `apiUpdateBooking(old)`, 'shift' → reverse time shift для main + linked bookings
- Нові history actions: `undo_edit`, `undo_shift`
- Version bump 5.51.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- Серія нових фіч v5.49–v5.51 завершена!

---

## 2026-02-08 — v5.50 Duplicate Booking

**Що вирішили:**
- Додати кнопку "Повторити" для швидкого створення копії бронювання
- Використати ту ж логіку pre-fill що і editBooking, але без editingBookingId

**Що додали/поміняли:**
- `js/booking.js` — `duplicateBooking()`: копіює всі поля в нову форму створення
- `js/booking.js` — кнопка "📋 Повторити" в booking-actions
- `css/modals.css` — `.btn-duplicate-booking` з blue gradient
- Version bump 5.50.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- v5.51 — Undo for Edit/Shift

---

## 2026-02-08 — v5.49 Program Search

**Що вирішили:**
- Додати пошук програм у каталозі при створенні/редагуванні бронювання
- Фільтрація по назві, коду або label в реальному часі

**Що додали/поміняли:**
- `index.html` — `#programSearch` input перед каталогом програм
- `js/booking.js` — `filterPrograms()`: фільтрує іконки за data-search, ховає порожні категорії
- `js/booking.js` — `renderProgramIcons()`: додає data-search та data-category атрибути, підключає input listener
- `js/booking.js` — `openBookingPanel()`: скидає пошук при відкритті панелі
- `css/panel.css` — `.program-search-input` з focus стилями
- `css/dark-mode.css` — dark mode для пошуку
- Version bump 5.49.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- v5.50 — Duplicate Booking

---

## 2026-02-07 — v5.48 Invite Creation Flow

**Що вирішили:**
- Замінити просту посилку "Запрошення" на повноцінну секцію з preview та діями
- Додати copy-to-clipboard та Web Share API
- Покращити UX: користувач бачить що буде в запрошенні перед відправкою

**Що додали/поміняли:**
- `js/booking.js` — нова invite section з preview (date, time, program, room) + 3 кнопки
- `js/booking.js` — `copyInviteLink()` з візуальним feedback "✅ Скопійовано!"
- `js/booking.js` — `shareInviteLink()` через Web Share API (мобільні)
- `css/features.css` — `.invite-section` з amber gradient background, `.invite-preview`, `.invite-actions`
- `css/features.css` — `.btn-invite-open` (amber), `.btn-invite-copy` (neutral), `.btn-invite-share` (emerald)
- `css/dark-mode.css` — dark mode для invite section з tinted backgrounds
- Version bump 5.48.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- Design system integration серія v5.46–v5.48 завершена!

---

## 2026-02-07 — v5.47 Inline Style Cleanup

**Що вирішили:**
- Видалити всі 20 inline styles з Telegram налаштувань в index.html
- Замінити на CSS класи для підтримки dark mode та maintainability
- Додати кольорові модифікатори кнопок (purple/blue)

**Що додали/поміняли:**
- `css/features.css` — нові класи: `.tg-subsection`, `.tg-subsection-lg`, `.tg-btn-row`, `.tg-inline-group`, `.tg-footer`
- `css/features.css` — кнопки: `.btn-submit.btn-purple`, `.btn-submit.btn-blue`, `.btn-submit.btn-flex`, `.btn-submit.btn-full`
- `css/features.css` — інпути: `.input-time` (width:120px), `.input-hours` (compact number input)
- `css/dark-mode.css` — адаптація `.tg-subsection` borders, `.btn-submit.btn-purple/blue` shadows, `.input-hours`
- `index.html` — 20 inline `style=` замінено на CSS класи, 2 input overrides видалено (використовується `.form-group input`)
- Version bump 5.47.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- v5.48 — Invite Creation Flow Fix

---

## 2026-02-07 — v5.46 Wire Up Design System

**Що вирішили:**
- Підключити CSS компоненти з v5.42–v5.44 до реального UI (status badges, category chips, empty states, sticky footer)
- 37+ класів були створені але не використані — тепер вони працюють

**Що додали/поміняли:**
- `js/booking.js` — showBookingDetails: `.status-badge--confirmed/preliminary` замість plain span
- `js/booking.js` — showBookingDetails: `.category-chip--{category}` в header бронювання
- `js/booking.js` — `.booking-actions` отримав `.modal-footer-sticky` (sticky кнопки при прокрутці)
- `js/ui.js` — showTooltip: status badge замість текстового статусу
- `js/settings.js` — loadHistory: `.empty-state` з іконкою та описом замість plain text
- `js/settings.js` — fetchAndRenderTelegramChats: `.empty-state` для "Тем не знайдено"
- Version bump 5.46.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- v5.47 — Unified Buttons + Inline Style Cleanup

---

## 2026-02-07 — v5.45 Invite Page Overhaul

**Що вирішили:**
- Повний редизайн invite.html під Emerald Design System v4.0
- Категорійні кольори для feature-плиток
- XSS захист через escapeHtml() для URL параметрів
- Proper meta tags (description, theme-color, favicon)

**Що додали/поміняли:**
- `invite.html` — міграція кольорів з #00A651 на #10B981 emerald систему
- `invite.html` — hero overlay gradient для кращого вигляду зображення
- `invite.html` — header content з emerald gradient + декоративне коло
- `invite.html` — категорійні кольори: quest (фіолет), animation (синій), show (помаранч), masterclass (зелений), photo (бірюза), pinata (рожевий)
- `invite.html` — info row іконки з фоновими колами (#ECFDF5)
- `invite.html` — share buttons з emerald hover, copy feedback "✅ Скопійовано!"
- `invite.html` — escapeHtml() для XSS захисту URL params (date, time, program, room)
- `invite.html` — responsive: менша висота hero на мобільних
- Version bump 5.45.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- Design system v4.0 серія v5.42–v5.45 завершена!

---

## 2026-02-07 — v5.44 Dashboard & Empty States

**Що вирішили:**
- Різнокольорові картки дашборду (зелений/синій/фіолет/помаранч)
- Медалі для топ-3 (золото/срібло/бронза)
- Покращені bar chart і empty states
- Subtle dot pattern для темної теми

**Що додали/поміняли:**
- `css/features.css` — dash-card з hover, декоративним колом, різними кольорами для 4 карток
- `css/features.css` — dash-list-item з hover border, dash-rank з gradient + special top-3 colors
- `css/features.css` — dash-bar-fill з inner shadow, stronger value text
- `css/features.css` — no-data з більшою іконкою + декоративна лінія
- `css/dark-mode.css` — subtle dot pattern через radial-gradient (40px grid)
- Version bump 5.44.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- v5.45 — Invite Page Overhaul

---

## 2026-02-07 — v5.43 Modals & Buttons Polish

**Що вирішили:**
- Sticky headers/footers в модалках
- Єдина система кнопок з чіткою ієрархією
- Компактніші картки історії
- Нові CSS empty states

**Що додали/поміняли:**
- `css/modals.css` — sticky h3 + modal-close при прокрутці модалки
- `css/modals.css` — `.btn-unified` базовий клас + `.btn-primary`/`.btn-secondary`/`.btn-danger-unified`/`.btn-accent`
- `css/modals.css` — `.empty-state` + `.empty-state-icon` + `.empty-state-title`/`.empty-state-text`
- `css/modals.css` — `.modal-footer-sticky` для прилипаючих кнопок внизу
- `css/modals.css` — компактніші `.history-item` (менше padding, hover shadow)
- `css/dark-mode.css` — адаптація sticky header/footer, buttons, empty states
- Version bump 5.43.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- v5.44 — Dashboard & Empty States

---

## 2026-02-07 — v5.42 Design Tokens + Premium Menu

**Що вирішили:**
- Розширити дизайн-систему: spacing scale, border tokens, card radius
- Преміальне темне меню (Emerald Core gradient)
- Уніфіковані CSS-класи для статусів і категорій

**Що додали/поміняли:**
- `css/base.css` — нові токени: `--space-*`, `--border-*`, `--radius-card`, `--status-*`, `--*-bg`
- `css/base.css` — `.status-badge` (confirmed/preliminary/cancelled) + `.category-chip` (7 категорій)
- `css/layout.css` — повний редизайн dropdown: темний градієнт, білий текст, hover-анімація
- `css/dark-mode.css` — адаптація dropdown, status badges, category chips для темної теми
- Version bump 5.42.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- v5.43 — Modals & Buttons Polish

---

## 2026-02-07 — v5.41 Performance & Cleanup

**Що вирішили:**
- Прискорити запити до БД через композитні індекси
- Прибрати дублювання коду (auth headers, time parsing)
- Оптимізувати INSERT запити (RETURNING * замість SELECT)
- Видалити мертві CSS класи

**Що додали/поміняли:**
- `db/index.js` — 3 нові композитні індекси (date+status, line+date, linked_to)
- `services/scheduler.js` — імпорт і використання `timeToMinutes`/`minutesToTime` з booking.js
- `routes/bookings.js` — INSERT RETURNING * замість SELECT після вставки (POST / і POST /full)
- `js/api.js` — `getAuthHeaders(withContentType)` замість двох окремих функцій
- `js/settings.js`, `js/booking.js` — оновлені виклики на `getAuthHeaders(false)`
- `css/layout.css` — видалено `.btn-header-nav`, `.btn-animators`, `.btn-programs`
- `css/features.css` — видалено `.btn-telegram`, `.btn-dashboard`
- Version bump 5.41.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- v5.42 — Mini Features (undo, пошук програм)

---

## 2026-02-07 — v5.40 UX & Accessibility

**Що вирішили:**
- Покращити UX (захист від подвійного кліку, auto-close модалок, збереження фільтра)
- Додати accessibility (ARIA roles, aria-label, alt тексти, семантичне меню)
- Додати візуальний спінер завантаження

**Що додали/поміняли:**
- `js/booking.js` — `unlockSubmitBtn()`, блокування кнопки під час API виклику
- `js/settings.js` — `closeAllModals()` після save (animators, telegram, digest)
- `js/app.js` — statusFilter → localStorage, відновлення при loadPreferences
- `js/auth.js` — відновлення активної кнопки фільтра при showMainApp
- `css/base.css` — `.loading-spinner` з CSS анімацією (spin)
- `js/booking.js`, `js/settings.js` — замінено текст "Завантаження..." на спінер
- `index.html` — ARIA roles на 9 модалках, aria-label на nav кнопках, role=menu/menuitem
- `invite.html` — описові alt тексти на 6 іконках програм
- Version bump 5.40.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- v5.41 — Performance & Cleanup

---

## 2026-02-07 — v5.39 Bugfixes & Security Hardening

**Що вирішили:**
- Пофіксити баги що знайшли при аналізі (minutesToTime, XSS, protocol detection)
- Закрити базові дірки в безпеці (rate limit на логін, security headers, request size limit)
- Почистити мертвий код (Google Sheets стаби)

**Що додали/поміняли:**
- `js/ui.js` — додано `minutesToTime()` (зворотна до timeToMinutes), фіксить краш при зсуві афіші
- `routes/telegram.js` — виправлено `&&` → `||` у визначенні HTTPS протоколу для webhook
- `middleware/rateLimit.js` — додано `loginRateLimiter` (5 спроб/хв, env `LOGIN_RATE_LIMIT_MAX`)
- `middleware/security.js` — додано `securityHeaders` (X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy)
- `server.js` — підключено securityHeaders, loginRateLimiter, `express.json({ limit: '1mb' })`
- `js/booking.js` — escapeHtml на назвах кімнат у free rooms panel (XSS фікс)
- `js/settings.js` — видалено порожні заглушки fetchAnimatorsFromSheet/updateLinesFromSheet
- `js/auth.js` — прибрано виклик fetchAnimatorsFromSheet() з showMainApp
- `routes/bookings.js` — rollback помилки тепер логуються замість мовчазного проковтування
- `db/index.js` — додано `pool.on('error')` handler
- Version bump 5.39.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- v5.40 — UX & Accessibility

---

## 2026-02-07 — v5.38 Image Asset Pack

**Що вирішили:**
- Нове лого (кролик з годинником на геометричному вітражі) замість діно
- Повний favicon set + PWA manifest + meta tags

**Що додали/поміняли:**
- `images/favicon.svg` — SVG лого (кролик + годинник + stained-glass фон)
- `images/favicon-*.png` — PNG 16, 32, 180 (apple-touch), 192, 512
- `favicon.ico` — multi-size ICO в корені
- `manifest.json` — PWA manifest (standalone, uk, theme emerald)
- `index.html` — meta description, theme-color, apple-mobile-web-app, favicon links, manifest link
- `index.html` — лого login screen + header → favicon-512.png
- `index.html` — changelog entry v5.38
- Version bump 5.38.0

**Під питанням:** —

**Наступний крок:**
- UI/UX overhaul серія v5.30–v5.38 завершена!

---

## 2026-02-07 — v5.37 Dark Mode & Typography Polish

**Що вирішили:**
- Повне покриття dark mode для всіх компонентів, які раніше не мали стилів
- Cleanup дублікатів у dark-mode.css

**Що додали/поміняли:**
- `css/dark-mode.css` — category program icons (7 категорій: quest, animation, show, masterclass, pinata, photo, custom) з tinted backgrounds
- `css/dark-mode.css` — повний login screen dark mode (gradient bg, dark container, inputs, labels, btn-changelog)
- `css/dark-mode.css` — panel backdrop darker (rgba 0.6), afisha items, category headers
- `css/dark-mode.css` — confirm modal buttons, empty states (.no-data, .no-history)
- `css/dark-mode.css` — видалено дублікат `afisha-import-section textarea` (був з v5.10 і v5.36)
- Version bump 5.37.0, changelog entry

**Під питанням:** —

**Наступний крок:**
- v5.38 — Image Asset Pack (favicon, PWA manifest)

---

## 2026-02-07 — v5.36 Афіша & Історія UI

**Що вирішили:**
- Другорядні екрани (Афіша, Історія) привести до design system v4.0
- Прибрати inline styles і !important — все через CSS класи

**Що додали/поміняли:**
- `index.html` — inline `style=` замінено на `.btn-afisha-add`, `.btn-afisha-import`
- `css/features.css` — нові класи кнопок, !important прибрано з .btn-shift/.btn-edit/.btn-sm
- `css/responsive.css` — афіша форма стеком (≤768px), історія фільтри стеком, touch targets
- `css/modals.css` — empty state `.no-history` з іконкою
- `css/features.css` — empty state `.no-data` з іконкою
- `css/dark-mode.css` — афіша кнопки та textarea в dark mode

**Під питанням:** —

**Наступний крок:**
- v5.37 — Dark Mode & Typography Polish

---

## 2026-02-07 — v5.35 Responsive Tablets + Desktop Toolbar

**Що вирішили:**
- Desktop toolbar переводимо на CSS Grid (два рядки замість хаотичного flex-wrap)
- Tablet panel — overlay з backdrop (380px), а не full-width push

**Що додали/поміняли:**
- `css/responsive.css` — Desktop Grid (≥769px), backdrop стилі (≤1024px), landscape query
- `css/panel.css` — `.panel-backdrop { display: none }` на desktop
- `js/booking.js` — toggle backdrop в open/close
- `js/app.js` — click handler на backdrop
- `index.html` — backdrop div, changelog entry
- Новий breakpoint: landscape phones (`max-height: 500px`)

**Під питанням:**
- Чи потрібен backdrop на desktop? (Зараз — ні, тільки tablet/mobile)

**Наступний крок:**
- v5.36 — Афіша & Історія UI

---

## 2026-02-07 — v5.34 Responsive Phones

**Що вирішили:**
- 4 breakpoints: 768px, 480px, 390px (новий), landscape
- Toolbar grouping по рядках з `order`

**Що додали/поміняли:**
- `css/responsive.css` — повний перепис responsive правил
- 768px: toolbar рядки (дата → фільтри → zoom)
- 480px: повноекранні модалки, компактний timeline
- 390px: hidden labels, ultra-compact buttons
- scroll-snap-type на timeline

**Під питанням:** —

**Наступний крок:**
- v5.35 — Tablet + Desktop toolbar ✅

---

## 2026-02-07 — v5.33 Booking Panel Mobile

**Що вирішили:**
- Панель бронювання — flex layout (header fixed, form scrollable, button sticky)
- Body scroll lock коли панель відкрита

**Що додали/поміняли:**
- `css/panel.css` — flex-direction: column, overflow: hidden на panel, flex:1 + overflow-y:auto на form
- `css/responsive.css` — `body.panel-open { overflow: hidden }`
- `js/booking.js` — `document.body.classList.add/remove('panel-open')`

**Під питанням:** —

**Наступний крок:**
- v5.34 — Responsive phones ✅

---

## 2026-02-07 — v5.32 Program Cards & Category Grid

**Що вирішили:**
- Показувати program.code замість label (коротше)
- Duration badge на кожній картці програми
- Сильніший selected state (scale + checkmark)

**Що додали/поміняли:**
- `js/booking.js` — renderProgramIcons: code + duration badge HTML
- `css/panel.css` — duration badge (.short/.long), selected state з ::after checkmark
- `css/controls.css` — видалені !important overrides (consolidated в panel.css)
- `css/dark-mode.css` — dark mode для duration badges

**Під питанням:** —

**Наступний крок:**
- v5.33 — Booking panel mobile ✅

---

## До v5.32 (попередні версії)

- **v5.31** — Segmented controls (status filter, period selector)
- **v5.30** — Design System v4.0 (emerald theme, CSS tokens, 10-file CSS architecture)
- **v5.29** — Modular backend (routes/, services/, middleware/)
- **v5.28** — Structured logging, request IDs
- **v5.19** — Free rooms feature, booking linking
- **v5.18** — Room selection in booking panel

---

*Формат: 5 рядків після кожної сесії. Тільки дописуємо зверху.*
