# Парк Закревського Періоду — Booking System

## Project Overview
Система бронювання для дитячого розважального парку з таймлайном аніматорів, Telegram сповіщеннями, каталогом програм і адмін-панеллю.

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
- **CSS**: 11-file modular architecture + Design System v4.0 (base, auth, layout, timeline, panel, modals, controls, features, dark-mode, responsive, pages)
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
server.js          — Entry point (~240 lines, routes + schedulers + graceful shutdown)
db/                — Pool, initDatabase (30 таблиць), migrate.js, migrations/
routes/ (17)       — auth, bookings, lines, history, settings, stats, afisha,
                     telegram, backup, products, tasks, task-templates, staff,
                     certificates, recurring, points, kleshnya
services/ (13)     — booking, bookingAutomation, bot, certificates, kleshnya,
                     kleshnya-greeting, recurring, telegram, templates,
                     taskTemplates, scheduler, backup, websocket
middleware/ (4)    — auth (JWT), rateLimit, security, requestId
utils/ (2)         — logger, validateEnv
index.html         — Main SPA (all modals)
kleshnya.html      — Kleshnya chat page
tasks.html         — Standalone task board
programs.html      — Standalone catalog
staff.html         — Standalone schedule
invite.html        — Public invite link
css/ (11)          — base, auth, layout, timeline, panel, modals, controls,
                     features, dark-mode, responsive, pages
js/ (19)           — config, api, auth, app, ui, booking, booking-form,
                     booking-linked, timeline, settings, settings-afisha,
                     settings-certificates, settings-dashboard, settings-history,
                     programs-page, tasks-page, staff-page, offline, ws
images/            — Logo, program icons, favicon set
tests/ (3+1)       — api.test.js (223), certificates.test.js (82),
                     automation.test.js (59), helpers.js
swagger.js         — OpenAPI 3.0 spec (not yet integrated)
```

## Versioning Workflow (5 steps)
1. `package.json` — version bump
2. `index.html` — all `?v=X.XX` on CSS/JS tags
3. `index.html` — tagline text
4. `index.html` — changelog button text
5. `index.html` — new changelog entry in modal
