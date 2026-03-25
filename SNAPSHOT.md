# SNAPSHOT — Event Genix CRM

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md

## Де ми
Версія **v38.9.0**. Бранч `claude/continue-project-work-pdpKD` — запушений.

## Актуальний стан

### Версія та бранч
- **package.json**: `"version": "38.4.0"`
- **Бранч**: `claude/continue-project-work-pdpKD` (pushed to origin)
- **main**: v20.9.15 (відстає значно)

### Тести
- **346+ тестів**, pass
- Запуск: `PGUSER=postgres PGPASSWORD=postgres PGDATABASE=park_booking PGHOST=localhost RATE_LIMIT_MAX=5000 node --test tests/api.test.js`

### Сервер
```bash
PGUSER=postgres PGPASSWORD=postgres PGDATABASE=park_booking PGHOST=localhost RATE_LIMIT_MAX=5000 node server.js
```
Порт 3000. PostgreSQL 16.

## Що зроблено в цій сесії

### v38.9.0 — Security & Reliability Hardening (based on deep tech audit)

#### JWT Refresh Tokens
- Access token 15m + refresh token 30d з rotation
- Replay detection — повторне використання revoked token = revoke ALL sessions
- Endpoints: /auth/refresh, /auth/logout, /auth/sessions
- Backward compat — legacy 24h token залишився

#### Transactional Outbox
- `publishInTransaction()` — запис подій в тій самій транзакції що й бізнес-дані
- Outbox relay — scheduler кожні 5 сек, FOR UPDATE SKIP LOCKED
- Auto-cleanup published events (7 днів)

#### pg_stat_statements + SQL Safety
- pg_stat_statements enabled
- utils/sqlSafe.js — safeOrderBy, safeTableName, safeSets
- Аудит SQL injection — 12+ місць перевірені, всі використовують allowlists

#### DB Migration 125
- Таблиця `refresh_tokens` (з індексами)
- Таблиця `outbox_events` (з індексами)
- pg_stat_statements extension

### v38.3.0 — Operations Intelligence (based on market research)

#### Exceptions Inbox
- Новий dashboard widget `exceptions` — агрегує 6 типів операційних проблем
- Конфлікти кімнат, без аніматора, прострочена підготовка, NPS detractors, cleaning SLA, непідтверджені бронювання
- Додано до дашбордів: creator, director, vice_director, senior_manager, manager, admin, reception

#### Event Pipeline
- Автоматичний lifecycle бронювання: T-24, day_of, completed
- Таблиця `booking_pipeline` для idempotent stage tracking
- 3 scheduler jobs: checkEventPipeline, checkNpsFollowUp, checkCleaningTasks

#### NPS Follow-Up
- Detractor (1-2/5) → задача менеджеру + Telegram alert
- Promoter (5/5) → referral пропозиція через Telegram
- Нові поля event_reviews: nps_score, follow_up_status, follow_up_task_id

#### Cleaning Task Chain
- Таблиця `cleaning_tasks` з SLA tracking (15 хв default)
- Автосоздание після завершення бронювання

#### Event Bus Rules (5 нових)
- booking_t24_reminder, nps_detractor_followup, nps_promoter_referral, booking_cleaning_auto, booking_day_prep

## Змінені файли
```
db/migrations/125_security_hardening.sql      — refresh_tokens + outbox_events + pg_stat_statements
middleware/auth.js                             — refresh token functions (create, rotate, revoke, cleanup)
routes/auth.js                                — /refresh, /logout, /sessions endpoints
services/eventBus.js                          — publishInTransaction + processOutbox + cleanupOutbox
utils/sqlSafe.js                              — SQL safety utilities (NEW)
server.js                                     — outbox relay + token cleanup schedulers
package.json                                  — version 38.4.0
CHANGELOG.md                                  — v38.9.0 entry
SNAPSHOT.md                                   — this file
```

## Що готово (коротко, всі попередні версії)
- v5.30–v5.51: Design System v4.0, responsive, dark mode, PWA, security, performance
- v6.0: Test Mode
- v7.0–v7.9: Каталог, Clawd Bot, Афіша, Задачник, standalone pages
- v8.3–v8.6: Автоматизація, сертифікати, розумний розподіл
- v9.0–v9.1: DnD, recurring, analytics, offline, migrations, WebSocket
- v10.0–v10.5: Tasker, Kleshnya, Security, Data Integrity, Reliability, Profile
- v11.0–v13.0: Kleshnya chat v1/v2, design board, auto dark mode
- v14.0–v14.4: Branding, Warehouse, тести
- v15.0–v15.1: HR Module, CRM Phase 2
- v16.0–v16.2: Finance, Analytics v2, Swagger
- v17.0–v17.10: Export, Budget, Procurement, AI Team, Task Bot, Worker Forge
- v18.0–v18.4: Sidebar Nav, Center, Art Director, Demo/Packages, Leo v2, Status Page
- v19.0–v19.17: Event Queue, Rule Engine, Deep Integration, UI Polish, Search, Loyalty, Charts, Backend Hardening, Monitoring
- v20.0–v20.12.0: Milestone, Role System, Command Panel, Navigation, Sales, Rebranding, Tests, Security, UX, Validation, Swagger
- v28.0–v28.2: Rock Sound Engine, Manager AI Copilot, Guardian
- v29.0–v30.0: Leads, Graduation, Chat improvements
- v31.0–v33.16: Hub Nav, Sound System, Alerts, Sidebar Pro, Test Builds
- v34.0.0–v35.0.0: Sidebar Full Rebuild
- v38.0.0–v38.2.0: Testing, deep research prep
- v38.3.0: Operations Intelligence
- **v38.9.0: Security & Reliability Hardening (ПОТОЧНА СЕСІЯ)**

## Незроблені баги з BUGFIX_TASKS.md
- **BUG-001** — Тімур бот: зайвий текст при decline/other (`tymur-bot/bot.py`) — НЕ ЗРОБЛЕНО
- **CRM-VAL-001** — Минула дата в бронюванні — НЕ ЗРОБЛЕНО (бекенд валідація)

## Архітектура
- **34 сторінок**, **74 routes**, 41 services, 6 middleware
- **180+ таблиць**, 80+ індексів, 125 міграцій
- ~128 000+ рядків коду
- 346+ тестів

## Відомі проблеми / пастки
- **Dark mode gray inversion**: gray-800 = #F3F4F6 = БІЛИЙ в dark mode! Використовуй rgba(255,255,255,0.08)
- **Версіонування 5 кроків**: package.json → index.html `?v=` (32+ тегів) → tagline → changelog button → changelog entry
- **center.html standalone**: Має inline `<style>` + dark-mode.css. Дублювати dark overrides
- **Два системи нотифікацій**: templates.js (прямі) та eventBus.js (rule-based)
- **Toast замість Notification**: `#notification` більше НЕМАЄ — тепер `#toastContainer` + `showNotification()` створює toast елементи
- **Multi-agent**: Завжди git fetch + перевіряй чи хтось не змінив файли. Коміти з тегом `[claude-code]`
- **gh CLI**: Немає GitHub токена — PR створювати вручну на GitHub
- **Sidebar accordion**: `sidebar-group-inner { min-height: 0 }` — КРИТИЧНО для grid collapse
- **#sidebarActions**: НЕ видаляти, тільки `display:none` — app.js/auth.js мають обробники

## Деплой
- `main` — staging (PR мерджаться сюди)
- `deployed` — production Railway (ТІЛЬКИ Клешня деплоїть)
- НІКОЛИ не push в `deployed` напряму

---
*Оновлено: 2026-03-25, v38.9.0, сесія claude-code*
