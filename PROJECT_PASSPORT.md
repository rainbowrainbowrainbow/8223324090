# PROJECT PASSPORT — Парк Закревського Періоду (Booking System)

> Ультра-детальний паспорт для передачі в новий чат. Усе що потрібно для продовження роботи.
>
> Оновлено: 2026-02-11, v7.0.0

---

## 1. Що це

Система бронювання для дитячого розважального парку **"Закревського Періоду"** (Київ, вул. Закревського 31/2, 3 поверх). Таймлайн аніматорів, прив'язка до кімнат/програм, Telegram-бот, дашборд, каталог, запрошення, бекапи.

---

## 2. Деплой

| Параметр | Значення |
|---|---|
| Хостинг | Railway |
| Гілка на Railway | `claude/review-project-docs-1y3qH` |
| Поточна версія | v7.0.0 (Product Catalog MVP + тестовий режим) |
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
| Frontend | Vanilla HTML + CSS + JS SPA (**NO React, NO Next.js, NO Astro**) |
| CSS | 10-file modular architecture + Design System v4.0 |
| Font | Nunito (Google Fonts) |
| Testing | Node.js built-in `node --test` (157 тестів) |
| PWA | `manifest.json` (standalone, theme emerald) |

### Dependencies (package.json)

```json
"bcryptjs": "^3.0.3",
"cors": "^2.8.5",
"express": "^4.18.2",
"jsonwebtoken": "^9.0.3",
"pg": "^8.11.3"
```

---

## 4. Структура файлів (16 401 рядок)

```
server.js              (97)  — Entry point, middleware, routes mount, schedulers
db/index.js           (400+) — Pool, schema creation, 11 таблиць, seed users+products, indexes

routes/
  auth.js              (39)  — Login (v6.0: passwordless), verify
  products.js          (68)  — Product catalog (GET list, GET by id)
  bookings.js         (349)  — CRUD, linked bookings, conflict checks, transactions
  lines.js             (62)  — Animator lines per date
  history.js           (77)  — Audit log with JSONB search, filters, pagination
  settings.js         (102)  — Settings CRUD, stats, free rooms, health
  afisha.js            (77)  — Events CRUD
  telegram.js         (277)  — Webhook, notifications, digest, reminder, animator requests
  backup.js            (72)  — SQL backup create/restore/download

services/
  booking.js          (195)  — Validators, time helpers, conflict checks, row mapper
  telegram.js         (265)  — Bot API wrapper, retry 3x, webhook setup, auto-delete
  templates.js         (59)  — Ukrainian notification templates
  scheduler.js        (185)  — Auto-digest (10:00 Kyiv), auto-reminder, auto-backup
  backup.js           (114)  — SQL dump generator, Telegram file upload

middleware/
  auth.js              (29)  — JWT verification
  rateLimit.js         (54)  — In-memory rate limiter (120/15min + 5/min login)
  security.js          (24)  — Security headers (X-Content-Type, X-Frame, HSTS)
  requestId.js         (41)  — AsyncLocalStorage request IDs

utils/
  logger.js            (83)  — Structured logging, JSON/pretty formats

js/
  config.js           (220+) — 40 programs, 28 costumes, 14 rooms, category config, products cache
  api.js               (?)   — Fetch wrapper with JWT auth
  auth.js              (?)   — Login/logout, session management
  app.js               (?)   — Event listeners, escapeHtml, preferences
  ui.js               (526)  — Notifications, tooltip, dark/compact mode, undo, export PNG
  booking.js         (1035)  — Booking panel, program search, form, invite, duplicate
  timeline.js         (494)  — Timeline render, multi-day, pending lines, status filter
  settings.js        (1179)  — History, catalogs, telegram config, dashboard, afisha

css/ (10 файлів):
  base.css             (303)  — Design tokens, typography, status badges, category chips
  auth.css             (240)  — Login screen, test-mode-hint
  layout.css           (505)  — Header, nav, emerald dark dropdown
  timeline.css         (638)  — Grid, booking blocks, time scale
  panel.css            (585)  — Sidebar, programs, search input
  modals.css           (753)  — All modals, unified buttons, empty states
  controls.css         (433)  — Status filter, zoom, segmented controls
  features.css         (933)  — Telegram settings, dashboard, invite, afisha
  dark-mode.css       (1071)  — Complete dark theme
  responsive.css       (381)  — 4 breakpoints + landscape

index.html           (1318)  — Full SPA, 12 modals, booking panel
invite.html           (475)  — Standalone invitation page

tests/
  api.test.js        (2159)  — 157 tests, 50 suites
  helpers.js            (54)  — Test utilities, cached token, testDate=2099-01-15

images/ (15 files, ~3.5MB):
  favicon.svg, favicon-16/32/180/192/512.png, favicon.ico
  logo-new.png, hero.png
  quest.png, animation.png, show.png, masterclass.png, photo.png, pinata.png
  empty-state.png

manifest.json — PWA manifest (standalone, uk, emerald theme)
```

---

