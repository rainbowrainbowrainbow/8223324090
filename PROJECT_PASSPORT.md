# PROJECT PASSPORT — Event Genix CRM

> Паспорт проекту для передачі в новий чат. Оновлено: 2026-03-25, v38.7.0

---

## 1. Що це

**Event Genix** (раніше "Парк Закревського Періоду") — AI-first CRM для дитячих розважальних центрів. Таймлайн аніматорів, кімнати, програми, Telegram-бот, Tasker + Клешня (AI-координатор), особистий кабінет з досягненнями та гейміфікацією, каталог, сертифікати, дашборд, HR, фінанси, склад, аналітика, бекапи.

---

## 2. Деплой

| Параметр | Значення |
|---|---|
| Хостинг | Railway |
| Staging гілка | `main` |
| Production гілка | `deployed` (ТІЛЬКИ Клешня) |
| Версія | v38.7.0 |
| Порт | `PORT` (default 3000) |

### Env змінні

```
DATABASE_URL, PORT, JWT_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_DEFAULT_CHAT_ID,
WEBHOOK_SECRET, RATE_LIMIT_MAX (120), LOGIN_RATE_LIMIT_MAX (5),
LOG_LEVEL (debug), NODE_ENV, RAILWAY_PUBLIC_DOMAIN
```

### Тестовий запуск

```bash
pg_ctlcluster 16 main start
PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql \
  RATE_LIMIT_MAX=5000 LOGIN_RATE_LIMIT_MAX=1000 JWT_SECRET=testsecret \
  node server.js &
node --test tests/api.test.js
```

---

## 3. Стек

| Компонент | Технологія |
|---|---|
| Runtime | Node.js >=18 (vanilla JS, **NO TypeScript**) |
| Backend | Express 4.18 |
| Database | PostgreSQL 16 + raw `pg` (**NO ORM**) |
| Auth | JWT + bcryptjs |
| Bot | Custom Telegram Bot API (**NO grammY**) |
| AI | @anthropic-ai/sdk (Клешня AI agent) |
| Frontend | Vanilla HTML+CSS+JS SPA (**NO React/Next.js**) |
| CSS | 22-file modular + Design System v4.0 |
| Testing | `node --test` (346+ тестів, 3 файли + helpers) |
| Realtime | WebSocket (ws library) |

**Dependencies (15):** @anthropic-ai/sdk, @supabase/supabase-js, bcryptjs, chart.js, compression, cors, exceljs, express, jsonwebtoken, multer, pg, qrcode, swagger-ui-express, web-push, ws

---

## 4. Структура файлів

```
server.js              — Entry point, middleware, routes, schedulers, WS init

db/index.js            — Pool, schema (40+ таблиць), seed, indexes
db/migrate.js          — Migration runner
db/migrations/         — 001–125 (125 міграцій)

routes/ (74):          auth, bookings, booking-templates, lines, history,
                       settings, stats, afisha, telegram, backup, products,
                       tasks, task-templates, staff, certificates, recurring,
                       points, kleshnya, procurement, gamification,
                       dashboard, analytics, finance, hr, customers,
                       leads, sales, agents, chat, center, designs,
                       demo, packages, search, loyalty, shop, quiz,
                       profile, room, status, warehouse, workers,
                       training, support, notes, music, print,
                       page-statuses, summary, svitlana, board,
                       achievements, minigame, quests, wallet,
                       art-director, contractors, employees,
                       event-queue, guardian, scripts, users,
                       decisions, graduation, sound-library, landing,
                       copilot, report-bot, personal-accounts,
                       subscription, omnichannel, inventory, streaks

services/ (41):        adminAudit, agentTracker, backup, bookingAutomation,
                       bot, cache, certificates, chat-bot, chatService,
                       contextCache, eventBus, gamification, guardian,
                       hr, kleshnya, kleshnya-bridge, kleshnya-chat,
                       kleshnya-greeting, linkPreview, notificationDigest,
                       recurring, scheduler, schedulerGuard, summary-agent,
                       taskTemplates, telegram, templates, training,
                       websocket, booking (helpers), outbox

middleware/ (6):       auth (JWT), rateLimit, security, requestId,
                       apiAudit, apiVersioning

utils/ (2):            logger, validateEnv

js/ (44 модулі):       config, api, auth, app, ui, booking, booking-form,
                       booking-linked, timeline, settings, settings-afisha,
                       settings-certificates, settings-dashboard,
                       settings-history, programs-page, tasks-page,
                       staff-page, offline, ws, dashboard-page,
                       analytics-page, finance-page, hr-page,
                       customers-page, leads-page, chat-page,
                       center-page, designs-page, demo-page,
                       art-director-page, warehouse-page, shop-page,
                       profile-page, kleshnya-page, kleshnya-widget,
                       agents-panel, command-panel, sales-panel,
                       search, status-page, idle-hints, logger,
                       minigame-match3

css/ (17):             base, auth, layout, timeline, panel, modals,
                       controls, features, dark-mode, responsive, pages,
                       achievements, agents, chat, dashboard,
                       kleshnya-widget, minigame

HTML (25 сторінок):    index.html (main SPA), analytics.html,
                       art-director.html, center.html, chat.html,
                       checkin.html, customers.html, dashboard.html,
                       demo.html, designs.html, finance.html,
                       game.html, hr.html, invite.html, leads.html,
                       profile.html, programs.html, quiz.html,
                       room.html, shop.html, staff.html, status.html,
                       tasks.html, training.html, warehouse.html

tests/ (3+1):          api.test.js (296+), certificates.test.js,
                       automation.test.js, helpers.js

swagger.js             — OpenAPI 3.0 spec
```

