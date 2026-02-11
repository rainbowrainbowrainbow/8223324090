# ПЛАН: Трансформація Booking System -> Mini-CRM v7.x

> Статус: **ЗАТВЕРДЖЕНИЙ** — старт з v7.0 Каталог MVP
>
> Оновлено: 2026-02-11

---

## 0. Прийняті рішення (Q&A)

| # | Питання | Рішення |
|---|---|---|
| 1 | Clawd Bot | Бот вже існує, потрібен API. **Окремий бот-токен** (не той що сповіщення) |
| 2 | Seed каталогу | **Автоматичний seed** 40 продуктів при `initDatabase()` |
| 3 | Підрядники — хто | **Різні типи**: аніматори, постачальники МК, фотографи та інші |
| 4 | К-ть підрядників | **До 10** на старті — простий список без пошуку |
| 5 | Навігація | **Модалки** (як Dashboard/History), не окремі вкладки |
| 6 | Автозамовлення | **Telegram бот** — бот надсилає повідомлення підряднику з підтвердженням |
| 7 | Видимість задач | User бачить **тільки свої** (assigned_to=себе), admin/manager — **всі** |
| 8 | Роль manager | **Так, нова роль** між admin і user |
| 9 | Типи задач | **Розширений фіксований набір**: Замовлення, Підготовка, Закупка, Зв'язок з клієнтом, Доставка, Ремонт, Прибирання, Фото/Відео, Інше |
| 10 | Ціна при зміні | **Оновлювати всі** бронювання з цим продуктом (включаючи минулі) |
| 11 | Клієнтська база | **Не потрібно поки** — залишаємо notes/group_name |
| 12 | Старт | **v7.0 Каталог MVP** |

---

## 1. Резюме: що будуємо і чому так

**Зараз:** Система бронювання з таймлайном аніматорів, де продукти (програми) захардкоджені в `js/config.js` як масив `PROGRAMS`. Немає клієнтської бази, немає підрядників, немає задачника. Ціни/назви дублюються в кожному бронюванні.

**Будуємо:** Mini-CRM з 3 новими модулями:

1. **Product Catalog** — єдине джерело правди для продуктів (зараз в JS -> переносимо в DB)
2. **Contractors** — реєстр підрядників з прив'язкою до послуг і авто-замовленням
3. **Task Manager** — задачі зв'язані з бронюваннями, підрядниками, процесами

**Чому так:** Поточна архітектура (продукти в JS, без клієнтів, без задач) не масштабується. Парк росте — потрібен контроль над каталогом, підрядниками і процесами з одного місця.

---

## 2. IA / Навігація: повна мапа

### Головна навігація — модалки (як Dashboard/History)

```
├── Таймлайн (існуючий, основний екран)
├── Меню (існуючий dropdown)
│   ├── Історія
│   ├── Дайджест
│   ├── Афіша
│   ├── Каталог продуктів (НОВА МОДАЛКА)
│   ├── Підрядники (НОВА МОДАЛКА, v7.2)
│   ├── Задачник (НОВА МОДАЛКА, v7.3)
│   ├── Статистика
│   └── Налаштування
```

**UI-підхід:** Нові розділи відкриваються як великі модалки з існуючого dropdown-меню. Таймлайн залишається основним екраном. Без додаткових вкладок.

---

## 3. Дані: сутності, поля, зв'язки

### 3.1 Нові таблиці

#### products (Каталог продуктів — source of truth)

