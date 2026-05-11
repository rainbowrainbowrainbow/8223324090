# Парк Закревського Періоду — Booking System

> Runtime note (2026-05-11): current Codex/Railway baseline is Node.js `22.x` with npm `10.x`. Use `AGENTS.md` and `README.md` as current operating rules; older Node 18 references below are historical.

## Project Overview
Event Genix — AI-first CRM для дитячих розважальних центрів. Таймлайн аніматорів, Telegram сповіщення, каталог програм, гейміфікація, дашборд, HR, фінанси, аналітика, Match-3 гра, AI-координатор Клешня.

## Language
- Code: English (variables, functions, comments)
- UI/UX: Ukrainian (labels, messages, notifications)
- Communication: Ukrainian preferred

## Source of Truth
- **PROJECT_PASSPORT.md** — повний паспорт проекту (стек, API, env, design system, programs, rooms)
- **CHANGELOG.md** — журнал змін по версіях
- **SNAPSHOT.md** — поточний стан для швидкого продовження сесії

## Tech Stack (ACTUAL)
- **Runtime**: Node.js 18+ (vanilla JavaScript, NO TypeScript)
- **Backend**: Express.js
- **Database**: PostgreSQL 16 + raw `pg` pool (NO Prisma, NO ORM)
- **Bot**: Custom Telegram Bot API calls (NO grammY)
- **Frontend**: Vanilla HTML + CSS + JS SPA (NO React, NO Next.js, NO Astro)
- **CSS**: 17-file modular architecture + Design System v4.0 (base, auth, layout, timeline, panel, modals, controls, features, dark-mode, responsive, pages, achievements, agents, chat, dashboard, kleshnya-widget, minigame)
- **Font**: Nunito (Google Fonts)
- **Testing**: Node.js built-in test runner (`node --test`)
- **CI/CD**: Manual deploy

## Key Conventions
- All dates stored in UTC, displayed in Europe/Kyiv (UTC+2/+3)
- Currency: UAH (₴), format: "1 000 ₴"
- Booking numbers: BK-YYYY-NNNN
- DB: snake_case → API: camelCase via `mapBookingRow()`
- Transaction pattern: `pool.connect()` → `BEGIN/COMMIT` → `catch/ROLLBACK` → `finally/release()`
- Telegram: fire-and-forget AFTER commit
- Commit messages: Conventional Commits (feat/fix/chore/docs)
- Touch targets: min 44px (WCAG 2.1)
- Font-size inputs: min 16px (iOS zoom prevention)

## Running Tests
```bash
pg_ctlcluster 16 main start
PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node server.js &
node --test tests/api.test.js
```
Test user: admin / admin123

## File Structure
```
server.js          — Entry point, routes + schedulers + graceful shutdown
db/                — Pool, initDatabase (40+ таблиць), migrate.js, migrations/ (50)
routes/ (61)       — auth, bookings, lines, history, settings, stats, afisha,
                     telegram, backup, products, tasks, task-templates, staff,
                     certificates, recurring, points, kleshnya, procurement,
                     gamification, dashboard, analytics, finance, hr, customers,
                     leads, sales, agents, chat, center, designs, demo, packages,
                     search, loyalty, shop, quiz, profile, room, status, warehouse,
                     workers, training, support, notes, music, print, and more
services/ (30)     — adminAudit, agentTracker, backup, bookingAutomation, bot,
                     cache, certificates, chat-bot, chatService, contextCache,
                     eventBus, gamification, guardian, hr, kleshnya, kleshnya-bridge,
                     kleshnya-chat, kleshnya-greeting, linkPreview, notificationDigest,
                     recurring, scheduler, schedulerGuard, summary-agent,
                     taskTemplates, telegram, templates, training, websocket
middleware/ (6)    — auth (JWT), rateLimit, security, requestId, apiAudit, apiVersioning
utils/ (2)         — logger, validateEnv
HTML (25 pages)    — index.html (main SPA), dashboard, tasks, programs, staff,
                     chat, analytics, finance, hr, customers, leads, warehouse,
                     center, art-director, designs, demo, profile, game, quiz,
                     room, shop, status, training, checkin, invite
css/ (17)          — base, auth, layout, timeline, panel, modals, controls,
                     features, dark-mode, responsive, pages, achievements,
                     agents, chat, dashboard, kleshnya-widget, minigame
js/ (44)           — config, api, auth, app, ui, booking, booking-form,
                     booking-linked, timeline, settings, settings-*, programs-page,
                     tasks-page, staff-page, offline, ws, dashboard-page,
                     analytics-page, finance-page, hr-page, customers-page,
                     leads-page, chat-page, center-page, designs-page, demo-page,
                     art-director-page, warehouse-page, shop-page, profile-page,
                     kleshnya-page, kleshnya-widget, agents-panel, command-panel,
                     sales-panel, search, status-page, idle-hints, logger,
                     minigame-match3
images/            — Logo, program icons, favicon set
tests/ (3+1)       — api.test.js (296+), certificates.test.js, automation.test.js, helpers.js
swagger.js         — OpenAPI 3.0 spec
```
Total: ~128 000 lines of code (87k JS + 16.5k HTML + 24.3k CSS)

