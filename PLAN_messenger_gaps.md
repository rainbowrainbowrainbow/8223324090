# План: Що є і чого не вистачає в месенджері (по ТЗ v1.0)

## ✅ Що ВЖЕ реалізовано

### База даних
- `chat_channels` — базова таблиця (slug, name, description, is_default, is_dm, dm_user_ids)
- `chat_messages` — повідомлення (seq numbers, reply_to, edited_at, deleted_at)
- `chat_channel_members` — учасники (last_read_seq, muted)
- `chat_reactions` — реакції (emoji)
- `chat_mentions` — @згадки (notified flag)
- `chat_pinned` — закріплені повідомлення
- Функція `next_chat_seq()` — атомарний sequence number
- Дефолтні канали: #команда, #бронювання, #каса, #технічний
- DM підтримка (міграція 032)

### Backend API (routes/chat.js — 428 рядків)
- `GET /api/chat/channels` — список каналів + непрочитані
- `POST /api/chat/channels` — створити канал
- `GET /api/chat/channels/:id/messages` — пагіновані повідомлення
- `POST /api/chat/channels/:id/messages` — відправити (з @mentions)
- `PUT /api/chat/channels/:id/read` — позначити прочитаним
- `POST/DELETE /api/chat/messages/:id/reactions` — реакції
- `PUT /api/chat/messages/:id` — редагувати повідомлення
- `DELETE /api/chat/messages/:id` — видалити (soft delete)
- `GET/POST/DELETE /api/chat/channels/:id/pinned` — pin/unpin
- `PUT /api/chat/channels/:id/mute` — заглушити
- `GET /api/chat/channels/:id/members` — учасники
- `POST /api/chat/channels/:id/members` — додати учасника
- `DELETE /api/chat/channels/:id/members/:userId` — видалити учасника
- `POST /api/chat/channels/:id/join` — приєднатися
- `POST /api/chat/dm` — створити/знайти DM
- `GET /api/chat/users` — список юзерів для autocomplete
- `GET /api/chat/users/:id/profile` — профіль
- `GET /api/chat/unread` — глобальні непрочитані

### WebSocket (services/websocket.js — 528 рядків)
- Native `ws` (НЕ Socket.io — це ОК, працює)
- JWT автентифікація
- Heartbeat 30с + авто-відключення мертвих з'єднань
- Підписка на канали (CHAT_JOIN/CHAT_LEAVE)
- Typing indicator (CHAT_TYPING)
- broadcastToChannel(), sendToUser(), sendToUsername()
- Max 5 з'єднань на юзера

### Services (chatService.js — 561 рядків)
- Повний CRUD для каналів, повідомлень, реакцій
- DM створення/пошук
- @mention парсинг
- Seq collision retry
- Auto-join до дефолтних каналів

### Frontend
- `chat.html` — 277 рядків (SPA layout)
- `js/chat-page.js` — 1920 рядків (повна логіка)
- `css/chat.css` — 1786 рядків (стилі)
- Клешня-чат окремо: `services/kleshnya-chat.js` — 1268 рядків

---

## ❌ Чого НЕ ВИСТАЧАЄ (по Фазах ТЗ)

### ФАЗА 1 — Базовий чат (пріоритет HIGH)

