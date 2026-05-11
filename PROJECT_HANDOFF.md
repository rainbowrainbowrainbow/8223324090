# Парк Закревського Періоду — Повний профіль проекту для нового чату

> Runtime note (2026-05-11): current Codex/Railway baseline is Node.js `22.x` with npm `10.x`. Use `AGENTS.md` and `README.md` for current runtime/deploy rules; older Node 18 and branch notes below are historical.

## Хто я (замовник)
Організатор свят у дитячому парку розваг. Не програміст. Пояснення мають бути простими — як для організатора свят, не для кодера. Формат: аргументуй, навчай принципам, пропонуй варіанти A/B/C коли є сумніви.

---

## 1. ЗАГАЛЬНІ ДАНІ

| Поле | Значення |
|------|----------|
| Проект | Система бронювання для Парку Закревського Періоду |
| Версія | **v5.32.0** |
| Гілка розробки | `claude/theme-park-booking-pZL5g` |
| Продакшн гілка | `claude/theme-park-booking-2sPgC` (Railway) |
| Мова UI | Українська |
| Мова коду | Англійська |
| Тести | 157 тестів, Node.js built-in test runner |
| Деплой | Railway |

---

## 2. TECH STACK

- **Runtime:** Node.js 18+ (package.json engines)
- **Backend:** Express.js — модульна архітектура (v5.28+), 18 модулів
- **Database:** PostgreSQL via `pg` (без ORM, raw SQL, connection pooling)
- **Auth:** JWT + bcryptjs
- **Frontend:** Vanilla HTML/CSS/JS SPA (index.html + invite.html) — БЕЗ React/Vue/Tailwind/Bootstrap
- **Font:** Nunito (Google Fonts)
- **Telegram:** Bot API (webhook, fire-and-forget notifications)
- **Тести:** `node --test tests/api.test.js`

---

## 3. СТРУКТУРА ПРОЕКТУ

```
/home/user/8223324090/
├── server.js              (89 рядків — slim entry point)
├── index.html             (головний SPA, ~750 рядків)
├── invite.html            (сторінка-запрошення)
├── package.json           (v5.32.0)
│
├── db/
│   └── index.js           (Pool, initDatabase, generateBookingNumber)
├── middleware/
│   ├── auth.js            (JWT authenticateToken)
│   ├── rateLimit.js       (configurable via RATE_LIMIT_MAX)
│   ├── requestId.js       (AsyncLocalStorage + unique ID)
│   └── security.js        (cache control headers)
├── services/
│   ├── booking.js         (mapBookingRow, business logic)
│   ├── telegram.js        (webhook, send notifications)
│   ├── templates.js       (Telegram message templates)
│   ├── scheduler.js       (auto-digest, reminder, backup)
│   └── backup.js          (database backup)
├── routes/
│   ├── auth.js            (POST /api/auth/login, /register)
│   ├── bookings.js        (CRUD + /full + /time-shift)
│   ├── lines.js           (animator lines per date)
│   ├── history.js         (audit log with filters)
│   ├── settings.js        (stats, rooms, health)
│   ├── afisha.js          (public events schedule)
│   ├── telegram.js        (webhook + bot commands)
│   └── backup.js          (export/import)
├── utils/
│   └── logger.js          (structured logging, JSON/pretty)
│
├── js/                    (Frontend, 8 файлів)
│   ├── config.js          (PROGRAMS, COSTUMES, CONFIG, AppState)
│   ├── api.js             (fetch wrapper з JWT)
│   ├── auth.js            (login/logout)
│   ├── app.js             (init, routing, event binding)
│   ├── booking.js         (CRUD форми, renderProgramIcons)
│   ├── timeline.js        (Gantt-like timeline render)
│   ├── ui.js              (modals, notifications, dark mode)
│   └── settings.js        (dashboard, telegram settings, afisha)
│
├── css/                   (10 файлів, порядок завантаження важливий!)
│   ├── base.css           (Design tokens, reset — 189 рядків)
│   ├── auth.css           (Login screen)
│   ├── layout.css         (Header, main layout)
│   ├── timeline.css       (Gantt grid, booking blocks)
│   ├── panel.css          (Sidebar form, program icons)
│   ├── modals.css         (All modal dialogs)
│   ├── controls.css       (Zoom, toggles, filters, segmented)
│   ├── features.css       (Telegram, dashboard, afisha)
│   ├── dark-mode.css      (Dark theme overrides)
│   └── responsive.css     (Media queries: 1024/768/480)
│
├── tests/
│   └── api.test.js        (157 тестів)
└── images/
    └── logo-new.png
```

