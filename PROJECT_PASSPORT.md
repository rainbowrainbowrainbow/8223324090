# PROJECT PASSPORT — Парк Закревського Періоду (Booking System)

> Ультра-детальний паспорт для передачі в новий чат. Усе що потрібно для продовження роботи.
>
> Оновлено: 2026-02-15, v9.1.0

---

## 1. Що це

Система бронювання для дитячого розважального парку **"Закревського Періоду"** (Київ, вул. Закревського 31/2, 3 поверх). Таймлайн аніматорів, прив'язка до кімнат/програм, Telegram-бот, задачник, каталог програм, дашборд, запрошення, бекапи.

---

## 2. Деплой

| Параметр | Значення |
|---|---|
| Хостинг | Railway |
| Гілка на Railway | `claude/review-project-docs-1y3qH` (потребує оновлення) |
| Актуальна гілка | `claude/review-project-updates-R2CbJ` |
| Поточна версія | v9.1.0 |
| Remote | `origin` → `rainbowrainbowrainbow/8223324090` |
| Домен | через `RAILWAY_PUBLIC_DOMAIN` env |
| Порт | `PORT` (default 3000) |

### Env змінні

```
DATABASE_URL          — PostgreSQL connection string (Railway auto)
PORT                  — порт (default 3000)
JWT_SECRET            — секрет для JWT (random якщо не задано)
TELEGRAM_BOT_TOKEN    — токен бота
TELEGRAM_DEFAULT_CHAT_ID — ID чату (default: -1001805304620)
WEBHOOK_SECRET        — секрет вебхука
RATE_LIMIT_MAX        — ліміт req/15min (default 120)
LOGIN_RATE_LIMIT_MAX  — ліміт логінів/хв (default 5)
LOG_LEVEL             — рівень логів (default debug)
NODE_ENV              — production/development
RAILWAY_PUBLIC_DOMAIN — домен Railway для webhook URL
```

### Тестовий запуск (локально)

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
| Runtime | Node.js >=18 (vanilla JavaScript, **NO TypeScript**) |
| Backend | Express 4.18 |
| Database | PostgreSQL 16 via `pg` (raw queries, **NO ORM, NO Prisma**) |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` |
| Bot | Custom Telegram Bot API (**NO grammY**) |
| Frontend | Vanilla HTML + CSS + JS, multi-page (**NO React, NO Next.js, NO Astro**) |
| CSS | 11-file modular architecture + Design System v4.0 |
| Font | Nunito (Google Fonts) |
| Testing | Node.js built-in `node --test` (364 тести, 78 suites) |
| PWA | `manifest.json` (standalone, theme emerald) |

### Dependencies (package.json)

```json
"bcryptjs": "^3.0.3",
"cors": "^2.8.5",
"express": "^4.18.2",
"jsonwebtoken": "^9.0.3",
"pg": "^8.11.3",
"qrcode": "^1.5.4",
"ws": "^8.19.0"
```

---

## 4. Структура файлів (~40 000 рядків)

```
server.js              — Entry point, middleware, routes mount, 8 schedulers, WebSocket init

db/
  index.js             — Pool, schema (20 таблиць), seed users+products, 23 indexes
  migrate.js           — Migration runner with version tracking
  migrations/          — 001_initial_schema, 002_add_updated_at, 003_recurring_bookings

routes/ (15 файлів):
  auth.js              — Login (JWT), verify
  bookings.js          — CRUD, linked bookings, conflict checks, optimistic locking, WS broadcast
  lines.js             — Animator lines per date, WS broadcast
  history.js           — Audit log with JSONB search, filters, pagination
  settings.js          — Settings CRUD, free rooms, health
  stats.js             — Analytics dashboard (revenue, top programs, load)
  afisha.js            — Events CRUD + generate-tasks + distribute
  telegram.js          — Webhook, notifications, digest, reminder, animator requests
  backup.js            — SQL backup create/restore/download
  products.js          — Product catalog CRUD
  tasks.js             — Tasks CRUD + type/template_id support
  task-templates.js    — Recurring task templates CRUD
  staff.js             — Staff management CRUD
  certificates.js      — Certificate registry CRUD
  recurring.js         — Recurring bookings CRUD + series operations

