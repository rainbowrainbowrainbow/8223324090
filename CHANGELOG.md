# CHANGELOG — Park Booking System

> Короткий журнал після кожної пачки змін. Формат: дата → рішення → зміни → питання → наступний крок.

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
