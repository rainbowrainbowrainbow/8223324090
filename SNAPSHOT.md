# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v18.4.0**. Leo v2 (Contractor Ratings) + Public Status Page.

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
- v18.1.0: Центр керування — Digital Workers, KPI, Price Matrix, задачі, звіт
- v18.2.0: Art Director v1 — Brand Memory, 10 шаблонів, Content Pipeline, Approval Workflow
- v18.3.0: Demo-режим + Packages — 5 сценаріїв, 3 пакети, 15 feature flags
- **v18.4.0: Leo v2 — рейтинг підрядників, ghost rate, ескалації + Публічна статус-сторінка**

## Що нове (поточна сесія)
### Leo v2 — Contractor Ratings & Escalations — v18.4.0
- **Рейтинг підрядників** — reliability_score (1-5), quality_score (1-5), response_time_minutes, was_ghost
- **Ghost Rate** — автоматичний розрахунок % ghosting, збереження в contractors
- **Leaderboard** — ТОП-20 підрядників по рейтингу
- **Завдання підрядникам** — assign/acknowledge/in_progress/completed/overdue/cancelled
- **Ескалації** — no_response, late_delivery, quality_issue, overdue, ghosting з severity (minor/medium/high)
- **Auto-escalation** — при статусі "overdue" автоматично створюється ескалація
- **Auto-ghost rating** — при ескалації "ghosting" автоматичний рейтинг was_ghost=true
- **Recalculate stats** — при кожному рейтингу перерахунок агрегованих метрик підрядника
- **Overview dashboard** — загальна статистика по підрядниках/завданнях/ескалаціях/рейтингах
- **Міграція 014** — 6 нових таблиць + 9 нових колонок у contractors

### Public Status Page — v18.4.0
- **Нова сторінка /status** — публічна, без авторизації
- **10 системних компонентів** — API, Database, WebSocket, Telegram, Backup, Scheduler, Auth, Booking, Certificates, Kleshnya
- **5 категорій** — Core, Integrations, Infrastructure, Business, AI
- **Інциденти** — створення/оновлення, severity (minor/major/critical), auto-resolve
- **Auto-refresh** — оновлення кожні 60 секунд
- **Admin API** — управління компонентами та інцидентами

### Fix
- **Фон логіну** — повернена фонова картинка slide1-baton.png у dark mode

## Архітектура
- **16 сторінок:** / (таймлайн), /tasks, /programs, /staff, /hr, /designs, /customers, /finance, /analytics, /invite, /kleshnya, /warehouse, /center, /art-director, /demo, /status
- **Backend:** 32 routes, 16 services, 5 middleware
- **Frontend:** 27 JS + 11 CSS модулів
- **БД:** ~66 таблиць, 60+ індексів, 14 міграцій
- **13 schedulers** (+ birthday greetings), WebSocket broadcast
- **291+ тестів** (3 файли + helpers)
- ~60 000 рядків коду

## Dark Mode (v12.1+)
- `initDarkMode()` в config.js — єдина функція для всіх сторінок
- Авто: темна 20:00–07:00, світла 07:00–20:00
- Ручний toggle зберігається в localStorage і перезаписує авто

## Що далі (ROADMAP.md)
- **30-day ROADMAP: 100% COMPLETE**
- **Core:** Event Queue + Rule Engine + Idempotency
- **Leo v2 ✅:** Рейтинги, ghost rate, ескалації
- **Print & Assets:** Preflight validation, print routing
- **Infrastructure ✅ (partial):** Public status page done, retention policy pending
- **Employee mapping:** Telegram ↔ профіль ↔ роль ↔ доступи
- **Support/SLA:** Ескалації + SLA правила

## Технічний стан
- Branch: `claude/continue-deployment-v18-6LOJW`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=127.0.0.1 PGPASSWORD=postgres`
- SessionStart hook: `.claude/hooks/session-start.sh`

---
*Оновлено: 2026-02-25, v18.4.0*
