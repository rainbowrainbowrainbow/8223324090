# SNAPSHOT — Event Genix CRM

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v31.8.0**. package.json: `31.8.0`. Бранч `claude/continue-project-work-EAhTA`.

## Актуальний стан

### Версія та бранч
- **Останній коміт**: fix: [claude-code] health check, rate limiter, eventBus column alignment
- **package.json**: `"version": "31.8.0"`
- **Бранч**: `claude/continue-project-work-EAhTA`

### Тести
- **316 тестів** (api.test.js) — all pass
- **51 тестів** (automation.test.js) — all pass (виправлено в цій сесії: type filter fix)
- **82 тести** (certificates.test.js)
- Запуск: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node --test tests/api.test.js`

### Сервер
```bash
PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node server.js
```
Порт 3000. PostgreSQL: `pg_ctlcluster 16 main start`

## Останні зміни (v24.4.0 → v31.8.0)

### v31.5.0–v31.8.0 (Claude Code, 15-16.03.2026)
- **Каталог випускних** — нова вкладка в Designs з пакетами, auto-pricing, друк, hero images, export
- **Embed mode** — запобігання auth redirect та подвійного sidebar в iframe
- **Manager access** — розблоковано доступ менеджерів до HR, Omni, Finance, Analytics, Art Director тощо
- **Login fix** — redirect на canonical login сторінку після logout
- **Health check, rate limiter, eventBus** — alignment fixes

### v31.1.0–v31.4.0 (Claude Code, 14-15.03.2026)
- **Dashboard tasks** — clickable tasks з модалкою, виправлено filter param
- **Kleshnya chat** — fix double-count бронювань з 2 hosts
- **Leads kanban** — Сьогодні/Завтра date filter кнопки
- **Lead status sync** — pipeline_stage синхронізується з status при update
- **CSS cleanup release** — v31.1.0

### v30.3.0 (Claude Code, 14.03.2026)
- **Пошук по таймлайну** — Ctrl+F, підсвітка, навігація ▲▼
- **Redo + Hotkeys** — Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y
- **Шаблони бронювань** — DB + API + UI dropdown
- **Повторювані бронювання UI** — модалка з патернами
- **Bulk-операції** — Shift+Click multi-select
- **PDF експорт** — print stylesheet
- **Міграція 075** — booking_templates

### v24.4.0 (Claude Code, 12.03.2026)
- **QA Mega Fix** — 8 сторінок + adaptive layout + smart hyperlinks + copy-on-hover
- **22 сторінки очищено** — видалено дубльовані script/CSS теги
- **Version sync script** — scripts/version-sync.js
- **Service Worker** — кеш v12→v24

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
- v22.0–v22.20: Dashboard, Messenger UX, Gamification, Game Profile, Match-3 Epic/Mystic/Candy, Dark Mode Polish, Security, Tech Debt, Guardian Phase 2+3
- v23.0–v23.5: Full Version Sync, Landing v1.0, OmniClaw v1.0 + Security, Lead Capture, Version Recovery
- v24.0–v24.4: Role Panel, Role Switcher, Impersonation, Dashboard Per-Role, Sidebar Rebuild, QA Mega Fix
- v30.3: Пошук, Шаблони, Повтори, Bulk-операції, PDF
- **v31.1–v31.8: Dashboard tasks, Leads kanban, Graduation catalogs, Embed mode, Manager access, Health check**

## Незроблені баги
- **BUG-001** — Лєо бот: зайвий текст при decline/other — НЕ ЗРОБЛЕНО
- ~~**CRM-VAL-001** — Минула дата в бронюванні~~ — ВИПРАВЛЕНО (бекенд валідація додана)
- ~~**VERSION-SYNC** — розсинхронізовані ?v= теги~~ — ВИПРАВЛЕНО в цій сесії (всі 360 тегів = 31.8.0)
- ~~**automation.test.js** — 28 тестів фейлились~~ — ВИПРАВЛЕНО (type filter fix в routes/tasks.js)

## Архітектура (актуальна)

| Метрика | Значення |
|---------|----------|
| Routes | 66 файлів |
| Services | 38 файлів |
| Middleware | 6 файлів |
| Frontend JS | 49 модулів |
| HTML сторінки | 32 |
| CSS файли | 20 |
| DB міграції | 77 (001–085) |
| DB таблиці | 48+ (core) + міграції |
| Залежності | 16 npm packages |
| JS код | ~112 000 рядків |
| HTML код | ~22 600 рядків |
| CSS код | ~33 200 рядків |
| **Всього коду** | **~167 800 рядків** |
| Тести | 367+ (316 api + 51 automation) |

## Відомі проблеми / пастки
- **Dark mode gray inversion**: gray-800 = #F3F4F6 = БІЛИЙ в dark mode! Використовуй rgba(255,255,255,0.08)
- **Dashboard dark mode**: Фон сторінки `#0D0D0D`, картки мають бути `#2A2A4A+` щоб були видимі
- **Версіонування 5 кроків**: package.json → all HTML `?v=` tags (32 файли) → tagline → changelog button → changelog entry
- **Два профілі**: `profile.html` (standalone, повний) та модалка в `auth.js` (вбудована, з game tab)
- **Gamification API**: Повертає масиви/об'єкти напряму, БЕЗ `{ success: true, data: [...] }` обгортки
- **Toast замість Notification**: `#toastContainer` + `showNotification()` створює toast елементи
- **_debug() у ws.js/offline.js**: Показує тільки при `localStorage.pzp_debug = 'true'`
- **Multi-agent**: Завжди git fetch + перевіряй чи хтось не змінив файли. Коміти з тегом `[claude-code]`
- **Version mismatch**: Клешня комітить з v22.XX в повідомленні, але не бампить package.json
- **Guardian commands**: `/g` або `/guardian` в чаті — 14 команд, admin-only для модерації
- **Embed mode**: iframe сторінки в Art Director потребують `?embed=1` параметр для запобігання auth redirect

## Деплой
- `main` — staging (PR мерджаться сюди)
- `deployed` — production Railway (ТІЛЬКИ Клешня деплоїть)
- НІКОЛИ не push в `deployed` напряму

---
*Оновлено: 2026-03-16, v31.8.0 + automation test fix + version sync + SNAPSHOT update, сесія claude-code*
