# Event Genix API Surface Map

This document records the intended backend route-file surface. The structural
guard is `npm run check:api-surface`, backed by `config/apiSurface.js`.

The check is not a behavior test. It verifies that every `routes/*.js` file is
mounted from `server.js`, that broad `/api` route mounts are explicit
exceptions, and that direct server-level API routes are documented.

## Why This Exists

Route files are easy to create during feature work and easy to forget during
cleanup. An unmounted file is dead code; a broad `/api` mount can hide route
ownership. This map makes both cases visible before cleanup or deploy work
ships.

If a new API router is added, removed, renamed, or mounted under a different
path, update `server.js`, this document, `config/apiSurface.js` when needed, and
focused route tests in the same pack.

## Route Files Mounted From server.js

| Mount | Route File | Owner |
| --- | --- | --- |
| `/api/achievements` | `routes/achievements.js` | achievements |
| `/api/afisha` | `routes/afisha.js` | afisha |
| `/api/agents` | `routes/agents.js` | agents |
| `/api/analytics` | `routes/analytics.js` | analytics |
| `/api/art-director` | `routes/art-director.js` | art-director |
| `/api/auth` | `routes/auth.js` | auth |
| `/api/backup` | `routes/backup.js` | backup |
| `/api/board` | `routes/board.js` | board |
| `/api/bookings` | `routes/bookings.js` | bookings |
| `/api/booking-templates` | `routes/booking-templates.js` | booking-templates |
| `/api/business-cards` | `routes/business-cards.js` | business-cards |
| `/api/catalogs` | `routes/catalogs.js` | catalogs |
| `/api/center` | `routes/center.js` | center |
| `/api/certificates` | `routes/certificates.js` | certificates |
| `/api/chat` | `routes/chat.js` | chat |
| `/api/content` | `routes/content.js` | content |
| `/api/contractors` | `routes/contractors.js` | contractors |
| `/api/copilot` | `routes/copilot.js` | copilot |
| `/api/customers` | `routes/customers.js` | customers |
| `/api/dashboard` | `routes/dashboard.js` | dashboard |
| `/api/decisions` | `routes/decisions.js` | decisions |
| `/api/demo` | `routes/demo.js` | demo |
| `/api/designs` | `routes/designs.js` | designs |
| `/api/employees` | `routes/employees.js` | employees |
| `/api/events` | `routes/event-queue.js` | event-queue |
| `/api/finance` | `routes/finance.js` | finance |
| `/api/gamification` | `routes/gamification.js` | gamification |
| `/api/graduation` | `routes/graduation.js` | graduation |
| `/api/guardian` | `routes/guardian.js` | guardian |
| `/api/history` | `routes/history.js` | history |
| `/api/hr` | `routes/hr.js` | hr |
| `/api/kleshnya` | `routes/kleshnya.js` | kleshnya |
| `/api/landing` | `routes/landing.js` | landing |
| `/api/leads` | `routes/leads.js` | leads |
| `/api/lines` | `routes/lines.js` | lines |
| `/api/loyalty` | `routes/loyalty.js` | loyalty |
| `/api/marketing-agent` | `routes/marketing-agent.js` | marketing-agent |
| `/api/minigame` | `routes/minigame.js` | minigame |
| `/api/music` | `routes/music.js` | music |
| `/api/notes` | `routes/notes.js` | notes |
| `/api/omni` | `routes/omnichannel.js` | omnichannel |
| `/api/packages` | `routes/packages.js` | packages |
| `/api/page-statuses` | `routes/page-statuses.js` | page-statuses |
| `/api/personal-accounts` | `routes/personal-accounts.js` | personal-accounts |
| `/api/points` | `routes/points.js` | points |
| `/api/print` | `routes/print.js` | print |
| `/api/procurement` | `routes/procurement.js` | procurement |
| `/api/products` | `routes/products.js` | products |
| `/api/quests` | `routes/quests.js` | quests |
| `/api/quiz` | `routes/quiz.js` | quiz |
| `/api/recurring` | `routes/recurring.js` | recurring |
| `/api/report-bot` | `routes/report-bot.js` | report-bot |
| `/api/reports` | `routes/reports.js` | reports |
| `/api/room` | `routes/room.js` | room |
| `/api/sales` | `routes/sales.js` | sales |
| `/api/scripts` | `routes/scripts.js` | scripts |
| `/api/search` | `routes/search.js` | search |
| `/api` | `routes/settings.js` | settings |
| `/api/shop` | `routes/shop.js` | shop |
| `/api` | `routes/shop.js` | shop legacy aliases |
| `/api/sound-library` | `routes/sound-library.js` | sound-library |
| `/api/staff` | `routes/staff.js` | staff |
| `/api/stats` | `routes/stats.js` | stats |
| `/api/status` | `routes/status.js` | status |
| `/api/streaks` | `routes/streaks.js` | streaks |
| `/api/subscription` | `routes/subscription.js` | subscription |
| `/api/summary` | `routes/summary.js` | summary |
| `/api/support` | `routes/support.js` | support |
| `/api/svitlana` | `routes/svitlana.js` | svitlana |
| `/api/tasks` | `routes/tasks.js` | tasks |
| `/api/task-templates` | `routes/task-templates.js` | task-templates |
| `/api/telegram` | `routes/telegram.js` | telegram |
| `/api/training` | `routes/training.js` | training |
| `/api/users` | `routes/users.js` | users |
| `/api/wallet` | `routes/wallet.js` | wallet |
| `/api/warehouse` | `routes/warehouse.js` | warehouse |
| `/api/work-queue` | `routes/work-queue.js` | work-queue |
| `/api/workers` | `routes/workers.js` | workers |

## Generic `/api` Route Mount Exceptions

Most routers must mount under a specific prefix such as `/api/tasks`. These are
the intentional broad route mounts:

| Mount | Route File | Reason |
| --- | --- | --- |
| `/api` | `routes/settings.js` | Owns generic `/api/version`, `/api/health`, and settings endpoints. Mounted after feature routers. |
| `/api` | `routes/shop.js` | Owns legacy gamification aliases such as `/api/inventory`, `/api/profile/:id`, and `/api/profile/equip`. |

## Server-Level API Routes

These API routes or mounts intentionally live directly in `server.js` instead of
a file under `routes/`:

| Entry | Owner | Reason |
| --- | --- | --- |
| `USE /api-docs` | swagger | Swagger UI middleware. |
| `GET /api-docs.json` | swagger | Swagger JSON export. |
| `GET /api/shifts/daily-digest` | scheduler | Operational digest trigger that still lives beside startup scheduler wiring. |

## Done Marker

This pack is considered done when all of these remain true:

- `npm run check:api-surface` passes.
- Every `routes/*.js` file is mounted from `server.js`.
- Any broad `/api` route mount is listed in `config/apiSurface.js` and this
  document.
- Any direct server-level API route is listed in `config/apiSurface.js` and this
  document.
- Route behavior changes still add focused route tests; this check only guards
  ownership and mounting.
