# ПЛАН: Трансформація Booking System -> Mini-CRM v7.x

> Статус: **НЕ ЗАТВЕРДЖЕНИЙ** — імплементація не починалась.
>
> Оновлено: 2026-02-11

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

### Головна навігація (tabs/pages)

```
├── Таймлайн (існуючий, без змін)
├── Каталог продуктів (НОВА)
│   ├── Список продуктів (по категоріях)
│   ├── Картка продукту (view / edit для admin-bot)
│   └── Історія змін каталогу
├── Підрядники (НОВА)
│   ├── Список підрядників
│   ├── Картка підрядника (контакти, послуги, правила)
│   └── Правила автозамовлення
├── Задачник (НОВА)
│   ├── Список задач (фільтри: статус, відповідальний, дедлайн)
│   ├── Картка задачі (деталі, зв'язки, коментарі)
│   └── Kanban-вид (pending -> in_progress -> done)
├── Меню (існуючий dropdown)
│   ├── Історія
│   ├── Дайджест
│   ├── Афіша
│   ├── Програми (deprecated -> redirect на Каталог)
│   ├── Статистика
│   └── Налаштування
```

**UI-підхід:** Tab bar під header (Таймлайн | Каталог | Підрядники | Задачник) — кожна вкладка = свій view у тому ж SPA. Контент рендериться в `#mainContent` area. Таймлайн залишається основним екраном.

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

#### product_audit (Аудит змін каталогу)

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

#### contractors (Підрядники)

```sql
CREATE TABLE contractors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    contact_phone VARCHAR(50),
    contact_telegram VARCHAR(100),
    contact_email VARCHAR(200),
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### contractor_services (Зв'язок підрядник <-> послуга)

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

#### contractor_auto_rules (Правила автозамовлення)

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

#### tasks (Задачник)

```sql
CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(300) NOT NULL,
    description TEXT,
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

#### task_comments (Коментарі до задач)

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
-- bookings: додаємо зв'язок із клієнтом (опціонально, на майбутнє)
ALTER TABLE bookings ADD COLUMN client_name VARCHAR(200);
ALTER TABLE bookings ADD COLUMN client_phone VARCHAR(50);
```

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
| Бачити всі задачі | v | v | v | v | - |
| Створити задачу | v | v | v | v | - |
| Змінити статус задачі | v | v | v | v* | - |
| Видалити задачу | v | v | - | - | - |
| **Бронювання (без змін)** | | | | | |
| CRUD бронювань | v | v | v | v | - |
| **Налаштування** | | | | | |
| Системні налаштування | v | v | - | - | - |

> *user може змінити статус лише задачі, де `assigned_to` = себе

**admin-bot** — спеціальна роль для API-доступу через бота (JWT з `role: 'admin-bot'`). Єдиний, хто може міняти каталог.

---

## 5. Інтеграція ботів

### 5.1 Існуючий Telegram Bot (залишається)

- Сповіщення про бронювання — без змін
- Дайджест/нагадування — без змін
- Бекап — без змін

### 5.2 Новий: Admin-Bot API (Clawd bot)

**Ендпоїнти для бота:**

```
POST /api/products          — Створити продукт (admin-bot only)
PUT  /api/products/:id      — Оновити продукт (admin-bot only)
PATCH /api/products/:id/deactivate — Деактивувати (admin-bot only)
GET  /api/products          — Список продуктів (будь-хто)
GET  /api/products/:id      — Деталі продукту (будь-хто)
```

**Аутентифікація бота:**

- Окремий JWT з `role: 'admin-bot'` + `bot_name: 'clawd'`
- Або API-key в header: `X-Bot-Token: <secret>`
- Rate limit: 100 req/min

**Схема взаємодії:**

```
Clawd Bot → POST /api/products { name, price, ... }
         → 200 { product } + audit record created
         → Telegram notification: "Каталог оновлено: [product_name]"
