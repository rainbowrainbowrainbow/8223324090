# CRM Client Database — Специфікація для реалізації

> Створено: 2026-02-22. Статус: **РЕАЛІЗОВАНО** (v15.1.0 — Phase 1 + Phase 2)

## Контекст

Зараз у бронюванні **НЕ МАЄ** жодних контактних даних клієнта. Є лише:
- `groupName` (VARCHAR 100) — "Група/Банкет", наприклад "ДН Олі"
- `notes` (TEXT) — нотатки персоналу

Клієнт забронював → провів час → пішов → ми його **НЕ ЗНАЄМО**.

---

## 1. БАЗА ДАНИХ

### 1.1 Нова таблиця `customers`

```sql
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  phone VARCHAR(30),
  instagram VARCHAR(100),
  child_name VARCHAR(200),
  child_birthday DATE,
  source VARCHAR(50),              -- instagram, google, recommendation, repeat, other
  notes TEXT,
  total_bookings INTEGER DEFAULT 0,
  total_spent INTEGER DEFAULT 0,
  first_visit DATE,
  last_visit DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_name ON customers(name);
CREATE INDEX idx_customers_instagram ON customers(instagram);
```

### 1.2 Зв'язок з бронюваннями

```sql
ALTER TABLE bookings ADD COLUMN customer_id INTEGER REFERENCES customers(id);
CREATE INDEX idx_bookings_customer_id ON bookings(customer_id);
```

### 1.3 Міграція

Файл: `db/migrations/006_add_customers.sql`
Також додати в `initDatabase()` в `db/index.js`.

---

## 2. BACKEND API

### 2.1 Новий файл: `routes/customers.js`

| Метод | Шлях | Опис |
|-------|------|------|
| GET | `/api/customers` | Список клієнтів (пагінація, пошук) |
| GET | `/api/customers/:id` | Деталі + історія бронювань |
| GET | `/api/customers/search?q=` | Autocomplete по name/phone/instagram |
| POST | `/api/customers` | Створити клієнта |
| PUT | `/api/customers/:id` | Оновити клієнта |
| DELETE | `/api/customers/:id` | Видалити клієнта |

**Ключовий ендпоінт — пошук (autocomplete):**
```sql
SELECT id, name, phone, instagram, child_name, total_bookings
FROM customers
WHERE name ILIKE $1 OR phone ILIKE $1 OR instagram ILIKE $1
ORDER BY last_visit DESC NULLS LAST
LIMIT 10
```

### 2.2 Зміни в існуючих файлах

