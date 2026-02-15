# CHANGELOG — Park Booking System

> Журнал змін. Останні версії зверху, детально. Старі — коротко внизу.

---

## v11.0.0 — Дофамінові покращення (2026-02-15)

**Kleshnya Greeting & Chat:**
- Quick stats bar → two-column layout: статистика ліворуч, Kleshnya banner праворуч
- Персоналізовані привітання на основі бронювань, задач, стріків, часу доби
- Greeting cache в БД (4h TTL) для rate-limit майбутніх AI agent викликів
- Повна чат-сторінка `/kleshnya` з історією повідомлень
- Template-based responses (agent-ready hook для майбутньої AI інтеграції)
- API: GET/POST `/api/kleshnya/greeting`, GET/POST `/api/kleshnya/chat`
- Dark mode + responsive support

**Особистий кабінет — повна перебудова:**
- 4 таби: Сьогодні / Задачі / Стати / Налашт.
- **Сьогодні:** shift block, SVG progress ring, actionable inbox (прострочені + майбутні задачі з done/start), admin team overview grid
- **Задачі:** inline status actions (start/done), blocked task indicators, dependency awareness, priority highlighting, animated task completion
- **Стати:** stat cards з week-over-week deltas, бали з task links, escalation history, certificate details, 12 achievements grid
- **Налашт.:** зміна пароля, user details, logout
- 12 досягнень (first_task, streak_3/7/30, booking_pro тощо) з auto-grant логікою
- `user_action_log` таблиця + POST/GET endpoints для UI click tracking
- `user_achievements` + `user_streaks` таблиці
- PATCH `/tasks/:id/quick-status` для inline task actions з профілю
- 23 паралельні SQL запити у `/profile` endpoint (Promise.allSettled)
- ~500 рядків нових CSS стилів (tabs, progress ring, shift block, inbox, team grid, achievements)

**БД (+3 таблиці):**
- `kleshnya_messages` (greeting cache), `kleshnya_chat` (chat history)
- `user_action_log`, `user_achievements`, `user_streaks`

**Файли:**
- `kleshnya.html` — нова сторінка чату
- `services/kleshnya-greeting.js` — новий (greeting engine)
- `routes/kleshnya.js` — новий (API greeting + chat)
- `routes/auth.js` — розширений `/profile` з 23 queries
- `js/auth.js` — перебудований profile modal з 4 табами
- `js/api.js` — +kleshnya API methods
- `js/timeline.js` — kleshnya banner на головній
- `css/modals.css` — +500 рядків profile styles
- `css/layout.css`, `css/dark-mode.css`, `css/responsive.css` — kleshnya layout

---

## v10.5.0 — Verification Bump (2026-02-15)

- **Profile modal на суб-сторінках:** tasks.html, programs.html, staff.html — додані modals.css та profile modal HTML
- **Modal UX:** close (×), backdrop click, Escape key в initProfileHandler
- **Auto-init:** profile click handler через DOMContentLoaded на всіх сторінках
- Всі 221 тестів пройдено

---

## v10.4.0 — Особистий кабінет PRO (2026-02-15)

- **Кабінет PRO:** повна переробка з 15+ SQL запитами через Promise.allSettled (паралельні)
- **Увага:** блок "Потребують уваги" — прострочені задачі, дедлайни < 24 год
- **Мої задачі:** inline-список з пріоритетами, дедлайнами, статусами (overdue виділені)
- **Бали:** транзакції останніх нарахувань з причинами (ON_TIME, EARLY, LATE тощо)
- **Лідерборд:** ранг #N серед усіх користувачів
- **Бронювання:** розбивка по статусах (підтверджені/попередні/скасовані), виручка (admin only), топ-3 програми
- **Сертифікати:** видані по статусах (активні/використані)
- **Задачі:** середній час виконання, кількість ескалацій, розбивка по категоріях
- **Зміна пароля:** PUT /api/auth/password з валідацією та bcrypt
- **Активність:** збільшено до 20 записів + пагінація "Показати ще"
- **Telegram:** статус підключення у профілі (badge)
- **UX:** мобільний responsive (3+2 grid на малих екранах), 5 stat cards замість 4

---

## v10.3.0 — Особистий кабінет (2026-02-15)

- **Особистий кабінет:** клік по імені користувача відкриває модальне вікно з персональною інформацією
- **API:** GET /api/auth/profile — консолідований профіль (user info + points + tasks + bookings + activity)
- **Профіль:** аватар, роль, дата реєстрації, статистика (бронювання, задачі, бали), остання активність
- **UX:** username кликабельний з underline hint, повна keyboard accessibility

---

## v10.2.0 — Reliability (2026-02-15)

- **Logging:** замінені всі `/* non-blocking */` catch блоки на log.warn з context (scheduler, afisha)
- **ROLLBACK safety:** distributeAfishaForDate — ROLLBACK з .catch() і логуванням помилки
- **Graceful shutdown:** drain in-flight Telegram запитів перед закриттям DB pool (drainTelegramRequests)
- **Body limit:** /api/backup/restore збільшений до 50mb (великі SQL дампи)

