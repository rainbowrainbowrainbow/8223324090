# PROJECT PASSPORT — Park Zakrevskogo Periodu Booking System

> Цей файл — єдине джерело правди про проект. Тільки дописуємо, не переписуємо хаотично.

## 1. Що це за продукт

Система бронювання для дитячого розважального парку "Закревського Періоду" (Київ). Таймлайн-інтерфейс для менеджерів: створення бронювань на аніматорів, прив'язка до кімнат і програм, Telegram-нотифікації, експорт, дайджести, статистика. Один SPA на vanilla JS, бекенд на Express + PostgreSQL.

## 2. Деплой / URL / Env

| Параметр | Значення |
|----------|----------|
| Хостинг | Railway |
| Домен | задається через `RAILWAY_PUBLIC_DOMAIN` |
| Порт | `PORT` (default: 3000) |
| БД | PostgreSQL (`DATABASE_URL` або `PGUSER`+`PGDATABASE`+`PGHOST`) |
| JWT | `JWT_SECRET` (random якщо не задано) |
| Telegram Bot | `TELEGRAM_BOT_TOKEN` |
| Telegram Chat | `TELEGRAM_DEFAULT_CHAT_ID` (default: -1001805304620) |
| Webhook Secret | `WEBHOOK_SECRET` |
| Rate Limit | `RATE_LIMIT_MAX` (default: 120 req/15min) |
| Log Level | `LOG_LEVEL` (default: debug) |
| Node Env | `NODE_ENV` (production/development) |