services/ (11 файлів):
  booking.js           — Validators, time helpers, conflict checks, row mapper
  bookingAutomation.js — Automation rules engine
  bot.js               — Telegram bot command handler
  certificates.js      — Certificate generation (Canvas PNG)
  recurring.js         — Recurring booking template generation
  telegram.js          — Bot API wrapper, retry 3x, webhook setup
  templates.js         — Ukrainian notification templates, afisha formatting
  taskTemplates.js     — Recurring task template logic
  scheduler.js         — 8 schedulers (digest, reminder, backup, recurring, etc.)
  backup.js            — SQL dump generator, Telegram file upload
  websocket.js         — WebSocket server (JWT auth, heartbeat, broadcast)

middleware/
  auth.js              — JWT verification + role-based access
  rateLimit.js         — In-memory rate limiter (120/15min + 5/min login)
  security.js          — Security headers (X-Content-Type, X-Frame, HSTS)
  requestId.js         — AsyncLocalStorage request IDs

utils/
  logger.js            — Structured logging, JSON/pretty formats
  validateEnv.js       — Environment variable validation

js/ (19 модулів):
  config.js            — Programs, costumes, rooms, category config, products cache
  api.js               — Fetch wrapper with JWT auth, all API calls
  auth.js              — Login/logout, session management, role checks, WS connect/disconnect
  app.js               — Event listeners, escapeHtml, preferences, navigation
  ui.js                — Notifications, tooltip, dark/compact mode, undo, export PNG
  booking.js           — Booking panel, program search, invite, duplicate
  booking-form.js      — Booking form logic
  booking-linked.js    — Linked bookings logic
  timeline.js          — Timeline render, drag-and-drop, resize, multi-day
  settings.js          — Settings modal controller
  settings-afisha.js   — Afisha settings
  settings-certificates.js — Certificates panel
  settings-dashboard.js — Analytics dashboard
  settings-history.js  — History viewer
  programs-page.js     — Standalone programs page controller
  tasks-page.js        — Standalone tasks page controller
  staff-page.js        — Standalone staff schedule page controller
  offline.js           — Service Worker + IndexedDB mutation queue
  ws.js                — WebSocket client (auto-reconnect, exponential backoff)

css/ (11 файлів):
  base.css             — Design tokens, typography, badges, skip-link, reduced-motion
  auth.css             — Login screen
  layout.css           — Header, nav, emerald dark dropdown
  timeline.css         — Grid, booking blocks, time scale, drag-and-drop
  panel.css            — Sidebar, programs, search input
  modals.css           — All modals, unified buttons, empty states
  controls.css         — Status filter, zoom, segmented controls
  features.css         — Telegram settings, dashboard, invite, afisha
  dark-mode.css        — Complete dark theme
  responsive.css       — 4 breakpoints + landscape
  pages.css            — Standalone pages: nav, cards, filters, badges

HTML pages (5):
  index.html           — Main SPA (timeline, modals, booking panel)
  tasks.html           — Standalone tasks page
  programs.html        — Standalone programs catalog
  staff.html           — Staff schedule (weekly view)
  invite.html          — Standalone invitation page

tests/ (3 файли):
  api.test.js          — 221 tests, 61 suites
  certificates.test.js — 82 tests
  automation.test.js   — 51 tests
  helpers.js           — Test utilities, cached token

sw.js                  — Service Worker (app shell caching, offline mutations)
swagger.js             — OpenAPI 3.0 specification (not yet served)
manifest.json          — PWA manifest (standalone, uk, emerald theme)

.claude/
  hooks/session-start.sh — SessionStart hook (PG + npm + env)
  settings.json        — Permissions + hooks config