## Multi-Agent Development

**CRITICAL: This project is edited by multiple AI agents. Always check the current version before making changes.**

### Agents in the System

| Agent | Role | Workflow |
|---|---|---|
| **Claude Code** | Основна розробка фіч | Бранчі `claude/*` → PR → `main` |
| **Клешня (OpenClaw)** | Координатор, деплой, дрібні правки | Напряму в `main`, тег `[kleshnya]` |
| **Anthropic** | Додаткова розробка | Бранчі `anthropic/*` → PR → `main` |
| **Human (Сергій)** | Approve, стратегія | Реакція :+1: = дозвіл на деплой |

### Commit Convention (ОБОВ'ЯЗКОВО)

Кожен коміт ПОВИНЕН включати тег автора:
```
feat: [claude-code] назва фічі
fix: [kleshnya] що виправив
feat: [anthropic] назва фічі
chore: [human] ручне завантаження
```

Допустимі теги: `[claude-code]`, `[kleshnya]`, `[anthropic]`, `[human]`

### Branches

- `main` — staging, сюди мерджаться всі PR
- `deployed` — production на Railway, ТІЛЬКИ Клешня деплоїть сюди
- `claude/*` — Claude Code працює тут
- `anthropic/*` — Anthropic працює тут

**NEVER** push directly to `deployed`
**NEVER** upload files via GitHub UI — breaks git history

### Before Starting Work (ОБОВ'ЯЗКОВО)
```bash
git log --oneline -10 origin/main   # хто що робив
cat package.json | grep '"version"' # поточна версія
cat SNAPSHOT.md                     # що зараз в роботі
git fetch origin && git rebase origin/main
```
Якщо бачиш незнайомі зміни — НЕ перезаписувай, а доповнюй.

### Workflow
1. Отримав завдання від Сергія
2. Виконав чекліст вище
3. Написав код у бранчі `claude/назва-XXXXX`
4. Закомітив з тегом `[claude-code]`
5. Відкрив PR в `main`
6. Сергій ставить :+1: → Клешня мерджить і деплоїть

### Version Conflict Resolution
- Якщо версія в `main` більша за твою — завжди стартуй від більшої +0.1:
  ```bash
  git show origin/main:package.json | grep version
  ```
- Якщо версія в package.json не збігається зі SNAPSHOT.md — довіряй package.json
- Якщо файл був змінений іншим агентом — прочитай актуальний перед редагуванням
- НІКОЛИ не робити `git reset --hard` без підтвердження користувача

### Communication
- Оновлюй `SNAPSHOT.md` після кожної сесії — це спільна пам'ять між агентами
- Сергій → всі агенти через Telegram
- :+1: від Сергія = approve на деплой

## Versioning Workflow (5 steps)
1. `package.json` — version bump
2. `index.html` — all `?v=X.XX` on CSS/JS tags
3. `index.html` — tagline text
4. `index.html` — changelog button text
5. `index.html` — new changelog entry in modal