---

## v10.1.0 — Data Integrity (2026-02-15)

- **Migration 004:** unique partial indexes для дедуплікації recurring bookings, tasks, afisha (template_id + date)
- **Migration 004:** додані відсутні індекси: bookings(status), tasks(assigned_to), tasks(assigned_to, date)
- **Atomic dedup:** scheduler recurring tasks і afisha використовують INSERT ON CONFLICT замість SELECT → INSERT (race condition fix)
- **Optimistic locking:** updateTaskStatus перевіряє version column перед UPDATE (захист від конкурентних змін)
- **DB:** додана колонка `tasks.version` (INTEGER DEFAULT 1) для optimistic locking

---

## v10.0.1 — Security Hotfix (2026-02-15)

- **RBAC:** tasks write-операції (POST/PUT/PATCH/DELETE) обмежені ролями admin/user, viewer = read-only
- **RBAC:** points leaderboard = admin/user, individual points = own + admin, history = own + admin
- **Security:** parseInt валідація в Telegram callback handlers (NaN guard з early return)
- **Security:** приховані DB error messages у backup endpoints (no schema leakage)
- **Security:** валідація `type` параметра в tasks GET query filter
- **Security:** обмежений offset в points history (max 10000, DoS prevention)

---

## v10.0.0 — Tasker & Kleshnya (2026-02-15)

**Tasker — операційний центр:**
- Централізований задачник з двома типами: `human` (людина) / `bot` (система)
- Дві ролі: `owner` (менеджер, ескалація) + `assigned_to` (виконавець)
- Дедлайни, вікна виконання, залежності між задачами
- `control_policy` (JSONB) — правила нагадувань та ескалації на рівні задачі
- `source_type` — відстеження джерела задачі (booking, trigger, recurring, kleshnya)

**Клешня (services/kleshnya.js) — центральний інтелект:**
- Створення задач з логуванням + нотифікацією
- 4-рівнева ескалація: м'яке → жорсткіше → увага → директор
- Автоматичне нарахування балів при завершенні задач
- Персональні Telegram-повідомлення (chat_id) + групові (@mention)
- Журнал змін (task_logs) з повною історією

**Система балів:**
- `user_points` — постійні (накопичувальні) + місячні (обнуляються 1-го)
- `point_transactions` — повна історія нарахувань
- Правила: вчасно +5/+2, з запасом +7/+3, high priority +10/+5, прострочено -2..-5
- API: GET /api/points (leaderboard), GET /api/points/:username/history

**Scheduler (3 нові, всього 11):**
- `checkTaskReminders` — щохвилинна перевірка дедлайнів + ескалація
- `checkWorkDayTriggers` — тригери початку дня (10:00/12:00), автозадачі піньят/футболок
- `checkMonthlyPointsReset` — обнулення місячних балів 1-го числа

**Telegram бот (+3 команди, всього 10):**
- `/tasks` — мої задачі на сьогодні (з визначенням юзера через telegram_username)
- `/done <id>` — завершити задачу з нарахуванням балів
- `/alltasks` — всі задачі команди, згруповані по виконавцях
- Inline-кнопки: `task_confirm`/`task_reject` для підтвердження

**БД (+4 таблиці, +15 колонок):**
- tasks: +task_type, +owner, +deadline, +time_window_start/end, +dependency_ids, +control_policy, +escalation_level, +source_type, +source_id, +last_reminded_at
- users: +telegram_chat_id, +telegram_username
- Нові: task_logs, user_points, point_transactions

**Файли:**
- `services/kleshnya.js` — новий (центральний процесор)
- `routes/points.js` — новий (API балів)
- `services/bot.js` — +3 команди (/tasks, /done, /alltasks)
- `services/scheduler.js` — +3 scheduler функції
- `routes/tasks.js` — інтеграція з Клешнею (logs, owner, task_type)
- `routes/telegram.js` — +task_confirm/reject callbacks, auto-register chat_id
- `server.js` — +points route, +3 schedulers
- `db/index.js` — +4 таблиці, +15 колонок, +12 індексів

---

## v9.1.0 — Live-Sync (2026-02-15)

**WebSocket підключено:**
- `services/websocket.js` підключено до `server.js` через `initWebSocket(server)`
- Graceful shutdown: WSS закривається перед DB pool
- `routes/bookings.js`: broadcast після create/create-full/update/delete
- `routes/lines.js`: broadcast після зміни ліній
- `js/auth.js`: ParkWS.connect() при логіні, disconnect() при logout
- userId coerced to String для коректного excludeUser

**SessionStart hook:**
- `.claude/hooks/session-start.sh`: старт PostgreSQL + npm install + env vars
- Працює тільки в remote (Claude Code на вебі)

---

## v9.0.2 — Доступність (2026-02-15)