---

## 4. DESIGN SYSTEM (base.css tokens)

```css
/* Primary — emerald park theme */
--primary: #10B981;
--primary-dark: #059669;
--primary-light: #D1FAE5;
--primary-50: #ECFDF5;

/* Categories */
--quest: #8B5CF6;      /* фіолетовий */
--animation: #3B82F6;  /* синій */
--show: #F97316;       /* оранжевий */
--masterclass: #84CC16;/* зелений-лайм */
--pinata: #EC4899;     /* рожевий */
--photo: #06B6D4;      /* бірюзовий */
--custom: #64748B;     /* сірий */

/* Semantic */
--success: #10B981;  --warning: #F59E0B;  --danger: #EF4444;

/* Typography */
--font-xs: 11px; --font-sm: 13px; --font-base: 14px;
--font-md: 15px; --font-lg: 17px; --font-xl: 20px;

/* Breakpoints (responsive.css) */
/* 1024px — tablet, 768px — mobile, 480px — small mobile */
```

---

## 5. DATABASE SCHEMA

```sql
-- Bookings (основна таблиця)
bookings (
    id VARCHAR(50) PRIMARY KEY,           -- BK-2026-0001
    date VARCHAR(20) NOT NULL,            -- '2026-02-07'
    time VARCHAR(10) NOT NULL,            -- '14:00'
    line_id VARCHAR(100) NOT NULL,        -- animator line
    program_id VARCHAR(50),
    program_code VARCHAR(20),
    label VARCHAR(100),
    program_name VARCHAR(100),
    category VARCHAR(50),
    duration INTEGER,
    price INTEGER,
    hosts INTEGER,
    second_animator VARCHAR(100),
    pinata_filler VARCHAR(50),
    room VARCHAR(100),
    notes TEXT,
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    linked_to VARCHAR(50),                -- FK to other booking
    status VARCHAR(20) DEFAULT 'confirmed', -- confirmed|preliminary
    kids_count INTEGER,
    costume VARCHAR(100),
    updated_at TIMESTAMP DEFAULT NOW(),
    group_name VARCHAR(100),
    telegram_message_id INTEGER
)

-- Lines (аніматори на дату)
lines_by_date (
    id SERIAL PRIMARY KEY,
    date VARCHAR(20) NOT NULL,
    line_id VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20),
    from_sheet BOOLEAN DEFAULT FALSE,
    UNIQUE(date, line_id)
)

-- History (audit log)
history (
    id SERIAL PRIMARY KEY,
    action VARCHAR(20) NOT NULL,     -- create|edit|delete|undo
    username VARCHAR(50),
    data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
)

-- Users
users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',  -- admin|user|viewer
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
)

-- Settings (key-value store)
settings (key VARCHAR(100) PRIMARY KEY, value TEXT)

-- Afisha (public events)
afisha (
    id SERIAL PRIMARY KEY,
    date VARCHAR(20) NOT NULL,
    time VARCHAR(10) NOT NULL,
    title VARCHAR(200) NOT NULL,
    duration INTEGER DEFAULT 60,
    created_at TIMESTAMP DEFAULT NOW()
)

-- Telegram
telegram_known_chats (chat_id BIGINT PK, title, type, updated_at)
telegram_known_threads (thread_id INT, chat_id BIGINT, title, updated_at)

-- Booking counter
booking_counter (year INTEGER PK, counter INTEGER DEFAULT 0)

-- Pending animators
pending_animators (id SERIAL PK, date, note, status DEFAULT 'pending', created_at)
```

---

## 6. ДЕФОЛТНІ КОРИСТУВАЧІ

