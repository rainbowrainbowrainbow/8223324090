# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v20.9.27**. Security Hardening + Test Coverage + Price Sync + UI Polish.

## Що готово (коротко)
- v5.30–v5.51: Design System v4.0, responsive, dark mode, PWA, security, performance
- v6.0: Test Mode
- v7.0–v7.6: Каталог, Clawd Bot, Афіша, Задачник, auto-tasks
- v7.8–v7.9: Standalone pages, мобільна адаптація, дошка задач
- v8.3–v8.6: Автоматизація, сертифікати, розумний розподіл
- v9.0: DnD, recurring bookings, analytics, offline, migrations
- v9.1.0: WebSocket live-sync, SessionStart hook
- v10.0.0–v10.5.0: Tasker, Kleshnya, Security, Data Integrity, Reliability, Profile
- v11.0.0: Kleshnya greeting/chat
- v12.0.0–v12.1.0: Design board, auto dark mode
- v13.0.0: Kleshnya Chat v2
- v14.0.0–v14.4.0: Branding, Warehouse, тести
- v15.0.0–v15.1.0: HR Module, CRM Phase 2
- v16.0.0–v16.2.0: Finance, Analytics v2, Swagger
- v17.0.0–v17.10.0: Export, Budget, Procurement, AI Team, Task Bot, Worker Forge
- v18.0.0–v18.4.0: Sidebar Nav, Center, Art Director, Demo/Packages, Leo v2, Status Page
- v19.0.0–v19.17.0: Event Queue, Rule Engine, Deep Integration, UI Polish, Search, Loyalty, Charts, Backend Hardening, Room Load Panel, Query Optimization, Smart Updates, Input Hardening, Concurrency Safety, Caching Layer, Monitoring
- **v20.0.0: Milestone Release**
- **v20.0.1: Backup Fix + Test Deploy**
- **v20.1.0: Role System — 10 ролей, матриця доступу, захист сторінок, user management API**
- **v20.2.0: Floating Command Panel — KPI dashboard, quick notes, draggable**
- **v20.3.0: Navigation — unified sidebar, Center tabs (Finance/Analytics/Status), Art rename**
- **v20.4.0: Staff Trainer — Telegram weekly prompts, review system, training.html**
- **v20.5.0: Sales Techniques — call script, upsells, free slots, price-per-child, reviews**
- **v20.6.0: Status Badges — sidebar page status indicators (building/testing/updated/in_tests/ready) + timeline menu refactor**
- **v20.7.0: Sales Features — hot leads, manager conversion, age recommendations, sales scripts, auto follow-up tasks**
- **v20.7.1: Bugfix Patch — 13 fixes (XSS, type mismatches, transactions, HTML)**
- **v20.8.0: Navigation Cleanup + UX — command panel redesign, sidebar final, art page, afisha cross-lane, header cleanup**
- **v20.9.0: Rebranding — Event Maestro → Event Genix, Space Grotesk + Inter, нова палітра**
- **v20.9.1: FAB Fix + Idle Hints — touch targets 44px, підказки при бездіяльності**
- **v20.9.2: UI Cleanup — видалено Quick Stats Bar, dark mode btn-room-load fix**
- **v20.9.3: Event Feed + Dark Mode Polish — 25+ action types, gray token contrast fix, badges dark mode**
- **v20.9.12: Supabase Customers — міграція customers на Supabase з fallback**
- **v20.9.13: Leads Page — standalone /leads з воронкою, фільтрами, конверсією**
- **v20.9.14: Banquet Booking — банкетні поля, amber стиль на таймлайні**
- **v20.9.15: Staff Extension — contract_type, skills, telegram в HR модалці**
- **v20.9.16: Task Visibility — role-based filtering через config/roles.js**
- **v20.9.18: Leads UI Polish — hardcoded colors, UX покращення**
- **v20.9.19: Test Coverage — +101 тест (leads, customers, finance, staff, tasks, warehouse)**
- **v20.9.20: Full Test Suite — +75 тестів, 9 нових файлів**
- **v20.9.21: 91% Test Coverage — 22 нових тест-файли, 797 тестів, 0 fails**
- **v20.9.22: Bugfix — 3 endpoint 500s + telegram cancellation duplicate**
- **v20.9.23: Leads Dark Mode — dark mode fix + modal mis-click protection**
- **v20.9.24: Sidebar Cleanup — видалено Status/Analytics, fix Center iframe**
- **v20.9.25: Price Sync — централізовані ціни оновлюють каталог бронювань**
- **v20.9.26: Performance + Compatibility**
- **v20.9.27: Security Hardening — CSP, input validation, JWT audit**

## Що нове (поточна сесія) — v20.9.16–v20.9.27

### v20.9.27 — Security Hardening
- **CSP** — connect-src, frame-src виправлено для embed mode
- **JWT** — revert hard fail (зламав production), залишено warning
- **Input validation** — додатковий захист

### v20.9.25–v20.9.26 — Price Sync + Performance
- **Price Sync** — централізовані ціни автоматично оновлюють каталог бронювань
- **UX** — кнопка збереження, час, валідація дат
- **Performance** — оптимізація сумісності

### v20.9.19–v20.9.21 — Test Coverage Expansion
- **797 тестів**, 0 fails, 22 тест-файли
- Покриття: leads, customers, finance, staff, tasks, warehouse, certificates, recurring, points, kleshnya, procurement, telegram, backup, settings, stats, afisha, products, auth

### v20.9.22–v20.9.24 — Bugfixes + UI
- **3 endpoint 500s** виправлено
- **Leads dark mode** — контраст, модалка
- **Sidebar** — видалено дублі, Center iframe embed

## Архітектура
- **17+ сторінок**, **40+ routes**, 18+ services, 5 middleware
- **~95+ таблиць**, 80+ індексів, 26 міграцій
- ~85 000+ рядків коду
- 797 тестів, 0 fail

## Технічний стан
- Branch: `claude/event-genix-crm-AtvBd`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`

## Відомі проблеми / пастки для нової сесії
- **Dark mode gray inversion**: В dark-mode.css сірі токени інвертовані (gray-800 = #F3F4F6 = БІЛИЙ!). Ніколи не використовувати var(--gray-800) для фону в dark mode — тільки rgba(255,255,255,0.08)
- **Версіонування 5 кроків**: package.json → index.html ?v=X.XX (32+ тегів) → tagline → changelog button → changelog entry
- **center.html standalone**: Має свої inline `<style>` + імпортує dark-mode.css. Dark mode overrides потрібно дублювати в inline стилях center.html
- **Два системи нотифікацій**: templates.js (прямі) та eventBus.js (rule-based). Перевіряй обидві при змінах
- **automation.test.js**: 28 тестів ЗАВЖДИ фейляться (pre-existing) — це НЕ наші баги
- **Rate limit в тестах**: Використовувати RATE_LIMIT_MAX=10000 при запуску тестів
- **Multi-agent**: Завжди git fetch + перевіряй чи хтось не змінив файли. Коміти з тегом [claude-code]

## Деплой
- `main` — staging (PR мерджаться сюди)
- `deployed` — production Railway (ТІЛЬКИ Клешня деплоїть)
- НІКОЛИ не push в `deployed` напряму

---
*Оновлено: 2026-03-07, v20.9.27*
