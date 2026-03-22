# SNAPSHOT — Event Genix CRM

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md

## Де ми
Версія **v35.0.0**. Бранч `claude/continue-project-work-pdpKD` — запушений.

## Актуальний стан

### Версія та бранч
- **package.json**: `"version": "35.0.0"`
- **Бранч**: `claude/continue-project-work-pdpKD` (pushed to origin)
- **Попередній бранч**: `claude/continue-work-hqBJ1` (v33.16.0 — base)
- **main**: v20.9.15 (відстає значно)

### Тести
- **346 тестів**, 346 pass, 0 fail
- Запуск: `PGUSER=postgres PGPASSWORD=postgres PGDATABASE=park_booking PGHOST=localhost RATE_LIMIT_MAX=5000 node --test tests/api.test.js`

### Сервер
```bash
PGUSER=postgres PGPASSWORD=postgres PGDATABASE=park_booking PGHOST=localhost RATE_LIMIT_MAX=5000 node server.js
```
Порт 3000. PostgreSQL 16.

## Що зроблено в цій сесії

### v34.0.0 — Sidebar Full Rebuild
- **Accordion Groups** — CRM, Управління, Творче, Система з CSS grid animation
- **Unified Nav** — однаковий sidebar на всіх 24 сторінках
- **Cross-Page Actions** — Афіша/Сертифікати/Налаштування працюють з будь-якої сторінки (`?open=` auto-open)
- **sidebarCollapseBtn** — додано на всі 23 standalone сторінки
- **Nav Icons** — emoji 15px/17px, scale hover animation
- **New Routes** — /afisha, /certificates → redirect; /designer, /sound → fallback
- **PAGE_ACCESS** — +4 сторінки (/designer, /sound, /afisha, /certificates)
- **Dark Mode** — повна підтримка accordion стилів
- **11 багфіксів (E1-E11)** — grid animation, sidebarActions hidden, double active /staff, toggleGroup export

### Hotfixes (v33.17.0)
- **8 unclosed `<div>` tags** в changelog секції index.html виправлено (624/624 balanced)
- **Test Build** — тестова збірка для перевірки деплою

## Змінені файли (повний список)
```
js/components/sidebar.js  — ПОВНА ЗАМІНА: accordion groups, NAV_ITEMS, toggleGroup, sidebarOpen* helpers
js/app.js                 — _checkAutoOpen() з ?open= параметром
js/auth.js                — PAGE_ACCESS: +/designer, /sound, /afisha, /certificates
css/layout.css            — nav-icon 28px/15px, accordion CSS (groups, arrow, animation, dark mode)
css/dark-mode.css         — nav-icon active box-shadow
server.js                 — /afisha, /certificates redirect; /designer, /sound fallback routes
index.html                — #sidebarActions hidden, version bump, changelog entry
package.json              — version 35.0.0
CHANGELOG.md              — v35.0.0 entry
SNAPSHOT.md               — this file
+ 23 standalone HTML      — sidebarCollapseBtn + sidebar.js?v=34.0.0
  (dashboard, tasks, chat, warehouse, customers, analytics, finance, hr,
   center, programs, staff, copilot, art-director, graduation, demo, designs,
   game, leads, training, reports, report-agent, omni, shop)
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
- v28.0–v28.2: Rock Sound Engine, Manager AI Copilot, Guardian
- v29.0–v30.0: Leads, Graduation, Chat improvements
- v31.0–v33.16: Hub Nav, Sound System, Alerts, Sidebar Pro, Test Builds
- **v34.0.0–v35.0.0: Sidebar Full Rebuild (ПОТОЧНА СЕСІЯ)**

## Незроблені баги з BUGFIX_TASKS.md
- **BUG-001** — Тімур бот: зайвий текст при decline/other (`tymur-bot/bot.py`) — НЕ ЗРОБЛЕНО
- **CRM-VAL-001** — Минула дата в бронюванні — НЕ ЗРОБЛЕНО (бекенд валідація)
- **CRM-UI-001** — День тижня на таймлайні — ВЖЕ ПРАЦЮЄ
- **CRM-UI-002** — Календар з Понеділка — ВЖЕ ПРАЦЮЄ
- **CRM-BUG-002** — Кнопка "Афіша" в меню — ВИПРАВЛЕНО в v34.0.0 (тепер в sidebar як action-link)

## Архітектура
- **24+ сторінок**, **40+ routes**, 18+ services, 5 middleware
- **~95+ таблиць**, 80+ індексів, 35 міграцій
- ~85 000+ рядків коду
- 346 тестів (346 pass)

## Відомі проблеми / пастки
- **Dark mode gray inversion**: gray-800 = #F3F4F6 = БІЛИЙ в dark mode! Використовуй rgba(255,255,255,0.08)
- **Версіонування 5 кроків**: package.json → index.html `?v=` (32+ тегів) → tagline → changelog button → changelog entry
- **center.html standalone**: Має inline `<style>` + dark-mode.css. Дублювати dark overrides
- **Два системи нотифікацій**: templates.js (прямі) та eventBus.js (rule-based)
- **Toast замість Notification**: `#notification` більше НЕМАЄ — тепер `#toastContainer` + `showNotification()` створює toast елементи
- **_debug() у ws.js/offline.js**: Замінено console.log на `_debug()` (показує тільки при `localStorage.pzp_debug = 'true'`)
- **Multi-agent**: Завжди git fetch + перевіряй чи хтось не змінив файли. Коміти з тегом `[claude-code]`
- **gh CLI**: Немає GitHub токена — PR створювати вручну на GitHub
- **Sidebar accordion**: `sidebar-group-inner { min-height: 0 }` — КРИТИЧНО для grid collapse
- **#sidebarActions**: НЕ видаляти, тільки `display:none` — app.js/auth.js мають обробники
- **showAfishaModal/openCertificatesPanel**: Існують ТІЛЬКИ в index.html — на інших сторінках `sidebarOpen*` робить redirect

## Деплой
- `main` — staging (PR мерджаться сюди)
- `deployed` — production Railway (ТІЛЬКИ Клешня деплоїть)
- НІКОЛИ не push в `deployed` напряму

---
*Оновлено: 2026-03-22, v35.0.0, сесія claude-code*
