# PROJECT PASSPORT — Парк Закревського Періоду

> Паспорт проекту для передачі в новий чат. Оновлено: 2026-02-15, v11.0.6

---

## 1. Що це

Система бронювання для дитячого парку **"Закревського Періоду"** (Київ, вул. Закревського 31/2, 3 поверх). Таймлайн аніматорів, кімнати, програми, Telegram-бот, **Tasker + Клешня** (greeting/chat), особистий кабінет з досягненнями, каталог, сертифікати, дашборд, бекапи.

---

## 2. Деплой

| Параметр | Значення |
|---|---|
| Хостинг | Railway |
| Актуальна гілка | `claude/review-project-updates-YHNS2` |
| Версія | v11.0.6 |
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
| Frontend | Vanilla HTML+CSS+JS (**NO React/Next.js**) |
| CSS | 11-file modular + Design System v4.0 |
| Testing | `node --test` (364 тести, 3 файли + helpers) |

**Dependencies:** bcryptjs, cors, express, jsonwebtoken, pg, qrcode, ws

---

## 4. Структура файлів

```
server.js              — Entry point, middleware, routes, 11 schedulers, WS init

db/index.js            — Pool, schema (30 таблиць), seed, 40+ indexes
db/migrate.js          — Migration runner
db/migrations/         — 001-004

routes/ (17):          auth, bookings, lines, history, settings, stats,
                       afisha, telegram, backup, products, tasks,
                       task-templates, staff, certificates, recurring,
                       points, kleshnya

services/ (13):        booking, bookingAutomation, bot, certificates,
                       kleshnya, kleshnya-greeting, recurring, telegram,
                       templates, taskTemplates, scheduler, backup, websocket

middleware/ (4):       auth, rateLimit, security, requestId
utils/ (2):            logger, validateEnv

js/ (19 модулів):      config, api, auth, app, ui, booking, booking-form,
                       booking-linked, timeline, settings, settings-afisha,
                       settings-certificates, settings-dashboard,
                       settings-history, programs-page, tasks-page,
                       staff-page, offline, ws

css/ (11):             base, auth, layout, timeline, panel, modals,
                       controls, features, dark-mode, responsive, pages

HTML (6):              index.html, tasks.html, programs.html,
                       staff.html, invite.html, kleshnya.html

tests/ (3+1):          api.test.js (223), certificates.test.js (82),
                       automation.test.js (59), helpers.js
```

---

## 5. Сторінки

| Шлях | Сторінка | Опис |
|---|---|---|
| `/` | Таймлайн | SPA: бронювання, модалки, панелі |
| `/tasks` | Задачник | 5 вкладок, канбан, категорії, Tasker |
| `/programs` | Каталог | Програми, CRUD, іконки |
| `/staff` | Графік | Тижневий розклад аніматорів |
| `/kleshnya` | Клешня чат | AI-чат з історією повідомлень |
| `/invite` | Запрошення | Standalone link для клієнтів |

---

## 6. БД (30 таблиць, 40+ індексів)

**Основні:** bookings, lines_by_date, history, settings, users, booking_counter, pending_animators

**Афіша/Задачі:** afisha, afisha_templates, tasks, task_templates, task_logs

**Telegram:** telegram_known_chats, telegram_known_threads, scheduled_deletions

**Каталог/Автоматизація:** products (40 програм, 7 категорій), automation_rules

**Персонал/Сертифікати:** staff, staff_schedule, certificates, certificate_counter

**Recurring:** recurring_templates, recurring_booking_skips

**Бали (v10.0):** user_points, point_transactions

**Профіль/Досягнення (v11.0):** user_action_log, user_achievements, user_streaks

**Клешня (v11.0):** kleshnya_messages (greeting cache, 4h TTL), kleshnya_chat (chat history)

### bookings (головна таблиця)

Ключові поля: `id` (BK-YYYY-NNNN), `date`, `time`, `line_id`, `program_id`, `program_code`, `program_name`, `category`, `duration`, `price`, `hosts`, `second_animator`, `room`, `status` (confirmed/preliminary/cancelled), `linked_to`, `kids_count`, `extra_data` (JSONB), `updated_at`