```

**Події/тригери для бота:**

- `product.created` -> Telegram: "Новий продукт додано"
- `product.updated` -> Telegram: "Ціну/назву змінено"
- `product.deactivated` -> Telegram: "Продукт деактивовано"
- `booking.created` + `contractor_auto_rule` match -> auto-create task / notify contractor
- `task.overdue` -> Telegram warning

### 5.3 Webhook Events (для зовнішніх інтеграцій, майбутнє)

```
POST /api/webhooks/subscribe   — підписка на події
POST /api/webhooks/unsubscribe — відписка
```

---

## 6. UX-логіка: ключові екрани і сценарії

### 6.1 Каталог продуктів

- **Список:** Таблиця/картки по категоріях. Кожна картка: іконка, назва, ціна, тривалість, статус (active/inactive)
- **Для звичайних юзерів:** тільки перегляд (кнопки edit відсутні)
- **Для admin-bot:** PUT/POST через API, не через UI
- **Edge case:** Продукт деактивовано, але є активні бронювання -> показувати попередження, не блокувати

### 6.2 Підрядники

- **Список:** Таблиця з іменем, телефоном, к-кістю послуг, статусом
- **Картка:** Контактна інфо + список послуг (прив'язаних продуктів) + правила автозамовлення
- **Сценарій автозамовлення:** Бронювання створено -> перевірка правил -> створити задачу "Замовити [підрядник] на [дата]"
- **Edge case:** Підрядник прив'язаний до деактивованого продукту -> показувати warning

### 6.3 Задачник

- **Список:** Фільтри по статусу, assigned_to, зв'язку (бронювання/підрядник)
- **Kanban:** 3 колонки (Pending | In Progress | Done)
- **Автостворення:** При бронюванні, якщо є `contractor_auto_rule` -> задача створюється автоматично
- **Edge case:** Бронювання видалено -> зв'язана задача отримує warning "Бронювання скасовано"

### 6.4 Booking Panel (зміни)

- Програми завантажуються з `GET /api/products?active=true` замість JS масиву `PROGRAMS`
- **Fallback:** якщо API недоступне, використовувати кешований `PROGRAMS` (backward compatibility)

---

## 7. Міграція і сумісність

### 7.1 Етапи міграції

**Крок 1:** Створити таблицю `products` і наповнити з `PROGRAMS`

```sql
-- Seed скрипт: перенести 40 продуктів з js/config.js → products table
INSERT INTO products (id, code, label, name, ...) VALUES ('kv1', 'КВ1', ...);
```

**Крок 2:** API `/api/products` — read-only спочатку

- GET повертає з DB
- Frontend переходить з `PROGRAMS` масиву на `fetch('/api/products')`
- `PROGRAMS` в `config.js` стає fallback

**Крок 3:** Booking panel — динамічне завантаження

- `renderProgramIcons()` отримує дані через API замість глобального масиву
- Кешування: `AppState.products` з TTL 5 хвилин

**Крок 4:** Admin-bot write endpoints

- POST/PUT/PATCH для каталогу
- Audit logging

**Крок 5:** Нові таблиці `contractors` + `tasks`

- Без впливу на існуючий функціонал

### 7.2 Backward Compatibility

- `js/config.js` `PROGRAMS` залишається як fallback до повної міграції
- Бронювання зберігають `program_name`, `price`, `duration` в своєму рядку (денормалізовано) — це правильно, бо ціна на момент бронювання може відрізнятись від поточної
- Існуючі бронювання НЕ мігруються — вони вже містять всі дані

---

## 8. Ризики та мітигація

| # | Ризик | Вплив | Мітигація |
|---|---|---|---|
| 1 | Розсинхрон `PROGRAMS` <-> `products` table | Дані в JS і DB відрізняються | Seed скрипт з валідацією, видалити `PROGRAMS` після повної міграції |
| 2 | Зламається booking panel | Юзери не можуть створити бронювання | Fallback на `PROGRAMS` масив, поступова міграція |
| 3 | Admin-bot отримує необмежений доступ | Помилковий bot request може зіпсувати каталог | Audit log, rate limiting, validation rules, rollback через `product_audit` |
| 4 | Каскадна деактивація продукту | Існуючі бронювання "зламаються" | Бронювання зберігають snapshot ціни/назви, деактивація не впливає на них |
| 5 | Перевантаження DB запитами | Кожне відкриття панелі = запит products | Кешування `AppState.products` з TTL, кеш інвалідація при оновленні |
| 6 | Підрядник не відповідає | Автозамовлення створено, але без підтвердження | Задача отримує статус "pending" + нагадування через N годин |
| 7 | Task manager стає "смітником" | Автоматичні задачі накопичуються | Auto-close задач через 30 днів, архівація, фільтри |
| 8 | Міграція зламає тести | 157 тестів можуть впасти | Міграція DB в `initDatabase()`, тести перевіряють обидва шляхи |
| 9 | Навігація стає складною | 4 вкладки замість 1 екрану | Progressive disclosure, таймлайн залишається default view |
| 10 | Конфлікт прав: bot vs admin | Адмін хоче змінити ціну, але може тільки bot | Чітка комунікація в UI: "Каталог редагується через бота", документація |
| 11 | Втрата даних при restore backup | Нові таблиці не включені в backup | Розширити `backup.js` для products, contractors, tasks |
| 12 | Race condition при автозамовленні | Два бронювання -> два тригери -> дублікат задач | Idempotency check: одна задача на `booking_id` + `contractor_id` |

---

## 9. План релізу по ітераціях

### MVP — v7.0 (Каталог продуктів)

- Створити таблицю `products` + seed з `PROGRAMS`
- `GET /api/products` endpoint
- Frontend: завантажувати продукти з API (з fallback)
- Вкладка "Каталог" — read-only перегляд
- Міграція booking panel на динамічні продукти

### v7.1 (Admin-Bot + Audit)

- POST/PUT/PATCH `/api/products` — admin-bot only
- `product_audit` таблиця + логування
- Bot auth middleware (`X-Bot-Token`)
- Telegram сповіщення про зміни каталогу

### v7.2 (Підрядники)

- Таблиці `contractors`, `contractor_services`
- CRUD API для підрядників
- Вкладка "Підрядники" — UI
- Прив'язка підрядників до продуктів

### v7.3 (Задачник MVP)

- Таблиця `tasks` + `task_comments`
- CRUD API для задач
- Вкладка "Задачник" — список + фільтри
- Ручне створення задач

### v7.4 (Автоматизація)

- `contractor_auto_rules` таблиця
- Тригери при створенні бронювання
- Автостворення задач
- Telegram нотифікації підрядникам
- Kanban-вид задачника

### v7.5 (Polish)

- Role `manager` введено
- Backup розширено для нових таблиць
- Dashboard розширено статистикою підрядників/задач
- Client fields на бронюваннях (`client_name`, `client_phone`)

---

## 10. Чекліст приймання (Acceptance Criteria)

### MVP (v7.0)

- [ ] Таблиця `products` створюється при `initDatabase()`
- [ ] 40 продуктів мігрировано з `PROGRAMS` -> `products`
- [ ] `GET /api/products` повертає всі active продукти
- [ ] Booking panel завантажує продукти з API
- [ ] Fallback на `PROGRAMS` працює якщо API fail
- [ ] Вкладка "Каталог" показує продукти по категоріях
- [ ] 157+ тестів проходять
- [ ] Існуючі бронювання працюють без змін

### v7.1

- [ ] Admin-bot може створити/оновити продукт через API
- [ ] Звичайний юзер отримує 403 при спробі змінити каталог
- [ ] Кожна зміна записується в `product_audit`
- [ ] Telegram повідомляє про зміни каталогу

### v7.2

- [ ] CRUD підрядників працює
- [ ] Підрядник прив'язується до 1+ продуктів
- [ ] Деактивований підрядник не з'являється в списку

### v7.3

- [ ] Задачі створюються вручну
- [ ] Задачі мають статус, пріоритет, дедлайн, відповідального
- [ ] Задачу можна зв'язати з бронюванням/підрядником

### v7.4

- [ ] При створенні бронювання з matching rule -> задача створюється автоматично
- [ ] Kanban відображає задачі коректно

---

## 11. Уточнювальні питання (12)

1. **Admin-bot auth:** Clawd bot підключається через webhook, API key, чи JWT? Яка його поточна інфраструктура — він вже існує як бот, чи його ще треба створити?

2. **Каталог products — хто seed'ить?** При першому запуску міграція з `PROGRAMS` автоматична, чи ви хочете вручну наповнювати через бота?

3. **Ціна на бронюванні vs ціна в каталозі:** Зараз ціна зберігається в бронюванні. Якщо ціна продукту зміниться в каталозі — чи старі бронювання мають оновитися, чи зберігати "ціну на момент бронювання"?

4. **Підрядники — хто це конкретно?** Це зовнішні аніматори? Постачальники матеріалів для МК? Фотографи? Потрібен приклад реального підрядника і його послуг.

5. **Автозамовлення підрядника — що конкретно відбувається?** Telegram повідомлення підряднику? Автоматичне створення задачі? Додзвін? Який канал комунікації?

6. **Задачник — хто бачить чиї задачі?** Кожен бачить тільки свої, чи всі бачать всі задачі? Підрядник (зовнішня людина) бачить свої задачі?

7. **Роль manager — це нова роль чи rename?** Зараз є admin/user/viewer. Manager — це між admin і user? Які конкретно люди будуть manager?

8. **Навігація — tabs чи модалки?** Каталог/Підрядники/Задачник — це повноекранні вкладки (SPA routing) чи великі модалки як зараз Dashboard/History?

9. **Clawd bot — він вже має Telegram бота?** Чи потрібен окремий бот-токен? Чи Clawd працює через той самий бот що і сповіщення?

10. **Обсяг підрядників на старті:** Скільки підрядників очікується? 5? 50? Від цього залежить UX (простий список vs пошук/фільтри).

11. **Задачі — які типи?** "Замовити підрядника", "Підготувати кімнату", "Купити матеріали"? Чи є фіксований набір типів, чи довільний текст?

12. **Чи потрібна клієнтська база (CRM-clients)?** В плані немає таблиці `clients` окремо, але бронювання вже мають `notes`/`group_name`. Чи потрібно зберігати контакти клієнтів (телефон, ім'я) для повторних бронювань?