```

---

## 5. Навігація між сторінками

Система складається з 4 HTML-сторінок з єдиним header-nav:

| Шлях | Сторінка | Файли |
|---|---|---|
| `/` | Таймлайн (головна SPA) | `index.html` + 8 JS modules + 11 CSS |
| `/tasks` | Задачник | `tasks.html` + `js/tasks-page.js` |
| `/programs` | Каталог програм | `programs.html` + `js/programs-page.js` |
| `/invite` | Запрошення (standalone) | `invite.html` |

Спільні ресурси: `js/config.js`, `js/api.js`, `js/auth.js`, `css/base.css`, `css/layout.css`, `css/pages.css`, `css/dark-mode.css`

---

## 6. База даних (20 таблиць)

### bookings (головна)

```sql
id VARCHAR(50) PK          -- BK-YYYY-NNNN format
date VARCHAR(20)            -- '2026-02-15'
time VARCHAR(10)            -- '14:00'
line_id VARCHAR(100)        -- 'line1_2026-02-15'
program_id VARCHAR(50)      -- 'kv1'
program_code VARCHAR(20)    -- 'КВ1'
label VARCHAR(100)          -- 'КВ1(60)'
program_name VARCHAR(100)   -- 'Легендарний тренд'
category VARCHAR(50)        -- 'quest'
duration INTEGER            -- 60 (хвилини)
price INTEGER               -- 2200 (в ₴)
hosts INTEGER               -- 1
second_animator VARCHAR(100)
pinata_filler VARCHAR(50)
costume VARCHAR(100)
room VARCHAR(100)           -- 'Marvel'
notes TEXT
created_by VARCHAR(50)
created_at TIMESTAMP
updated_at TIMESTAMP
linked_to VARCHAR(50)       -- FK до іншого booking
status VARCHAR(20)          -- 'confirmed'/'preliminary'/'cancelled'
kids_count INTEGER
group_name VARCHAR(100)
telegram_message_id INTEGER
```

### lines_by_date

```
id SERIAL PK, date, line_id (UNIQUE date+line_id), name, color, from_sheet
```

### history

```
id SERIAL PK, action VARCHAR(20), username, data JSONB, created_at
```

### settings

```
key VARCHAR(100) PK, value TEXT
```

### users

```
id SERIAL PK, username UNIQUE, password_hash, role ('admin'/'user'/'viewer'), name, created_at
```

#### Seed users

| Username | Password | Role | Name |
|---|---|---|---|
| Vitalina | Vitalina109 | user | Віталіна |
| Dasha | Dasha743 | user | Даша |
| Natalia | Natalia875 | admin | Наталія |
| Sergey | Sergey232 | admin | Сергій |
| Animator | Animator612 | viewer | Аніматор |

### booking_counter

```
year INTEGER PK, counter INTEGER -- auto-increment per year
```

### pending_animators

```
id SERIAL PK, date, note TEXT, status ('pending'), created_at
```

### afisha

```
id SERIAL PK, date, time, title, duration (default 60), type ('event'/'birthday'/'regular'), created_at
```

### telegram_known_chats

```
chat_id BIGINT PK, title, type, updated_at
```

### telegram_known_threads

```
thread_id + chat_id (composite PK), title, updated_at
```

### products (v7.0)

```sql
id VARCHAR(50) PK              -- same as PROGRAMS id (e.g. 'kv1')
code VARCHAR(20)               -- 'КВ1'
label VARCHAR(100)             -- 'КВ1(60)'
name VARCHAR(200)              -- 'Легендарний тренд'
icon VARCHAR(10)               -- '🎭'
category VARCHAR(50)           -- 'quest'
duration INTEGER               -- 60
price INTEGER DEFAULT 0        -- 2200
hosts INTEGER DEFAULT 1
age_range VARCHAR(30)          -- '5-10р'
kids_capacity VARCHAR(30)      -- '4-10'
description TEXT
is_per_child BOOLEAN DEFAULT FALSE
has_filler BOOLEAN DEFAULT FALSE
is_custom BOOLEAN DEFAULT FALSE
is_active BOOLEAN DEFAULT TRUE
sort_order INTEGER DEFAULT 0
created_at TIMESTAMP
updated_at TIMESTAMP
updated_by VARCHAR(50)
```

### tasks (v7.5 + v7.6 + v7.8)

```sql
id SERIAL PK
title VARCHAR(200) NOT NULL
description TEXT
date VARCHAR(20)
status VARCHAR(20) DEFAULT 'todo'     -- 'todo' | 'in_progress' | 'done'
priority VARCHAR(20) DEFAULT 'normal' -- 'low' | 'normal' | 'high'
assigned_to VARCHAR(50)
created_by VARCHAR(50)
created_at TIMESTAMP DEFAULT NOW()
updated_at TIMESTAMP DEFAULT NOW()
completed_at TIMESTAMP
afisha_id INTEGER                      -- v7.6: зв'язок з подією афіші
type VARCHAR(20) DEFAULT 'manual'      -- v7.8: 'manual' | 'recurring' | 'afisha' | 'auto_complete'
template_id INTEGER                    -- v7.8: FK до task_templates
```

### task_templates (v7.8)

```sql
id SERIAL PK
title VARCHAR(200) NOT NULL
description TEXT
priority VARCHAR(20) DEFAULT 'normal'
assigned_to VARCHAR(50)
recurrence_pattern VARCHAR(20) NOT NULL  -- 'daily' | 'weekdays' | 'weekly' | 'custom'
recurrence_days VARCHAR(20)              -- для custom: '1,3,5' (1=Пн...7=Нд)
is_active BOOLEAN DEFAULT TRUE
created_by VARCHAR(50)
created_at TIMESTAMP DEFAULT NOW()
```

### Indexes (23)

```
idx_bookings_date (date)
idx_bookings_date_status (date, status)
idx_bookings_line_date (line_id, date)
idx_bookings_linked_to (linked_to)
idx_lines_by_date_date (date)
idx_history_created_at (created_at)
idx_afisha_date (date)
idx_products_category (category)
idx_products_active (is_active)
idx_tasks_status (status)
idx_tasks_date (date)
idx_tasks_afisha_id (afisha_id)
idx_tasks_type (type)
idx_tasks_template_id (template_id)
```

---

## 7. API Routes

| Method | Path | Auth | Опис |
|---|---|---|---|
| POST | `/api/auth/login` | No | Login -> JWT 24h |
| GET | `/api/auth/verify` | Yes | Token check |
| GET | `/api/bookings/:date` | Yes | Bookings for date |
| POST | `/api/bookings/` | Yes | Create booking |
| POST | `/api/bookings/full` | Yes | Create with linked bookings |
| PUT | `/api/bookings/:id` | Yes | Update booking |
| DELETE | `/api/bookings/:id` | Yes | Delete (`?permanent=true`) |
| GET | `/api/lines/:date` | Yes | Animator lines |
| POST | `/api/lines/:date` | Yes | Update lines |
| GET | `/api/history` | Yes | Audit log (filters: action, user, date range, search) |
| POST | `/api/history` | Yes | Manual history entry |
| GET/POST/PUT/DELETE | `/api/afisha/*` | Yes | Events CRUD + generate-tasks |
| GET | `/api/telegram/chats` | Yes | Known chats |
| GET | `/api/telegram/threads` | Yes | Forum threads |
| POST | `/api/telegram/notify` | Yes | Manual notification |
| GET | `/api/telegram/digest/:date` | Yes | Daily digest |
| GET | `/api/telegram/reminder/:date` | Yes | Reminder |
| POST | `/api/telegram/ask-animator` | Yes | Animator request |
| POST | `/api/telegram/webhook` | No | Bot webhook |
| POST | `/api/backup/create` | Yes | Create backup |
| GET | `/api/backup/download` | Yes | Download SQL |
| POST | `/api/backup/restore` | Yes | Restore from SQL |
| GET | `/api/stats/:from/:to` | Yes | Statistics |
| GET/POST | `/api/settings/:key` | Yes | Settings CRUD |
| GET | `/api/rooms/free/:date/:time/:dur` | Yes | Free rooms |
| GET | `/api/products` | Yes | Product catalog (?active=true) |
| GET | `/api/products/:id` | Yes | Single product |
| POST | `/api/products` | Yes | Create product (v7.1) |
| PUT | `/api/products/:id` | Yes | Update product (v7.1) |
| DELETE | `/api/products/:id` | Yes | Delete/deactivate product (v7.1) |
| GET | `/api/tasks` | Yes | Tasks list (?status, ?date, ?type, ?assigned_to, ?afisha_id) |
| GET | `/api/tasks/:id` | Yes | Single task |
| POST | `/api/tasks` | Yes | Create task (supports type, template_id, afisha_id) |
| PUT | `/api/tasks/:id` | Yes | Full update |
| PATCH | `/api/tasks/:id/status` | Yes | Quick status change |
| DELETE | `/api/tasks/:id` | Yes | Delete task |
| GET | `/api/task-templates` | Yes | Templates list (?active=true) |
| POST | `/api/task-templates` | Yes | Create template |
| PUT | `/api/task-templates/:id` | Yes | Update template |
| DELETE | `/api/task-templates/:id` | Yes | Delete template |
| GET | `/api/health` | No | Health check |

---

## 8. Schedulers (8 штук, кожні 60с)

| Scheduler | Час (Kyiv) | Опис |
|---|---|---|
| `checkAutoDigest` | Налаштовується (weekday/weekend) | Дайджест дня в Telegram |
| `checkAutoReminder` | Налаштовується | Нагадування про завтра |
| `checkAutoBackup` | 03:00 (default) | SQL backup в Telegram |
| `checkRecurringTasks` | 00:05 | Авто-створення recurring задач за шаблонами |
| `checkScheduledDeletions` | Кожні 60с | Авто-видалення за розкладом |
| `checkRecurringAfisha` | Кожні 60с | Авто-створення recurring афіші |
| `checkRecurringBookings` | Кожні 60с | Авто-генерація recurring бронювань |
| `checkCertificateExpiry` | Кожні 60с | Перевірка терміну дії сертифікатів |

---

## 9. Design System v4.0

### CSS Tokens (base.css :root)

```css
--primary: #10B981       /* emerald */
--primary-dark: #059669
--primary-light: #D1FAE5
--danger: #EF4444
--warning: #F59E0B
--info: #3B82F6
--font-family: 'Nunito', -apple-system, sans-serif
--radius: 16px / --radius-sm: 10px / --radius-xs: 6px
--space-xs: 4px / --space-sm: 8px / --space-md: 16px / --space-lg: 24px / --space-xl: 32px
```

### Category Colors (CSS + JS)

| Category | Hex | CSS var |
|---|---|---|
| quest | #8B5CF6 | `--quest-bg` |
| animation | #3B82F6 | `--animation-bg` |
| show | #F97316 | `--show-bg` |
| masterclass | #84CC16 | `--masterclass-bg` |
| pinata | #EC4899 | `--pinata-bg` |
| photo | #06B6D4 | `--photo-bg` |
| custom | #64748B | `--custom-bg` |

### CSS Components

```
.status-badge--confirmed/preliminary/cancelled
.category-chip--{category} (7 variants)
.empty-state + .empty-state-icon + .empty-state-title/text
.btn-unified + .btn-primary/secondary/danger-unified/accent
.modal-footer-sticky
.tg-subsection, .tg-btn-row, .tg-inline-group
.btn-submit.btn-purple/blue/flex/full
.invite-section, .invite-preview, .invite-actions
.program-search-input
.btn-duplicate-booking