```sql
CREATE TABLE products (
    id VARCHAR(50) PRIMARY KEY,         -- 'kv1', 'an60', etc.
    code VARCHAR(20) NOT NULL,          -- 'КВ1', 'АН(60)'
    label VARCHAR(100) NOT NULL,        -- 'КВ1(60)'
    name VARCHAR(200) NOT NULL,         -- 'Легендарний тренд'
    icon VARCHAR(10),                   -- emoji
    category VARCHAR(50) NOT NULL,      -- quest/animation/show/...
    duration INTEGER NOT NULL,          -- minutes
    price INTEGER NOT NULL DEFAULT 0,   -- UAH (base price)
    hosts INTEGER NOT NULL DEFAULT 1,   -- animators needed
    age_range VARCHAR(30),              -- '5-10р'
    kids_capacity VARCHAR(30),          -- '4-10'
    description TEXT,
    is_per_child BOOLEAN DEFAULT FALSE, -- masterclass pricing
    has_filler BOOLEAN DEFAULT FALSE,   -- piñata
    is_custom BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,     -- active/inactive toggle
    sort_order INTEGER DEFAULT 0,       -- ordering within category
    tags TEXT[],                         -- PostgreSQL array
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    updated_by VARCHAR(50)              -- who last changed (bot/admin)
);
```

#### product_audit (Аудит змін каталогу — v7.1)

```sql
CREATE TABLE product_audit (
    id SERIAL PRIMARY KEY,
    product_id VARCHAR(50) NOT NULL,
    action VARCHAR(20) NOT NULL,        -- 'create','update','deactivate'
    field_changed VARCHAR(50),          -- 'price', 'name', etc.
    old_value TEXT,
    new_value TEXT,
    changed_by VARCHAR(50) NOT NULL,    -- 'admin-bot', 'system'
    changed_at TIMESTAMP DEFAULT NOW()
);
```

#### contractors (Підрядники — v7.2)