```
Vitalina / Vitalina109  — role: user   — Віталіна
Dasha    / Dasha743      — role: user   — Даша
Natalia  / Natalia875    — role: admin  — Наталія
Sergey   / Sergey232     — role: admin  — Сергій
Animator / Animator612   — role: viewer — Аніматор
```

**Тестовий користувач** (для `tests/api.test.js`): `admin / admin123`

---

## 7. ПРОГРАМИ (js/config.js — 37 програм)

### Квести (quest)
| id | code | duration | price | hosts | age |
|----|------|----------|-------|-------|-----|
| kv1 | КВ1 | 60 хв | 2200₴ | 1 | 5-10р |
| kv4 | КВ4 | 60 хв | 2800₴ | 2 | 5-12р |
| kv5 | КВ5 | 60 хв | 2700₴ | 2 | 3-7р |
| kv6 | КВ6 | 90 хв | 2100₴ | 1 | 4-10р |
| kv7 | КВ7 | 60 хв | 3300₴ | 2 | 5-12р |
| kv8 | КВ8 | 60 хв | 2900₴ | 2 | 6-12р |
| kv9 | КВ9 | 60 хв | 2500₴ | 2 | 4-10р |
| kv10 | КВ10 | 60 хв | 3000₴ | 2 | 5-16р |
| kv11 | КВ11 | 60 хв | 2500₴ | 2 | 5-12р |

### Анімація (animation)
| anim60 | АН | 60 хв | 1500₴ | 1 | 3-9р |
| anim120 | АН | 120 хв | 2500₴ | 1 | 3-9р |

### Шоу (show)
| bubble | Бульб | 30 хв | 2400₴ | 1 | 2-6р |
| neon_bubble | Неон | 30 хв | 2700₴ | 1 | 2-8р |
| paper | Папір | 30 хв | 2900₴ | 2 | 4-12р |
| dry_ice | Лід | 40 хв | 4400₴ | 1 | 4-10р |
| football | Футб | 90 хв | 3800₴ | 1 | 5-12р |
| mafia | Мафія | 90 хв | 2700₴ | 1 | 4-10р |

### Фото (photo)
| photo60 | Фото | 60 хв | 1600₴ | 1 |
| photo_magnets | Фото+ | 60 хв | 2600₴ | 1 |
| photo_magnet_extra | Магн | 0 | 290₴/дит | 0 | perChild |
| video | Відео | 0 | 6000₴ | 0 | videoType: highlight |

### Майстер-класи (masterclass) — всі perChild
| mk_candy | МК | 90 хв | 370₴/дит | Цукерки |
| mk_thermomosaic | МК | 45 хв | 390₴/дит | Термомозаїка |
| mk_slime | МК | 45 хв | 390₴/дит | Слайми |
| mk_tshirt | МК | 90 хв | 450₴/дит | Розпис футболок |
| mk_cookie | МК | 60 хв | 300₴/дит | Розпис пряників |
| mk_ecobag | МК | 75 хв | 390₴/дит | Еко-сумки |
| mk_pizza_classic | МК | 45 хв | 290₴/дит | Класична піца |
| mk_pizza_custom | МК | 45 хв | 430₴/дит | Кастомна піца |
| mk_cakepops | МК | 90 хв | 330₴/дит | Кейк-попси |
| mk_cupcake | МК | 120 хв | 450₴/дит | Капкейки |
| mk_soap | МК | 90 хв | 450₴/дит | Миловаріння |

### Піньяти (pinata)
| pinata | Пін | 15 хв | 700₴ | 1 | hasFiller |
| pinata_custom | ПінН | 15 хв | 1000₴ | 1 | hasFiller |

### Інше (custom)
| custom | Інше | 30 хв | 0₴ | 1 | isCustom |

---

## 8. КІМНАТИ (14 шт)

Великий зал, Мала зала, Кімната 1, Кімната 2, Кімната 3, Кімната 4, Кімната 5, Кімната 6, Зелена кімната, Кімната УФ, Тераса, Двір, Кухня, Без кімнати

---

## 9. КОСТЮМИ (28 шт)

