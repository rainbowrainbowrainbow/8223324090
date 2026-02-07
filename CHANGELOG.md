# CHANGELOG — Park Booking System

> Короткий журнал після кожної пачки змін. Формат: дата → рішення → зміни → питання → наступний крок.

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
