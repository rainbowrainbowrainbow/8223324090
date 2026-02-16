# 🦞 Claw ↔ Park Booking Integration Guide

**API Version:** 1.0
**Last Updated:** 2026-02-16
**Base URL:** `https://park-booking.railway.app` (TBD after deployment)

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [API Endpoints](#api-endpoints)
4. [Event Polling](#event-polling)
5. [Integration Examples](#integration-examples)
6. [Error Handling](#error-handling)

---

## 🎯 Overview

Park Booking System надає **External API** для інтеграції з Claw (Club Bot). API дозволяє:

- 📊 Отримувати загальну статистику (бронювання, задачі, стрік)
- ✅ Управляти задачами (створювати, оновлювати, фільтрувати)
- 📅 Читати бронювання та розклад персоналу
- 🔔 Отримувати події через polling (webhook альтернатива)
- 👋 Генерувати персоналізовані привітання з контекстом

---

## 🔑 Authentication

Всі запити до `/api/external/*` захищені **API ключем**.

### Використання:

```http
GET /api/external/context HTTP/1.1
Host: park-booking.railway.app
X-API-Key: 51cb10428a6655c519d3346fbf99784824dd8eb596fcb1d33356e966fd2fb083
```

### API Key:

```
51cb10428a6655c519d3346fbf99784824dd8eb596fcb1d33356e966fd2fb083
```

**⚠️ Важливо:**
- Ключ передається через header `X-API-Key`
- Без ключа - **401 Unauthorized**
- Невірний ключ - **403 Forbidden**

---

## 🚀 API Endpoints

### 1. GET /api/external/context

**Опис:** Загальна статистика системи для AI контексту.

**Request:**
```http
GET /api/external/context HTTP/1.1
X-API-Key: 51cb10428a6655c519d3346fbf99784824dd8eb596fcb1d33356e966fd2fb083
```

**Response:**
```json
{
  "bookingsCount": 1247,
  "totalRevenue": 3456000,
  "pendingTasks": 12,
  "overdueTasks": 3,
  "streak": 14,
  "today": {
    "bookings": 5,
    "revenue": 12500
  }
}
```

**Поля:**
- `bookingsCount` — загальна кількість бронювань (крім скасованих)
- `totalRevenue` — загальна виручка в грн (all-time)
- `pendingTasks` — активні задачі (todo + in_progress)
- `overdueTasks` — прострочені задачі
- `streak` — стрік (дні з ≥1 бронюванням підряд, останні 30 днів)
- `today.bookings` — бронювань сьогодні
- `today.revenue` — виручка сьогодні в грн

---

### 2. GET /api/external/tasks

**Опис:** Список задач з фільтрами.

**Query параметри:**
- `status` (optional): `todo` | `in_progress` | `done`
- `assigned_to` (optional): username (наприклад, `admin`)
- `date` (optional): `YYYY-MM-DD`
- `category` (optional): `event` | `purchase` | `admin` | `trampoline` | `personal` | `improvement`

**Request:**
```http
GET /api/external/tasks?assigned_to=admin&status=todo HTTP/1.1
X-API-Key: 51cb10428a6655c519d3346fbf99784824dd8eb596fcb1d33356e966fd2fb083
```

**Response:**
```json
{
  "tasks": [
    {
      "id": 42,
      "title": "🪅 Замовити друк піньяти №15 на 2026-02-20",
      "description": null,
      "date": "2026-02-17",
      "status": "todo",
      "priority": "high",
      "assigned_to": "admin",
      "created_by": "automation",
      "created_at": "2026-02-16T10:30:00.000Z",
      "updated_at": "2026-02-16T10:30:00.000Z",
      "completed_at": null,
      "category": "purchase",
      "type": "automation"
    }
  ]
}
```

---

### 3. POST /api/external/tasks

**Опис:** Створити нову задачу.

**Body (обов'язкові поля):**
- `title` (string) — назва задачі
- `created_by` (string) — username хто створив

**Body (опціональні поля):**
- `description` (string)
- `date` (string, YYYY-MM-DD)
- `priority` (string): `low` | `normal` | `high` (default: `normal`)
- `assigned_to` (string): username
- `category` (string): `event` | `purchase` | `admin` | `trampoline` | `personal` | `improvement` (default: `admin`)

**Request:**
```http
POST /api/external/tasks HTTP/1.1
X-API-Key: 51cb10428a6655c519d3346fbf99784824dd8eb596fcb1d33356e966fd2fb083
Content-Type: application/json

{
  "title": "Перевірити бронювання на завтра",
  "description": "Звірити всі підтвердження з клієнтами",
  "date": "2026-02-17",
  "priority": "high",
  "assigned_to": "Natalia",
  "category": "admin",
  "created_by": "claw"
}
```

**Response:**
```json
{
  "success": true,
  "task": {
    "id": 123,
    "title": "Перевірити бронювання на завтра",
    "description": "Звірити всі підтвердження з клієнтами",
    "date": "2026-02-17",
    "status": "todo",
    "priority": "high",
    "assigned_to": "Natalia",
    "created_by": "claw",
    "created_at": "2026-02-16T14:22:00.000Z",
    "updated_at": "2026-02-16T14:22:00.000Z",
    "completed_at": null,
    "category": "admin",
    "type": "external"
  }
}
```

**⚠️ Події:** Після створення задачі додається запис в `events_log` з типом `task.created`.

---

### 4. PATCH /api/external/tasks/:id

**Опис:** Оновити поля задачі (часткове оновлення).

**URL параметри:**
- `id` — ID задачі (number)

**Body (всі поля опціональні):**
- `status` (string): `todo` | `in_progress` | `done`
- `priority` (string): `low` | `normal` | `high`
- `assigned_to` (string)
- `description` (string)
- `date` (string, YYYY-MM-DD)

**Request:**
```http
PATCH /api/external/tasks/123 HTTP/1.1
X-API-Key: 51cb10428a6655c519d3346fbf99784824dd8eb596fcb1d33356e966fd2fb083
Content-Type: application/json

{
  "status": "done"
}
```

**Response:**
```json
{
  "success": true,
  "task": {
    "id": 123,
    "title": "Перевірити бронювання на завтра",
    "status": "done",
    "priority": "high",
    "completed_at": "2026-02-16T15:00:00.000Z",
    ...
  }
}
```

**💡 Примітка:** Якщо `status` змінюється на `done`, автоматично встановлюється `completed_at = NOW()`.

**⚠️ Події:** Після оновлення додається запис в `events_log` з типом `task.updated`.

---

### 5. GET /api/external/bookings

**Опис:** Бронювання на конкретну дату.

**Query параметри:**
- `date` (required): `YYYY-MM-DD`

**Request:**
```http
GET /api/external/bookings?date=2026-02-16 HTTP/1.1
X-API-Key: 51cb10428a6655c519d3346fbf99784824dd8eb596fcb1d33356e966fd2fb083
```

**Response:**
```json
{
  "bookings": [
    {
      "id": "BK-2026-0042",
      "date": "2026-02-16",
      "time": "14:00",
      "line_id": "1",
      "program_code": "КВ1",
      "label": "КВ1(60)",
      "program_name": "Легендарний тренд",
      "category": "quest",
      "duration": 60,
      "price": 2200,
      "hosts": 1,
      "second_animator": null,
      "room": "Кімната 1",
      "notes": "Піца після квесту",
      "status": "confirmed",
      "kids_count": 8,
      "group_name": "Софійка 7 років",
      "created_by": "admin",
      "created_at": "2026-02-10T12:00:00.000Z"
    }
  ]
}
```

**⚠️ Важливо:**
- Не повертаються бронювання зі статусом `cancelled`
- Відсортовані за часом (`time` ASC)

---

### 6. GET /api/external/staff

**Опис:** Розклад персоналу на конкретну дату.

**Query параметри:**
- `date` (required): `YYYY-MM-DD`

**Request:**
```http
GET /api/external/staff?date=2026-02-16 HTTP/1.1
X-API-Key: 51cb10428a6655c519d3346fbf99784824dd8eb596fcb1d33356e966fd2fb083
```

**Response:**
```json
{
  "staff": [
    {
      "id": 1,
      "name": "Валерія",
      "department": "animators",
      "position": "Аніматор",
      "phone": "+380501234501",
      "telegram_username": "keralunay",
      "shift_start": "10:00",
      "shift_end": "20:00",
      "status": "working",
      "note": null
    },
    {
      "id": 7,
      "name": "Софія Кравченко",
      "department": "animators",
      "position": "Аніматор",
      "phone": "+380501234507",
      "telegram_username": null,
      "shift_start": null,
      "shift_end": null,
      "status": "vacation",
      "note": "Відпустка"
    }
  ]
}
```

**Departments:**
- `animators` — Аніматори
- `admin` — Адміністрація
- `cafe` — Кафе
- `tech` — Технічний відділ
- `cleaning` — Прибирання
- `security` — Охорона

**Statuses:**
- `working` — працює
- `dayoff` — вихідний
- `vacation` — відпустка
- `sick` — лікарняний

---

### 7. POST /api/external/greeting

**Опис:** Генерує персоналізоване привітання з контекстом для користувача.

**Body:**
- `username` (string, required) — username користувача

**Request:**
```http
POST /api/external/greeting HTTP/1.1
X-API-Key: 51cb10428a6655c519d3346fbf99784824dd8eb596fcb1d33356e966fd2fb083
Content-Type: application/json

{
  "username": "admin"
}
```

**Response:**
```json
{
  "greeting": "Доброго дня, Адмін! 👋\n\n⚠️ У вас 2 прострочених задачі.\n🎉 Сьогодні 5 бронювань.",
  "context": {
    "name": "Адмін",
    "role": "admin",
    "pendingTasks": 12,
    "todayBookings": 5,
    "overdueTasks": 2
  }
}
```

**💡 Use case:** Викликати при старті діалогу в Telegram для генерації привітання з контекстом.

---

### 8. GET /api/external/events

**Опис:** Polling endpoint для отримання подій (webhook альтернатива).

**Query параметри:**
- `limit` (optional): кількість подій (default: 10, max: 100)

**Request:**
```http
GET /api/external/events?limit=20 HTTP/1.1
X-API-Key: 51cb10428a6655c519d3346fbf99784824dd8eb596fcb1d33356e966fd2fb083
```

**Response:**
```json
{
  "events": [
    {
      "id": 42,
      "event_type": "task.created",
      "payload": {
        "taskId": 123,
        "title": "Замовити футболки",
        "assignedTo": "admin",
        "date": "2026-02-20"
      },
      "created_at": "2026-02-16T14:22:00.000Z"
    },
    {
      "id": 43,
      "event_type": "task.updated",
      "payload": {
        "taskId": 120,
        "status": "done",
        "priority": "high"
      },
      "created_at": "2026-02-16T15:00:00.000Z"
    }
  ]
}
```

**Event types:**
- `task.created` — створена нова задача
- `task.updated` — оновлена задача

**⚠️ Важливо:**
- Події повертаються **лише 1 раз** (після повернення `processed_at` встановлюється)
- Якщо подій немає → `{ events: [] }`
- Викликати раз на 10-60 секунд (polling)

---

## 🔔 Event Polling

Замість webhooks використовується **polling** через `GET /api/external/events`.

### Рекомендований flow:

```javascript
// Claw side (pseudo-code)
async function pollEvents() {
  const response = await fetch('https://park-booking.railway.app/api/external/events?limit=20', {
    headers: { 'X-API-Key': 'YOUR_KEY' }
  });

  const { events } = await response.json();

  for (const event of events) {
    switch (event.event_type) {
      case 'task.created':
        await handleTaskCreated(event.payload);
        break;
      case 'task.updated':
        await handleTaskUpdated(event.payload);
        break;
    }
  }
}

// Poll every 30 seconds
setInterval(pollEvents, 30000);
```

---

## 💡 Integration Examples

### Приклад 1: Отримати контекст для привітання

**Flow:**
1. User → Telegram: `/start`
2. Claw → `POST /api/external/greeting` з `{ username: "admin" }`
3. Park Booking → повертає привітання + контекст
4. Claw → відправляє привітання в Telegram

**Code:**
```javascript
const greeting = await fetch('/api/external/greeting', {
  method: 'POST',
  headers: {
    'X-API-Key': 'YOUR_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ username: 'admin' })
});

const data = await greeting.json();
await sendTelegramMessage(chatId, data.greeting);
```

---

### Приклад 2: Показати задачі на сьогодні

**Flow:**
1. User → Telegram: "Які задачі на сьогодні?"
2. Claw → `GET /api/external/tasks?date=2026-02-16&assigned_to=admin`
3. Park Booking → повертає список задач
4. Claw → AI генерує відповідь і відправляє в Telegram

**Code:**
```javascript
const today = new Date().toISOString().split('T')[0];
const tasks = await fetch(`/api/external/tasks?date=${today}&assigned_to=admin`, {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});

const { tasks: taskList } = await tasks.json();
const message = `📋 Задачі на сьогодні (${taskList.length}):\n\n` +
  taskList.map((t, i) => `${i+1}. ${t.title} [${t.status}]`).join('\n');

await sendTelegramMessage(chatId, message);
```

---

### Приклад 3: Створити задачу через AI команду

**Flow:**
1. User → Telegram: "Нагадай завтра перевірити бронювання"
2. Claw → AI розпізнає інтент + параметри
3. Claw → `POST /api/external/tasks` з даними
4. Park Booking → створює задачу
5. Claw → підтверджує користувачу

**Code:**
```javascript
const task = await fetch('/api/external/tasks', {
  method: 'POST',
  headers: {
    'X-API-Key': 'YOUR_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    title: 'Перевірити бронювання',
    date: '2026-02-17',
    assigned_to: 'admin',
    priority: 'normal',
    category: 'admin',
    created_by: 'claw'
  })
});

const { task: createdTask } = await task.json();
await sendTelegramMessage(chatId, `✅ Задачу створено: #${createdTask.id}`);
```

---

## ⚠️ Error Handling

### HTTP Status Codes

| Code | Значення | Причина |
|------|----------|---------|
| 200 | OK | Успішний запит |
| 201 | Created | Ресурс створений (POST tasks) |
| 400 | Bad Request | Невалідні параметри |
| 401 | Unauthorized | Відсутній API ключ |
| 403 | Forbidden | Невірний API ключ |
| 404 | Not Found | Ресурс не знайдений |
| 500 | Internal Server Error | Помилка на сервері |

### Error Response Format

```json
{
  "error": "Missing required field: username"
}
```

---

## 📞 Support

**Questions?** Contact Park Booking team або перевір логи:
- `utils/logger.js` — structured logging
- `routes/external.js` — API endpoints

**Deployment:** Railway → URL буде надано після деплою

---

**Готовий до інтеграції!** 🚀🦞