Супер Кіт, Леді Баг, Тік-ток ведучий чорн, Тік-ток ведучий син, Майнкрафт Кріпер, Піратка 2, Пірат 1, Ельза, Студент Ґоґвортса, Ліло, Стіч, Єдиноріжка, Поняшка, Ютуб, Людина-павук, Neon-party 1, Neon-party 2, Супермен, Бетмен, Мавка, Лукаш, Чейз, Скай, Венсдей, Монстер Хай, Лялька рожева LOL, Барбі, Роблокс

---

## 10. API ENDPOINTS

### Auth
- `POST /api/auth/login` — { username, password } → { token, user }
- `POST /api/auth/register` — { username, password, name, role }

### Bookings
- `GET /api/bookings?date=YYYY-MM-DD` — всі на дату
- `POST /api/bookings` — створити
- `POST /api/bookings/full` — створити з linked bookings
- `PUT /api/bookings/:id` — оновити
- `DELETE /api/bookings/:id` — м'яке видалення
- `POST /api/bookings/:id/time-shift` — зсув часу ±15/30/60хв
- `GET /api/bookings/free-rooms?date=&time=&duration=` — вільні кімнати

### Lines
- `GET /api/lines?date=YYYY-MM-DD` — лінії аніматорів на дату
- `POST /api/lines` — створити лінію
- `PUT /api/lines/:id` — оновити
- `DELETE /api/lines/:id` — видалити

### History
- `GET /api/history?action=&username=&from=&to=&page=&limit=` — з фільтрами

### Settings
- `GET /api/stats?date=` — статистика дня
- `GET /api/settings` — всі налаштування
- `PUT /api/settings` — оновити
- `GET /api/rooms` — список кімнат
- `GET /api/health` — health check

### Afisha
- `GET /api/afisha?date=` — публічні події
- `POST /api/afisha` — створити
- `PUT /api/afisha/:id` — оновити
- `DELETE /api/afisha/:id` — видалити

### Telegram
- `POST /api/telegram/webhook` — incoming updates
- `GET /api/telegram/status` — bot status
- `POST /api/telegram/test-send` — тестове повідомлення

### Backup
- `GET /api/backup/export` — повний JSON backup
- `POST /api/backup/import` — відновлення з backup

---

## 11. KEY PATTERNS

### Транзакції (КРИТИЧНО!)
```javascript
const client = await pool.connect();
try {
    await client.query('BEGIN');
    // ... operations ...
    await client.query('COMMIT');
    // Telegram notification AFTER commit (fire-and-forget)
} catch (err) {
    await client.query('ROLLBACK');
    throw err;
} finally {
    client.release(); // ОДНОРАЗОВО! Ніколи double release!
}
```

### DB → API mapping
- DB: `snake_case` (program_id, created_at)
- API: `camelCase` (programId, createdAt)
- Конвертація: `mapBookingRow()` в `services/booking.js`

### Версійний bump (3 місця!)
1. `package.json` → `"version": "5.32.0"`
2. `index.html` → всі `?v=5.32` в CSS/JS тегах
3. `index.html` → `<p class="tagline">Система бронювання v5.32</p>`
4. `index.html` → `<button>Що нового у v5.32</button>`
5. Changelog entry в `#changelogModal`

### Cache busting
```html
<link rel="stylesheet" href="css/base.css?v=5.32">
<script src="js/config.js?v=5.32"></script>
```

---

## 12. ENVIRONMENT VARIABLES

```bash
PORT=3000                        # server port
DATABASE_URL=                    # PostgreSQL connection string (Railway auto-sets)
RAILWAY_PUBLIC_DOMAIN=           # auto-set by Railway
TELEGRAM_BOT_TOKEN=              # Telegram bot token
TELEGRAM_DEFAULT_CHAT_ID=        # default chat for notifications
RATE_LIMIT_MAX=100               # rate limit per window (5000 for tests)
```

---

## 13. ТЕСТУВАННЯ

### Запуск тестів
```bash
# Запустити PostgreSQL
pg_ctlcluster 16 main start

# Запустити сервер у фоні
PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node server.js &

# Запустити тести
node --test tests/api.test.js
```

### Тестовий користувач
- Створюється автоматично при першому seed, або:
- `admin / admin123` — для тестів