### Метрики коду

| Метрика | Значення |
|---------|----------|
| JS код | ~87 000 рядків |
| HTML код | ~16 500 рядків |
| CSS код | ~24 300 рядків |
| **Всього** | **~128 000 рядків** |

---

## 5. Сторінки (25)

| Шлях | Сторінка | Опис |
|---|---|---|
| `/` | Таймлайн | SPA: бронювання, модалки, панелі |
| `/dashboard` | Дашборд | Персоналізована HOME з віджетами |
| `/tasks` | Задачник | Канбан, категорії, Tasker |
| `/programs` | Каталог | Програми, CRUD, іконки |
| `/staff` | Графік | Тижневий розклад аніматорів |
| `/chat` | Месенджер | Внутрішній чат з emoji, lightbox |
| `/analytics` | Аналітика | Графіки, revenue, trends |
| `/finance` | Фінанси | Бюджет, витрати, прибуток |
| `/hr` | HR | Персонал, контракти, навички |
| `/customers` | Клієнти | CRM клієнтська база |
| `/leads` | Ліди | Воронка продажів, конверсія |
| `/warehouse` | Склад | Товари, закупівлі |
| `/center` | Центр | Загальна інформація |
| `/art-director` | Арт-директор | Дизайн-борд |
| `/designs` | Дизайни | Галерея дизайнів |
| `/demo` | Демо | Demo/Packages |
| `/profile` | Профіль | Досягнення, гейміфікація, магазин |
| `/game` | Match-3 | Candy Crush з таро-картами |
| `/quiz` | Квіз | Gamification quiz |
| `/room` | Кімната | Інтерактивна кімната |
| `/shop` | Магазин | Магазин предметів за монети |
| `/status` | Статус | Status page системи |
| `/training` | Навчання | Training module |
| `/checkin` | Check-in | Face check-in |
| `/invite` | Запрошення | Публічна сторінка |

---

## 6. БД (40+ таблиць, 80+ індексів, 50 міграцій)

**Основні:** bookings, lines_by_date, history, settings, users, booking_counter, pending_animators

**Афіша/Задачі:** afisha, afisha_templates, tasks, task_templates, task_logs

**Telegram:** telegram_known_chats, telegram_known_threads, scheduled_deletions

**Каталог/Автоматизація:** products (40 програм, 7 категорій), automation_rules

**Персонал/Сертифікати:** staff, staff_schedule, certificates, certificate_counter

**Recurring:** recurring_templates, recurring_booking_skips

**Бали:** user_points, point_transactions

**Профіль/Досягнення:** user_action_log, user_achievements, user_streaks

**Клешня:** kleshnya_messages, kleshnya_chat

**Гейміфікація (v22.0+):** gamification_levels, gamification_achievements, gamification_items, gamification_inventory, gamification_shop, gamification_leaderboard, achievement_progress, quest_progress, minigame_scores

**CRM (v20.0+):** leads, customers, role_definitions, dashboard_widgets

**HR/Фінанси (v15.0+):** employees, contractors, finance_transactions, budgets

**Інше:** notification_digest, user_last_seen, reviews, face_checkin, auto_ordering

### bookings (головна таблиця)

Ключові поля: `id` (BK-YYYY-NNNN), `date`, `time`, `line_id`, `program_id`, `program_code`, `program_name`, `category`, `duration`, `price`, `hosts`, `second_animator`, `room`, `status` (confirmed/preliminary/cancelled), `linked_to`, `kids_count`, `extra_data` (JSONB), `updated_at`, `banquet_menu`, `banquet_guests`, `banquet_tables`

### Seed users

| Username | Role |
|---|---|
| Natalia | admin |
| Sergey | admin |
| Vitalina | user |
| Dasha | user |
| Animator | viewer |

---

## 7. API (основні групи маршрутів)

| Група | Endpoints |
|---|---|
| Auth | POST login, GET verify, GET profile, achievements, log-action, PUT password |
| Bookings | GET /:date, POST /, POST /full, PUT /:id, DELETE /:id |
| Lines | GET /:date, POST /:date |
| History | GET (filters), POST |
| Dashboard | GET /widgets, GET /stats |
| Afisha | CRUD + generate-tasks, distribute/undistribute |
| Telegram | GET chats/threads, POST notify/digest/reminder/webhook |
| Backup | POST create, GET download, POST restore |
| Stats | GET /revenue, /programs, /load, /trends |
| Settings | GET/POST /:key, GET /rooms/free |
| Products | CRUD |
| Tasks | CRUD + status, logs |
| Staff | CRUD + schedule (bulk, copy-week) |
| Certificates | CRUD + batch, QR, code lookup |
| Recurring | CRUD + series ops + skips |
| Points | GET leaderboard, user points, history |
| Kleshnya | GET /greeting, GET/POST /chat |
| Gamification | XP, levels, achievements, shop, inventory, leaderboard, minigame |
| Customers | CRUD (Supabase + fallback) |
| Leads | CRUD + stats, hot leads |
| Finance | Transactions, budgets, reports |
| HR | Employees, training, contracts |
| Analytics | Charts, trends, exports |
| Chat | Messages, rooms, reactions |
| Search | Global search across entities |
| Health | GET /api/health |