```sql
CREATE TABLE contractors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(50),                   -- 'animator','supplier','photographer','other'
    contact_phone VARCHAR(50),
    contact_telegram VARCHAR(100),
    contact_email VARCHAR(200),
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### contractor_services (Зв'язок підрядник <-> послуга — v7.2)

```sql
CREATE TABLE contractor_services (
    id SERIAL PRIMARY KEY,
    contractor_id INTEGER REFERENCES contractors(id) ON DELETE CASCADE,
    product_id VARCHAR(50) REFERENCES products(id),
    service_type VARCHAR(100),          -- якщо послуга не з каталогу
    price_override INTEGER,             -- ціна підрядника (може відрізнятись)
    is_default BOOLEAN DEFAULT FALSE,   -- підрядник за замовчуванням
    notes TEXT
);
```

#### contractor_auto_rules (Правила автозамовлення — v7.4)

```sql
CREATE TABLE contractor_auto_rules (
    id SERIAL PRIMARY KEY,
    contractor_id INTEGER REFERENCES contractors(id) ON DELETE CASCADE,
    trigger_type VARCHAR(50) NOT NULL,  -- 'booking_created','booking_confirmed','manual'
    condition_category VARCHAR(50),     -- 'quest','show', NULL = будь-яка
    condition_min_price INTEGER,        -- мін. ціна для тригеру
    action_type VARCHAR(50) NOT NULL,   -- 'notify_telegram','create_task','auto_assign'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### tasks (Задачник — v7.3)

```sql
CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(300) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL DEFAULT 'other',
        -- 'order' (Замовлення підрядника)
        -- 'preparation' (Підготовка кімнати)
        -- 'purchase' (Закупка матеріалів)
        -- 'client_contact' (Зв'язок з клієнтом)
        -- 'delivery' (Доставка)
        -- 'repair' (Ремонт)
        -- 'cleaning' (Прибирання)
        -- 'media' (Фото/Відео)
        -- 'other' (Інше)
    status VARCHAR(20) DEFAULT 'pending', -- pending/in_progress/done/cancelled
    priority VARCHAR(10) DEFAULT 'normal',-- low/normal/high/urgent
    assigned_to VARCHAR(50),              -- username
    due_date VARCHAR(20),                 -- YYYY-MM-DD
    due_time VARCHAR(10),                 -- HH:MM
    -- зв'язки
    booking_id VARCHAR(50),               -- зв'язок із бронюванням
    contractor_id INTEGER REFERENCES contractors(id),
    product_id VARCHAR(50) REFERENCES products(id),
    -- мета
    trigger_type VARCHAR(50),             -- 'manual','auto_booking','auto_rule'
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);
```

#### task_comments (Коментарі до задач — v7.3)

```sql
CREATE TABLE task_comments (
    id SERIAL PRIMARY KEY,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    author VARCHAR(50) NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 3.2 Зміни існуючих таблиць

```sql
-- users: додаємо роль manager
-- Поточні ролі: 'admin', 'user', 'viewer'
-- Нова роль: 'manager' (між admin і user)
-- Додається в v7.5
```

> **Примітка:** client_name/client_phone на bookings — НЕ додаємо поки (рішення Q&A #11).

### 3.3 Схема зв'язків

```
products ────────── 1:N ── contractor_services ── N:1 ── contractors
    │                                                        │
    │ 1:N                                                    │ 1:N
    ↓                                                        ↓
bookings <── N:1 ── products               contractor_auto_rules
    │
    │ 1:N
    ↓
  tasks ── N:1 ── contractors
    │
    │ 1:N
    ↓
task_comments
```

### 3.4 Оновлення цін (рішення Q&A #10)

При зміні ціни продукту в каталозі — **всі бронювання** з цим `program_id` оновлюють `price`:

```sql
UPDATE bookings SET price = :new_price, updated_at = NOW()
WHERE program_id = :product_id;
```

---

## 4. Права доступу: матриця

| Дія | admin-bot | admin | manager (new) | user | viewer |
|---|---|---|---|---|---|
| **Каталог продуктів** | | | | | |
| Читати каталог | v | v | v | v | v |
| Створити/редагувати продукт | v | - | - | - | - |
| Деактивувати продукт | v | - | - | - | - |
| Бачити аудит змін | v | v | v | - | - |
| **Підрядники** | | | | | |
| Список підрядників | v | v | v | - | - |
| Додати/редагувати підрядника | v | v | v | - | - |
| Налаштувати автозамовлення | v | v | - | - | - |
| **Задачник** | | | | | |
| Бачити всі задачі | v | v | v | - | - |
| Бачити свої задачі | v | v | v | v | - |
| Створити задачу | v | v | v | v | - |
| Змінити статус задачі | v | v | v | v* | - |
| Видалити задачу | v | v | - | - | - |
| **Бронювання (без змін)** | | | | | |
| CRUD бронювань | v | v | v | v | - |
| **Налаштування** | | | | | |
| Системні налаштування | v | v | - | - | - |

> *user може змінити статус лише задачі, де `assigned_to` = себе

**admin-bot** — спеціальна роль для API-доступу через Clawd бота (окремий токен). Єдиний, хто може міняти каталог.

---

## 5. Інтеграція ботів

### 5.1 Існуючий Telegram Bot (залишається)

- Сповіщення про бронювання — без змін
- Дайджест/нагадування — без змін
- Бекап — без змін

### 5.2 Clawd Bot (окремий бот-токен)

**Ендпоїнти для бота:**

```
POST /api/products          — Створити продукт (admin-bot only)
PUT  /api/products/:id      — Оновити продукт (admin-bot only)
PATCH /api/products/:id/deactivate — Деактивувати (admin-bot only)
GET  /api/products          — Список продуктів (будь-хто)
GET  /api/products/:id      — Деталі продукту (будь-хто)
```

**Аутентифікація бота:**

- Окремий env: `CLAWD_BOT_TOKEN` (Telegram token) + `CLAWD_API_KEY` (API key)
- Header: `X-Bot-Token: <CLAWD_API_KEY>`
- Rate limit: 100 req/min
- Role: `admin-bot`

**Схема взаємодії:**

```
Clawd Bot → POST /api/products { name, price, ... }
         → Header: X-Bot-Token: <secret>
         → 200 { product } + audit record created
         → Telegram notification (через свій токен): "Каталог оновлено: [product_name]"
```

**Події/тригери для бота:**

- `product.created` -> Telegram: "Новий продукт додано"
- `product.updated` -> Telegram: "Ціну/назву змінено" + оновлення всіх бронювань
- `product.deactivated` -> Telegram: "Продукт деактивовано"
- `booking.created` + `contractor_auto_rule` match -> Telegram підряднику через Clawd бота
- `task.overdue` -> Telegram warning

---

## 6. UX-логіка: ключові екрани і сценарії

### 6.1 Каталог продуктів (модалка)

- **Список:** Картки по категоріях (7 категорій). Кожна картка: іконка, назва, ціна, тривалість, статус (active/inactive)
- **Для звичайних юзерів:** тільки перегляд (кнопки edit відсутні)
- **Для admin-bot:** PUT/POST через API, не через UI
- **Edge case:** Продукт деактивовано, але є активні бронювання -> показувати попередження, не блокувати
- **Відкриття:** через dropdown-меню -> "Каталог продуктів"

### 6.2 Підрядники (модалка, v7.2)

- **Список:** Простий список (до 10 підрядників), без пошуку/фільтрів
- **Картка:** Контактна інфо + тип (аніматор/постачальник/фотограф/інше) + список послуг
- **Сценарій автозамовлення:** Бронювання створено -> перевірка правил -> Telegram підряднику через Clawd бота
- **Edge case:** Підрядник прив'язаний до деактивованого продукту -> показувати warning

### 6.3 Задачник (модалка, v7.3)

- **Список:** Фільтри по статусу, типу задачі, assigned_to
- **Типи:** Замовлення | Підготовка | Закупка | Зв'язок з клієнтом | Доставка | Ремонт | Прибирання | Фото/Відео | Інше
- **Видимість:** user бачить тільки свої (assigned_to=себе), admin/manager бачать всі
- **Kanban (v7.4):** 3 колонки (Pending | In Progress | Done)
- **Автостворення (v7.4):** При бронюванні + contractor_auto_rule -> задача автоматично
- **Edge case:** Бронювання видалено -> зв'язана задача отримує warning "Бронювання скасовано"

### 6.4 Booking Panel (зміни в v7.0)

- Програми завантажуються з `GET /api/products?active=true` замість JS масиву `PROGRAMS`
- **Fallback:** якщо API недоступне, використовувати кешований `PROGRAMS` (backward compatibility)

---

## 7. Міграція і сумісність

### 7.1 Етапи міграції (v7.0)

**Крок 1:** Створити таблицю `products` і автоматично seed з `PROGRAMS`

```sql
-- При initDatabase() — INSERT IF NOT EXISTS для кожного з 40 продуктів
INSERT INTO products (id, code, label, name, category, duration, price, hosts, ...)
VALUES ('kv1', 'КВ1', 'КВ1(60)', 'Легендарний тренд', 'quest', 60, 2200, 1, ...)
ON CONFLICT (id) DO NOTHING;
```

**Крок 2:** API `GET /api/products` — read-only

- GET повертає з DB
- Frontend переходить з `PROGRAMS` масиву на `fetch('/api/products')`
- `PROGRAMS` в `config.js` стає fallback

**Крок 3:** Booking panel — динамічне завантаження

- `renderProgramIcons()` отримує дані через API замість глобального масиву
- Кешування: `AppState.products` з TTL 5 хвилин

### 7.2 Backward Compatibility

- `js/config.js` `PROGRAMS` залишається як fallback до повної міграції
- Бронювання зберігають `program_name`, `price`, `duration` в своєму рядку (денормалізовано)
- При зміні ціни в каталозі — **всі** бронювання з цим product_id оновлюються (рішення Q&A #10)
- Існуючі бронювання НЕ мігруються — вони вже містять всі дані

---

## 8. Ризики та мітигація

| # | Ризик | Вплив | Мітигація |
|---|---|---|---|
| 1 | Розсинхрон `PROGRAMS` <-> `products` table | Дані в JS і DB відрізняються | Seed скрипт з `ON CONFLICT DO NOTHING`, видалити `PROGRAMS` після повної міграції |
| 2 | Зламається booking panel | Юзери не можуть створити бронювання | Fallback на `PROGRAMS` масив, поступова міграція |
| 3 | Admin-bot отримує необмежений доступ | Помилковий bot request може зіпсувати каталог | Audit log, rate limiting, validation rules, rollback через `product_audit` |
| 4 | Каскадна деактивація продукту | Існуючі бронювання "зламаються" | Бронювання зберігають snapshot даних, деактивація не впливає |
| 5 | Перевантаження DB запитами | Кожне відкриття панелі = запит products | Кешування `AppState.products` з TTL 5 хв |
| 6 | Підрядник не відповідає | Автозамовлення створено, але без підтвердження | Задача "pending" + нагадування через N годин |
| 7 | Task manager стає "смітником" | Автоматичні задачі накопичуються | Auto-close через 30 днів, архівація |
| 8 | Міграція зламає тести | 157 тестів можуть впасти | Міграція в `initDatabase()`, тести перевіряють обидва шляхи |
| 9 | Оновлення цін зачіпає минулі бронювання | Історичні дані змінюються | Audit log фіксує зміни, product_audit зберігає old/new |
| 10 | Конфлікт прав: bot vs admin | Адмін хоче змінити ціну, але може тільки bot | Чітка комунікація в UI |
| 11 | Втрата даних при restore backup | Нові таблиці не включені в backup | Розширити `backup.js` (v7.5) |
| 12 | Race condition при автозамовленні | Дублікат задач | Idempotency: одна задача на `booking_id` + `contractor_id` |

---

## 9. План релізу по ітераціях

### MVP — v7.0 (Каталог продуктів) <-- СТАРТ

- [ ] Створити таблицю `products` + auto seed з `PROGRAMS` при `initDatabase()`
- [ ] `GET /api/products` endpoint (read-only)
- [ ] `GET /api/products/:id` endpoint
- [ ] Frontend: завантажувати продукти з API (з fallback на PROGRAMS)
- [ ] Модалка "Каталог" — read-only перегляд по категоріях
- [ ] Пункт "Каталог" в dropdown-меню
- [ ] Міграція booking panel на динамічні продукти
- [ ] Кешування `AppState.products` з TTL 5 хв
- [ ] 157+ тестів проходять
- [ ] Існуючі бронювання працюють без змін

### v7.1 (Admin-Bot + Audit)

- [ ] POST/PUT/PATCH `/api/products` — admin-bot only
- [ ] `product_audit` таблиця + логування
- [ ] Bot auth middleware (`X-Bot-Token` header)
- [ ] Env: `CLAWD_BOT_TOKEN`, `CLAWD_API_KEY`
- [ ] При оновленні ціни — UPDATE всіх бронювань з цим product_id
- [ ] Telegram сповіщення через Clawd бота про зміни каталогу

### v7.2 (Підрядники)

- [ ] Таблиці `contractors`, `contractor_services`
- [ ] CRUD API для підрядників
- [ ] Модалка "Підрядники" — простий список (до 10)
- [ ] Типи: animator, supplier, photographer, other
- [ ] Прив'язка підрядників до продуктів

### v7.3 (Задачник MVP)

- [ ] Таблиця `tasks` + `task_comments`
- [ ] CRUD API для задач
- [ ] Модалка "Задачник" — список + фільтри по статусу/типу
- [ ] 9 фіксованих типів задач
- [ ] Ручне створення задач
- [ ] Видимість: user=тільки свої, admin/manager=всі

### v7.4 (Автоматизація)

- [ ] `contractor_auto_rules` таблиця
- [ ] Тригери при створенні бронювання
- [ ] Автостворення задач
- [ ] Telegram нотифікації підрядникам через Clawd бота
- [ ] Kanban-вид задачника (3 колонки)

### v7.5 (Polish)

- [ ] Роль `manager` в users table
- [ ] Backup розширено для нових таблиць
- [ ] Dashboard розширено статистикою підрядників/задач

---

## 10. Фіксовані типи задач

| Ключ | Назва (UK) | Іконка |
|---|---|---|
| `order` | Замовлення підрядника | - |
| `preparation` | Підготовка кімнати | - |
| `purchase` | Закупка матеріалів | - |
| `client_contact` | Зв'язок з клієнтом | - |
| `delivery` | Доставка | - |
| `repair` | Ремонт | - |
| `cleaning` | Прибирання | - |
| `media` | Фото/Відео | - |
| `other` | Інше | - |
