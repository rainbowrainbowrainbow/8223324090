# SNAPSHOT — Event Genix CRM

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v22.17.0**. package.json: `22.17.0` (синхронізовано). Бранч `main`.

## Актуальний стан

### Версія та бранч
- **Останній коміт**: v22.17.0 — Match-3 UI polish
- **package.json**: `"version": "22.17.0"` (синхронізовано)
- **Бранч**: `main`
- **Що нового**: Match-3 Candy Crush стиль, custom art assets, UI polish

### Тести
- **296+ тестів** (api.test.js)
- Запуск: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node --test tests/api.test.js`
- automation.test.js — 28 тестів ЗАВЖДИ фейляться (pre-existing, НЕ наші)

### Сервер
```bash
PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node server.js
```
Порт 3000. PostgreSQL: `pg_ctlcluster 16 main start`

## Останні зміни (v22.4.0 → v22.17.0)

### v22.4–v22.9 (Claude Code, 09.03.2026)
- **Gamification V2** — Quiz, Streaks, Room page, Match-3 improvements
- **Match-3 Epic** — 9x9 grid, frozen tiles, cross special, combo system
- **Game fixes** — game over screen, start layout, dashboard stale cache

### v22.10–v22.11 (Claude Code, 09.03.2026)
- **Dark Mode Polish** — 92 нових overrides + JS color fixes, confirm icons, status vars
- **Security Hardening** — input validation, race conditions, error disclosure
- **Gamification Hardening** — DB integrity, bug fixes, tests
- **Match-3 Mystic Edition** — tarot cards, bosses, events, modern UI

### v22.12–v22.17 (Клешня, 09-10.03.2026)
- **Match-3 custom art assets** — v22.12.0
- **Candy Crush icons** — idle/combo/special animations v22.16.0
- **Icon fix** — replace v4 icons with consistent v3/final candy style
- **UI polish** — contrast, style, mystical vibe v22.17.0

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
- v22.0–v22.3: Dashboard, Messenger UX, Gamification, Game Profile
- **v22.4–v22.17: Gamification V2, Match-3 Epic/Mystic/Candy, Dark Mode Polish, Security**

## Незроблені баги
- **BUG-001** — Тімур бот: зайвий текст при decline/other — НЕ ЗРОБЛЕНО
- **CRM-VAL-001** — Минула дата в бронюванні — НЕ ЗРОБЛЕНО (бекенд валідація)
- **VERSION-SYNC** — package.json (22.12.0) розсинхронізований з комітами (v22.17.0)

## Архітектура
- **21+ сторінок**, **40+ routes**, 18+ services, 5 middleware
- **~105+ таблиць**, 80+ індексів, 44 міграції
- ~90 000+ рядків коду
- 296+ тестів

## Відомі проблеми / пастки
- **Dark mode gray inversion**: gray-800 = #F3F4F6 = БІЛИЙ в dark mode! Використовуй rgba(255,255,255,0.08)
- **Dashboard dark mode**: Фон сторінки `#0D0D0D`, картки мають бути `#2A2A4A+` щоб були видимі
- **Версіонування 5 кроків**: package.json → all HTML `?v=` tags (21 файлів) → tagline → changelog button → changelog entry
- **Два профілі**: `profile.html` (standalone, повний) та модалка в `auth.js` (вбудована, з game tab)
- **Gamification API**: Повертає масиви/об'єкти напряму, БЕЗ `{ success: true, data: [...] }` обгортки
- **Toast замість Notification**: `#toastContainer` + `showNotification()` створює toast елементи
- **_debug() у ws.js/offline.js**: Показує тільки при `localStorage.pzp_debug = 'true'`
- **Multi-agent**: Завжди git fetch + перевіряй чи хтось не змінив файли. Коміти з тегом `[claude-code]`
- **Version mismatch**: Клешня комітить з v22.XX в повідомленні, але не бампить package.json

## Деплой
- `main` — staging (PR мерджаться сюди)
- `deployed` — production Railway (ТІЛЬКИ Клешня деплоїть)
- НІКОЛИ не push в `deployed` напряму

---
*Оновлено: 2026-03-10, v22.17.0, сесія claude-code*
