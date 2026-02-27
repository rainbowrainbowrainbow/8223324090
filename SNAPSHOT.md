# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v20.9.0**. Rebranding: Event Maestro → Genix.

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
- **v20.9.0: Rebranding — Event Maestro → Genix, Space Grotesk + Inter, нова палітра**

## Що нове (поточна сесія) — v20.9.0

### v20.9.0 — Rebranding: Event Maestro → Genix
- **Genix** — повний ребрендинг у 35+ файлах (HTML, JS, CSS, routes, services, configs)
- **Абревіатура** — EM → GX у sidebar навігації
- **Space Grotesk** — новий шрифт для заголовків (Brand Guide v0.1)
- **Inter** — основний шрифт замість Nunito
- **Палітра** — gold accent #C9A84C, dark background #0D0D0D
- **Конфіги** — package.json (genix), manifest.json, sw.js cache name
- **Тести** — оновлено перевірку назви сайту

## Архітектура
- **16+ сторінок**, **40+ routes**, 18+ services, 5 middleware
- **~95+ таблиць**, 80+ індексів, 24 міграцій
- ~75 000+ рядків коду
- 291 тестів, 0 fail

## Технічний стан
- Branch: `claude/event-maestro-crm-m3Jlp`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`

---
*Оновлено: 2026-02-27, v20.9.0*