- Skip-links на всіх 5 сторінках
- `@media (prefers-reduced-motion: reduce)` — вимкнення анімацій
- programs.html: cache bust v7.9.2 → v9.0.2

---

## v9.0.1 — Стабілізація (2026-02-15)

- Staff toolbar: кнопки винесені в окремий `.schedule-toolbar`
- Cache bust staff.html і tasks.html

---

## v9.0.0 — Розумна платформа (2026-02-15)

- **Drag-and-drop** на таймлайні (мишка/палець + resize + undo)
- **Повторювані бронювання** (шаблони щотижня/через тиждень/щомісяця, авто-генерація 14 днів)
- **Аналітика** (дашборд виручки, топ програм, завантаженість)
- **Оптимістичне блокування** (updated_at + PL/pgSQL тригер + HTTP 409)
- **Offline режим** (Service Worker + IndexedDB mutation queue)
- **Міграції БД** (db/migrate.js + 3 міграції)
- **Тести:** certificates.test.js (82) + automation.test.js (51)

---

## v8.6.1 — Оновлений дизайн сертифікатів (2026-02-14)

- Новий фон + QR у лівий нижній кут (150px замість 216px)

---

## v8.6.0 — Розумний розподіл (2026-02-14)

- Birthday blocks: pill-форма з градієнтом + 🎂 + пульсуюча анімація
- Авто-розподіл афіші перед дайджестами та нагадуваннями

---

## v8.5.0–v8.5.2 — Сертифікати (2026-02-13)

- v8.5.0: Панель сертифікатів (slide-in, статистика, градієнтні картки)
- v8.5.1: Графічні сертифікати (Canvas PNG, Містер Зак)
- v8.5.2: Сезонний маскот (4 seasonal ілюстрації)

---

## v8.4.0 — Сертифікати MVP (2026-02-13)

- Реєстр CERT-YYYY-NNNNN, Telegram-сповіщення, scheduler expiry

---

## v8.3.0–v8.3.3 — Автоматизація + Bugfixes (2026-02-12)

- v8.3.0: Automation rules engine + Drag-to-Move афіша
- v8.3.1: МК Футболки (розміри XS-XL в extra_data, 2 автоматизації)
- v8.3.2: Фікс історії (афіша/автоматизація рендеринг) + extra_data в linked bookings
- v8.3.3: Bugfixes (undo в історії, share/copy invite crash fix)

---

## v7.8–v7.9.2 — Задачі & Програми & Мобільна адаптація (2026-02-11–12)

- v7.8: Standalone Tasks & Programs pages + recurring task templates
- v7.8.1–v7.8.9: Мобільна адаптація (свайп, CSS Grid toolbar, glassmorphism, WCAG 44px touch targets)
- v7.8.10: Дайджест для 2го ведучого + афіша ±1год
- v7.9.0: Дошка задач (5 вкладок, канбан, авто-задачі з афіші, категорії)
- v7.9.2: Стилізовані емодзі іконки з градієнтними колами

---

## v7.0–v7.6.1 — Каталог, Бот, Афіша, Задачник (2026-02-11)

- v7.0: Product Catalog MVP (products таблиця, API, кеш 5хв, seed 40 програм)
- v7.1: Admin CRUD каталогу (create/edit/deactivate, requireRole middleware)
- v7.2: Clawd Bot (7 команд: today/tomorrow/programs/find/price/stats/menu)
- v7.3: Афіша в Telegram (дайджест + нагадування з подіями)
- v7.4: Типи подій (event/birthday/regular), іменинники в Telegram
- v7.5: Задачник MVP (tasks CRUD, статуси todo/in_progress/done, пріоритети)
- v7.6: Афіша → Задачі (генерація, шаблони, каскадне видалення)
- v7.6.1: Переключення ліній аніматорів + z-index bugfix

---

## v6.0 — Test Mode (2026-02-08)

- Безпарольний login: будь-який username → admin role, token 24h
- **УВАГА:** тимчасова версія для тестування

---

## v5.30–v5.51 — UI/UX Overhaul & Design System (2026-02-07–08)

| Версія | Що |
|---|---|
| v5.30 | Design System v4.0 (emerald, CSS tokens, 10-file architecture) |
| v5.31–v5.33 | Segmented controls, program cards, booking panel mobile |
| v5.34–v5.35 | Responsive (4 breakpoints, tablet overlay, desktop grid) |
| v5.36–v5.38 | Афіша/Історія UI, dark mode coverage, favicon/PWA |
| v5.39–v5.41 | Bugfixes, security headers, rate limiting, performance (indexes) |
| v5.42–v5.48 | Design tokens, modals polish, dashboard, invite overhaul, inline cleanup |
| v5.49 | Program search |
| v5.50 | Duplicate booking |
| v5.51 | Undo for edit & shift |

---

## До v5.30

- v5.29: Modular backend (routes/, services/, middleware/)
- v5.28: Structured logging, request IDs
- v5.19: Free rooms, booking linking
- v5.18: Room selection

---

*Формат: останні версії детально, старі — коротко.*