---

## 8. Tasker & Клешня

### Tasker
Централізований задачник та диспетчер. Приймає події, створює задачі, контролює виконання, комунікація через Telegram, нарахування балів.

### Клешня (AI-координатор)
Центральний інтелект системи з @anthropic-ai/sdk. Доступ до всіх даних CRM. Greeting з кешем (4h TTL), чат з історією.

**Типи задач:** `human` (відповідальність людини), `bot` (системне виконання)

**Ескалація (4 рівні):** 0-нагадування → 1-повторне → 2-прострочена → 3-ескалація на директора

**Бали:** Постійні (permanent) + Місячні (monthly, обнуляються 1-го числа)

**Telegram бот:** `/tasks`, `/done <id>`, `/alltasks`

---

## 9. Гейміфікація (v22.0+)

- **XP / Рівні / Монети** — за дії в CRM
- **20+ досягнень** з рідкостями та нагородами
- **Магазин** — предмети за монети (backgrounds, frames, hats, weapons, shields, outfits, effects, badges)
- **Match-3 гра** — Candy Crush з таро-картами, bosses, events, 9x9 grid, frozen tiles, cross special, combo system
- **Quiz** — вікторина по знанню програм
- **Стріки** — серії входів та виконань задач
- **Лідерборд** — рейтинг по XP/монетах/досягненнях

---

## 10. Schedulers

| Scheduler | Час | Опис |
|---|---|---|
| checkAutoDigest | Налаштовується | Дайджест дня в Telegram |
| checkAutoReminder | Налаштовується | Нагадування про завтра |
| checkAutoBackup | 03:00 | SQL backup в Telegram |
| checkRecurringTasks | 00:05 | Recurring задачі |
| checkScheduledDeletions | 60с | Авто-видалення повідомлень |
| checkRecurringAfisha | 00:06 | Recurring афіша |
| checkCertificateExpiry | 00:10 | Термін сертифікатів |
| checkTaskReminders | 60с | Нагадування/ескалація |
| checkWorkDayTriggers | 10:00/12:00 | Тригери початку дня |
| checkMonthlyPointsReset | 00:15 (1-ше) | Обнулення місячних балів |
| cleanupKleshnyaMessages | 30хв | Очистка greeting cache |

---

## 11. WebSocket

- `services/websocket.js` — JWT auth, heartbeat 30s, date subscriptions
- `js/ws.js` — auto-reconnect, exponential backoff 1s–30s
- Events: `booking:created/updated/deleted`, `line:updated`

---

## 12. Design System v4.0

**Тема:** Emerald (`--primary: #10B981`)
**Шрифт:** Nunito
**Категорії:** quest (#8B5CF6), animation (#3B82F6), show (#F97316), masterclass (#84CC16), pinata (#EC4899), photo (#06B6D4), custom (#64748B)
**Dark mode:** `body.dark-mode`, покриття в `dark-mode.css`
**Responsive:** >=769px desktop, <=1024px tablet, <=768px mobile, <=480px small, <=390px xs, landscape

---

## 13. Ключові конвенції

- **Дати:** UTC → `Europe/Kyiv` для відображення
- **Валюта:** UAH (₴), `"1 000 ₴"`
- **Booking ID:** `BK-YYYY-NNNN`
- **DB→API:** snake_case → camelCase через `mapBookingRow()`
- **Транзакції:** BEGIN → COMMIT → catch ROLLBACK → finally release()
- **Telegram:** fire-and-forget ПІСЛЯ commit
- **Touch targets:** min 44px, inputs min 16px font
- **Мова коду:** English, **Мова UI:** Ukrainian
- **Коміти:** Conventional Commits + тег агента `[claude-code]`/`[kleshnya]`

### 5-Step Versioning

1. `package.json` version
2. `index.html` `?v=X.XX` на CSS/JS
3. `index.html` tagline
4. `index.html` changelog button
5. `index.html` changelog entry

---

## 14. Multi-Agent Development

| Agent | Role | Workflow |
|---|---|---|
| **Claude Code** | Основна розробка фіч | `claude/*` → PR → `main` |
| **Клешня (OpenClaw)** | Координатор, деплой | Напряму в `main`, тег `[kleshnya]` |
| **Anthropic** | Додаткова розробка | `anthropic/*` → PR → `main` |
| **Human (Сергій)** | Approve, стратегія | :+1: = дозвіл на деплой |

---

> Актуальна версія: v38.7.0. Копіюй в новий чат — тут все для продовження.
