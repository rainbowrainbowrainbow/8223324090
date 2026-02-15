# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md

## Де ми
Версія **v11.0.5**. Клешня знає твоє ім'я: персональні привітання з displayName з JWT токена.

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
- v10.3.0: Особистий кабінет (profile modal)
- v10.4.0: Особистий кабінет PRO (15+ SQL queries, бали, лідерборд, сертифікати)
- v10.5.0: Profile modal на sub-pages (tasks, programs, staff)
- **v11.0.0: Kleshnya greeting/chat + перебудований кабінет з 4 табами, 12 досягненнями**

## Архітектура
- **6 сторінок:** / (таймлайн), /tasks, /programs, /staff, /invite, /kleshnya
- **Backend:** 17 routes, 13 services, 4 middleware
- **Frontend:** 19 JS + 11 CSS модулів
- **БД:** ~29 таблиць, 40+ індексів, 4 міграції
- **11 schedulers**, WebSocket broadcast
- **364 тести** (3 файли + helpers)
- ~43 000 рядків коду

## Kleshnya Ecosystem (v10.0–v11.0)
- **services/kleshnya.js** — центральний інтелект (створення задач, ескалація, бали, нотифікації)
- **services/kleshnya-greeting.js** — greeting engine (персоналізовані привітання, cache 4h TTL)
- **routes/kleshnya.js** — API greeting + chat
- **routes/points.js** — API балів (leaderboard, history)
- **kleshnya.html** — чат-сторінка з історією повідомлень

## Особистий кабінет (v10.3–v11.0)
- 4 таби: Сьогодні / Задачі / Стати / Налашт.
- SVG progress ring, actionable inbox, team overview (admin)
- 12 досягнень з auto-grant, стріки, week-over-week deltas
- 23 паралельні SQL запити в /profile (Promise.allSettled)
- Inline task actions (start/done) з профілю

## Tasker & Бали
- **Типи задач:** human (людина) / bot (система)
- **Ролі:** owner (менеджер) + assigned_to (виконавець)
- **Ескалація:** 4 рівні → нагадування → увага → директор
- **Бали:** permanent (накопичувальні) + monthly (обнуляються 1-го)
- **Scheduler:** checkTaskReminders (60с), checkWorkDayTriggers (10:00/12:00), checkMonthlyPointsReset (1-ше)
- **Bot:** /tasks, /done, /alltasks
- **Telegram:** персональні (chat_id) + групові (@mention)

## Що далі
- AI agent інтеграція для Kleshnya chat
- Swagger /api-docs
- Export PDF/Excel
- Розширення тригерів Клешні

## Технічний стан
- Branch: `claude/review-project-updates-YHNS2`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- SessionStart hook: `.claude/hooks/session-start.sh`

---
*Оновлено: 2026-02-15, v11.0.0*
