# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md

## Де ми
Версія **v10.0.0**. Tasker + Клешня: операційний центр системи.

## Що готово (коротко)
- v5.30–v5.51: Design System v4.0, responsive, dark mode, PWA, security, performance
- v6.0: Test Mode
- v7.0–v7.6: Каталог, Clawd Bot, Афіша, Задачник, auto-tasks
- v7.8–v7.9: Standalone pages, мобільна адаптація, дошка задач
- v8.3–v8.6: Автоматизація, сертифікати, розумний розподіл
- v9.0: DnD, recurring bookings, analytics, offline, migrations
- v9.0.1–v9.0.2: Staff toolbar fix, accessibility (skip-links, reduced motion)
- v9.1.0: WebSocket live-sync, SessionStart hook
- **v10.0.0: Tasker + Клешня — операційний центр**

## Архітектура
- **5 сторінок:** / (таймлайн), /tasks, /programs, /staff, /invite
- **Backend:** 16 routes, 12 services, 4 middleware
- **Frontend:** 19 JS + 11 CSS модулів
- **БД:** 24 таблиці, 30+ індексів
- **11 schedulers**, WebSocket broadcast
- **364 тести** (3 файли)
- ~41 000 рядків коду

## Tasker & Клешня (v10.0)
- **services/kleshnya.js** — центральний інтелект (створення задач, ескалація, бали, нотифікації)
- **routes/points.js** — API балів (leaderboard, history)
- **Типи задач:** human (людина) / bot (система)
- **Ролі:** owner (менеджер) + assigned_to (виконавець)
- **Ескалація:** 4 рівні → нагадування → увага → директор
- **Бали:** permanent (накопичувальні) + monthly (обнуляються 1-го)
- **Scheduler:** checkTaskReminders (60с), checkWorkDayTriggers (10:00/12:00), checkMonthlyPointsReset (1-ше)
- **Bot:** /tasks, /done, /alltasks
- **Telegram:** персональні (chat_id) + групові (@mention)

## Що далі
- Frontend: бали, owner/deadline в задачах
- Swagger /api-docs
- Drag-n-drop програм
- Export PDF/Excel
- Розширення тригерів Клешні

## Технічний стан
- Branch: `claude/review-project-updates-R2CbJ`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- SessionStart hook: `.claude/hooks/session-start.sh`

---
*Оновлено: 2026-02-15, v10.0.0*