### tasks (v10.0 — Tasker)

Нові поля: `task_type` (human/bot), `owner` (менеджер, ескалація), `deadline`, `time_window_start/end`, `dependency_ids` (INTEGER[]), `control_policy` (JSONB), `escalation_level` (0-3), `source_type` (booking/trigger/manual/recurring/kleshnya), `source_id`, `last_reminded_at`

### tasks (v10.0 — Tasker, розширено v11.0)

Ключові поля: `id`, `title`, `date`, `status`, `priority`, `assigned_to`, `task_type` (human/bot), `owner`, `deadline`, `time_window_start/end`, `dependency_ids` (INTEGER[]), `control_policy` (JSONB), `escalation_level` (0-3), `source_type` (booking/trigger/manual/recurring/kleshnya), `source_id`, `last_reminded_at`, `version` (optimistic locking)

### Seed users

| Username | Role |
|---|---|
| Natalia | admin |
| Sergey | admin |
| Vitalina | user |
| Dasha | user |
| Animator | viewer |

---

## 7. API (основні маршрути)

| Група | Endpoints |
|---|---|
| Auth | POST login, GET verify, GET profile, GET achievements, POST log-action, GET action-log, PUT password, PATCH tasks/:id/quick-status |
| Bookings | GET /:date, POST /, POST /full, PUT /:id, DELETE /:id |
| Lines | GET /:date, POST /:date |
| History | GET (filters: action, user, dates, search), POST |
| Afisha | CRUD + POST /:id/generate-tasks, PATCH /:id/time, distribute/undistribute |
| Telegram | GET chats/threads, POST notify/digest/reminder/ask-animator/webhook |
| Backup | POST create, GET download, POST restore |
| Stats | GET /revenue, GET /programs, GET /load, GET /trends, GET /:from/:to |
| Settings | GET/POST /:key, GET /rooms/free/:date/:time/:dur |
| Products | CRUD (GET ?active=true) |
| Tasks | CRUD + PATCH /:id/status + GET /:id/logs (filters: status, date, type, task_type, assigned_to, owner) |
| Task Templates | CRUD (?active=true) |
| Staff | CRUD + schedule (bulk, copy-week, hours, check) |
| Certificates | CRUD + batch, QR, code lookup, send-image |
| Recurring | CRUD + series ops + skips |
| Points | GET / (leaderboard), GET /:username, GET /:username/history |
| **Kleshnya** | GET /greeting, GET /chat, POST /chat |
| Health | GET /api/health |

---

## 8. Tasker & Клешня (v10.0–v11.0)

### Що таке Tasker
Tasker — централізований задачник та диспетчер операцій бізнесу. Приймає події, створює задачі, контролює виконання, забезпечує комунікацію через Telegram, нараховує бали.

### Клешня (services/kleshnya.js)
Центральний інтелект системи. Має доступ до всіх даних CRM, задач, Telegram, фінансових логів.

### Greeting & Chat (v11.0, services/kleshnya-greeting.js)
- Персоналізовані привітання на основі бронювань, задач, стріків, часу доби
- Greeting cache в БД (kleshnya_messages, 4h TTL) для rate-limit AI agent викликів
- Чат-сторінка `/kleshnya` з історією повідомлень (kleshnya_chat)
- Template-based responses (agent-ready hook для AI інтеграції)
- API: GET/POST `/api/kleshnya/greeting`, GET/POST `/api/kleshnya/chat`

**Типи задач:**
- `human` — 100% відповідальність людини
- `bot` — 100% системне виконання

**Ролі в задачі:**
- `assigned_to` — виконавець
- `owner` — менеджер/відповідальний (ескалація йде на owner)

