# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v18.1.0**. Центр керування бізнесом (Boss) + Sidebar Navigation + ROADMAP Week 1 ✅ + Week 4 початок.

## Що готово (коротко)
- v5.30–v5.51: Design System v4.0, responsive, dark mode, PWA, security, performance
- v6.0: Test Mode
- v7.0–v7.6: Каталог, Clawd Bot, Афіша, Задачник, auto-tasks
- v7.8–v7.9: Standalone pages, мобільна адаптація, дошка задач
- v8.3–v8.6: Автоматизація, сертифікати, розумний розподіл
- v9.0: DnD, recurring bookings, analytics, offline, migrations
- v9.0.1–v9.0.2: Staff toolbar fix, accessibility (skip-links, reduced motion)
- v9.1.0: WebSocket live-sync, SessionStart hook
- v10.0.0: Tasker + Клешня — операційний центр
- v10.0.1: Security hotfix (RBAC, input validation)
- v10.1.0: Data integrity (unique indexes, atomic dedup, optimistic locking)
- v10.2.0: Reliability (logging, ROLLBACK safety, graceful shutdown)
- v10.3.0–v10.5.0: Особистий кабінет PRO + profile на sub-pages
- v11.0.0: Kleshnya greeting/chat + перебудований кабінет
- v12.0.0: Дизайн-борд
- v12.1.0: Авто dark mode + мобільний UX
- v13.0.0: Kleshnya Chat v2 — multi-session + sidebar + media + WebSocket
- v14.0.0–v14.4.0: Branding, Warehouse, тести
- v15.0.0: HR Module — повний HR-блок
- v15.1.0: CRM Phase 2 — клієнтська база, фільтри, RFM, ДН, сертифікати, експорт
- v16.0.0: Finance Module — каса, P&L, зарплати, категорії, автозапис, CSV
- v16.1.0: Analytics v2 — єдиний дашборд (bookings + finance + HR + CRM)
- v16.2.0: Swagger API Docs — /api-docs, OpenAPI 3.0, 136 ендпоінтів
- v17.0.0: Export Excel/PDF + Бюджетне планування + Система закупок
- v17.1.0: AI Team редизайн — акордеон-панелі, журнал, відправка на завдання
- v17.4.0: Світлана Task Bot live
- v17.8.0: Multi-agent workflow rules (CLAUDE.md)
- v17.9.0: ROADMAP Week 1 — API Audit + Backup Verify + System Status
- v17.10.0: Digital Worker Forge v1 + Backup failure alerts
- v18.0.0: Sidebar Navigation — вертикальне бокове меню на всіх сторінках
- **v18.1.0: Центр керування — Digital Workers, KPI, Price Matrix, задачі, звіт**

## Що нове (поточна сесія)
### Центр керування (Boss) — v18.1.0
- **Нова сторінка /center** — центр керування бізнесом з 5 блоками
- **Digital Workers** — картки Клешні, Світлани, Складу з живим статусом (active/idle/offline)
- **KPI дашборд** — виручка, бронювання, середній чек, топ програма (сьогодні/тиждень/місяць)
- **Price Matrix** — централізовані ціни (CRUD) з inline-редагуванням, таблиця `price_rules`
- **Задачі** — агреговані задачі по всій системі з фільтром по виконавцю
- **Щоденний звіт** — секція останнього звіту від Клешні (зберігається в settings)

### Backend
- **routes/center.js** — 8 ендпоінтів (overview, workers, prices CRUD, report, tasks)
- **Міграція 011** — таблиця `price_rules` + 7 seed цін
- **GET /api/center/overview** — зведені KPI + workers status
- **GET/PUT/POST/DELETE /api/center/prices** — повний CRUD цінових правил
- **GET /api/center/report** — останній щоденний звіт

### Navigation
- **Центр у sidebar** — 🧠 Центр додано на всі 12 сторінок
- **Доступ** — admin only (sidebar-admin-only + JS перевірка)

## Архітектура
- **12 сторінок:** / (таймлайн), /tasks, /programs, /staff, /hr, /designs, /customers, /finance, /analytics, /invite, /kleshnya, /warehouse, /center
- **Backend:** 28 routes, 16 services, 5 middleware
- **Frontend:** 25 JS + 11 CSS модулів
- **БД:** ~52 таблиць, 50+ індексів, 11 міграцій
- **13 schedulers** (+ birthday greetings), WebSocket broadcast
- **288 тестів** (3 файли + helpers)
- ~56 000 рядків коду

## Dark Mode (v12.1+)
- `initDarkMode()` в config.js — єдина функція для всіх сторінок
- Авто: темна 20:00–07:00, світла 07:00–20:00
- Ручний toggle зберігається в localStorage і перезаписує авто

## Що далі (ROADMAP.md)
- **Week 1 ✅:** Повністю завершено (аудит, verify, status, алерти)
- **Week 2 ✅:** Digital Worker Forge v1
- **Week 3:** Demo-режим + пакети/ліміти
- **Week 4 (в процесі):** ✅ Boss v1 (Center) | Далі: Art Director v1

## Технічний стан
- Branch: `claude/continue-deployment-v18-6LOJW`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- SessionStart hook: `.claude/hooks/session-start.sh`

---
*Оновлено: 2026-02-25, v18.1.0*
