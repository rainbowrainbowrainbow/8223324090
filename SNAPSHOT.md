# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md

## Де ми
Версія **v17.0.0**. Export, Budget & Procurement.

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
- **v17.0.0: Export Excel/PDF + Бюджетне планування + Система закупок**

## Архітектура
- **11 сторінок:** / (таймлайн), /tasks, /programs, /staff, /hr, /designs, /customers, /finance, /analytics, /invite, /kleshnya, /warehouse
- **Backend:** 21 routes, 13 services, 4 middleware
- **Frontend:** 24 JS + 11 CSS модулів
- **БД:** ~37 таблиць (budget_plans, procurement_lists, procurement_items — нові), 50+ індексів, 9 міграцій
- **13 schedulers** (+ birthday greetings), WebSocket broadcast
- **288 тестів** (3 файли + helpers)
- ~54 000 рядків коду

## v17.0 — Нові модулі

### Export Excel
- `exceljs` — server-side Excel generation
- `/api/finance/export-xlsx` — фінансові транзакції
- `/api/customers/export-xlsx` — клієнтська база
- `/api/procurement/export-xlsx` — списки закупок
- Print CSS для PDF через Ctrl+P

### Бюджетне планування
- `budget_plans` — план по категоріях × місяцях
- `PUT /api/finance/budget` — upsert (ON CONFLICT)
- `GET /api/finance/budget/comparison` — план vs факт з % виконання
- Фронтенд: таб «Бюджет» у Фінансах

### Система закупок
- `procurement_lists` + `procurement_items`
- 6 відділів: animators, cleaning, cafe, tech, admin, security
- 6 статусів: draft → approved → in_progress → purchased → delivered / cancelled
- Авто-поповнення з нестач (`suggestions/low-stock`)
- Авто-реstock при завершенні закупки (`complete`)
- Фронтенд: таб «Закупки» на сторінці Складу
- Excel export для закупок

## Dark Mode (v12.1+)
- `initDarkMode()` в config.js — єдина функція для всіх сторінок
- Авто: темна 20:00–07:00, світла 07:00–20:00
- Ручний toggle зберігається в localStorage і перезаписує авто

## Що далі
- Тестування Kleshnya Chat v2 з OpenClaw Bridge
- Розширення тригерів Клешні
- Інтеграція закупок з Telegram-сповіщеннями
- Мобільна оптимізація закупок

## Технічний стан
- Branch: `claude/bump-version-0.1-lj64Q`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- SessionStart hook: `.claude/hooks/session-start.sh`

---
*Оновлено: 2026-02-22, v17.0.0*
