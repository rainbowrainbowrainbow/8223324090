# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md

## Де ми
Версія **v9.1.0**. Live-Sync: WebSocket, accessibility, SessionStart hook.

## Що готово (коротко)
- v5.30–v5.51: Design System v4.0, responsive, dark mode, PWA, security, performance
- v6.0: Test Mode
- v7.0–v7.6: Каталог, Clawd Bot, Афіша, Задачник, auto-tasks
- v7.8–v7.9: Standalone pages, мобільна адаптація, дошка задач
- v8.3–v8.6: Автоматизація, сертифікати, розумний розподіл
- v9.0: DnD, recurring bookings, analytics, offline, migrations
- v9.0.1–v9.0.2: Staff toolbar fix, accessibility (skip-links, reduced motion)
- v9.1.0: WebSocket live-sync, SessionStart hook

## Архітектура
- **5 сторінок:** / (таймлайн), /tasks, /programs, /staff, /invite
- **Backend:** 15 routes, 11 services, 4 middleware
- **Frontend:** 19 JS + 11 CSS модулів
- **БД:** 20 таблиць, 23 індекси
- **8 schedulers**, WebSocket broadcast
- **364 тести** (3 файли)
- ~40 000 рядків коду

## Що далі
- Swagger /api-docs
- Clawd Bot /tasks, /done
- Drag-n-drop програм
- Export PDF/Excel

## Технічний стан
- Branch: `claude/review-project-updates-R2CbJ`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- SessionStart hook: `.claude/hooks/session-start.sh`

---
*Оновлено: 2026-02-15, v9.1.0*