**Ескалація (4 рівні):**
0. Нагадування (м'яке)
1. Повторне (жорсткіше)
2. Увага: прострочена
3. Ескалація на директора

**Бали:**
- Постійні (permanent) — накопичувальні, показник надійності
- Місячні (monthly) — обнуляються 1-го числа, впливають на премії

**Правила нарахування:**
- Вчасно: +5 monthly, +2 permanent
- З запасом: +7 monthly, +3 permanent
- High priority вчасно: +10 monthly, +5 permanent
- Прострочено < 1 год: -2 monthly
- Прострочено > 1 год: -5 monthly, -1 permanent

**Telegram бот (Клешня):**
- `/tasks` — мої задачі на сьогодні
- `/done <id>` — завершити задачу
- `/alltasks` — всі задачі команди

**Telegram нотифікації:**
- Персональні (якщо user зареєстрував chat_id через /start)
- Групові (з @mention через telegram_username)

---

## 9. Schedulers (11 + 1 cleanup, кожні 60с)

| Scheduler | Час | Опис |
|---|---|---|
| checkAutoDigest | Налаштовується | Дайджест дня в Telegram |
| checkAutoReminder | Налаштовується | Нагадування про завтра |
| checkAutoBackup | 03:00 | SQL backup в Telegram |
| checkRecurringTasks | 00:05 | Recurring задачі за шаблонами |
| checkScheduledDeletions | 60с | Авто-видалення повідомлень |
| checkRecurringAfisha | 00:06 | Recurring афіша |
| checkCertificateExpiry | 00:10 | Термін сертифікатів |
| checkTaskReminders | 60с | Клешня: нагадування/ескалація |
| checkWorkDayTriggers | 10:00/12:00 | Клешня: тригери початку дня |
| checkMonthlyPointsReset | 00:15 (1-ше) | Клешня: обнулення місячних балів |
| **cleanupKleshnyaMessages** | **30хв** | **Клешня: очистка greeting cache (v11.0)** |

---

## 10. WebSocket (v9.1.0)

- `services/websocket.js` — JWT auth, heartbeat 30s, date subscriptions
- `js/ws.js` — auto-reconnect, exponential backoff 1s–30s
- Events: `booking:created/updated/deleted`, `line:updated`

---

## 11. Design System v4.0

**Тема:** Emerald (`--primary: #10B981`)
**Шрифт:** Nunito
**Категорії:** quest (#8B5CF6), animation (#3B82F6), show (#F97316), masterclass (#84CC16), pinata (#EC4899), photo (#06B6D4), custom (#64748B)
**Dark mode:** `body.dark-mode`, повне покриття в `dark-mode.css`
**Responsive:** >=769px desktop, <=1024px tablet, <=768px mobile, <=480px small, <=390px xs, landscape

---

## 12. Ключові конвенції

- **Дати:** UTC → `Europe/Kyiv` для відображення
- **Валюта:** UAH (₴), `"1 000 ₴"`
- **Booking ID:** `BK-YYYY-NNNN`
- **DB→API:** snake_case → camelCase через `mapBookingRow()`
- **Транзакції:** BEGIN → COMMIT → catch ROLLBACK → finally release()
- **Telegram:** fire-and-forget ПІСЛЯ commit
- **Клешня:** створює/оновлює задачі → логує → нараховує бали → нотифікує
- **Touch targets:** min 44px, inputs min 16px font
- **Мова коду:** English, **Мова UI:** Ukrainian

### 5-Step Versioning

1. `package.json` version
2. `index.html` `?v=X.XX` на CSS/JS
3. `index.html` tagline
4. `index.html` changelog button
5. `index.html` changelog entry

---

## 13. Особистий кабінет (v10.3–v11.0)

- 4 таби: Сьогодні / Задачі / Стати / Налашт.
- **Сьогодні:** shift block, SVG progress ring, actionable inbox, admin team overview
- **Задачі:** inline status actions (start/done), blocked task indicators, dependency awareness
- **Стати:** stat cards з week-over-week deltas, бали, 12 досягнень з auto-grant, стріки
- **Налашт.:** зміна пароля, user details, logout
- 23 паралельні SQL запити у `/profile` (Promise.allSettled)
- `user_action_log` — UI click tracking
- `user_achievements` + `user_streaks` — досягнення та серії

---

## 14. Що далі

- AI agent інтеграція для Kleshnya chat
- Swagger /api-docs (swagger.js існує, ~1600 рядків, треба підключити + оновити)
- Export PDF/Excel
- Розширення тригерів Клешні

---

> Актуальна гілка: `claude/review-project-updates-YHNS2`. Копіюй в новий чат — тут все для продовження.