## 5. База даних (11 таблиць)

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
id SERIAL PK, date, time, title, duration (default 60), created_at
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

### Indexes (9)

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
```

---

## 6. API Routes

| Method | Path | Auth | Опис |
|---|---|---|---|
| POST | `/api/auth/login` | No | Login -> JWT 24h (v6.0: passwordless, тимчасово) |
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
| GET/POST/PUT/DELETE | `/api/afisha/*` | Yes | Events CRUD |
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
| GET | `/api/health` | No | Health check |

---

## 7. Design System v4.0

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
```

### Dark Mode

- Class: `body.dark-mode`
- File: `css/dark-mode.css` (1071 lines — full coverage)
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

## 8. Програми (40 шт, 7 категорій)

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

## 9. Кімнати (14)

Marvel, Ninja, Minecraft, Monster High, Elsa, Растішка, Rock, Minion, Food Court, Жовтий стіл, Диван 1, Диван 2, Диван 3, Диван 4

---

## 10. Костюми (28)

Супер Кіт, Леді Баг, Тік-ток ведучий чорн, Тік-ток ведучий син, Майнкрафт Кріпер, Піратка 2, Пірат 1, Ельза, Студент Ґоґвортса, Ліло, Стіч, Єдиноріжка, Поняшка, Ютуб, Людина-павук, Neon-party 1, Neon-party 2, Супермен, Бетмен, Мавка, Лукаш, Чейз, Скай, Венсдей, Монстер Хай, Лялька рожева LOL, Барбі, Роблокс

---

## 11. Ключові конвенції

- **Дати:** зберігаються в UTC, відображаються в `Europe/Kyiv` (UTC+2/+3)
- **Валюта:** UAH (₴), формат `formatPrice()` -> `"1 000 ₴"`
- **Booking ID:** `BK-YYYY-NNNN` (auto via `booking_counter` table)
- **DB -> API mapping:** `snake_case` -> `camelCase` через `mapBookingRow()`
- **Транзакції:** `pool.connect()` -> `BEGIN` -> ... -> `COMMIT` -> catch `ROLLBACK` -> finally `release()`
- **Telegram:** fire-and-forget ПІСЛЯ commit
- **Commits:** Conventional Commits (`feat`/`fix`/`chore`/`docs`)
- **Touch targets:** min 44px (WCAG 2.1)
- **Font-size inputs:** min 16px (iOS zoom)
- **Мова коду:** English (змінні, функції, коментарі)
- **Мова UI:** Ukrainian (labels, повідомлення)
- **Спілкування:** Ukrainian preferred

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
- Запустити тести: `node --test tests/api.test.js` (157 pass)
- Commit + push

---

## 12. Поточний стан (v7.0.0)

### v7.0 — Product Catalog MVP

- **Нова таблиця `products`** — 40 програм мігровано з хардкоду (PROGRAMS) в БД
- `routes/products.js` — GET /api/products (?active=true), GET /api/products/:id
- `js/api.js` — apiGetProducts(), apiGetProduct()
- `js/config.js` — кешування: getProducts() (async, TTL 5хв), getProductsSync() (синхронний fallback)
- `js/booking.js` + `js/settings.js` — всі PROGRAMS.find/filter замінено на getProductsSync()/getProducts()
- Auto-seed: при першому запуску 40 програм з PROGRAMS заливаються в products table
- **Backward compatible:** якщо API недоступний → fallback на PROGRAMS масив
- Вхід без пароля працює (v6.0 test mode)
- **УВАГА: Перед production повернути стандартну авторизацію!**
- 157/157 тестів проходять

---

## 13. Історія версій (v5.30 -> v7.0)

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

---

## 14. Git

- **Branch (Railway):** `claude/review-project-docs-1y3qH` <-- v6.0, потребує оновлення
- **Branch (v7.0):** `claude/project-passport-docs-XKYIn` <-- АКТУАЛЬНА ГІЛКА з v7.0
- **Друга гілка (стара):** `claude/theme-park-booking-pZL5g`
- **Last commit:** `f7f701d` feat: v7.0 — Product Catalog MVP

---

## 15. Що далі (план ЗАТВЕРДЖЕНИЙ)

Міні-CRM трансформація. План затверджений, Q&A пройдено (12 питань). Детальний план у `IMPROVEMENT_PLAN.md`.

- ~~**v7.0 Product Catalog MVP**~~ ✅ DONE
- **v7.1 Admin-Bot API** — CRUD продуктів, роль manager, Clawd Bot зв'язка
- **v7.2 Contractors** — підрядники з контактами, навичками (до 10 шт)
- **v7.3 Tasks** — завдання з дедлайнами, розширені типи
- **v7.4 Automation** — автозамовлення через Telegram бот
- **v7.5 Polish** — RBAC, дашборд, фінал

Також можливі:

- Graphic assets (7 prompt templates для іконок/патернів)
- Drag & drop на таймлайні
- Export PDF/Excel

---

> Це все. Гілка на Railway: `claude/review-project-docs-1y3qH`. Копіюй цей паспорт у новий чат — там є все для продовження.
