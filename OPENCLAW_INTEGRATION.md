# OpenClaw Integration Guide — Парк Закревського Періоду CRM

> Технічна документація для інтеграції AI-асистента OpenClaw з CRM-системою Парку.
> Версія CRM: **12.7.1** | Дата: 2026-02-17

---

## Зміст

1. [Архітектура (Q1–Q4)](#1-архітектура)
2. [Авторизація (Q5–Q8)](#2-авторизація)
3. [API ендпоінти (Q9–Q12)](#3-api-ендпоінти)
4. [Бронювання (Q13–Q17)](#4-бронювання)
5. [Клієнти (Q18–Q20)](#5-клієнти)
6. [Послуги та події (Q21–Q23)](#6-послуги-та-події)
7. [Фінанси (Q24–Q25)](#7-фінанси)
8. [Персонал (Q26–Q28)](#8-персонал)
9. [Сповіщення / Webhook (Q29–Q31)](#9-сповіщення--webhook)
10. [Аналітика (Q32–Q33)](#10-аналітика)
11. [Специфічно для OpenClaw (Q34–Q36)](#11-специфічно-для-openclaw)
12. [Повний список ендпоінтів](#12-повний-список-ендпоінтів)
13. [Приклади JSON](#13-приклади-json)
14. [Інструкція підключення](#14-інструкція-підключення)

---

## 1. Архітектура

### Q1. Який стек?

| Шар | Технологія |
|-----|-----------|
| **Runtime** | Node.js 18+ (vanilla JavaScript, NO TypeScript) |
| **Backend** | Express.js 4.18.2 |
| **Database** | PostgreSQL 16 + `pg` pool (raw SQL, NO ORM/Prisma) |
| **Frontend** | Vanilla HTML + CSS + JS (SPA, NO React/Next.js) |
| **WebSocket** | `ws` 8.19.0 (real-time sync) |
| **Auth** | JWT (`jsonwebtoken` 9.0.3) + bcryptjs |
| **Bot** | Custom Telegram Bot API (прямі HTTPS-виклики) |
| **File Upload** | Multer 2.0.2 |
| **QR** | qrcode 1.5.4 |

### Q2. Де знаходиться бекенд?

**Монорепо** — один `server.js` як entry point, всі routes/services/middleware в одній репозиторії. Деплой на Railway.

### Q3. Яка база даних?

- **PostgreSQL 16** на Railway
- Connection через `DATABASE_URL` env var
- SSL: `{ rejectUnauthorized: false }` для Railway
- **32 таблиці** (bookings, users, products, tasks, staff, certificates, etc.)
- Raw SQL queries через `pg` Pool (параметризовані запити)

### Q4. Є чи буде окремий API для зовнішніх інтеграцій?

Зараз **єдиний REST API** для фронтенду і бота. Окремого external API немає, але всі ендпоінти доступні через JWT-авторизацію. Для OpenClaw рекомендується:
- Створити bot-користувача з роллю `user` або новою роллю `bot`
- Використовувати існуючі `/api/*` ендпоінти
- Опціонально: додати `/api/openclaw/*` namespace для специфічних операцій

---

## 2. Авторизація

### Q5. Як влаштована авторизація?

**JWT (JSON Web Token)**:
- Токен видається при `POST /api/auth/login`
- Передається в header: `Authorization: Bearer <token>`
- Payload: `{ id, username, role, name }`
- Secret: з env var `JWT_SECRET`
- Middleware перевіряє токен на всіх `/api/*` маршрутах крім:
  - `/api/auth/*` (login, verify)
  - `/api/health`
  - `/api/telegram/webhook`

### Q6. Час життя токена і refresh?

- **TTL: 24 години**
- **Refresh механізму НЕМАЄ** — після 24h потрібен повторний login
- Для OpenClaw рекомендація: логін раз на добу або при 403 помилці

### Q7. Bot-користувач для OpenClaw?

**Зараз немає** — потрібно створити. Рекомендований план:

```
Username: openclaw
Password: <secure-generated>
Role: user (або новий 'bot')
Name: OpenClaw 🦞
```

Роль `user` дає доступ до:
- Бронювання (CRUD)
- Задачі (CRUD)
- Сертифікати (CRUD)
- Статистика (read)

Роль `admin` додатково дає:
- Видалення продуктів
- Управління користувачами

### Q8. API ключ чи логін/пароль?

**Логін/пароль** → JWT токен. Окремих API-ключів немає. Для OpenClaw:

```bash
# Один раз на 24 години:
POST /api/auth/login
{ "username": "openclaw", "password": "..." }
→ { "token": "eyJhbG...", "user": { "username": "openclaw", "role": "user" } }

# Потім використовувати:
Authorization: Bearer eyJhbG...
```

---

## 3. API ендпоінти

### Q9. Повний список (152+ ендпоінтів)

Див. [розділ 12](#12-повний-список-ендпоінтів) нижче.

### Q10. Ендпоінти для OpenClaw (потрібно створити)

| Ендпоінт | Мета | Статус |
|----------|------|--------|
| `GET /api/openclaw/summary/:date` | Зведення на день (бронювання + персонал + задачі) | **Потрібно створити** |
| `GET /api/openclaw/available-slots/:date` | Вільні слоти на дату | **Потрібно створити** |
| `POST /api/openclaw/action-log` | Логування дій OpenClaw | Є аналог: `POST /api/auth/log-action` |
| `GET /api/openclaw/client/:phone` | Пошук клієнта за телефоном | **Потрібно створити** (клієнтська таблиця не існує) |

### Q11. Формат відповідей?

**Чистий JSON** на всіх ендпоінтах. Формати:

- Успіх: `{ success: true, ...data }` або масив `[{...}]`
- Помилка: `{ error: "message" }` з HTTP кодом 4xx/5xx
- Список з пагінацією: `{ items: [...], total: N }`

### Q12. Swagger / OpenAPI?

Файл `swagger.js` **існує** але **не інтегрований** в сервер (не підключений). Планується підключення. Зараз цей документ є основною API-документацією.

---

## 4. Бронювання

### Q13. Структура об'єкта бронювання (camelCase, як повертає API)

```json
{
  "id": "BK-2026-0142",
  "date": "2026-02-17",
  "time": "14:00",
  "lineId": "animator-1",
  "programId": "quest-marvel",
  "programCode": "КВ1",
  "label": "КВ1",
  "programName": "Квест Marvel",
  "category": "quest",
  "duration": 60,
  "price": 2800,
  "hosts": 1,
  "secondAnimator": null,
  "pinataFiller": null,
  "costume": null,
  "room": "Marvel",
  "notes": "Маша, 8 років, тел. 0501234567",
  "createdBy": "admin",
  "createdAt": "2026-02-15T10:30:00.000Z",
  "linkedTo": null,
  "status": "confirmed",
  "kidsCount": 12,
  "updatedAt": "2026-02-15T10:30:00.000Z",
  "groupName": "ДН Маші",
  "extraData": {
    "tshirt_sizes": { "XS": 2, "M": 5, "L": 3, "XL": 2 }
  },
  "skipNotification": false
}
```

### Q14. Статуси бронювання

| Статус | Значення | Коли |
|--------|----------|------|
| `confirmed` | Підтверджено (default) | При створенні |
| `preliminary` | Попередньо (не факт) | Коли ще не оплачено |
| `cancelled` | Скасовано | Ручна зміна або DELETE |

> "Виконано" як окремий статус не використовується — бронювання вважається виконаним після закінчення часу.

### Q15. Отримати бронювання на конкретну дату

```
GET /api/bookings/2026-02-17
Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "id": "BK-2026-0142",
    "date": "2026-02-17",
    "time": "14:00",
    "lineId": "animator-1",
    "programName": "Квест Marvel",
    "status": "confirmed",
    "duration": 60,
    "price": 2800,
    "kidsCount": 12,
    "room": "Marvel",
    ...
  }
]
```

### Q16. Бронювання за останній час / сьогодні

Використовуємо той самий ендпоінт з поточною датою (Kyiv TZ):

```
GET /api/bookings/2026-02-17
```

Для діапазону дат (статистика):
```
GET /api/settings/stats/2026-02-17/2026-02-17
```

### Q17. Змінити статус бронювання через API?

**Так**, через `PUT /api/bookings/:id`:

```
PUT /api/bookings/BK-2026-0142
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "cancelled",
  "updatedAt": "2026-02-15T10:30:00.000Z"
}
```

> `updatedAt` — обов'язково для optimistic locking (конфлікт-детекція). Якщо хтось інший змінив бронювання після цього timestamp, повернеться `{ success: false, conflict: true, currentData: {...} }`.

---

## 5. Клієнти

### Q18. Структура клієнта

**Окремої таблиці клієнтів НЕМАЄ.** Інформація про клієнтів зберігається в полях бронювання:

- `notes` — ім'я, телефон, додаткова інформація (вільний текст)
- `groupName` — "ДН Маші", "Корпоратив Розетка" тощо
- `kidsCount` — кількість дітей
- `extraData` — JSON з додатковими даними (розміри футболок тощо)

### Q19. Пошук клієнта за телефоном

**Прямого ендпоінта немає.** Можна шукати через notes:
```sql
SELECT * FROM bookings WHERE notes ILIKE '%0501234567%'
```

Для OpenClaw рекомендується створити окрему таблицю `clients` або ендпоінт пошуку по bookings.

### Q20. Telegram ID клієнта

**Не зберігається для клієнтів.** Telegram ID зберігається тільки для:
- Співробітників: `users.telegram_chat_id`, `users.telegram_username`
- Підрядників: `contractors.telegram_chat_id`, `contractors.telegram_username`
- Персоналу: `staff.telegram_username`

---

## 6. Послуги та події

### Q21. Типи послуг

**Таблиця `products` (40 програм):**

| Категорія | Кількість | Приклад | Ціна |
|-----------|-----------|---------|------|
| `quest` | 11 | Квест Marvel, Ninja, Minecraft | 2100–3300 ₴ |
| `animation` | 2 | Анімація 60/120 хв | 1500–2500 ₴ |
| `show` | 6 | Бульбашкове шоу, Крио-шоу | 2400–4400 ₴ |
| `photo` | 4 | Фотосесія, відеозйомка | 1600–6000 ₴ |
| `masterclass` | 10 | МК цукерки, слайм, футболки | 290–450 ₴/дитина |
| `pinata` | 2 | Піньята стандарт/PRO | 700–1000 ₴ |
| `custom` | 1 | Вільна категорія | довільна |

```
GET /api/products
GET /api/products?active=true
```

### Q22. Розклад на тиждень

Комбінація трьох джерел:

```bash
# Бронювання на кожен день:
GET /api/bookings/2026-02-17
GET /api/bookings/2026-02-18
...

# Афіша (події/заходи):
GET /api/afisha/2026-02-17

# Розклад персоналу:
GET /api/staff/schedule?from=2026-02-17&to=2026-02-23
```

### Q23. Вільні слоти

**Для кімнат є готовий ендпоінт:**

```
GET /api/settings/rooms/free/2026-02-17/14:00/60
```

**Response:**
```json
{
  "free": ["Ninja", "Minecraft", "Food Court"],
  "occupied": [
    { "room": "Marvel", "booking": "BK-2026-0142", "time": "14:00", "duration": 60 }
  ],
  "total": 14
}
```

**Для аніматорів** — перевірити через `GET /api/staff/schedule/check/:date` та `GET /api/bookings/:date`.

---

## 7. Фінанси

### Q24. Фінансові дані

**Так**, є модуль аналітики. Оплати відстежуються через поле `price` в бронюваннях. Окремої системи оплат/кас немає.

### Q25. Виручка за період

```
GET /api/stats/revenue?period=day&from=2026-02-17&to=2026-02-17
Authorization: Bearer <token>
```

**Response:**
```json
{
  "period": "day",
  "totals": {
    "revenue": 28500,
    "bookings": 8,
    "avgCheck": 3562
  },
  "comparison": {
    "prevRevenue": 22000,
    "revenueGrowth": 29.5
  },
  "daily": [
    { "date": "2026-02-17", "revenue": 28500, "count": 8 }
  ]
}
```

Підтримувані періоди: `day`, `week`, `month`, `quarter`, `year`.

---

## 8. Персонал

### Q26. Структура співробітника

```json
{
  "id": 1,
  "name": "Віталіна",
  "department": "animators",
  "position": "Старший аніматор",
  "phone": "+380501234567",
  "hireDate": "2024-01-15",
  "isActive": true,
  "color": "#4caf50",
  "telegramUsername": "vitalina_park",
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

**Департаменти:** `animators`, `admin`, `cafe`, `tech`, `cleaning`, `security`

### Q27. Розклад персоналу

```
GET /api/staff/schedule?from=2026-02-17&to=2026-02-23
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "staffId": 5,
      "staffName": "Віталіна",
      "department": "animators",
      "date": "2026-02-17",
      "shiftStart": "09:00",
      "shiftEnd": "18:00",
      "status": "working",
      "note": null
    }
  ]
}
```

**Статуси зміни:** `working`, `dayoff`, `vacation`, `sick`

**Доступність аніматорів:**
```
GET /api/staff/schedule/check/2026-02-17
```
```json
{
  "success": true,
  "available": [
    { "id": 5, "name": "Віталіна", "shiftStart": "09:00", "shiftEnd": "18:00" }
  ],
  "unavailable": [
    { "id": 6, "name": "Даша", "status": "dayoff" }
  ]
}
```

**Відпрацьовані години:**
```
GET /api/staff/schedule/hours?from=2026-02-01&to=2026-02-28
```

### Q28. Система задач для персоналу

**Так**, повноцінна таск-система (Kleshnya):

```
GET /api/tasks?assigned_to=Vitalina&status=todo
GET /api/tasks?date=2026-02-17
POST /api/tasks  (створити задачу)
PATCH /api/tasks/:id/status  (змінити статус)
```

**Задача:**
```json
{
  "id": 42,
  "title": "Підготувати зал Marvel",
  "description": "Перевірити реквізит, повісити банер",
  "date": "2026-02-17",
  "status": "todo",
  "priority": "high",
  "assignedTo": "Vitalina",
  "category": "operational",
  "deadline": "2026-02-17T13:00:00.000Z",
  "timeWindowStart": "12:00",
  "timeWindowEnd": "13:30",
  "escalationLevel": 0,
  "createdBy": "admin"
}
```

---

## 9. Сповіщення / Webhook

### Q29. Webhook на нове бронювання

**Зараз немає HTTP webhook.** Сповіщення йдуть через:
1. **Telegram** — автоматично після кожного бронювання (fire-and-forget)
2. **WebSocket** — подія `booking:created` для підключених клієнтів
3. **Automation rules** — кастомні тригери (автоматичні задачі, повідомлення підрядникам)

### Q30. Webhook на зміну статусу

Аналогічно: Telegram + WebSocket (`booking:updated`), але **HTTP webhook немає**.

### Q31. Як OpenClaw може підписатись на події в реальному часі?

**WebSocket** — найкращий варіант:

```javascript
// 1. Підключення
const ws = new WebSocket('wss://your-domain.railway.app/ws');

// 2. Авторизація (перше повідомлення)
ws.send(JSON.stringify({ type: 'auth', token: 'JWT_TOKEN' }));

// 3. Підписка на дату
ws.send(JSON.stringify({ type: 'JOIN_DATE', date: '2026-02-17' }));

// 4. Отримання подій
ws.onmessage = (event) => {
  const { type, payload } = JSON.parse(event.data);
  // type: 'booking:created', 'booking:updated', 'booking:deleted',
  //       'task:created', 'task:updated', 'certificate:issued', etc.
};
```

**Типи подій WebSocket:**
| Подія | Коли |
|-------|------|
| `booking:created` | Нове бронювання |
| `booking:updated` | Зміна бронювання (включно зі статусом) |
| `booking:deleted` | Видалення |
| `line:updated` | Зміна ліній аніматорів |
| `task:created` | Нова задача |
| `task:updated` | Зміна задачі |
| `certificate:issued` | Новий сертифікат |
| `certificate:used` | Використання сертифіката |
| `afisha:updated` | Зміна афіші |
| `settings:updated` | Зміна налаштувань |

---

## 10. Аналітика

### Q32. Готові звіти

| Ендпоінт | Звіт |
|----------|------|
| `GET /api/stats/revenue` | Виручка (день/тиждень/місяць/квартал/рік) з порівнянням |
| `GET /api/stats/programs` | Рейтинг програм (по кількості та по виручці) |
| `GET /api/stats/load` | Завантаженість (по днях тижня, годинах, кімнатах, аніматорах) |
| `GET /api/stats/trends` | Тренди (поточний vs попередній період, зростання %) |
| `GET /api/auth/profile` | Персональний профіль (задачі, бали, стріки, досягнення) |
| `GET /api/points` | Лідерборд (рейтинг співробітників по балах) |
| `GET /api/staff/schedule/hours` | Відпрацьовані години персоналу |

### Q33. Ключові метрики для Сергія (директора)

1. **Виручка за день/тиждень/місяць** — `GET /api/stats/revenue`
2. **Кількість бронювань** — з тієї ж endpoint
3. **Середній чек** — `avgCheck` в revenue response
4. **Зростання vs минулий період** — `comparison.revenueGrowth`
5. **Популярні програми** — `GET /api/stats/programs`
6. **Завантаженість кімнат** — `GET /api/stats/load` → `roomUtilization`
7. **Завантаженість аніматорів** — `GET /api/stats/load` → `animatorWorkload`
8. **Протерміновані задачі** — `GET /api/tasks?status=todo` (перевірити deadline)
9. **Стріки команди** — `GET /api/points` + user_streaks
10. **Сертифікати (активні/використані)** — `GET /api/certificates?status=active`

---

## 11. Специфічно для OpenClaw

### Q34. Зведення на сьогодні

**Потрібно створити** `GET /api/openclaw/summary/:date`. Поки що — збирати з 4 ендпоінтів:

```bash
# Паралельно:
GET /api/bookings/2026-02-17           # Бронювання
GET /api/staff/schedule?from=2026-02-17&to=2026-02-17  # Персонал
GET /api/tasks?date=2026-02-17         # Задачі
GET /api/afisha/2026-02-17             # Афіша/події
```

Результат агрегувати:
```json
{
  "date": "2026-02-17",
  "bookings": {
    "total": 5,
    "confirmed": 4,
    "preliminary": 1,
    "revenue": 15800
  },
  "staff": {
    "working": 8,
    "dayoff": 2,
    "animatorsAvailable": ["Віталіна", "Даша", "Анлі"]
  },
  "tasks": {
    "todo": 3,
    "inProgress": 2,
    "overdue": 1
  },
  "events": [
    { "time": "09:00", "title": "Міні-шоу" }
  ]
}
```

### Q35. Таблиця для ai_logs / bot_actions

**Зараз є:**
- `user_action_log` — логування дій користувачів (підходить для OpenClaw)
- `kleshnya_chat` — чат з AI-асистентом
- `kleshnya_messages` — кешовані AI-повідомлення

**Рекомендація:** використати `user_action_log` для логування дій OpenClaw:

```
POST /api/auth/log-action
Authorization: Bearer <openclaw-token>

{
  "action": "booking_query",
  "target": "2026-02-17",
  "meta": {
    "source": "openclaw",
    "query": "Скільки бронювань на сьогодні?",
    "response_summary": "5 бронювань, 15800₴"
  }
}
```

### Q36. Реагування на дії OpenClaw

1. **Логування** — через `POST /api/auth/log-action` з `meta.source = "openclaw"`
2. **Аудит** — всі зміни автоматично записуються в таблицю `history`
3. **WebSocket** — зміни від OpenClaw бродкастяться всім клієнтам
4. **Telegram** — якщо OpenClaw створює бронювання, автоматично спрацює Telegram-сповіщення
5. **createdBy** — поле `created_by` / `createdBy` покаже "openclaw" як автора

---

## 12. Повний список ендпоінтів

### Auth (9 ендпоінтів)
```
POST   /api/auth/login                       — Логін → JWT токен
POST   /api/auth/debug-login                 — Debug логін (dev only)
GET    /api/auth/verify                      — Перевірка токена
GET    /api/auth/profile                     — Повний профіль + статистика
GET    /api/auth/achievements                — Список досягнень
POST   /api/auth/log-action                  — Логування дії
GET    /api/auth/action-log                  — Історія дій
PATCH  /api/auth/tasks/:id/quick-status      — Швидка зміна статусу задачі
PUT    /api/auth/password                    — Зміна пароля
```

### Bookings (5 ендпоінтів)
```
GET    /api/bookings/:date                   — Бронювання на дату
POST   /api/bookings                         — Створити бронювання
POST   /api/bookings/full                    — Створити основне + пов'язані
PUT    /api/bookings/:id                     — Оновити бронювання
DELETE /api/bookings/:id                     — Видалити бронювання
```

### Lines (2 ендпоінти)
```
GET    /api/lines/:date                      — Лінії аніматорів на дату
POST   /api/lines/:date                      — Встановити лінії на дату
```

### History (2 ендпоінти)
```
GET    /api/history                          — Історія дій з фільтрами
POST   /api/history                          — Додати запис
```

### Settings & Health (7 ендпоінтів)
```
GET    /api/settings/stats/:from/:to         — Статистика за період
GET    /api/settings/settings/:key           — Отримати налаштування
POST   /api/settings/settings                — Зберегти налаштування
GET    /api/settings/rooms/free/:date/:time/:dur — Вільні кімнати
GET    /api/settings/health                  — Health check
GET/POST/PUT/DELETE /api/settings/automation-rules — Правила автоматизації
```

### Stats (4 ендпоінти, потребує auth: admin/user)
```
GET    /api/stats/revenue                    — Виручка
GET    /api/stats/programs                   — Рейтинг програм
GET    /api/stats/load                       — Завантаженість
GET    /api/stats/trends                     — Тренди
```

### Afisha (12 ендпоінтів)
```
GET    /api/afisha                           — Всі події
GET    /api/afisha/:date                     — Події на дату
POST   /api/afisha                           — Створити подію
PUT    /api/afisha/:id                       — Оновити подію
PATCH  /api/afisha/:id/time                  — Змінити час (drag)
DELETE /api/afisha/:id                       — Видалити подію
POST   /api/afisha/:id/generate-tasks        — Згенерувати задачі для події
GET    /api/afisha/templates/list            — Шаблони повторюваних подій
POST   /api/afisha/templates                 — Створити шаблон
PUT    /api/afisha/templates/:id             — Оновити шаблон
DELETE /api/afisha/templates/:id             — Видалити шаблон
GET    /api/afisha/distribute/:date          — Запропонувати розподіл
POST   /api/afisha/distribute/:date          — Авто-розподіл
POST   /api/afisha/undistribute/:date        — Скинути розподіл
```

### Telegram (8 ендпоінтів)
```
GET    /api/telegram/chats                   — Список чатів
GET    /api/telegram/threads                 — Теми/топіки
POST   /api/telegram/notify                  — Надіслати повідомлення
GET    /api/telegram/digest/:date            — Дайджест на дату
GET    /api/telegram/reminder/:date          — Нагадування на завтра
POST   /api/telegram/ask-animator            — Запит на аніматора
GET    /api/telegram/animator-status/:id     — Статус запиту
POST   /api/telegram/webhook                 — Webhook бота
```

### Backup (3 ендпоінти)
```
POST   /api/backup/create                    — Створити бекап → Telegram
GET    /api/backup/download                  — Завантажити SQL
POST   /api/backup/restore                   — Відновити з SQL
```

### Products (5 ендпоінтів)
```
GET    /api/products                         — Список програм
GET    /api/products/:id                     — Одна програма
POST   /api/products                         — Створити (admin/manager)
PUT    /api/products/:id                     — Оновити (admin/manager)
DELETE /api/products/:id                     — Деактивувати (admin)
```

### Tasks (7 ендпоінтів)
```
GET    /api/tasks                            — Список з фільтрами
GET    /api/tasks/:id                        — Одна задача
GET    /api/tasks/:id/logs                   — Історія змін задачі
POST   /api/tasks                            — Створити (admin/user)
PUT    /api/tasks/:id                        — Оновити (admin/user)
PATCH  /api/tasks/:id/status                 — Змінити статус
DELETE /api/tasks/:id                        — Видалити (admin)
```

### Task Templates (4 ендпоінти)
```
GET    /api/task-templates                   — Список шаблонів
POST   /api/task-templates                   — Створити
PUT    /api/task-templates/:id               — Оновити
DELETE /api/task-templates/:id               — Видалити
```

### Staff (11 ендпоінтів)
```
GET    /api/staff                            — Список персоналу
POST   /api/staff                            — Додати
PUT    /api/staff/:id                        — Оновити
DELETE /api/staff/:id                        — Видалити
GET    /api/staff/departments                — Департаменти
GET    /api/staff/schedule                   — Розклад (from/to)
PUT    /api/staff/schedule                   — Оновити зміну
POST   /api/staff/schedule/bulk              — Масове оновлення
POST   /api/staff/schedule/copy-week         — Копіювати тиждень
GET    /api/staff/schedule/hours             — Відпрацьовані години
GET    /api/staff/schedule/check/:date       — Доступність аніматорів
```

### Certificates (10 ендпоінтів)
```
GET    /api/certificates                     — Список (status, search, pagination)
GET    /api/certificates/:id                 — Один сертифікат
GET    /api/certificates/code/:code          — За кодом (CERT-YYYY-NNNNN)
GET    /api/certificates/qr/:code            — QR-код
POST   /api/certificates                     — Створити
POST   /api/certificates/batch               — Пакетне створення
PATCH  /api/certificates/:id/status          — Змінити статус
PUT    /api/certificates/:id                 — Оновити
DELETE /api/certificates/:id                 — Видалити
POST   /api/certificates/:id/send-image      — Відправити в Telegram
```

### Recurring Bookings (12 ендпоінтів)
```
GET    /api/recurring                        — Список шаблонів
POST   /api/recurring                        — Створити
PUT    /api/recurring/:id                    — Оновити
DELETE /api/recurring/:id                    — Видалити
POST   /api/recurring/:id/pause              — Пауза/відновлення
POST   /api/recurring/:id/generate           — Згенерувати
POST   /api/recurring/generate-all           — Згенерувати всі
GET    /api/recurring/:id/series             — Всі інстанси
DELETE /api/recurring/:id/series/future       — Скасувати майбутні
GET    /api/recurring/:id/skips              — Список пропусків
POST   /api/recurring/:id/skips              — Додати пропуск
DELETE /api/recurring/skips/:skipId          — Видалити пропуск
```

### Points (3 ендпоінти)
```
GET    /api/points                           — Лідерборд
GET    /api/points/:username                 — Бали користувача
GET    /api/points/:username/history         — Транзакції балів
```

### Kleshnya / AI Chat (3 ендпоінти)
```
GET    /api/kleshnya/greeting                — Привітання дня
GET    /api/kleshnya/chat                    — Історія чату
POST   /api/kleshnya/chat                    — Надіслати повідомлення
```

### Contractors (8 ендпоінтів)
```
GET    /api/contractors                      — Список підрядників
GET    /api/contractors/:id                  — Один підрядник
POST   /api/contractors                      — Додати
PUT    /api/contractors/:id                  — Оновити
DELETE /api/contractors/:id                  — Видалити
POST   /api/contractors/:id/regenerate-invite — Нове запрошення
POST   /api/contractors/:id/test-message     — Тест Telegram
GET    /api/contractors/notifications/recent — Останні сповіщення
```

### Designs (11 ендпоінтів)
```
GET    /api/designs                          — Список дизайнів
GET    /api/designs/tags                     — Теги
GET    /api/designs/calendar                 — Календар дизайнів
GET    /api/designs/collections              — Колекції
POST   /api/designs/collections              — Створити колекцію
PUT    /api/designs/collections/:id          — Оновити колекцію
DELETE /api/designs/collections/:id          — Видалити колекцію
POST   /api/designs/upload                   — Завантажити дизайн
PUT    /api/designs/:id                      — Оновити метадані
DELETE /api/designs/:id                      — Видалити
POST   /api/designs/:id/telegram             — Відправити в Telegram
```

**Разом: ~152 ендпоінти**

---

## 13. Приклади JSON

### Авторизація

**Request:**
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "openclaw",
  "password": "secure-password-here"
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "username": "openclaw",
    "role": "user",
    "name": "OpenClaw 🦞"
  }
}
```

---

### Створити бронювання

**Request:**
```http
POST /api/bookings
Authorization: Bearer eyJhbG...
Content-Type: application/json

{
  "date": "2026-02-20",
  "time": "14:00",
  "lineId": "animator-1",
  "programId": "quest-marvel",
  "programCode": "КВ1",
  "label": "КВ1",
  "programName": "Квест Marvel",
  "category": "quest",
  "duration": 60,
  "price": 2800,
  "hosts": 1,
  "room": "Marvel",
  "kidsCount": 10,
  "groupName": "ДН Олі",
  "notes": "Оля, 0501234567, 10 дітей",
  "status": "confirmed"
}
```

**Response (200):**
```json
{
  "success": true,
  "booking": {
    "id": "BK-2026-0143",
    "date": "2026-02-20",
    "time": "14:00",
    "lineId": "animator-1",
    "programName": "Квест Marvel",
    "status": "confirmed",
    "price": 2800,
    "createdBy": "openclaw",
    ...
  }
}
```

---

### Оновити статус бронювання

**Request:**
```http
PUT /api/bookings/BK-2026-0143
Authorization: Bearer eyJhbG...
Content-Type: application/json

{
  "status": "cancelled",
  "updatedAt": "2026-02-17T14:30:00.000Z"
}
```

**Response (200):**
```json
{
  "success": true,
  "booking": {
    "id": "BK-2026-0143",
    "status": "cancelled",
    "updatedAt": "2026-02-17T14:35:00.000Z",
    ...
  }
}
```

**Конфлікт (409):**
```json
{
  "success": false,
  "conflict": true,
  "currentData": { ... }
}
```

---

### Виручка

**Request:**
```http
GET /api/stats/revenue?period=week&from=2026-02-10&to=2026-02-17
Authorization: Bearer eyJhbG...
```

**Response:**
```json
{
  "period": "week",
  "totals": {
    "revenue": 125400,
    "bookings": 32,
    "avgCheck": 3919
  },
  "comparison": {
    "prevRevenue": 98000,
    "revenueGrowth": 27.96
  },
  "daily": [
    { "date": "2026-02-10", "revenue": 15800, "count": 4 },
    { "date": "2026-02-11", "revenue": 22000, "count": 6 },
    ...
  ]
}
```

---

### Задачі — створити

**Request:**
```http
POST /api/tasks
Authorization: Bearer eyJhbG...
Content-Type: application/json

{
  "title": "Перевірити реквізит для Marvel",
  "description": "Перед святом о 14:00 перевірити щит, маски, костюми",
  "date": "2026-02-20",
  "priority": "high",
  "assignedTo": "Vitalina",
  "category": "operational",
  "deadline": "2026-02-20T13:00:00.000Z",
  "timeWindowStart": "12:00",
  "timeWindowEnd": "13:30"
}
```

**Response:**
```json
{
  "success": true,
  "task": {
    "id": 43,
    "title": "Перевірити реквізит для Marvel",
    "status": "todo",
    "priority": "high",
    "assignedTo": "Vitalina",
    "createdBy": "openclaw",
    ...
  }
}
```

---

### Задачі — змінити статус

**Request:**
```http
PATCH /api/tasks/43/status
Authorization: Bearer eyJhbG...
Content-Type: application/json

{ "status": "done" }
```

---

### Розклад персоналу

**Request:**
```http
GET /api/staff/schedule?from=2026-02-17&to=2026-02-17
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "staffId": 5,
      "staffName": "Віталіна",
      "department": "animators",
      "date": "2026-02-17",
      "shiftStart": "09:00",
      "shiftEnd": "18:00",
      "status": "working"
    },
    {
      "staffId": 6,
      "staffName": "Даша",
      "department": "animators",
      "date": "2026-02-17",
      "shiftStart": null,
      "shiftEnd": null,
      "status": "dayoff"
    }
  ]
}
```

---

### Продукти

**Request:**
```http
GET /api/products?active=true
```

**Response:**
```json
[
  {
    "id": "quest-marvel",
    "code": "КВ1",
    "label": "КВ1",
    "name": "Квест Marvel",
    "icon": "🦸",
    "category": "quest",
    "duration": 60,
    "price": 2800,
    "hosts": 1,
    "ageRange": "5-12",
    "kidsCapacity": "10-25",
    "description": "Захоплюючий квест у стилі Marvel...",
    "isPerChild": false,
    "hasFiller": false,
    "isActive": true
  },
  ...
]
```

---

### Сертифікати

**Request:**
```http
GET /api/certificates?status=active&limit=10
Authorization: Bearer eyJhbG...
```

**Response:**
```json
{
  "items": [
    {
      "id": 5,
      "certCode": "CERT-2026-14823",
      "displayMode": "fio",
      "displayValue": "Маша Петренко",
      "typeText": "Квест на вибір",
      "issuedAt": "2026-02-10T12:00:00.000Z",
      "validUntil": "2026-03-27",
      "status": "active",
      "season": "winter"
    }
  ],
  "total": 1
}
```

---

### WebSocket підключення

```javascript
const ws = new WebSocket('wss://park-booking.up.railway.app/ws');

// Крок 1: Auth
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'auth', token: JWT_TOKEN }));
};

// Крок 2: Слухати
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case 'auth:success':
      // Підписатись на сьогодні
      ws.send(JSON.stringify({ type: 'JOIN_DATE', date: '2026-02-17' }));
      break;

    case 'booking:created':
      console.log('Нове бронювання:', msg.payload);
      break;

    case 'booking:updated':
      console.log('Оновлення:', msg.payload);
      break;

    case 'task:created':
      console.log('Нова задача:', msg.payload);
      break;
  }
};
```

---

## 14. Інструкція підключення

### Base URL
```
https://<RAILWAY_PUBLIC_DOMAIN>
```

Наприклад: `https://park-booking.up.railway.app`

### Auth Header
```
Authorization: Bearer <JWT_TOKEN>
```

### Крок за кроком

1. **Створити bot-користувача** (одноразово, через SQL або UI):
```sql
INSERT INTO users (username, password_hash, role, name)
VALUES ('openclaw', '<bcrypt_hash>', 'user', 'OpenClaw 🦞');
```

2. **Отримати JWT токен** (раз на 24 години):
```bash
curl -X POST https://your-domain/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"openclaw","password":"your-password"}'
```

3. **Використовувати API**:
```bash
curl https://your-domain/api/bookings/2026-02-17 \
  -H "Authorization: Bearer eyJhbG..."
```

4. **Підключити WebSocket** для real-time подій (опціонально):
```
wss://your-domain/ws
→ send: { "type": "auth", "token": "JWT" }
→ send: { "type": "JOIN_DATE", "date": "YYYY-MM-DD" }
→ receive: booking:created, booking:updated, task:created, ...
```

### Rate Limits
| Обмеження | Ліміт | Вікно |
|-----------|-------|-------|
| Загальний | 120 req | 60 сек |
| Логін | 5 req | 60 сек |
| Створення бронювань | 30 req | 15 хв |
| Оновлення бронювань | 60 req | 15 хв |
| Створення сертифікатів | 20 req | 15 хв |

### Важливі нюанси

1. **Дати** — формат `YYYY-MM-DD`, зберігаються як VARCHAR
2. **Час** — формат `HH:MM`, зберігається як VARCHAR
3. **Таймзона** — всі timestamps UTC, відображення Europe/Kyiv
4. **camelCase** — API повертає camelCase (DB зберігає snake_case)
5. **Валюта** — UAH (₴), ціни в копійках не використовуються (цілі гривні)
6. **Booking ID** — формат `BK-YYYY-NNNN` (автогенерація)
7. **Cert Code** — формат `CERT-YYYY-NNNNN` (автогенерація)
8. **Optimistic Locking** — для PUT bookings передавати `updatedAt`
9. **Telegram** — fire-and-forget після COMMIT (не блокує відповідь)
10. **Content-Type** — завжди `application/json`

---

## Підсумок: що потрібно створити для OpenClaw

| # | Задача | Пріоритет |
|---|--------|-----------|
| 1 | Bot-користувач `openclaw` з роллю `user` | **Критично** |
| 2 | `GET /api/openclaw/summary/:date` — зведення дня | Високий |
| 3 | `GET /api/openclaw/available-slots/:date` — вільні слоти | Високий |
| 4 | Таблиця `clients` для пошуку клієнтів | Середній |
| 5 | HTTP Webhook (POST callback URL) для real-time подій | Низький (є WebSocket) |
| 6 | Роль `bot` з обмеженими правами | Середній |
| 7 | API-key auth (альтернатива JWT для M2M) | Низький |

---

*Документ згенерований на основі аналізу 19 route-файлів, 13 сервісів та 32 таблиць БД.*
*CRM v12.7.1 | 2026-02-17*
