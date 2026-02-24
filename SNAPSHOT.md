# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v18.0.0**. Sidebar Navigation + ROADMAP Week 1 ✅ + Week 2 початок.

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
- **v18.0.0: Sidebar Navigation — вертикальне бокове меню на всіх сторінках**

## Що нове (поточна сесія)
### UI / Navigation
- **Sidebar Navigation** — горизонтальну шапку-навігацію замінено на вертикальну бокову панель (220px зліва)
- **Role-based sidebar** — пункти меню відображаються залежно від ролі (admin/viewer)
- **Мобільна адаптація sidebar** — off-canvas меню з кнопкою ☰ та overlay на ≤768px
- **Sidebar на всіх сторінках** — навігацію додано на всі 10 standalone сторінок

### Backend (v17.9–v17.10)
- **API Audit Middleware** — автолог мутацій (POST/PUT/PATCH/DELETE) до user_action_log
- **GET /api/backup/verify** — перевірка цілісності бекапу без відновлення
- **GET /api/system-status** — адмін-дашборд стану системи
- **Digital Worker Forge v1** — таблиця `worker_roles` (міграція 010), CRUD API `/api/workers`, 3 seed ролі
- **Telegram-алерт при збої бекапу** — scheduler повідомляє в Telegram
- **Бекап 51 таблиця** — додано `worker_roles`

## Архітектура
- **11 сторінок:** / (таймлайн), /tasks, /programs, /staff, /hr, /designs, /customers, /finance, /analytics, /invite, /kleshnya, /warehouse
- **Backend:** 27 routes, 16 services, 5 middleware
- **Frontend:** 24 JS + 11 CSS модулів
- **БД:** ~51 таблиць, 50+ індексів, 10 міграцій
- **13 schedulers** (+ birthday greetings), WebSocket broadcast
- **288 тестів** (3 файли + helpers)
- ~55 000 рядків коду

## Dark Mode (v12.1+)
- `initDarkMode()` в config.js — єдина функція для всіх сторінок
- Авто: темна 20:00–07:00, світла 07:00–20:00
- Ручний toggle зберігається в localStorage і перезаписує авто

## Що далі (ROADMAP.md)
- **Week 1 ✅:** Повністю завершено (аудит, verify, status, алерти)
- **Week 2 (в процесі):** ✅ Digital Worker Forge v1 | Далі: Rule Engine, enforce ролей
- **Week 3:** Demo-режим + пакети/ліміти
- **Week 4:** Boss v1 + Art Director v1

## Технічний стан
- Branch: `claude/review-project-setup-WkSgf`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- SessionStart hook: `.claude/hooks/session-start.sh`

---
*Оновлено: 2026-02-24, v18.0.0*