**`routes/bookings.js`** — POST /api/bookings та POST /api/bookings/full:
- Прийняти `customerId` (INTEGER, nullable) та `customer` (об'єкт)
- Якщо `customer` є але `customerId` немає → INSERT новий customer
- INSERT бронювання з `customer_id`
- UPDATE агрегатів клієнта (total_bookings, total_spent, last_visit, first_visit)
- Все в рамках ІСНУЮЧОЇ транзакції BEGIN/COMMIT

**`services/booking.js`** — `mapBookingRow()`:
- Додати `customerId: row.customer_id`

**`server.js`** — підключити:
```javascript
const customersRoutes = require('./routes/customers');
app.use('/api/customers', authenticate, customersRoutes);
```

---

## 3. FRONTEND — ФОРМА БРОНЮВАННЯ

### 3.1 Галочка-тогл

В формі бронювання (aside#bookingPanel) додається чекбокс:

```
[✓] 👤 Дані клієнта
```

**За замовчуванням: ВИМКНЕНИЙ.** Форма працює як раніше.
**Коли ввімкнений:** з'являється блок CRM-полів.

### 3.2 HTML — `index.html`

Розташування: ПІСЛЯ "Група/Банкет" (~рядок 389), ПЕРЕД "Програма" (~рядок 394).

Поля:
- **Пошук клієнта** — input з autocomplete dropdown
- **Ім'я клієнта*** — обов'язкове (якщо тогл ON)
- **Телефон** — +380...
- **Instagram** — username
- **Ім'я дитини**
- **Дата народження дитини**
- **Звідки дізналися** — select (instagram, google, рекомендація, повторний, інше)
- **Hidden: selectedCustomerId** — ID вибраного клієнта

### 3.3 JS — `js/booking.js`

- Toggle listener: показ/приховання CRM-секції
- Autocomplete: debounced пошук (300ms) → GET /api/customers/search?q=
- Dropdown результатів: клік → заповнити поля + selectedCustomerId
- `buildBookingObject()` — додати customer data якщо тогл ON
- `showBookingDetails()` — блок "👤 Клієнт" з інфо
- `clearCustomerFields()` — скидання CRM-полів

### 3.4 JS — `js/booking-form.js`

- `validate()` — якщо тогл ON → customerName обов'язковий
- `getFormData()` / `getBookingFormData()` — збирати CRM-поля
- `reset()` — скинути тогл OFF + очистити CRM-поля

### 3.5 CSS — `css/panel.css` або `css/controls.css`

```css
.customer-data-section { ... }
.customer-search-wrap { position: relative; }
.customer-search-results {
    position: absolute; z-index: 100;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    max-height: 200px; overflow-y: auto;
}
.customer-search-item { padding: 8px 12px; cursor: pointer; }
.customer-info-badge {
    background: var(--accent-primary);
    color: white; border-radius: 12px;
    padding: 4px 10px; font-size: 13px;
}
```

---

## 4. КАРТА ФАЙЛІВ ДЛЯ ЗМІНИ

| # | Файл | Тип | Що робити |
|---|------|-----|-----------|
| 1 | `db/migrations/006_add_customers.sql` | **NEW** | CREATE TABLE + ALTER TABLE |
| 2 | `db/index.js` | EDIT | Додати customers в initDatabase() |
| 3 | `routes/customers.js` | **NEW** | CRUD + search API |
| 4 | `server.js` | EDIT | Підключити customers route |
| 5 | `routes/bookings.js` | EDIT | customer_id при створенні/оновленні |
| 6 | `services/booking.js` | EDIT | mapBookingRow() + customerId |
| 7 | `index.html` | EDIT | Тогл + CRM-блок в формі |
| 8 | `js/booking.js` | EDIT | Toggle, autocomplete, buildBookingObject, showDetails |
| 9 | `js/booking-form.js` | EDIT | validate, getFormData, reset |
| 10 | `css/panel.css` | EDIT | Стилі CRM-блоку |
| 11 | `tests/api.test.js` | EDIT | Тести customers API |

---

## 5. ПОРЯДОК РЕАЛІЗАЦІЇ

| Крок | Що робимо | Файли |
|------|-----------|-------|
| 1 | Міграція БД | `db/migrations/006_add_customers.sql`, `db/index.js` |
| 2 | Backend: customers CRUD + search | `routes/customers.js`, `server.js` |
| 3 | Backend: bookings + customer_id | `routes/bookings.js`, `services/booking.js` |
| 4 | Frontend: HTML тогл + CRM-блок | `index.html` |
| 5 | Frontend: JS логіка | `js/booking.js`, `js/booking-form.js` |
| 6 | Frontend: CSS стилі | `css/panel.css` |
| 7 | Frontend: деталі бронювання | `js/booking.js` (showBookingDetails) |
| 8 | Тести | `tests/api.test.js` |

---

## 6. PHASE 2 (реалізовано в v15.1.0)

- ✅ Окрема сторінка CRM (`customers.html`) — таблиця, пошук, пагінація, CRUD
- ✅ Фільтри клієнтів (джерело, візити, дата, сортування)
- ✅ Автопривітання з ДН дитини (scheduler 09:00 + Telegram)
- ✅ RFM-аналітика (5 сегментів: champion, loyal, potential, at_risk, lost)
- ✅ Зв'язок сертифікатів із клієнтами (`certificates.customer_id`)
- ✅ Експорт бази клієнтів (CSV, UTF-8 BOM, `;` separator)

---

## 7. BACKEND ЛОГІКА (деталі)

### Створення бронювання з клієнтом (в транзакції)

```javascript
let customerId = req.body.customerId || null;

// Якщо є дані клієнта, але немає customerId → створити нового
if (req.body.customer && !customerId) {
    const { name, phone, instagram, childName, childBirthday, source } = req.body.customer;
    if (name) {
        const customerResult = await client.query(
            `INSERT INTO customers (name, phone, instagram, child_name, child_birthday, source)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [name, phone || null, instagram || null, childName || null, childBirthday || null, source || null]
        );
        customerId = customerResult.rows[0].id;
    }
}

// INSERT бронювання з customer_id (додати до існуючого INSERT)
// ...

// Оновити агрегати клієнта
if (customerId) {
    await client.query(
        `UPDATE customers SET
           total_bookings = total_bookings + 1,
           total_spent = total_spent + $1,
           last_visit = GREATEST(last_visit, $2::date),
           first_visit = LEAST(COALESCE(first_visit, $2::date), $2::date),
           updated_at = NOW()
         WHERE id = $3`,
        [price, date, customerId]
    );
}
```

### При видаленні/скасуванні бронювання

Декрементити `total_bookings` та `total_spent` у клієнта (якщо `customer_id` NOT NULL).

---

*Документ є джерелом правди для реалізації CRM модуля.*
