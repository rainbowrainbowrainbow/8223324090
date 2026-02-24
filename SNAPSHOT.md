# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v17.8.0**. Multi-agent workflow rules + ROADMAP v1.1.

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
- **v17.8.0: Multi-agent workflow rules (CLAUDE.md)**

## Що нове (поточна сесія)
- **ROADMAP.md** — Improvement Playbook v1.1 (15 розділів, 30-денний план)
- **Бекапи виправлено** — з 18 до 50 таблиць (критичний фікс: раніше не бекапились customers, finance, HR, warehouse, procurement, designs, contractors, chat_sessions)

## Архітектура
- **11 сторінок:** / (таймлайн), /tasks, /programs, /staff, /hr, /designs, /customers, /finance, /analytics, /invite, /kleshnya, /warehouse
- **Backend:** 26 routes, 16 services, 4 middleware
- **Frontend:** 24 JS + 11 CSS модулів
- **БД:** ~50 таблиць, 50+ індексів, 9 міграцій
- **13 schedulers** (+ birthday greetings), WebSocket broadcast
- **288 тестів** (3 файли + helpers)
- ~54 000 рядків коду

## Dark Mode (v12.1+)
- `initDarkMode()` в config.js — єдина функція для всіх сторінок
- Авто: темна 20:00–07:00, світла 07:00–20:00
- Ручний toggle зберігається в localStorage і перезаписує авто

## Що далі (ROADMAP.md)
- **Week 1:** RBAC + аудит, бекапи + test restore, алерти
- **Week 2:** Digital Worker Forge + Rule Engine
- **Week 3:** Demo-режим + пакети/ліміти
- **Week 4:** Boss v1 + Art Director v1

## Технічний стан
- Branch: `claude/review-project-setup-WkSgf`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- SessionStart hook: `.claude/hooks/session-start.sh`

---
*Оновлено: 2026-02-24, v17.8.0*