/* v7.8: pages.css components */
.nav-link / .nav-link.active
.card / .card-header / .card-title / .card-meta / .card-actions
.badge / .badge-{type} / .badge-{status} / .badge-{priority}
.filter-bar
.category-tab / .category-tab.active
.page-tabs / .page-tab
.inline-form / .form-field
.btn-page-primary / .btn-page-secondary / .btn-page-danger
.task-card[data-status] / .task-card[data-priority]
.program-card / .program-card.inactive
.empty-state / .page-login-overlay
```

### Dark Mode

- Class: `body.dark-mode`
- File: `css/dark-mode.css` (1110 lines — full coverage)
- Toggle: `#darkModeToggle` checkbox

### Responsive Breakpoints

```
Desktop:     >=769px  (CSS Grid toolbar)
Tablet:      <=1024px (panel overlay 380px + backdrop)
Mobile:      <=768px  (panel 100%, flex toolbar)
Small:       <=480px  (full-screen modals)
Extra small: <=390px  (hidden labels, ultra-compact)
Landscape:   max-height: 500px + orientation: landscape
```

---

## 10. Задачі (Tasks System v7.8)

### Типи задач

| Type | Badge | Опис |
|---|---|---|
| `manual` | ✋ Ручна | Створено вручну |
| `recurring` | 🔄 Повторювана | Створено автоматично з шаблону |
| `afisha` | 🎭 Афіша | Генеровано з події афіші |
| `auto_complete` | ⚡ Авто | Авто-завершення |

