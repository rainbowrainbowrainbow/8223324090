# SNAPSHOT — Park Booking System

> Оновлюється кожні 10-15 повідомлень. Швидкий контекст для продовження роботи.

## Де ми
Версія **v9.1.0**. Live-Sync: WebSocket підключено, accessibility, SessionStart hook.

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
- v7.8.1-v7.8.9: Мобільна адаптація (свайп, тулбар, glassmorphism, WCAG touch targets)
- v7.8.10: Дайджест для 2го ведучого + афіша ±1год
- v7.9.0: Дошка задач з категоріями (5 вкладок, канбан, авто-задачі з афіші)
- v7.9.2: Стилізовані емодзі іконки з градієнтними колами по категоріях
- v8.3.0: Автоматизація (правила, задачі, Telegram) + Drag-to-Move афіша
- v8.3.1: МК Футболки (розміри XS-XL в extra_data, 2 автоматизації)
- v8.3.2: Фікс історії (афіша/автоматизація рендеринг) + extra_data в linked bookings
- v8.3.3: Bugfixes (undo_edit/undo_shift в історії, share/copy invite crash fix)
- v8.4.0: Сертифікати (реєстр CERT-YYYY-NNNNN, Telegram-сповіщення, scheduler)
- v8.5.0: Панель сертифікатів (slide-in, статистика, градієнтні картки)
- v8.5.1: Графічні сертифікати (Canvas PNG, Містер Зак)
- v8.5.2: Сезонний маскот (4 seasonal ілюстрації)
- v8.6.0: Розумний розподіл (birthday pill-redesign + авто-distribute перед дайджестами)
- v8.6.1: Оновлений дизайн сертифікатів
- v9.0.0: Розумна платформа (drag-and-drop, recurring bookings, analytics, optimistic locking, offline mode, migrations, tests)
- v9.0.1: Стабілізація (staff toolbar fix, cache bust)
- v9.0.2: Доступність (skip-links, reduced motion, focus indicators)
- v9.1.0: Live-Sync (WebSocket підключено, broadcast bookings/lines, ParkWS connect/disconnect)

## Що далі (план)
- Swagger /api-docs (код є, треба підключити)
- Clawd Bot команди для задач (/tasks, /done)
- Авто-задачі (контент для соцмереж, нагадування)
- Drag-n-drop сортування програм
- Export PDF/Excel

## Архітектура (v9.1.0)

### 5 HTML-сторінок
| Шлях | Файли | Опис |
|---|---|---|
| `/` | index.html + 19 JS + 11 CSS | Таймлайн (SPA) |
| `/tasks` | tasks.html + tasks-page.js | Задачник (5 вкладок, канбан, категорії) |
| `/programs` | programs.html + programs-page.js | Каталог програм (категорії, CRUD, іконки) |
| `/staff` | staff.html + staff-page.js | Графік роботи (тижневий розклад) |
| `/invite` | invite.html | Запрошення (standalone) |

CSS (11 модулів): base, auth, layout, timeline, panel, modals, controls, features, dark-mode, responsive, pages
JS (19 модулів): config, api, ui, auth, timeline, booking, booking-form, booking-linked, settings, settings-afisha, settings-certificates, settings-dashboard, settings-history, app, programs-page, tasks-page, staff-page, offline, ws

### 20 таблиць БД
bookings, lines_by_date, history, settings, users, booking_counter, pending_animators, afisha, afisha_templates, telegram_known_chats, telegram_known_threads, products, tasks, task_templates, scheduled_deletions, staff, staff_schedule, automation_rules, certificates, certificate_counter

### 23 індекси

### 8 Schedulers (60s interval)
- checkAutoDigest (налаштовується)
- checkAutoReminder (налаштовується)
- checkAutoBackup (03:00)
- checkRecurringTasks (00:05)
- checkScheduledDeletions
- checkRecurringAfisha
- checkRecurringBookings
- checkCertificateExpiry

### WebSocket (v9.1.0)
- services/websocket.js — сервер (JWT auth, heartbeat 30s, broadcast, date subscriptions)
- js/ws.js — клієнт (auto-reconnect, exponential backoff 1s-30s)
- Broadcast: booking:created/updated/deleted, line:updated

## Технічний стан
- Branch: `claude/review-project-updates-R2CbJ`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- 364 тестів, 78 suites (api.test.js + certificates.test.js + automation.test.js)
- ~40 000 рядків коду
- SessionStart hook: `.claude/hooks/session-start.sh`

---
*Оновлено: 2026-02-15, v9.1.0*