| # | Що потрібно | Статус | Деталі |
|---|---|---|---|
| 1 | **Офлайн-черга** | ❌ | Клієнтська черга повідомлень при обриві з'єднання. Зберігати в localStorage, відправити при реконекті |
| 2 | **Авто-реконнект WS** | ⚠️ Перевірити | В chat-page.js — чи є reconnect з backoff? |
| 3 | **Звукові сповіщення** | ❌ | Звуки для нових повідомлень, @mentions. Toggle в UI |
| 4 | **client_message_id** | ❌ | Дедуплікація повідомлень (ТЗ ризик #2). UUID на клієнті → перевірка на сервері |
| 5 | **Read receipts (✓✓)** | ❌ | ✓ відправлено, ✓✓ прочитано — Telegram-style |

### ФАЗА 1 — DB Schema gaps

| # | Колонка | Де | Деталі |
|---|---|---|---|
| 6 | `type` | chat_channels | 'general', 'booking', 'private', 'system' — для фільтрації та прав |
| 7 | `linked_entity_type` | chat_channels | 'booking', 'client', 'event' — зв'язок з CRM |
| 8 | `linked_entity_id` | chat_channels | ID пов'язаного запису |
| 9 | `is_archived` | chat_channels | Для архівації каналів подій |
| 10 | `is_bot` | chat_messages | TRUE для повідомлень Клешні |
| 11 | `content_type` | chat_messages | 'text', 'system', 'alert', 'task_ref' |
| 12 | `metadata` | chat_messages | JSONB — task_id, booking_id тощо |
| 13 | `role` | chat_channel_members | 'admin', 'member', 'readonly' |

### ФАЗА 1 — Missing API

| # | Endpoint | Деталі |
|---|---|---|
| 14 | `PATCH /api/chat/channels/:id` | Оновити назву/опис каналу |
| 15 | `DELETE /api/chat/channels/:id` | Архівувати канал (is_archived = true) |
| 16 | `GET /api/chat/search` | Пошук по повідомленнях (q, channel_id) |

### ФАЗА 2 — Задачі + CRM інтеграція (пріоритет MEDIUM)

| # | Що потрібно | Деталі |
|---|---|---|
| 17 | **Таблиця `chat_tasks`** | message_id, channel_id, assigned_to/by, title, status, deadline |
| 18 | **API: GET/POST/PATCH tasks** | CRUD для задач з чату |
| 19 | **Slash-команда `/task`** | `/task @юзер опис [deadline]` — створює задачу |
| 20 | **Slash-команда `/tasks`** | Список задач (окрема вкладка або inline) |
| 21 | **Авто-повідомлення: нове бронювання** | CRM event → повідомлення в #бронювання |
| 22 | **Авто-повідомлення: оплата** | CRM event → повідомлення в #каса |
| 23 | **Картки бронювань в чаті** | Клікабельні, з деталями і кнопками [Відкрити в CRM] |
| 24 | **Авто-канали для подій** | При створенні бронювання → канал #event-{date}-{id} |
| 25 | **Кнопка "взяв в роботу"** | Під задачею в чаті |

### ФАЗА 3 — Охоронець + Клешня (пріоритет LOW для MVP)

| # | Що потрібно | Деталі |
|---|---|---|
| 26 | **Bot-юзер в БД** | Клешня і Охоронець як системні юзери (is_bot) |
| 27 | **Slash-команди бота** | `/booking ID`, `/status`, `/alert`, `/help` |
| 28 | **Охоронець: класифікація** | Критичне / важливе / звичайне по ключовим словам |
| 29 | **Пересилання в Telegram** | Важливе → Клешня в Telegram |
| 30 | **DND режим** | "Не турбувати" для юзерів |
| 31 | **Модерація оффтопіку** | "⚠️ Можливо, це краще в #загальний" |

### UI/UX доповнення (по ТЗ)

| # | Що потрібно | Деталі |
|---|---|---|
| 32 | **Telegram-style bubbles** | Свої праворуч (фіолетові), чужі ліворуч (сірі) |
| 33 | **Timestamp в баблі** | Час праворуч знизу всередині повідомлення |
| 34 | **CRM-картки в чаті** | Інтерактивні картки бронювань з кнопками |
| 35 | **Навігація з CRM** | Іконка чату в навігації CRM з бейджем непрочитаних |
| 36 | **Мобільна адаптація** | Responsive CSS для мобільного браузера |
| 37 | **Колірна схема ТЗ** | --bg-primary: #0f0f1a, --bubble-own: #5c3d99 тощо |

---

## 🎯 Рекомендований порядок роботи

### Етап А: DB + Backend gaps (Фаза 1 завершення)
1. Міграція 033: додати колонки type, linked_entity_type/id, is_archived, is_bot, content_type, metadata, role
2. Додати client_message_id для дедуплікації
3. API: PATCH/DELETE channels, search
4. Офлайн-черга (клієнт)
5. Авто-реконнект WS з backoff
6. Звукові сповіщення

### Етап Б: Задачі + CRM (Фаза 2)
7. Міграція: chat_tasks таблиця
8. API: tasks CRUD
9. Slash-команда /task парсинг
10. CRM events → чат (booking:created, payment:received)
11. Авто-канали для подій
12. Картки бронювань

### Етап В: Бот + Охоронець (Фаза 3)
13. Bot-юзери в БД
14. Slash-команди бота
15. Watchdog логіка
16. Telegram forwarding

### Етап Г: UI полірування
17. Telegram-style дизайн (bubbles, timestamps)
18. Responsive mobile
19. Read receipts
20. Звуки
