# PROJECT PASSPORT — Парк Закревського Періоду

> Паспорт проекту для передачі в новий чат. Оновлено: 2026-02-15, v9.1.0

---

## 1. Що це

Система бронювання для дитячого парку **"Закревського Періоду"** (Київ, вул. Закревського 31/2, 3 поверх). Таймлайн аніматорів, кімнати, програми, Telegram-бот, задачник, каталог, сертифікати, дашборд, бекапи.

---

## 2. Деплой

| Параметр | Значення |
|---|---|
| Хостинг | Railway |
| Актуальна гілка | `claude/review-project-updates-R2CbJ` |
| Версія | v9.1.0 |
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
| Testing | `node --test` (364 тести, 78 suites) |

**Dependencies:** bcryptjs, cors, express, jsonwebtoken, pg, qrcode, ws

---

## 4. Структура файлів

```
server.js              — Entry point, middleware, routes, 8 schedulers, WS init

db/index.js            — Pool, schema (20 таблиць), seed, 23 indexes
db/migrate.js          — Migration runner
db/migrations/         — 001-003

routes/ (15):          auth, bookings, lines, history, settings, stats,
                       afisha, telegram, backup, products, tasks,
                       task-templates, staff, certificates, recurring

services/ (11):        booking, bookingAutomation, bot, certificates,
                       recurring, telegram, templates, taskTemplates,
                       scheduler, backup, websocket

middleware/ (4):       auth, rateLimit, security, requestId
utils/ (2):            logger, validateEnv

js/ (19 модулів):      config, api, auth, app, ui, booking, booking-form,
                       booking-linked, timeline, settings, settings-afisha,
                       settings-certificates, settings-dashboard,
                       settings-history, programs-page, tasks-page,
                       staff-page, offline, ws

css/ (11):             base, auth, layout, timeline, panel, modals,
                       controls, features, dark-mode, responsive, pages

HTML (5):              index.html, tasks.html, programs.html,
                       staff.html, invite.html

tests/ (3+1):          api.test.js (221), certificates.test.js (82),
                       automation.test.js (51), helpers.js
```

---

## 5. Сторінки

| Шлях | Сторінка | Опис |
|---|---|---|
| `/` | Таймлайн | SPA: бронювання, модалки, панелі |
| `/tasks` | Задачник | 5 вкладок, канбан, категорії |
| `/programs` | Каталог | Програми, CRUD, іконки |
| `/staff` | Графік | Тижневий розклад аніматорів |
| `/invite` | Запрошення | Standalone link для клієнтів |

---

## 6. БД (20 таблиць, 23 індекси)

**Основні:** bookings, lines_by_date, history, settings, users, booking_counter, pending_animators

**Афіша/Задачі:** afisha, afisha_templates, tasks, task_templates

**Telegram:** telegram_known_chats, telegram_known_threads

**Каталог/Автоматизація:** products (40 програм, 7 категорій), automation_rules, scheduled_deletions

**Персонал/Сертифікати:** staff, staff_schedule, certificates, certificate_counter

### bookings (головна таблиця)

Ключові поля: `id` (BK-YYYY-NNNN), `date`, `time`, `line_id`, `program_id`, `program_code`, `program_name`, `category`, `duration`, `price`, `hosts`, `second_animator`, `room`, `status` (confirmed/preliminary/cancelled), `linked_to`, `kids_count`, `extra_data` (JSONB), `updated_at`

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
| Auth | POST login, GET verify |
| Bookings | GET /:date, POST /, POST /full, PUT /:id, DELETE /:id |
| Lines | GET /:date, POST /:date |
| History | GET (filters: action, user, dates, search), POST |
| Afisha | CRUD + POST /:id/generate-tasks |
| Telegram | GET chats/threads, POST notify/digest/reminder/ask-animator/webhook |
| Backup | POST create, GET download, POST restore |
| Stats | GET /:from/:to |
| Settings | GET/POST /:key, GET /rooms/free/:date/:time/:dur |
| Products | CRUD (GET ?active=true) |
| Tasks | CRUD + PATCH /:id/status (filters: status, date, type, assigned_to, afisha_id) |
| Task Templates | CRUD (?active=true) |
| Staff | CRUD |
| Certificates | CRUD |
| Recurring | CRUD + series ops |
| Health | GET /api/health |

---

## 8. Schedulers (8, кожні 60с)

| Scheduler | Час | Опис |
|---|---|---|
| checkAutoDigest | Налаштовується | Дайджест дня в Telegram |
| checkAutoReminder | Налаштовується | Нагадування про завтра |
| checkAutoBackup | 03:00 | SQL backup в Telegram |
| checkRecurringTasks | 00:05 | Recurring задачі за шаблонами |
| checkScheduledDeletions | 60с | Авто-видалення |
| checkRecurringAfisha | 60с | Recurring афіша |
| checkRecurringBookings | 60с | Recurring бронювання |
| checkCertificateExpiry | 60с | Термін сертифікатів |

---

## 9. WebSocket (v9.1.0)

- `services/websocket.js` — JWT auth, heartbeat 30s, date subscriptions
- `js/ws.js` — auto-reconnect, exponential backoff 1s–30s
- Events: `booking:created/updated/deleted`, `line:updated`

---

## 10. Design System v4.0

**Тема:** Emerald (`--primary: #10B981`)
**Шрифт:** Nunito
**Категорії:** quest (#8B5CF6), animation (#3B82F6), show (#F97316), masterclass (#84CC16), pinata (#EC4899), photo (#06B6D4), custom (#64748B)
**Dark mode:** `body.dark-mode`, повне покриття в `dark-mode.css`
**Responsive:** >=769px desktop, <=1024px tablet, <=768px mobile, <=480px small, <=390px xs, landscape

---

## 11. Ключові конвенції

- **Дати:** UTC → `Europe/Kyiv` для відображення
- **Валюта:** UAH (₴), `"1 000 ₴"`
- **Booking ID:** `BK-YYYY-NNNN`
- **DB→API:** snake_case → camelCase через `mapBookingRow()`
- **Транзакції:** BEGIN → COMMIT → catch ROLLBACK → finally release()
- **Telegram:** fire-and-forget ПІСЛЯ commit
- **Touch targets:** min 44px, inputs min 16px font
- **Мова коду:** English, **Мова UI:** Ukrainian

### 5-Step Versioning

1. `package.json` version
2. `index.html` `?v=X.XX` на CSS/JS
3. `index.html` tagline
4. `index.html` changelog button
5. `index.html` changelog entry

---

## 12. Що далі

- Swagger /api-docs (swagger.js є, треба swagger-ui-express)
- Clawd Bot: /tasks, /done
- Авто-задачі (контент, нагадування)
- Drag-n-drop сортування програм
- Export PDF/Excel

---

> Актуальна гілка: `claude/review-project-updates-R2CbJ`. Копіюй в новий чат — тут все для продовження.