**Test env:**
- `TEST_URL` (default: http://localhost:3000)
- `TEST_USER` / `TEST_PASS` (default: admin / admin123)

## 3. Стек і файли

### Бекенд
- **Runtime:** Node.js >=18
- **Framework:** Express 4.18
- **DB:** PostgreSQL via `pg` (raw queries, NO ORM)
- **Auth:** JWT (jsonwebtoken) + bcryptjs
- **Тести:** Node.js built-in test runner (`node --test`)

### Структура файлів

```
server.js              — Entry point, middleware setup, static serving
db/index.js            — Schema creation, pool, default user seeding
routes/
  auth.js              — Login, verify
  bookings.js          — CRUD bookings, linked bookings, conflict checks
  lines.js             — Animator lines per date
  history.js           — Audit log
  afisha.js            — Events/schedule
  telegram.js          — Notifications, digest, webhook, animator requests
  backup.js            — SQL backup create/restore/download
  settings.js          — Key-value settings, stats, rooms, health
services/
  telegram.js          — Telegram API wrapper (sendMessage, retry)
  booking.js           — Validators, time helpers, booking number generator
  scheduler.js         — Auto-digest, reminders, backup cron
  templates.js         — Message formatting (HTML for Telegram)
  backup.js            — pg_dump utilities
middleware/
  auth.js              — JWT verification middleware
  rateLimit.js         — Rate limiting
  requestId.js         — Request ID tracking
  security.js          — Cache-control headers
utils/
  logger.js            — Structured logging
tests/
  api.test.js          — 157 API smoke tests (89KB)
  helpers.js           — Test utilities (getToken, authRequest, testDate)
```

### Фронтенд (Vanilla HTML/CSS/JS SPA)
```
index.html             — Main SPA
invite.html            — Public invite page

css/ (10 файлів, порядок завантаження важливий!):
  base.css             — Design tokens, reset, notifications
  auth.css             — Login screen
  layout.css           — Header, nav, control panel, date controls
  timeline.css         — Timeline grid, booking blocks, legend
  panel.css            — Booking sidebar, form, programs, status
  modals.css           — All modals (changelog, catalog, history, etc.)
  controls.css         — Segmented controls, zoom, toggles, filters
  features.css         — Dashboard, minimap, afisha, export
  dark-mode.css        — Dark theme overrides
  responsive.css       — All media queries (769+, 1024, 768, 480, 390, landscape)

js/ (8 файлів):
  config.js            — Programs (35), rooms (14), costumes (27), categories, colors
  api.js               — fetch wrapper with auth headers
  auth.js              — Login/logout, token management
  app.js               — Initialization, event listeners, keyboard shortcuts
  timeline.js          — Timeline rendering, drag-to-book, multi-day view
  booking.js           — Booking form logic, program icons, panel open/close
  ui.js                — Modals, notifications, export, history UI
  settings.js          — Settings panel, Telegram config UI
```

## 4. Не чіпати / Інтеграції

### Telegram Bot
- Token: env `TELEGRAM_BOT_TOKEN`
- Webhook: `POST /api/telegram/webhook`
- Функціонал: нотифікації (create/edit/delete/status), дайджест, нагадування, запити на аніматорів (inline buttons), бекап
- Fire-and-forget ПІСЛЯ commit транзакції
- Retry: 3 спроби з 1s backoff
- Повідомлення: HTML parsing, thread support

### API Routes (НЕ ламати контракт!)
| Method | Path | Опис |
|--------|------|------|
| POST | /api/auth/login | Логін → JWT (8h) |
| GET | /api/auth/verify | Перевірка токена |
| GET | /api/bookings/:date | Бронювання на дату |
| POST | /api/bookings/ | Створити бронювання |
| POST | /api/bookings/full | Створити з пов'язаними |
| PUT | /api/bookings/:id | Редагувати |
| DELETE | /api/bookings/:id | Soft/hard delete (?permanent=true) |
| GET | /api/lines/:date | Лінії аніматорів |
| POST | /api/lines/:date | Оновити лінії |
| GET | /api/history | Журнал дій (фільтри) |
| POST | /api/history | Ручний запис |
| GET/POST/PUT/DELETE | /api/afisha/* | CRUD афіші |
| GET | /api/telegram/chats | Відомі чати |
| GET | /api/telegram/threads | Теми форуму |
| POST | /api/telegram/notify | Ручне повідомлення |
| GET | /api/telegram/digest/:date | Дайджест |
| GET | /api/telegram/reminder/:date | Нагадування |
| POST | /api/telegram/ask-animator | Запит аніматора |
| POST | /api/telegram/webhook | Вебхук бота |
| POST | /api/backup/create | Створити бекап |
| GET | /api/backup/download | Завантажити SQL |
| POST | /api/backup/restore | Відновити з SQL |
| GET | /api/stats/:from/:to | Статистика |
| GET/POST | /api/settings/:key | Налаштування |
| GET | /api/rooms/free/:date/:time/:dur | Вільні кімнати |
| GET | /api/health | Health check |

### LiqPay
- Ще не інтегровано, заплановано на майбутнє

## 5. Тестові логіни

| Username | Password | Role | Ім'я |
|----------|----------|------|------|
| admin | admin123 | admin | Адмін (тестовий) |
| vitalina | vitalina123 | admin | Віталіна |
| dasha | dasha123 | user | Даша |
| natalia | natalia123 | user | Наталія |
| sergey | sergey123 | admin | Сергій |
| animator | animator123 | user | Аніматор |

## 6. Design System

### Tokens (css/base.css :root)
```
--primary: #10B981 (emerald)
--primary-dark: #059669
--primary-light: #D1FAE5
--danger: #EF4444
--warning: #F59E0B
--info: #3B82F6
--success: #10B981
--font-family: 'Nunito', -apple-system, sans-serif
--radius: 16px / --radius-sm: 10px / --radius-xs: 6px
```

### Category Colors
| Category | Color | Hex |
|----------|-------|-----|
| quest | purple | #8B5CF6 |
| animation | blue | #3B82F6 |
| show | orange | #F97316 |
| masterclass | green | #84CC16 |
| pinata | pink | #EC4899 |
| photo | cyan | #06B6D4 |
| custom | gray | #64748B |

### Dark Mode
- Toggle: `body.dark-mode` class
- Файл: `css/dark-mode.css`
- Перемикач: `#darkModeToggle` checkbox

### Шрифти
- Google Fonts: Nunito (400, 600, 700, 800, 900)

## 7. Критичні правила

### Accessibility (WCAG 2.1)
- Touch targets: >= 44x44px
- Font size на mobile inputs: >= 16px (запобігає iOS auto-zoom)
- `:focus-visible` outline на всіх інтерактивних елементах
- `user-scalable=yes` (НЕ блокувати zoom!)

### DB транзакції
- `pool.connect()` → try/BEGIN/COMMIT → catch/ROLLBACK → finally/release
- НІКОЛИ не робити double `client.release()` — крашить сервер
- snake_case в БД → camelCase в API через `mapBookingRow()`

### Booking number format
- `BK-YYYY-NNNN` (наприклад BK-2025-0042)
- Генерується через `booking_counter` таблицю

### Responsive breakpoints
- Desktop: >=769px (CSS Grid toolbar)
- Tablet: <=1024px (panel overlay 380px + backdrop)
- Mobile: <=768px (panel 100%, flex column toolbar)
- Small mobile: <=480px (full-screen modals)
- Extra small: <=390px (ultra-compact, hidden labels)
- Landscape: max-height 500px + orientation: landscape

### Версіонування
Кожна версія вимагає:
1. `package.json` version bump
2. `index.html` — всі `?v=X.XX` на CSS/JS тегах
3. `index.html` — tagline "Система бронювання vX.XX"
4. `index.html` — changelog button text "Що нового у vX.XX"
5. `index.html` — новий changelog entry

## 8. Програми, кімнати, костюми

### Програми (35 шт, 7 категорій)
- **Quests (9):** КВ1, КВ4, КВ5, КВ6, КВ7, КВ8, КВ9, КВ10, КВ11
- **Animation (2):** АН(60), АН(120)
- **Shows (6):** Bubble, Neon Bubble, Paper Neon, Dry Ice, Football, Mafia
- **Photo (4):** Photo(60), Photo+Magnets, Extra Magnet, Video
- **Masterclass (11):** Candy, Thermomosaic, Slime, T-shirt, Cookie, Eco-bag, Pizza Classic, Pizza Custom, Cake-pops, Cupcakes, Soap
- **Pinata (2):** Standard, PRO
- **Custom (1):** Інше

### Кімнати (14)
Marvel, Ninja, Minecraft, Monster High, Elsa, Растішка, Rock, Minion, Food Court, Жовтий стіл, Диван 1-4

### Костюми (27)
Визначені в `js/config.js` — Супер Кіт, Леді Баг, Майнкрафт Кріпер, Ельза, Людина-павук, Венсдей, Барбі, Роблокс та інші

## 9. Завершені цілі (v5.30–v5.38 UI/UX Overhaul)

1. **v5.30** — A11y Foundation (touch targets, focus-visible, iOS zoom fix) ✅
2. **v5.31** — Segmented controls (status filter, period selector) ✅
3. **v5.32** — Program Cards & Category Grid ✅
4. **v5.33** — Booking Panel Mobile (flex layout, scroll lock) ✅
5. **v5.34** — Responsive Phones (4 breakpoints) ✅
6. **v5.35** — Tablet overlay + Desktop Grid toolbar ✅
7. **v5.36** — Афіша & Історія UI ✅
8. **v5.37** — Dark Mode & Typography Polish ✅
9. **v5.38** — Image Asset Pack (favicon, PWA manifest, нове лого) ✅
10. Виправлення CLAUDE.md (реальний стек замість TypeScript/Prisma) ✅
11. Очистка `.claude/skills/` (видалено 12 шаблонних файлів) ✅

---

*Останнє оновлення: v5.39.0 (2026-02-07)*
