# CHANGELOG — Park Booking System

> Короткий журнал після кожної пачки змін. Формат: дата → рішення → зміни → питання → наступний крок.

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
