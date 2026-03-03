# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v20.9.15**. CRM Big Sprint: Supabase Customers, Leads Page, Banquet Booking, Staff Extension.

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

## Що нове (поточна сесія) — v20.9.12–v20.9.15

### v20.9.15 — Staff Extension
- **HR** — нові поля: telegram_username, contract_type (fulltime/parttime/contract), skills (TEXT[])
- **Модалка** — edit modal розширено новими полями
- **Міграція** — 026_leads_banquet_staff.sql (26.3)

### v20.9.14 — Banquet Booking
- **Бронювання** — banquet_menu, banquet_guests, banquet_tables в POST/PUT
- **Форма** — банкетні поля з'являються при category=banquet
- **Таймлайн** — .banquet-block стиль (amber gradient)

### v20.9.13 — Leads Page
- **Сторінка** — leads.html + js/leads-page.js: повний CRUD, фільтри, пошук
- **API** — instagram, source, lost_reason, booking_id + /api/leads/stats
- **Конверсія** — кнопка "Конвертувати" → перехід на бронювання з pre-fill
- **Sidebar** — додано "Ліди" в навігацію

### v20.9.12 — Supabase Customers
- **db/supabase.js** — Supabase клієнт (lazy init, fallback)
- **routes/customers.js** — повний CRUD через Supabase
- **Міграція** — POST /api/customers/migrate-to-supabase

## Архітектура
- **17+ сторінок**, **40+ routes**, 18+ services, 5 middleware
- **~95+ таблиць**, 80+ індексів, 26 міграцій
- ~75 000+ рядків коду
- 291 тест, 0 fail

## Технічний стан
- Branch: `claude/event-maestro-crm-m3Jlp`
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
*Оновлено: 2026-03-03, v20.9.15*