### Що тестується (157 тестів, 50 suites)
- Auth: login, register, token validation
- Bookings: CRUD, full booking with linked, time-shift, free rooms
- Lines: CRUD per date
- History: with filters and pagination
- Afisha: CRUD
- Settings: stats, rooms
- Static pages: / and /invite
- Unauthenticated access checks

---

## 14. ВИКОНАНІ ВЕРСІЇ (v5.30 — v5.32)

### v5.30 — A11y Foundation (4 зміни)
1. Viewport: прибрано `user-scalable=no` → дозволено масштабування
2. Inputs: `font-size ≥ 16px` на всіх полях → iOS не зумить при фокусі
3. Touch targets: всі кнопки `≥ 44px` (WCAG 2.1 мінімум)
4. Focus-visible: `:focus-visible` на всіх inputs для клавіатурної навігації

### v5.31 — Status Controls & Button Semantics (5 змін)
1. Status radio → segmented control (як День/3 дні/Тиждень)
2. Status filter → такий же segmented стиль (pill background)
3. "Редагувати" → зелена кнопка (було червона як "Видалити")
4. Time shift кнопки → нейтральний outline (замість gradient)
5. btn-status-toggle → чіткий segmented-like стиль
- Прибрано `!important` хаки, консолідовано CSS

### v5.32 — Program Cards & Category Grid (4 зміни)
1. Бейдж тривалості (60', 120') у правому верхньому куті картки
2. Тонші рамки (2px→1px) + м'які кольорові тла категорій
3. Сильніший стан вибору: scale(1.04) + тінь + зелена галочка ✓
4. Мобільні: більші картки (68px), читабельніший текст (9px замість 8px)
- Прибрано `!important` overrides з controls.css → consolidated in panel.css
- Dark mode для бейджів тривалості

---

## 15. ЗАПЛАНОВАНІ ВЕРСІЇ (v5.33 — v5.38)

### v5.33 — Booking Modal Mobile (P0, 4 зміни)

**Чому:** Адміни парку часто бронюють з телефону між подіями. Зараз бокова панель на мобільному має проблеми.

1. **Sticky header (заголовок фіксований зверху)**
   - `position: sticky; top: 0` для `.panel-header`
   - Зараз при скролі форми заголовок зникає — не знаєш де ти
   - **Принцип:** "Spatial orientation" — користувач завжди має бачити назву екрану

2. **Sticky footer з кнопкою "Зберегти"**
   - Кнопка `.btn-submit` фіксована внизу панелі
   - Зараз треба скролити вниз щоб натиснути "Зберегти" (форма довга)
   - **Принцип:** "Primary action always visible" — головна дія має бути доступна без скролу

3. **Scroll lock (фон не скролиться)**
   - `body.panel-open { overflow: hidden }` при відкритій панелі на мобільному
   - Зараз фон за панеллю скролиться — виглядає як баг
   - **Принцип:** "Modal trap" — модальний контент ізолює увагу

4. **Internal scroll для форми**
   - Панель: `display: flex; flex-direction: column`
   - Header/footer fixed, середина scrollable
   - **Принцип:** "Scroll containment" — scroll відбувається тільки всередині форми

**Файли:** css/panel.css, css/responsive.css, js/booking.js (toggle body class), js/ui.js

---

### v5.34 — Responsive Phones (P0, 5-6 змін)

**Чому:** На телефоні 390px toolbar не вміщується в один рядок, timeline обрізається, модалки виходять за межі.

1. **Toolbar wrapping**
   - Control panel: дозволити flex-wrap, логічні групи в рядки
   - Дата + навігація = рядок 1; Zoom + фільтри = рядок 2; Period selector = рядок 3
   - **Принцип:** "Content choreography" — елементи перегруповуються на вужчих екранах

2. **Timeline horizontal overflow**
   - `-webkit-overflow-scrolling: touch` для `.timeline-scroll`
   - Scroll snap на timeline grid
   - **Принцип:** "Horizontal scroll affordance" — горизонтальний скрол має бути очевидним