### Статуси задач

| Status | Опис |
|---|---|
| `todo` | Очікує виконання |
| `in_progress` | В роботі |
| `done` | Виконано (completed_at заповнюється) |

### Пріоритети

| Priority | Опис |
|---|---|
| `high` | 🔴 Високий (сортується першим) |
| `normal` | Звичайний |
| `low` | 🔵 Низький |

### Шаблони recurring задач (task_templates)

| Pattern | Опис |
|---|---|
| `daily` | Щоденно |
| `weekdays` | Будні пн-пт |
| `weekly` | Щотижня (понеділок) |
| `custom` | Обрані дні (recurrence_days: '1,3,5') |

Scheduler створює задачі щодня о 00:05 Kyiv time. Dedup: якщо задача з тим же template_id вже існує на цю дату — пропускається.

---

## 11. Програми (40 шт, 7 категорій)

### Квести (11)

| ID | Code | Name | Duration | Price | Hosts |
|---|---|---|---|---|---|
| kv1 | КВ1 | Легендарний тренд | 60 | 2200 | 1 |
| kv4 | КВ4 | Шпигунська історія | 60 | 2800 | 2 |
| kv5 | КВ5 | Щенячий патруль | 60 | 2700 | 2 |
| kv6 | КВ6 | Лісова Академія | 90 | 2100 | 1 |
| kv7 | КВ7 | Гра в Кальмара | 60 | 3300 | 2 |
| kv8 | КВ8 | MineCraft 2 | 60 | 2900 | 2 |
| kv9 | КВ9 | Ліга Світла | 60 | 2500 | 2 |
| kv10 | КВ10 | Бібліотека Чарів | 60 | 3000 | 2 |
| kv11 | КВ11 | Секретна скарбів | 60 | 2500 | 2 |

