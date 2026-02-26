# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v19.1.0**. Deep Integration — модулі з'єднані через EventBus + Rule Engine v2.

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
- v19.0.0: Event Queue, Rule Engine, Print & Assets, Employee Mapping, Support/SLA, Music Center
- **v19.1.0: Deep Integration — EventBus, Rule Engine v2 (real actions), SLA auto-breach, Activity tracking**

## Що нове (поточна сесія) — v19.1.0

### 1. EventBus — services/eventBus.js
- Універсальний publisher: `publish(eventType, payload, idempotencyKey)`
- Автоматичний виклик Rule Engine при публікації
- Retry failed events з exponential backoff (2^n хвилин)
- Dead letter queue для невідновлюваних подій

### 2. Rule Engine v2 — реальне виконання дій
- **create_task** — створення задачі через правило з шаблонами `{key}`
- **send_telegram** — відправка повідомлення з інтерполяцією payload
- **create_print_job** — автоматичне створення друкованого завдання
- **escalate** — ескалація з Telegram сповіщенням
- **log** — логування подій

### 3. Bookings → Event Queue
- `booking.created` — при створенні бронювання
- `booking.cancelled` — при скасуванні
- `booking.confirmed` / `booking.status_changed` — при зміні статусу

### 4. Certificates → Event Queue
- `certificate.created` — при створенні сертифікату
- `certificate.used` / `certificate.revoked` — при зміні статусу

### 5. Scheduler Integration
- **checkEventQueue** — retry failed + move to DLQ (кожну хвилину)
- **checkSLABreach** — виявлення порушень SLA, Telegram ескалація
- **checkScheduledAnnouncements** — автоактивація запланованих оголошень

### 6. Employee Activity Tracking
- `employee_profiles.last_activity_at` оновлюється при кожному API-запиті
- Throttled: максимум 1 UPDATE на хвилину на користувача

## Архітектура
- **16 сторінок**, **37 routes**, 17 services, 5 middleware
- **~81 таблиць**, 75+ індексів, 15 міграцій
- ~66 000 рядків коду

## Технічний стан
- Branch: `claude/continue-deployment-v18-6LOJW`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=127.0.0.1 PGPASSWORD=postgres`

---
*Оновлено: 2026-02-26, v19.1.0*
