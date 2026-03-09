# SNAPSHOT — Event Genix CRM

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v22.3.0**. Бранч `claude/event-genix-crm-handoff-7ANWR`.

## Актуальний стан

### Версія та бранч
- **package.json**: `"version": "22.3.0"`
- **Бранч**: `claude/event-genix-crm-handoff-7ANWR`
- **Що нового у v22.3.0**: Game Profile — таб "Гра" в профілі (досягнення, магазин, інвентар, лідерборд)

### Тести
- **296 тестів**, 296 pass, 0 fail
- Запуск: `PGUSER=postgres PGPASSWORD=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node --test tests/api.test.js`
- automation.test.js — 28 тестів ЗАВЖДИ фейляться (pre-existing, НЕ наші)

### Сервер
```bash
PGUSER=postgres PGPASSWORD=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node server.js
```
Порт 3000. PostgreSQL: `pg_ctlcluster 16 main start`

## Що зроблено в цій сесії (від v22.0.0 до v22.3.0)

### v22.0.0 — Dashboard + 25 Roles + Navigation
- **Dashboard** — персоналізована HOME-сторінка `/dashboard` з віджетами (задачі, бронювання, графік, команда, погода, курси, оголошення)
- **25 ролей** — розширення з 10 до 25 (бухгалтер, арт-директор, маркетолог, IT, HR, шеф-кухар, кондитер, рецепція, бариста, клінінг, технік та ін.)
- **Навігація** — дашборд як головна, мердж сторінок, sidebar з динамічними NAV_ITEMS
- **Тест-панель** — creator може переключати ролі для тестування інтерфейсів
- **Onboarding** — вибір віджетів при першому вході на дашборд
- **Widget API** — `/api/dashboard/*` ендпоінти, кеш для погоди/курсів
- **Role DB** — нова таблиця role_definitions з 25 ролями, departments, parent_role

### v22.1.0 — Messenger UX
- **Пошук емодзі** — реальна фільтрація по ключових словах (укр/eng)
- **Lightbox** — повноекранний перегляд зображень з галереєю ←→
- **Unread separator** — роздільник "Нові повідомлення" при переключенні каналів
- **Scroll badge** — кнопка ↓ з кількістю нових при скролі вгору
- **Reaction popup** — hover на реакціях показує список хто поставив
- **Drag overlay** — візуальне "Перетягніть файл сюди" при drag&drop
- **ARIA** — keyboard navigation в каналах, focus-visible, Escape закриває панелі
- **Touch/Mobile** — safe-area-inset, 44px touch targets
- **Dashboard fix** — виправлені SQL запити віджетів (price, label, staff_schedule)

### v22.2.0 — Gamification MVP
- **Gamification service** — `services/gamification.js` (727 рядків): XP, рівні, монети, стріки
- **Achievement catalog** — 20 досягнень (one_time, repeatable, rare, secret, seasonal)
- **Character items** — backgrounds, frames, hats, weapons, shields, outfits, effects, badges
- **Shop** — магазин предметів за монети, купівля, інвентар, екіпування
- **Leaderboard** — таблиця лідерів по XP/монетах/досягненнях
- **API** — `/api/gamification/*` (10 ендпоінтів: profile, achievements, shop, equip, coins, leaderboard)
- **DB** — міграція 039_gamification.sql: 10 нових таблиць
- **Standalone profile** — `profile.html` + `js/profile-page.js` (повна сторінка гейміфікації)

### v22.3.0 — Game Profile + Dashboard Dark Mode Fix
- **Таб "Гра" в профілі** — клік на нікнейм → модалка з 5 табами (Сьогодні, **Гра**, Задачі, Стати, Налашт.)
- **Game sub-tabs** — Досягнення, Інвентар, Магазин, Лідери — все в одному місці
- **XP progress bar** — рівень, титул, монети в шапці ігрового профілю
- **Магазин в профілі** — купівля предметів за монети без переходу на окрему сторінку
- **Інвентар** — екіпувати/зняти предмети одним кліком
- **Dashboard dark mode** — картки `#2A2A4A` з видимими бордерами (було `#252540` → зливалося з фоном `#0D0D0D`)
- **8 API helpers** — `apiGamification*()` функції в api.js
- **CSS** — ~300 рядків нових стилів для game tab (features.css) з dark mode
- **Version bump** — v22.3.0 на 21 HTML сторінці, tagline, changelog

## Змінені файли (ця сесія)
```
package.json            — version 22.3.0
index.html              — version bump, changelog entries, ?v= tags
dashboard.html          — version bump, dark mode flash prevention, ?v= tags
profile.html            — version bump
css/dashboard.css       — dark mode fix: solid backgrounds, visible borders, hover effects
css/features.css        — +300 рядків game tab styles (achievements, shop, inventory, leaderboard)
js/api.js               — +8 apiGamification*() functions
js/auth.js              — +200 рядків: game tab, sub-tabs, render functions, buy/equip/leaderboard
js/dashboard-page.js    — widget-based personalized dashboard
js/profile-page.js      — standalone gamification page
services/gamification.js — gamification service (XP, coins, achievements, shop, leaderboard)
routes/gamification.js  — gamification API routes
db/migrations/039_gamification.sql — 10 new tables
+ 16 standalone HTML pages — version bump ?v= tags
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
- v20.0–v20.12: Milestone, Role System, Command Panel, Navigation, Sales, Rebranding, Tests, Security, UX, Validation, Swagger
- v21.12–v21.15: Dark Mode Fix, Night Settings, Polish, A11y, Tablet, Unified Navigation
- **v22.0–v22.3: Dashboard, Messenger UX, Gamification, Game Profile (ПОТОЧНА СЕСІЯ)**

## Незроблені баги
- **BUG-001** — Тімур бот: зайвий текст при decline/other — НЕ ЗРОБЛЕНО
- **CRM-VAL-001** — Минула дата в бронюванні — НЕ ЗРОБЛЕНО (бекенд валідація)

## Архітектура
- **21+ сторінок**, **40+ routes**, 18+ services, 5 middleware
- **~105+ таблиць**, 80+ індексів, 44 міграції
- ~90 000+ рядків коду
- 296 тестів (296 pass)

## Відомі проблеми / пастки
- **Dark mode gray inversion**: gray-800 = #F3F4F6 = БІЛИЙ в dark mode! Використовуй rgba(255,255,255,0.08)
- **Dashboard dark mode**: Фон сторінки `#0D0D0D`, картки мають бути `#2A2A4A+` щоб були видимі
- **Версіонування 5 кроків**: package.json → all HTML `?v=` tags (21 файлів) → tagline → changelog button → changelog entry
- **Два профілі**: `profile.html` (standalone, повний) та модалка в `auth.js` (вбудована, з game tab)
- **Gamification API**: Повертає масиви/об'єкти напряму, БЕЗ `{ success: true, data: [...] }` обгортки
- **Toast замість Notification**: `#toastContainer` + `showNotification()` створює toast елементи
- **_debug() у ws.js/offline.js**: Показує тільки при `localStorage.pzp_debug = 'true'`
- **Multi-agent**: Завжди git fetch + перевіряй чи хтось не змінив файли. Коміти з тегом `[claude-code]`

## Деплой
- `main` — staging (PR мерджаться сюди)
- `deployed` — production Railway (ТІЛЬКИ Клешня деплоїть)
- НІКОЛИ не push в `deployed` напряму

---
*Оновлено: 2026-03-09, v22.3.0, сесія claude-code*