3. **Full-screen modals на мобільному**
   - `@media (max-width: 480px)` → `.modal-content { max-width: 100%; max-height: 100vh; border-radius: 0; }`
   - **Принцип:** "Mobile-first modal" — на маленькому екрані модалка = весь екран

4. **Date controls compact**
   - На 390px: input[type="date"] зменшити до icon-only або зменшити padding
   - Прибрати day-info на маленьких екранах (вже зроблено на 480px)
   - **Принцип:** "Progressive disclosure" — показуємо менше деталей на менших екранах

5. **390px breakpoint**
   - Новий `@media (max-width: 390px)` для iPhone SE / Samsung Galaxy A03
   - Toolbar buttons: icon-only, мінімальний padding
   - **Принцип:** "Minimum viable viewport" — навіть на 320px все має працювати

6. **Legend (легенда кольорів)**
   - На мобільному легенду згорнути в disclosure або зробити горизонтальний scroll
   - **Принцип:** "Collapsible detail" — рідковживані деталі ховаються

**Файли:** css/responsive.css (основний), css/controls.css, css/modals.css, css/layout.css

---

### v5.35 — Responsive Tablets + Desktop Toolbar (P1, 4 зміни)

**Чому:** На планшеті (768-1024px) і десктопі toolbar займає забагато місця по вертикалі, бокова панель перекриває все.

1. **Tablet sidebar: overlay замість push**
   - На 768-1024px панель бронювання — overlay з backdrop
   - Зараз `width: 100%` — перекриває весь timeline
   - **Принцип:** "Non-blocking panel" — бачити timeline і форму одночасно

2. **Desktop toolbar grouping** — ВІДКРИТЕ ПИТАННЯ:
   - **Варіант A:** Один горизонтальний рядок з separator bars
   - **Варіант B:** Два рядки — дата/навігація зверху, zoom/фільтри знизу
   - **Варіант C:** Sticky sidebar з контролами зліва, timeline справа
   - Потрібно вирішити з замовником перед реалізацією!

3. **Tablet-specific grid**
   - Програмні іконки: 4 в ряд (було 3 на мобільному)
   - Модалки: max-width 90% (не 100% як на телефоні)

4. **Landscape optimization**
   - `@media (orientation: landscape) and (max-height: 500px)` для телефону в landscape
   - Зменшити header, стиснути padding

**Файли:** css/responsive.css, css/panel.css, css/layout.css

---

### v5.36 — Афіша & Історія (P1, 5 змін)

**Чому:** Сторінки Афіші та Історії не оптимізовані для мобільних.

1. **Afisha form mobile**
   - Поля form складаються в стовпець
   - Кнопки "Зберегти" / "Скасувати" — повна ширина
   - **Принцип:** "Single-column mobile forms"

2. **History filters responsive**
   - Фільтри wrap у колонку на < 480px
   - Date range inputs — full width
   - **Принцип:** "Form reflow"

3. **Icon buttons замість текстових**
   - Afisha: ✏️ / 🗑️ замість "Редагувати" / "Видалити" на мобільному
   - Економить горизонтальний простір
   - **Принцип:** "Icon affordance" — загальновідомі іконки не потребують підпису

4. **History pagination touch-friendly**
   - Кнопки ≥ 44px (вже зроблено в v5.30)
   - Можливо swipe для навігації

5. **invite.html responsive**
   - Публічна сторінка-запрошення — перевірити/виправити на мобільному

**Файли:** css/features.css, css/responsive.css, invite.html

---

### v5.37 — Dark Mode & Typography Polish (P2, 4-5 змін)

**Чому:** Dark mode має артефакти (білі плями, невидимий текст), типографіка не консистентна.

1. **Dark mode contrast fixes**
   - Перевірити WCAG AA contrast ratio (4.5:1 для тексту)
   - Borders: `var(--gray-200)` → `var(--gray-600)` у dark mode
   - Backgrounds: прибрати hardcoded `#FFFFFF` → використовувати tokens

2. **Typography scale consistency**
   - Перевірити що всі font-size використовують tokens (не hardcoded)
   - Заголовки: font-weight 800 → consistent across all modals
   - Line-height: 1.4-1.6 для body text, 1.2 для headings