### Анімація (2)

| ID | Code | Name | Duration | Price | Hosts |
|---|---|---|---|---|---|
| anim60 | АН | Анімація 60хв | 60 | 1500 | 1 |
| anim120 | АН | Анімація 120хв | 120 | 2500 | 1 |

### Шоу (6)

| ID | Code | Name | Duration | Price | Hosts |
|---|---|---|---|---|---|
| bubble | Бульб | Бульбашкове шоу | 30 | 2400 | 1 |
| neon_bubble | Неон | Неон-бульбашки | 30 | 2700 | 1 |
| paper | Папір | Паперове Неон-шоу | 30 | 2900 | 2 |
| dry_ice | Лід | Шоу з сухим льодом | 40 | 4400 | 1 |
| football | Футб | Футбольне шоу | 90 | 3800 | 1 |
| mafia | Мафія | Мафія | 90 | 2700 | 1 |

### Фото (4)

| ID | Code | Name | Duration | Price | Hosts |
|---|---|---|---|---|---|
| photo60 | Фото | Фотосесія 60хв | 60 | 1600 | 1 |
| photo_magnets | Фото+ | Фотосесія + магніти | 60 | 2600 | 1 |
| photo_magnet_extra | Магн | Додатковий магніт | 0 | 290 | 0 |
| video | Відео | Аніматорська відеозйомка | 0 | 6000 | 0 |

