# SNAPSHOT — Park Booking System

> Оновлюється кожні 10-15 повідомлень. Швидкий контекст для продовження роботи.

## Де ми
Версія **v7.8.0**. Standalone сторінки Tasks + Programs — **ЗАВЕРШЕНІ**.

## Що готово
- v5.30-v5.38: UI/UX overhaul (design system, responsive, dark mode, PWA)
- v5.39-v5.41: Bugfixes, Security, Performance
- v5.42-v5.48: Design System v4.0 + Integration
- v5.49-v5.51: Program Search, Duplicate Booking, Undo
- v6.0: Test Mode (безпарольний вхід, тимчасовий)
- v7.0: Product Catalog MVP (програми в БД, API read-only)
- v7.1: Admin CRUD каталогу (create/edit/deactivate, role manager, product form)
- v7.2: Clawd Bot (7 Telegram-команд: today/tomorrow/programs/find/price/stats/menu)
- v7.3: Афіша в Telegram (дайджест + нагадування про завтра)
- v7.4: Типи подій (event/birthday/regular), іменинники в Telegram
- v7.5: Задачник MVP (tasks CRUD, статуси, пріоритети, фільтрація)
- v7.6: Афіша -> Задачі (генерація задач по кнопці, шаблони, каскад)
- v7.6.1: Переключення ліній аніматорів + bugfix
- v7.8: Standalone Tasks & Programs pages + recurring task templates

## Що далі (план)
- Clawd Bot команди для задач (/tasks, /done)
- Авто-задачі (контент для соцмереж, нагадування)
- Drag-n-drop сортування програм
- Export PDF/Excel

## Архітектура (v7.8)

### 4 HTML-сторінки
| Шлях | Файли | Опис |
|---|---|---|
| `/` | index.html + 8 JS + 11 CSS | Таймлайн (SPA) |
| `/tasks` | tasks.html + tasks-page.js | Задачник (фільтри, типи, шаблони) |
| `/programs` | programs.html + programs-page.js | Каталог програм (категорії, CRUD) |
| `/invite` | invite.html | Запрошення |

Спільні: config.js, api.js, auth.js, base.css, layout.css, pages.css, dark-mode.css

### 13 таблиць БД
bookings, lines_by_date, history, settings, users, booking_counter, pending_animators, afisha, telegram_known_chats, telegram_known_threads, products, **tasks**, **task_templates**

### 4 Schedulers (60s interval)
- checkAutoDigest (налаштовується)
- checkAutoReminder (налаштовується)
- checkAutoBackup (03:00)
- **checkRecurringTasks (00:05)** — авто-створення recurring задач

## Технічний стан
- Branch: `claude/project-passport-docs-XKYIn`
- Last commit: `982e2a4`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- 20 238 рядків коду, 53 файли
- 192 тести, 54 suites

### Задачі (Tasks System)
- routes/tasks.js — CRUD + PATCH status + filter by type/afisha_id
- routes/task-templates.js — recurring templates CRUD
- tasks.type: manual | recurring | afisha | auto_complete
- tasks.status: todo | in_progress | done
- tasks.priority: low | normal | high
- tasks.afisha_id: зв'язок з подією
- tasks.template_id: зв'язок з шаблоном
- task_templates.recurrence_pattern: daily | weekdays | weekly | custom

### API endpoints (нові у v7.8)
- GET/POST/PUT/DELETE `/api/task-templates`
- GET `/api/tasks?type=recurring`

---
*Оновлено: 2026-02-12, після v7.8*
