# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v20.0.0**. Milestone Release — Room Load Panel + повна серія оптимізацій бекенду.

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
- v19.0.0–v19.9.2: Event Queue, Rule Engine, Deep Integration, UI Polish, Search, Loyalty, Charts
- **v19.10.0: Backend Hardening — SQL injection fix, transactions, indexes, optimistic locking**
- **v19.11.0: Room Load Panel — згортаюча панель навантаження 15 кімнат**
- **v19.12.0: Query Optimization — N+1 fix, LEFT JOIN exports, RANK() leaderboard**
- **v19.13.0: Smart Updates — skip conflict checks, explicit SELECT columns**
- **v19.14.0: Input Hardening — CSP header, export rate limit, input validation**
- **v19.15.0: Concurrency Safety — Telegram retry queue з exponential backoff**
- **v19.16.0: Caching Layer — HTTP cache immutable, LRU stats cache**
- **v19.17.0: Monitoring — deep health check, request timeout 30s**
- **v20.0.0: Milestone Release**

## Що нове (поточна сесія) — v19.10.0–v20.0.0

### v19.11.0 — Room Load Panel (фіча користувача)
- Кнопка "🏠 Кімнати" біля zoom-контролів
- Згортаюча панель справа з усіма 15 кімнатами
- Прогрес-бари зайнятості: зелений/помаранчевий/червоний/фіолетовий
- Авто-оновлення при зміні дати, dark mode, мобільна версія
- Рахується з уже завантажених bookings (без нового API)

### v19.12.0–v19.17.0 — Backend Optimization Series
- **N+1 fix**: checkServerDuplicate — 1 запит замість N+1
- **Export JOIN**: LEFT JOIN замість correlated subquery
- **Profile RANK()**: window function замість повної вибірки
- **Smart conflict**: пропуск перевірок якщо дата/час не змінились
- **CSP**: Content-Security-Policy header
- **Rate limit**: 5 експортів / 15 хв
- **Input validation**: max length notes/label/duration
- **Telegram retry**: черга невдалих сповіщень (30с/1хв/2хв)
- **HTTP cache**: JS/CSS 7d, images 30d, fonts 1y (immutable)
- **LRU cache**: O(1) eviction для stats
- **Health check**: DB latency, pool stats, memory, 503 on degraded
- **Timeout**: 30s на всі API endpoints

## Архітектура
- **16 сторінок**, **38 routes**, 17 services, 5 middleware
- **~87 таблиць**, 77+ індексів, 23 міграцій
- ~71 000 рядків коду
- 291 тестів, 0 fail

## Технічний стан
- Branch: `claude/continue-deployment-v18-6LOJW`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=127.0.0.1 PGPASSWORD=postgres`

---
*Оновлено: 2026-02-26, v20.0.0*