### Майстер-класи (11)

| ID | Code | Name | Duration | Price | Hosts |
|---|---|---|---|---|---|
| mk_candy | МК | Цукерки | 90 | 370/child | 1 |
| mk_thermomosaic | МК | Термомозаїка | 45 | 390/child | 1 |
| mk_slime | МК | Слайми | 45 | 390/child | 1 |
| mk_tshirt | МК | Розпис футболок | 90 | 450/child | 1 |
| mk_cookie | МК | Розпис пряників | 60 | 300/child | 1 |
| mk_ecobag | МК | Розпис еко-сумок | 75 | 390/child | 1 |
| mk_pizza_classic | МК | Класична піца | 45 | 290/child | 1 |
| mk_pizza_custom | МК | Кастомна піца | 45 | 430/child | 1 |
| mk_cakepops | МК | Кейк-попси | 90 | 330/child | 1 |
| mk_cupcake | МК | Капкейки | 120 | 450/child | 1 |
| mk_soap | МК | Миловаріння | 90 | 450/child | 1 |

### Піньяти (2)

| ID | Code | Name | Duration | Price | Hosts |
|---|---|---|---|---|---|
| pinata | Пін | Піньята | 15 | 700 | 1 |
| pinata_custom | ПінН | Піньята PRO | 15 | 1000 | 1 |

### Інше (1)

| ID | Code | Name | Duration | Price | Hosts |
|---|---|---|---|---|---|
| custom | Інше | Інше (вкажіть) | 30 | 0 | 1 |

---

## 12. Кімнати (14)

Marvel, Ninja, Minecraft, Monster High, Elsa, Растішка, Rock, Minion, Food Court, Жовтий стіл, Диван 1, Диван 2, Диван 3, Диван 4

---

## 13. Костюми (28)

Супер Кіт, Леді Баг, Тік-ток ведучий чорн, Тік-ток ведучий син, Майнкрафт Кріпер, Піратка 2, Пірат 1, Ельза, Студент Ґоґвортса, Ліло, Стіч, Єдиноріжка, Поняшка, Ютуб, Людина-павук, Neon-party 1, Neon-party 2, Супермен, Бетмен, Мавка, Лукаш, Чейз, Скай, Венсдей, Монстер Хай, Лялька рожева LOL, Барбі, Роблокс

---

## 14. Ключові конвенції

- **Дати:** зберігаються в UTC, відображаються в `Europe/Kyiv` (UTC+2/+3)
- **Валюта:** UAH (₴), формат `formatPrice()` -> `"1 000 ₴"`
- **Booking ID:** `BK-YYYY-NNNN` (auto via `booking_counter` table)
- **DB -> API mapping:** `snake_case` -> `camelCase` через `mapBookingRow()` / `mapTemplateRow()`
- **Транзакції:** `pool.connect()` -> `BEGIN` -> ... -> `COMMIT` -> catch `ROLLBACK` -> finally `release()`
- **Telegram:** fire-and-forget ПІСЛЯ commit
- **Commits:** Conventional Commits (`feat`/`fix`/`chore`/`docs`)
- **Touch targets:** min 44px (WCAG 2.1)
- **Font-size inputs:** min 16px (iOS zoom)
- **Мова коду:** English (змінні, функції, коментарі)
- **Мова UI:** Ukrainian (labels, повідомлення)
- **Спілкування:** Ukrainian preferred
- **Сторінки:** кожна standalone HTML шерить `js/config.js` + `js/api.js` + `js/auth.js`

### 5-Step Versioning Protocol

При кожній новій версії:

1. `package.json` — version bump
2. `index.html` — всі `?v=X.XX` на CSS/JS тегах
3. `index.html` — tagline `"Система бронювання vX.XX"`
4. `index.html` — changelog button `"Що нового у vX.XX"`
5. `index.html` — новий changelog entry в модалці

Після кожної версії:

- `CHANGELOG.md` — нова секція зверху
- `SNAPSHOT.md` — оновити стан
- Запустити тести: `node --test tests/api.test.js` (192 pass)
- Commit + push

---

## 15. Поточний стан (v9.1.0)

### v9.1.0 — Live-Sync

- WebSocket підключено до server.js (services/websocket.js + js/ws.js)
- Broadcast: booking:created/updated/deleted, line:updated
- JWT auth, heartbeat 30s, auto-reconnect з exponential backoff
- Accessibility: skip-links на 5 сторінках, prefers-reduced-motion
- SessionStart hook для Claude Code на вебі
- 364/364 тестів проходять (3 test files)

---

## 16. Історія версій (v5.30 -> v7.8)

| Version | Feature |
|---|---|
| v5.30 | Design System v4.0 (emerald, tokens, 10-file CSS) |
| v5.31 | Segmented controls |
| v5.32 | Program Cards & Category Grid |
| v5.33 | Booking Panel Mobile |
| v5.34 | Responsive Phones (4 breakpoints) |
| v5.35 | Tablet overlay + Desktop Grid |
| v5.36 | Афіша & Історія UI |
| v5.37 | Dark Mode full coverage |
| v5.38 | Image Asset Pack (favicon, PWA) |
| v5.39 | Bugfixes & Security Hardening |
| v5.40 | UX & Accessibility |
| v5.41 | Performance & Cleanup (indexes, RETURNING *) |
| v5.42 | Design Tokens + Premium Menu |
| v5.43 | Modals & Buttons Polish |
| v5.44 | Dashboard & Empty States |
| v5.45 | Invite Page Overhaul |
| v5.46 | Wire Up Design System |
| v5.47 | Inline Style Cleanup |
| v5.48 | Invite Creation Flow |
| v5.49 | Program Search in Catalog |
| v5.50 | Duplicate Booking |
| v5.51 | Undo for Edit & Shift |
| v6.0 | Test Mode (passwordless, temporary) |
| v7.0 | Product Catalog MVP (products table, API, caching, migration) |
| v7.1 | Admin CRUD каталогу (create/edit/deactivate, role manager) |
| v7.2 | Clawd Bot (7 Telegram-команд: today/tomorrow/programs/find/price/stats/menu) |
| v7.3 | Афіша в Telegram (дайджест + нагадування з подіями) |
| v7.4 | Типи подій (event/birthday/regular), іменинники |
| v7.5 | Задачник MVP (tasks CRUD, статуси, пріоритети) |
| v7.6 | Афіша -> Задачі (auto-generation, cascade) |
| v7.6.1 | Переключення ліній аніматорів + bugfix |
| v7.8 | Standalone Tasks & Programs pages + recurring task templates |
| v8.3.0 | Автоматизація (правила, задачі, Telegram) + Drag-to-Move афіша |
| v8.4.0 | Сертифікати (реєстр, Telegram-сповіщення, scheduler) |
| v8.5.0 | Панель сертифікатів (slide-in, статистика, градієнтні картки) |
| v8.5.1 | Графічні сертифікати (Canvas PNG, Містер Зак) |
| v8.6.0 | Розумний розподіл (birthday redesign + авто-distribute) |
| v9.0.0 | Розумна платформа (DnD, recurring, analytics, locking, offline, migrations) |
| v9.0.1 | Стабілізація (staff toolbar, cache bust) |
| v9.0.2 | Доступність (skip-links, reduced motion) |
| v9.1.0 | Live-Sync (WebSocket підключено, broadcast) |

---

## 17. Git

- **Branch (актуальна):** `claude/review-project-updates-R2CbJ` <-- v9.1.0

---

## 18. Що далі

- Swagger /api-docs (код є в swagger.js, треба підключити swagger-ui-express)
- Clawd Bot команди для задач (/tasks, /done)
- Авто-задачі (контент для соцмереж, нагадування)
- Drag-n-drop сортування програм
- Export PDF/Excel

---

> Це все. Актуальна гілка: `claude/review-project-updates-R2CbJ`. Копіюй цей паспорт у новий чат — там є все для продовження.
