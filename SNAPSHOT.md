# SNAPSHOT — Event Genix CRM

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v38.17.0**. package.json: `38.17.0`. Бранч `claude/continue-project-work-pdpKD`.

## Актуальний стан

### Версія та бранч
- **package.json**: `"version": "38.17.0"`
- **Бранч**: `claude/continue-project-work-pdpKD`
- **origin/main**: v28.2.0 (далеко позаду — наш бранч має merge v38.13.0)
- **Зміни v38.14.0-v38.17.0**:
  - v38.14.0: Каталоги UX (Image Picker 4 варіанти, Premium Catalog Viewer, 81 changelog)
  - v38.15.0: Match-3 спецефекти (bomb/lightning/cross/rainbow) + profile API route
  - v38.16.0: Profile (hero glassmorphism, inventory cards, shop seed, quests seed, Кімнату прибрано)
  - v38.17.0: Leaderboard seed, daily badge, tasks preview

### Що залишилось доробити:
1. Profile: стріки по професіях, equip/unequip UI, confirm()→модалки
2. Match-3: білий фон пофіксити (клітинки фіолетовий тінт є)
3. Рейтинг: потребує реальних даних
4. Міграція 129: може фейлитись якщо prod DB має неповні таблиці

### Тести
- **296+ тестів** (api.test.js)
- Запуск: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node --test tests/api.test.js`
- automation.test.js — 28 тестів ЗАВЖДИ фейляться (pre-existing, НЕ наші)

### Сервер
```bash
PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node server.js
```
Порт 3000. PostgreSQL: `pg_ctlcluster 16 main start`

## Останні зміни (v38.14.0 → v38.17.0)

### v38.17.0 (Claude Code, 26.03.2026)
- **Leaderboard seed** — рейтинг заповнений для всіх юзерів (XP, coins, level)
- **Daily badge pulse** — CSS `badge-pulse` анімація на табі щоденних завдань
- **Tasks preview** — блок попереднього перегляду завдань на профілі
- **Migration 129 fixes** — ALTER TABLE daily_quests ADD all columns (IF NOT EXISTS)

### v38.16.0 (Claude Code, 26.03.2026)
- **Profile Redesign** — hero glassmorphism, контрастні шрифти
- **Inventory** — RPG ячейки → картковий вигляд
- **Shop seed** — 17 items (кава 200₴, піца 800₴ + 6 їжі + 9 косметики)
- **Quests seed** — 8 щоденних квестів
- **Кімната прибрано** — таб "Кімната" видалено

### v38.15.0 (Claude Code, 26.03.2026)
- **Match-3 спецефекти** — bomb, lightning, cross, rainbow анімації
- **Клітинки** — фіолетовий тінт на білому фоні (light mode fix)
- **Profile API** — `/profile/:userId` повертає JSON замість redirect

### v38.14.0 (Claude Code, 26.03.2026)
- **Image Picker** — 4 варіанти: AI генерація, upload, галерея, URL
- **Premium Catalog Viewer** — 7 пакетів випускних з повноекранним переглядом
- **openCatalog fix** — виправлено infinite recursion
- **submitCreateCatalog** — додано відсутню функцію
- **Graduation seed** — inline button styles + catalog seed data

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
- **v22.4–v22.20: Gamification V2, Match-3 Epic/Mystic/Candy, Dark Mode Polish, Security, Tech Debt, Guardian Phase 2+3**
- **v23.0–v23.5: Major Release, Landing, OmniClaw, Lead Capture, Version Sync**
- **v24.0–v24.3: Role Panel, Sidebar Rebuild, Dashboard Per-Role, QA**
- **v25–v37: Continuous CRM improvements**
- **v38.0–v38.13: Sound, HR, Operations, Security, Sidebar, Catalogs, Supabase**
- **v38.14–v38.17: Image Picker, Match-3 FX, Profile Redesign, Leaderboard (ПОТОЧНА СЕСІЯ)**

## Стан гілок (26.03.2026)
| Гілка | Версія | Статус |
|-------|--------|--------|
| `claude/continue-project-work-pdpKD` | **v38.17.0** | Головна робоча гілка |
| `claude/continue-event-genix-crm-REaqT` | **v38.17.0** | Поточна сесія |
| `origin/main` | v28.2.0 | Стара |

## Незроблені баги
- **BUG-001** — Лєо бот: зайвий текст при decline/other — НЕ ЗРОБЛЕНО
- **CRM-VAL-001** — Минула дата в бронюванні — НЕ ЗРОБЛЕНО (бекенд валідація)
- **VERSION-SYNC** — ВИПРАВЛЕНО в v23.0.0
- **3 confirm()** — profile-page.js (рядки 613, 959, 1147) — потребують модалки
- **Streaks** — coin_transactions NOT NULL violation (давній баг)
- **Migration 129** — може фейлитись на prod якщо таблиці неповні (додано ALTER TABLE фікси)

## Архітектура (актуальна)

| Метрика | Значення |
|---------|----------|
| Routes | 62 файлів |
| Services | 35 файлів |
| Middleware | 6 файлів |
| Frontend JS | 44 модулі |
| HTML сторінки | 26 |
| CSS файли | 17 |
| DB міграції | 53 (001–053) |
| DB таблиці | 48+ (core) + міграції |
| Залежності | 15 npm packages |
| JS код | ~90 000 рядків |
| HTML код | ~17 000 рядків |
| CSS код | ~25 000 рядків |
| **Всього коду** | **~132 000 рядків** |
| Тести | 296+ |

## Відомі проблеми / пастки
- **Dark mode gray inversion**: gray-800 = #F3F4F6 = БІЛИЙ в dark mode! Використовуй rgba(255,255,255,0.08)
- **Dashboard dark mode**: Фон сторінки `#0D0D0D`, картки мають бути `#2A2A4A+` щоб були видимі
- **Версіонування 5 кроків**: package.json → all HTML `?v=` tags (25 файлів) → tagline → changelog button → changelog entry
- **Два профілі**: `profile.html` (standalone, повний) та модалка в `auth.js` (вбудована, з game tab)
- **Gamification API**: Повертає масиви/об'єкти напряму, БЕЗ `{ success: true, data: [...] }` обгортки
- **Toast замість Notification**: `#toastContainer` + `showNotification()` створює toast елементи
- **_debug() у ws.js/offline.js**: Показує тільки при `localStorage.pzp_debug = 'true'`
- **Multi-agent**: Завжди git fetch + перевіряй чи хтось не змінив файли. Коміти з тегом `[claude-code]`
- **Version mismatch**: Клешня комітить з v22.XX в повідомленні, але не бампить package.json
- **Guardian commands**: `/g` або `/guardian` в чаті — 14 команд, admin-only для модерації

## Деплой
- `main` — staging (PR мерджаться сюди)
- `deployed` — production Railway (ТІЛЬКИ Клешня деплоїть)
- НІКОЛИ не push в `deployed` напряму

---
*Оновлено: 2026-03-26, v38.17.0 + version sync + test deploy, сесія claude-code*