3. **Spacing audit**
   - Margin/padding: послідовна шкала (4, 8, 12, 16, 20, 24, 28)
   - Gap: 4px → tiny, 8px → small, 12px → medium, 16px → large

4. **Dark mode: program cards**
   - Тінти категорій для dark mode (зараз `background: var(--gray-100)` однаковий для всіх)
   - Duration badge — вже зроблено в v5.32

5. **Dark mode: timeline grid**
   - Grid lines, time marks, booking blocks — перевірити контраст

**Файли:** css/dark-mode.css (основний), css/base.css (tokens)

---

### v5.38 — Image Asset Pack (P2, special)

**Чому:** Всі іконки зараз — emoji. Потрібні власні іконки для брендингу.

1. **Інвентаризація всіх іконок**
   - Program icons (37 програм × emoji)
   - Category icons (7 категорій)
   - UI icons (zoom +/-, dark mode toggle, close, delete, edit, undo, navigation arrows)
   - Status icons (confirmed ✓, preliminary ?)

2. **specs.json для генерації**
   - Розміри: 26px (карта програми), 24px (каталог), 20px (мобільний), 16px (booking block)
   - Формат: SVG preferred, PNG @2x fallback
   - Стиль: flat, rounded corners, park-themed color palette

3. **Master prompt для Nano Banano Pro**
   - Описати стиль: flat design, rounded, nature/park theme
   - Кольорова палітра: emerald primary, category colors
   - Consistency: однаковий stroke width, padding, corner radius

**Файли:** specs.json (новий), images/ directory

---

## 16. ПРИНЦИПИ РОБОТИ (для навчання замовника)

### Що вже пояснено:
1. **WCAG 2.1 A11y** — touch targets ≥ 44px, font-size ≥ 16px (iOS zoom), :focus-visible
2. **Семантика кольорів** — зелений = safe, червоний = destructive, сірий = secondary
3. **Segmented control** — для mutually exclusive choices (замість radio buttons)
4. **Progressive disclosure** — не показувати все одразу, розкривати поступово
5. **Visual noise** — тонші рамки = менше шуму, контент стає головним
6. **Affordance** — елемент повинен підказувати як з ним взаємодіяти
7. **Spatial orientation** — завжди знати де ти (sticky headers)

### Що ще потрібно пояснити (v5.33+):
8. **Modal trap** — модальний контент ізолює увагу (scroll lock)
9. **Content choreography** — елементи перегруповуються на вужчих екранах
10. **Mobile-first** — спочатку проектуємо для маленького екрану, потім розширюємо
11. **Design tokens** — кольори, розміри, тіні як змінні (CSS custom properties)

---

## 17. ФОРМАТ РОБОТИ

1. **Великий обсяг → розбити на версії** (3-10 змін кожна)
2. **Погодити перед роботою** — аргументувати кожну зміну
3. **Навчати на прикладах** — "як для організатора свят"
4. **Варіанти A/B/C** — коли є сумніви, пропонувати варіанти
5. **Тести після кожної версії** — 157 тестів повинні проходити
6. **Commit + push** — після кожної версії
7. **Changelog** — додавати в `#changelogModal` в index.html
8. **Мова** — звіти та пояснення українською

---

## 18. GIT WORKFLOW

```bash
# Гілка для розробки
git checkout claude/theme-park-booking-pZL5g

# Після змін
git add <specific files>
git commit -m "v5.33: Description of changes"
git push -u origin claude/theme-park-booking-pZL5g
```

- Продакшн гілка: `claude/theme-park-booking-2sPgC` (Railway auto-deploy)
- НЕ пушити на продакшн гілку без дозволу!

---

## 19. ВІДКРИТІ ПИТАННЯ

1. **v5.35 toolbar grouping** — варіант A, B, або C? (Потрібне рішення замовника)
   - A: Один горизонтальний рядок з separator bars
   - B: Два рядки — дата/навігація зверху, zoom/фільтри знизу
   - C: Sticky sidebar з контролами зліва

---

*Цей документ створено 2026-02-07, версія v5.32.0*
*Для продовження роботи — скопіювати весь цей файл в новий чат як контекст.*
