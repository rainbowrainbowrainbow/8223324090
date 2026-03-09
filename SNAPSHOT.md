# SNAPSHOT — Park Booking System (Event Genix)

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v22.3.1** (test release). Бранч `claude/setup-test-release-85ryz`.

## Актуальний стан

### Версія та бранч
- **package.json**: `"version": "22.3.1"`
- **Бранч**: `claude/setup-test-release-85ryz`
- **Попередній бранч**: `claude/event-genix-crm-handoff-7ANWR`
- **main**: відстає (v20.2.0), PR ще не створені

### Тести
- **296 тестів**, 296 pass
- Запуск: `PGUSER=postgres PGPASSWORD=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node --test tests/api.test.js`

### Сервер
```bash
PGUSER=postgres PGPASSWORD=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node server.js
```
Порт 3000. PostgreSQL: `pg_ctlcluster 16 main start`

## Що зроблено (v22.0.0 → v22.3.0)

### v22.0.0 — Dashboard як HOME
- Dashboard з віджетами як головна сторінка
- 25 ролей у системі
- Тест-панель creator

### v22.1.0 — Messenger UX
- Емодзі пошук
- Lightbox для зображень
- Reactions
- ARIA доступність
- Mobile оптимізація

### v22.2.0 — Gamification MVP
- XP, рівні, монети
- 20 досягнень
- Магазин
- Лідерборд
- 10 таблиць БД

### v22.3.0 — Game Profile
- Таб "Гра" в профілі при кліку на нікнейм
- Dashboard dark mode fix

### v22.3.1 — Test Release
- Тестовий реліз для перевірки пайплайну

## Ключові файли останніх сесій
```
js/auth.js              — профіль-модалка з 5 табами (Сьогодні, Гра, Задачі, Стати, Налашт.)
js/api.js               — 8 нових apiGamification*() функцій
css/features.css        — +300 рядків game tab стилів
css/dashboard.css       — dark mode fix для віджетів
services/gamification.js — повний gamification service (727 рядків)
routes/gamification.js  — 10 API ендпоінтів
profile.html            — standalone profile сторінка
js/profile-page.js      — standalone profile JS
```

## Що готово (коротко, всі попередні версії)
- v5.30–v5.51: Design System v4.0, responsive, dark mode, PWA, security, performance
- v6.0: Test Mode
- v7.0–v7.9: Каталог, Clawd Bot, Афіша, Задачник, standalone pages
- v8.3–v8.6: Автоматизація, сертифікати, розумний розподіл
- v9.0–v9.1: DnD, recurring, analytics, offline, migrations, WebSocket
- v10.0–v10.5: Tasker, Kleshnya, Security, Data Integrity, Reliability, Profile
- v11.0–v13.0: Kleshnya chat v1/v2, design board, auto dark mode
- v14.0–v14.4: Branding, Warehouse, тести
- v15.0–v15.1: HR Module, CRM Phase 2
- v16.0–v16.2: Finance, Analytics v2, Swagger
- v17.0–v17.10: Export, Budget, Procurement, AI Team, Task Bot, Worker Forge
- v18.0–v18.4: Sidebar Nav, Center, Art Director, Demo/Packages, Leo v2, Status Page
- v19.0–v19.17: Event Queue, Rule Engine, Deep Integration, UI Polish, Search, Loyalty, Charts, Backend Hardening, Monitoring
- v20.0–v20.12.0: Milestone, Role System, Command Panel, Navigation, Sales, Rebranding, Tests, Security, UX, Validation, Swagger
- v22.0.0–v22.3.0: Dashboard HOME, Messenger UX, Gamification MVP, Game Profile
- **v22.3.1: Test Release (ПОТОЧНА)**

## Незроблені задачі
- **BUG-001** — Тімур бот: зайвий текст при decline/other
- **CRM-VAL-001** — Бекенд валідація минулої дати в бронюванні
- **Dashboard** — можливо потребує ще тестування на production
- **Gamification** — наповнення магазину реальними товарами

## Пастки
- **Gamification API** повертає масиви напряму, БЕЗ `{ success, data }` обгортки
- **Версіонування**: 21 HTML файл з `?v=` тегами — оновлювати ВСЕ при version bump
- **Два профілі**: `profile.html` (standalone) та модалка в `auth.js` (вбудована)
- **Dashboard dark mode**: фон сторінки `#0D0D0D`, картки мають бути `#2A2A4A+`
- **Dark mode gray inversion**: gray-800 = #F3F4F6 = БІЛИЙ в dark mode! Використовуй `rgba(255,255,255,0.08)`
- **Toast замість Notification**: `#notification` більше НЕМАЄ — тепер `#toastContainer` + `showNotification()`
- **Multi-agent**: Завжди git fetch + перевіряй чи хтось не змінив файли. Коміти з тегом `[claude-code]`

## Архітектура
- **17+ сторінок**, **40+ routes**, 18+ services, 5 middleware
- **~95+ таблиць**, 80+ індексів, 35 міграцій
- ~85 000+ рядків коду
- 296 тестів (296 pass)

## Деплой
- `main` — staging (PR мерджаться сюди)
- `deployed` — production Railway (ТІЛЬКИ Клешня деплоїть)
- НІКОЛИ не push в `deployed` напряму

---
*Оновлено: 2026-03-09, v22.3.1, сесія claude-code (test release)*
