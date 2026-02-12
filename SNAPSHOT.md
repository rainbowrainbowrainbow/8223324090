# SNAPSHOT — Park Booking System

> Оновлюється кожні 10-15 повідомлень. Швидкий контекст для продовження роботи.

## Де ми
Версія **v8.3.3**. Bugfixes: undo_edit/undo_shift в історії + share/copy invite crash fix.

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
- v7.9.1: SVG іконки (відкинуто)
- v7.9.2: Стилізовані емодзі іконки з градієнтними колами по категоріях
- v8.3.0: Автоматизація (правила, задачі, Telegram) + Drag-to-Move афіша
- v8.3.1: МК Футболки (розміри XS-XL в extra_data, 2 автоматизації) + афіша-блоки row layout
- v8.3.2: Фікс історії (афіша/автоматизація рендеринг) + extra_data в linked bookings
- v8.3.3: Bugfixes (undo_edit/undo_shift в історії, share/copy invite crash fix)

## Що далі (план)
- Clawd Bot команди для задач (/tasks, /done)
- Авто-задачі (контент для соцмереж, нагадування)
- Drag-n-drop сортування програм
- Export PDF/Excel

## Архітектура (v7.9.2)

### 4 HTML-сторінки
| Шлях | Файли | Опис |
|---|---|---|
| `/` | index.html + 8 JS + 10 CSS | Таймлайн (SPA) |
| `/tasks` | tasks.html + tasks-page.js | Задачник (5 вкладок, канбан, категорії) |
| `/programs` | programs.html + programs-page.js | Каталог програм (категорії, CRUD, іконки) |
| `/invite` | invite.html | Запрошення (standalone) |

CSS (10 модулів): base, auth, layout, timeline, panel, modals, controls, features, dark-mode, responsive + pages.css
JS (10 модулів): config, api, ui, auth, timeline, booking, settings, app + programs-page, tasks-page

### 13 таблиць БД
bookings, lines_by_date, history, settings, users, booking_counter, pending_animators, afisha, telegram_known_chats, telegram_known_threads, products, tasks, task_templates

### 4 Schedulers (60s interval)
- checkAutoDigest (налаштовується)
- checkAutoReminder (налаштовується)
- checkAutoBackup (03:00)
- checkRecurringTasks (00:05) — авто-створення recurring задач

## Технічний стан
- Branch: `claude/review-project-docs-mSGjR`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- 190 тестів, 54 suites

### Задачі (Tasks System)
- routes/tasks.js — CRUD + PATCH status + filter by type/afisha_id/category
- routes/task-templates.js — recurring templates CRUD
- tasks.category: event | purchase | admin | trampoline | personal
- tasks.status: todo | in_progress | done
- tasks.priority: low | normal | high
- tasks.afisha_id: зв'язок з подією
- tasks.template_id: зв'язок з шаблоном
- task_templates.recurrence_pattern: daily | weekdays | weekly | custom

### Іконки програм (v7.9.2)
- Унікальні емодзі обгорнуті в .icon-circle з градієнтним фоном по категорії
- Кольори: фіолетовий (quest), блакитний (animation), помаранчевий (show), бірюзовий (photo), зелений (masterclass), рожевий (pinata), сірий (custom)

---
*Оновлено: 2026-02-12, v8.3.3*
