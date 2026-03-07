# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v20.12.0**. Бранч `claude/event-genix-crm-AtvBd` — запушений, PR в main треба створити вручну (gh CLI без токена).

## Актуальний стан

### Версія та бранч
- **package.json**: `"version": "20.12.0"`
- **Бранч**: `claude/event-genix-crm-AtvBd` (pushed to origin)
- **Production**: v20.9.27 на `deployed` бранчі (деплоїть тільки Клешня)
- **main**: відстає (v20.2.0), PR ще не створений

### Тести
- **291 тест**, 290 pass, 1 fail (pre-existing — CSV/XLSX export)
- Запуск: `PGUSER=postgres PGPASSWORD=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node --test tests/api.test.js`
- automation.test.js — 28 тестів ЗАВЖДИ фейляться (pre-existing, НЕ наші)

### Сервер
```bash
PGUSER=postgres PGPASSWORD=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node server.js
```
Порт 3000. PostgreSQL: `pg_ctlcluster 16 main start`

## Що зроблено в цій сесії (від v20.9.27 до v20.12.0)

### v20.10.0 — UX Polish & Observability
- **WS Status Dot** — зелений/червоний індикатор з'єднання у шапці (`#wsStatusDot`)
- **Offline Badge** — лічильник pending мутацій (`#offlineBadge`)
- **Toast Stack** — до 3 сповіщень одночасно замість одного (`#toastContainer` замінив `#notification`)
- **CSV Export** — кнопка «📥 CSV» в модалці історії змін
- **Console Cleanup** — видалено 26 console.log з ws.js, offline.js, timeline.js → замінено на `_debug()`
- **Login Fix** — кнопки ☰ і 💡 більше не видно на екрані входу

### v20.11.0 — Form Validation & Accessibility
- **Real-time Validation** — `BookingForm.validateField()` на `change`/`blur`, `aria-invalid`, red border
- **Unsaved Changes** — `BookingForm._dirty` flag + `beforeunload` warning
- **Keyboard Navigation** — ArrowUp/Down між booking blocks на таймлайні, Enter/Space → open
- **ARIA** — `aria-required`, `aria-label`, `focus-visible` на booking blocks
- **Login Autocomplete** — `autocomplete="username"` / `autocomplete="current-password"`

### v20.12.0 — Swagger & Developer Experience
- **Swagger** — OpenAPI spec оновлено v16.2→v20.12 (+12 endpoints: leads, customers, workers, finance, health)
- **JWT Auth** — глобальна bearerAuth в Swagger UI
- **FrontendLogger** — `js/logger.js`: `.debug()/.info()/.warn()/.error()` через `localStorage.pzp_log_level`

### Hotfix (останній коміт)
- **☰ кнопка на логіні** — додано `class="hidden"` в HTML щоб не блимала до виконання JS

## Змінені файли (повний список)
```
index.html         — WS dot, offline badge, toast container, CSV btn, ARIA attrs, version bump, changelog
js/app.js          — WS status listeners, offline badge, history export, BookingForm.init()
js/auth.js         — hide ☰/💡 on login, show on main app
js/ui.js           — toast stack (replaced single notification)
js/ws.js           — 16 console.log → _debug()
js/offline.js      — 9 console.log → _debug()
js/timeline.js     — keyboard nav, ARIA on booking blocks
js/booking-form.js — dirty state, validateField(), init(), isDirty(), markClean()
js/settings.js     — _lastHistoryItems for CSV export
js/logger.js       — NEW: FrontendLogger
swagger.js         — version bump, +12 endpoints, global JWT
css/base.css       — toast-container styles
css/features.css   — ws-status-dot, offline-badge, modal-header-row
css/controls.css   — aria-invalid red border, field-error
css/timeline.css   — booking-block:focus-visible
css/dark-mode.css  — toast dark mode
css/responsive.css — toast-container responsive
package.json       — version 20.12.0
SNAPSHOT.md        — this file
```

## Що готово (коротко, всі попередні версії)
- v5.30–v5.51: Design System v4.0, responsive, dark mode, PWA, security, performance
- v6.0: Test Mode
- v7.0–v7.9: Каталог, Clawd Bot, Афіша, Задачник, standalone pages
- v8.3–v8.6: Автоматизація, сертифікати, розумний розподіл
- v9.0–v9.1: DnD, recurring, analytics, offline, migrations, WebSocket
- v10.0–v10.5: Tasker, Kleshnya, Security, Data Integrity, Reliability, Profile
- v11.0–v13.0: Kleshnya chat v1/v2, design board, auto dark mode
- v14.0–v14.4: Branding, Warehouse, тести
- v15.0–v15.1: HR Module, CRM Phase 2
- v16.0–v16.2: Finance, Analytics v2, Swagger
- v17.0–v17.10: Export, Budget, Procurement, AI Team, Task Bot, Worker Forge
- v18.0–v18.4: Sidebar Nav, Center, Art Director, Demo/Packages, Leo v2, Status Page
- v19.0–v19.17: Event Queue, Rule Engine, Deep Integration, UI Polish, Search, Loyalty, Charts, Backend Hardening, Monitoring
- v20.0–v20.9.27: Milestone, Role System, Command Panel, Navigation, Sales, Rebranding, Tests, Security
- **v20.10.0–v20.12.0: UX, Validation, Swagger (ПОТОЧНА СЕСІЯ)**

## Незроблені баги з BUGFIX_TASKS.md
- **BUG-001** — Тімур бот: зайвий текст при decline/other (`tymur-bot/bot.py`) — НЕ ЗРОБЛЕНО
- **CRM-UI-001** — День тижня на таймлайні — ВЖЕ ПРАЦЮЄ (перевірено, `#dayOfWeekLabel` показує день)
- **CRM-UI-002** — Календар з Понеділка — ВЖЕ ПРАЦЮЄ (перевірено)
- **CRM-VAL-001** — Минула дата в бронюванні — НЕ ЗРОБЛЕНО (бекенд валідація)
- **CRM-BUG-002** — Кнопка "Афіша" в меню — НЕ ПЕРЕВІРЕНО

## Архітектура
- **17+ сторінок**, **40+ routes**, 18+ services, 5 middleware
- **~95+ таблиць**, 80+ індексів, 35 міграцій
- ~85 000+ рядків коду
- 291 тест (290 pass)

## Відомі проблеми / пастки
- **Dark mode gray inversion**: gray-800 = #F3F4F6 = БІЛИЙ в dark mode! Використовуй rgba(255,255,255,0.08)
- **Версіонування 5 кроків**: package.json → index.html `?v=` (32+ тегів) → tagline → changelog button → changelog entry
- **center.html standalone**: Має inline `<style>` + dark-mode.css. Дублювати dark overrides
- **Два системи нотифікацій**: templates.js (прямі) та eventBus.js (rule-based)
- **Toast замість Notification**: `#notification` більше НЕМАЄ — тепер `#toastContainer` + `showNotification()` створює toast елементи
- **_debug() у ws.js/offline.js**: Замінено console.log на `_debug()` (показує тільки при `localStorage.pzp_debug = 'true'`)
- **Multi-agent**: Завжди git fetch + перевіряй чи хтось не змінив файли. Коміти з тегом `[claude-code]`
- **gh CLI**: Немає GitHub токена — PR створювати вручну на GitHub

## Деплой
- `main` — staging (PR мерджаться сюди)
- `deployed` — production Railway (ТІЛЬКИ Клешня деплоїть)
- НІКОЛИ не push в `deployed` напряму

---
*Оновлено: 2026-03-07, v20.12.0, сесія claude-code*
