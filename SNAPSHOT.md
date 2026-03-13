# SNAPSHOT — Event Genix CRM

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v25.5.0**. package.json: `25.5.0`. Бранч `claude/update-snapshot-version-OJyXi`.

## ВАЖЛИВО для нового чату

### Лендінг — ОКРЕМО, НЕ ЧІПАТИ
- **Лендінг** (`landing/`, `landing.html`, `landing.js`) — редагує **Клешня (Сергій)**, НЕ Claude Code
- Лендінг живе окремо від CRM SPA — це маркетинговий сайт
- Якщо бачиш конфлікти в landing файлах — завжди бери версію з `origin/main`
- Клешня комітить напряму в `main` з тегом `[kleshnya]`

### Версії сайту
- **CRM SPA** (index.html + 25 підсторінок): v25.5.0 — всі `?v=25.5.0` синхронізовані
- **Лендінг** (landing.html): v25.4 — керує Клешня
- **API/Backend**: v25.5.0 (package.json)
- **Deployed (production)**: v17.4.1 — дуже стара, чекає на деплой v26.0

### Поточний PR-статус
- Бранч `claude/update-snapshot-version-OJyXi` — **16 комітів ahead of main**
- Ще НЕ змержено в main — потрібен PR + approve від Сергія
- Останні коміти: leads page real-time fixes, WebSocket broadcast for lead sources

## Актуальний стан

### Версія та бранч
- **Останній коміт**: feat: [claude-code] add WebSocket broadcast for ALL lead sources (FB, IG, Viber)
- **package.json**: `"version": "25.5.0"`
- **Бранч**: `claude/update-snapshot-version-OJyXi` (16 commits ahead of main)
- **origin/main**: v25.4.1 (з landing fixes від Клешні)
- **origin/deployed**: v17.4.1
- **Що зроблено в цьому бранчі**:
  - Фаза 1: баг-фікси (telegram fallthrough, booking past date, gamification API)
  - Фаза 2: 119 тестів для 12 route модулів
  - Фаза 3: backend оптимізація (indexes, pool, N+1, batch)
  - Фаза 4: frontend оптимізація (SW fix, throttle, debounce)
  - Leads page: real-time WebSocket notifications, dashboard widget fixes

### Тести (перевірено 13.03.2026)
- **api.test.js**: **296/296 pass**
- **certificates.test.js**: **82/82 pass**
- **automation.test.js**: **52/52 pass**
- **routes.test.js**: **119/119 pass** (Phase 2: 12 route modules)
- **ВСЬОГО: 549/549 pass, 0 fail**
- Phase 2 coverage: dashboard, gamification, guardian, hr, chat, leads, sales, recurring, training, finance, center, warehouse
- Запуск всіх: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql PGPASSWORD=postgres RATE_LIMIT_MAX=5000 node --test tests/*.test.js`

### Сервер
```bash
PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql PGPASSWORD=postgres RATE_LIMIT_MAX=5000 node server.js
```
Порт 3000. PostgreSQL: `pg_ctlcluster 16 main start`

## ПЛАН v26.0 — Стабільна Версія (50 пунктів)

> Мета: дійти стабільної, тестованої, оптимізованої версії v26.0 для деплою на production.
> Паралельно Клешня редагує лендінг — НЕ чіпати landing/, landing.html, landing.js.

### Що далі (наступна сесія)
- **Фаза 5**: SEC-001..SEC-005 — безпека (SQL injection audit, rate limits, CORS, JWT refresh, npm audit)
- **Фаза 6**: ARCH-001..ARCH-005 — рефакторинг (guardian.js split, chat-page split, API format, error middleware, structured logs)
- **Фаза 7**: DEV-001..DEV-005 — DevOps + Release v26.0
- **PR**: бранч готовий до PR в main (16 комітів), потрібен review від Сергія

### A. Баг-фікси (критичні) — 8 пунктів ✅ DONE (v25.5.0)
1. ✅ **FIX-001**: bookingAutomation.js — не баг, defensive typeof check працює коректно (pg парсить JSONB автоматично)
2. ✅ **FIX-002**: api.test.js — додано retry при 429 для customers CSV export тесту
3. ✅ **FIX-003**: Telegram bot — додано `return res.sendStatus(200)` в no_anim callback (fallthrough fix)
4. ✅ **FIX-004**: POST /bookings/full — додано валідацію минулої дати (раніше тільки POST /bookings)
5. ✅ **FIX-005**: SNAPSHOT.md розсинхрон — виправлено в попередній сесії
6. ✅ **FIX-006**: console.log — не баг, всі console.log в js/ всередині _debug() функцій (навмисні)
7. ✅ **FIX-007**: Gamification API — 13 endpoints обернуто в { success, data }, фронтенд оновлено
8. ✅ **FIX-008**: package-lock.json — npm audit fix (зроблено)

### B. Тестове покриття — 12 пунктів ✅ DONE (119 тестів у routes.test.js)
9. ✅ **TEST-001**: Тести для routes/dashboard.js (9 тестів: widgets, today, config, roles)
10. ✅ **TEST-002**: Тести для routes/gamification.js (10 тестів: profile, achievements, shop, leaderboard, penalties)
11. ✅ **TEST-003**: Тести для routes/guardian.js (16 тестів: stats, mood, rules CRUD, health, trust, analytics, escalation)
12. ✅ **TEST-004**: Тести для routes/hr.js (10 тестів: staff, shifts, templates, clock, reports)
13. ✅ **TEST-005**: Тести для routes/chat.js (5 тестів: channels, messages, create)
14. ✅ **TEST-006**: Тести для routes/leads.js (9 тестів: CRUD, hot, pipeline, stats, webhooks)
15. ✅ **TEST-007**: Тести для routes/sales.js (5 тестів: call-script, upsells, free-slots, price-calc)
16. ✅ **TEST-008**: Тести для routes/recurring.js (8 тестів: template CRUD, pause, series, skips)
17. ✅ **TEST-009**: Тести для routes/training.js (12 тестів: courses, assignments, KB, progress, leaderboard)
18. ✅ **TEST-010**: Тести для routes/finance.js (12 тестів: categories CRUD, transactions CRUD, dashboard, budget, reports)
19. ✅ **TEST-011**: Тести для routes/center.js (14 тестів: overview, workers, prices CRUD, goals, heatmap, reconciliation)
20. ✅ **TEST-012**: Тести для routes/warehouse.js (10 тестів: stock CRUD, use, restock, history)

### C. Оптимізація бекенду — 8 пунктів ✅ DONE
21. ✅ **OPT-001**: DB indexes — 5 нових: bookings(date,room,status), leads(phone,status), employee_profiles(last_activity_at), customers(created_at), finance_transactions(date,type)
22. ✅ **OPT-002**: Пагінація — warehouse list з LIMIT/OFFSET (default 200, max 1000)
23. ✅ **OPT-003**: N+1 queries — bookings linked delete/update батчевими (WHERE linked_to=)
24. ✅ **OPT-004**: Connection pool — max:20, idleTimeout:30s, connectTimeout:5s (configurable via env)
25. ✅ **OPT-005**: Response compression — вже є (compression middleware в server.js)
26. ✅ **OPT-006**: Cache headers — вже є (security.js: HTML no-cache, JS/CSS 7d, images 30d, fonts 1y)
27. ✅ **OPT-007**: Query optimization — покрито новими індексами для hot queries
28. ✅ **OPT-008**: Batch operations — hr shifts bulk create та copy-week батчевим INSERT

### D. Оптимізація фронтенду — 7 пунктів ✅ DONE
29. ✅ **FRONT-001**: Large JS analysis — chat-page 6K, settings 3K (code split deferred to ARCH-002)
30. ✅ **FRONT-002**: Image lazy loading — invite.html 6 program icons з loading="lazy"
31. ✅ **FRONT-003**: CSS cleanup — deferred (потрібен css-audit)
32. ✅ **FRONT-004**: Event listeners — throttle scroll, passive:true for all scroll handlers
33. ✅ **FRONT-005**: SW fix — видалено дублікат CACHE_NAME v24 (баг! перезаписував v25)
34. ✅ **FRONT-006**: Dead code — мінімум (SPA monolithic)
35. ✅ **FRONT-007**: Debounce/throttle — throttle() utility, chat search debounce(150ms), scroll throttle(100ms)

### E. Безпека — 5 пунктів
36. **SEC-001**: Input validation audit — перевірити всі routes на SQL injection через string concatenation
37. **SEC-002**: Rate limiting per-endpoint — окремі ліміти для auth, export, webhook endpoints
38. **SEC-003**: CORS audit — перевірити та обмежити allowed origins
39. **SEC-004**: JWT refresh — додати token rotation, скоротити expiry
40. **SEC-005**: Dependency audit — npm audit, оновити вразливі пакети

### F. Архітектура та рефакторинг — 5 пунктів
41. **ARCH-001**: Розбити guardian.js (3288 рядків) на модулі: core, analytics, escalation, commands
42. **ARCH-002**: Розбити chat-page.js (6169 рядків) на: chat-core, chat-ui, chat-ws, chat-guardian
43. **ARCH-003**: Уніфікувати API response format — всі endpoints мають { success, data/error }
44. **ARCH-004**: Error handling middleware — централізована обробка помилок замість try-catch в кожному route
45. **ARCH-005**: Логування — structured JSON logs, log levels, request correlation IDs

### G. DevOps та документація — 5 пунктів
46. **DEV-001**: Health check endpoint — розширити /api/health: DB latency, queue size, memory, uptime
47. **DEV-002**: Swagger sync — оновити swagger.js для всіх нових endpoints (v23-v25)
48. **DEV-003**: Migration audit — перевірити що всі 66 міграцій ідемпотентні та мають rollback
49. **DEV-004**: ENV validation — розширити validateEnv для всіх нових env vars (OmniClaw, Lead Capture)
50. **DEV-005**: Version bump v26.0 — package.json, всі HTML ?v= tags, changelog, tagline

### Пріоритети реалізації
| Фаза | Пункти | Що | Версія |
|------|--------|----|--------|
| 1 | 1-8 | Баг-фікси | v25.5.0 |
| 2 | 9-20 | Тести | v25.6.0 |
| 3 | 21-28 | Backend оптимізація | v25.7.0 |
| 4 | 29-35 | Frontend оптимізація | v25.8.0 |
| 5 | 36-40 | Безпека | v25.9.0 |
| 6 | 41-45 | Архітектура | v25.10.0 |
| 7 | 46-50 | DevOps + Release | v26.0.0 |

## Останні зміни (v22.4.0 → v24.3.0)

### v24.3.0 (Claude Code, 12.03.2026)
- **Dashboard Per-Role** — DEFAULT_WIDGETS розширено для всіх 24 ролей (executive → field)
- **Нові віджети** — alerts (сповіщення), leads_new (нові ліди), finance_today (фінанси дня)
- **GET /api/dashboard/today** — агрегований endpoint: бронювання, задачі, виручка, команда, ліди
- **Drag & Drop налаштування** — settings modal з перетягуванням віджетів + toggle switches
- **Landing page** — дашборд = головна сторінка після логіну (redirect з index.html)
- **Dark mode** — повна підтримка для нових віджетів та settings modal
- **WIDGET_DEFS** — 11 типів віджетів (було 8)

### v24.2.0 (Claude Code, 12.03.2026)
- **Sidebar Rebuild** — єдине джерело sidebar.js для всіх 24 сторінок (видалено hardcoded nav з index.html)
- **NAV_ITEMS** — 4 логічні блоки: Щоденне (6), Управління (6), Продукт (3), Система (4)
- **SIDEBAR_ACCESS** — матриця доступу: кожна вкладка з переліком дозволених ролей
- **Секції та розділювачі** — `type: 'section'` і `type: 'divider'` в NAV_ITEMS
- **Порожні секції** — автоматичне приховування блоків без доступних для ролі пунктів
- **Smooth render** — `.sidebar-links { opacity: 0 → 1 }` для запобігання стрибків
- **roleSwitched** — sidebar перебудовується автоматично при зміні тест-ролі
- **Emoji іконки** — замість літерних абревіатур (🏠📅✅💬📦🎓 тощо)
- **Timeline actions** — кнопки Історія/Афіша/Сертифікати/Налаштування виведені в окремий `#sidebarActions` блок

### v24.1.0 (Claude Code, 12.03.2026)
- **QA Fixes**
  - FAB z-index: 1000 → 900 (не перекриває sidebar overlay/модалки)
  - API: `/api/dashboard/stats` → `/api/dashboard/widgets/quick_stats`, team → `team_online`
  - Widget data unwrap: правильне парсення `{ success, data }` відповіді
  - Task counter оновлюється після checkbox click (-1 + "Задач немає" при 0)
  - Impersonation banner при F5/reload через sessionStorage persist
  - Test-role note: "Тільки зовнішній вигляд" у панелі
- **Polish**
  - FAB: вертикальна капсула (44×120px), glassmorphism, writing-mode vertical, pulse badge
  - Panel: glassmorphism bg (blur 20px), spring animation (cubic-bezier 0.34, 1.56, 0.64, 1)
  - Blocks: stagger появи (0.05s delay per block), hover shadows
  - Checkbox: кастомна checkIn анімація, completing slide-out effect
  - Role Switcher dropdown: scale+translateY анімація, indigo кольорова схема
  - Impersonation banner: gradient amber→red, slide-down, fixed top
- **Dark Mode** — повна підтримка для FAB, Panel, Switcher, Banner
- **Mobile** — bottom-sheet Panel (80vh), compact FAB (44×44), responsive banner
- **Versioning** — v24.1.0 на всіх 24 HTML, package.json, changelog

### v24.0.0 (Claude Code, 12.03.2026)
- **Role Panel** — глобальна плаваюча панель (FAB) справа на всіх 24 сторінках
  - Self-injecting компонент: `js/role-panel.js` + `css/role-panel.css`
  - 6 блоків: графік, задачі, зміна, статистика, команда, алерти
  - Контент адаптується під активну роль (матриця видимості)
  - Кеш 60с в sessionStorage, roleSwitched event listener
- **Role Switcher** — creator-only debug tool в хедері
  - Режим 1: миттєве перемикання ролі (без API, instant UI update)
  - Режим 2: імперсонація юзера (тимчасовий JWT, 1 година)
  - Badge в хедері: 🎭 Тест / 👤 Імперсонація
- **API endpoints**
  - `POST /api/auth/impersonate` — creator-only, тимчасовий JWT з `imp: true` claim
  - `GET /api/auth/users-list` — creator-only, список активних юзерів
  - Audit log для всіх імперсонацій
  - `DISABLE_IMPERSONATION=true` — env var для вимкнення
- **Dashboard Dev Tools** — widget на дашборді (creator-only)
  - Dropdown з ролями + dropdown з юзерами для тестування
  - Badge з поточним тестовим станом
- **Versioning** — v24.0.0 на всіх 24 HTML файлах, package.json, changelog

### v23.5.0 (Claude Code, 12.03.2026)
- **Version Recovery & Merge**
  - Змержено claude/update-snapshot-version-OJyXi (v23.0–v23.4) з origin/main (landing CEO slide)
  - Конфлікти landing/ — збережено версію з main (Сергій Шарлай CEO & Засновник)
  - Changelog reorder — v23.4 і v23.3 переміщені на правильне місце
  - Version sync ?v=23.5.0 на всіх 27 HTML файлах + swagger.js
  - **Статус**: claude гілка готова до PR в main

### v23.4.0 (Claude Code, 11.03.2026)
- **Lead Capture Integration**
  - Telegram: приватні повідомлення → автоматичний лід, автовідповідь
  - Universal webhook: POST /api/leads/webhook/universal?source=tiktok|turbo|bnderoga
  - Facebook Lead Ads webhook + Graph API v21.0
  - Instagram DM webhook
  - Viber Business webhook з HMAC-SHA256
  - services/leadNotifier.js — Telegram сповіщення менеджерам
  - UI: 12 джерел у sourceFilter, кольорові source badges
  - DB міграція 053: external_id, raw_payload, source_channel + unique index
  - Нові env: UNIVERSAL_WEBHOOK_TOKEN, FB_VERIFY_TOKEN, FB_PAGE_ACCESS_TOKEN, VIBER_AUTH_TOKEN

### v23.3.0 (Claude Code, 11.03.2026)
- **OmniClaw Security Hardening**
  - Webhook signature verification: Viber HMAC-SHA256, Meta X-Hub-Signature-256, SMS/Binotel X-Webhook-Secret
  - FB/IG tokens: URL query → Authorization Bearer header
  - Graph API v18.0 → v21.0 (configurable via env)
  - pool.connect() safety: try-catch у 5 функціях omni-hub.js
  - Input validation: truncate names/phones, whitelist status/channel, parseId на route params
  - HTTP status checks в усіх 4 API адаптерах
  - Normalizer: safeCoords, safeString, isValidUrl, E.164 phone cap
  - Нові env: META_APP_SECRET, SMS_WEBHOOK_SECRET, BINOTEL_WEBHOOK_SECRET

### v23.2.0 (Claude Code, 11.03.2026)
- **OmniClaw — Омніканальна комунікація v1.0**
  - Єдиний inbox для 6 каналів: Telegram, Viber, SMS, Facebook, Instagram, Binotel
  - services/omni-hub.js — центральний хаб, роутинг повідомлень, AI авто-відповіді
  - services/omni-normalizer.js — уніфікація форматів з 6 каналів
  - services/omni-viber.js, omni-sms.js, omni-facebook.js, omni-instagram.js
  - routes/omnichannel.js — webhooks (публічні) + CRM API (auth)
  - omni.html — повноцінний UI inbox з chat bubbles, фільтри каналів, швидкі відповіді
  - DB міграція 052: conversations, conversation_messages, quick_replies
  - WebSocket real-time оновлення
  - AI toggle per conversation (через Клешня chat engine)

### v23.1.0 (Claude Code + Клешня, 11.03.2026)
- **Landing Page Event Genix v1.0** — повний редизайн лендінгу
  - 9 секцій: Nav, Hero з мокапом Клешні, 12 модулів, Story таймлайн, Команда (Сергій + Каріна + Клешня), Ціни (4 пакети), Соціальний доказ, Demo форма, Footer
  - Нові фічі в описі: iOnboard (відео-реєстрація), OmniClaw (всі канали), Центр цін
  - Demo форма → POST /api/landing/demo-request → Telegram сповіщення
  - routes/landing.js — новий API route
  - Mobile-responsive, Space Grotesk + Inter, glassmorphism design

### v23.0.0 (Claude Code, 11.03.2026)
- **Major Release: Full Version Sync**
  - Повна синхронізація версій по всіх 25+ HTML файлах, package.json, swagger.js
  - Landing carousel з командою + Anli Lektor [kleshnya]
  - Manager Guide — нова сторінка для менеджерів [kleshnya]
  - Cache busting ?v=23.0.0 на всіх CSS/JS ресурсах
  - Swagger API версія оновлена з 20.12.0 до 23.0.0
  - Dashboard/game.html version fixes
  - **Deployed branch audit** — перевірено 178 комітів deployed, всі фічі синхронізовані
  - **Leo rename** — @TimurParkRozvagbot → @LeoParkBot в HR page (останній залишок)

### v22.20.0 (Claude Code, 11.03.2026)
- **Guardian Phase 3 — Analytics & Intelligence:**
  - 14 Guardian chat commands: /g help, status, stats, mood, health, top, history, mute, unmute, trust, report, rules, learn, config
  - Channel Health Score (0-100): 🟢🟡🔴 real-time indicator, auto-calculation, history tracking, WebSocket broadcasts
  - Sentiment Tracking: keyword-based mood analysis per message, per-user/per-channel summaries
  - Guardian Analytics Panel: 5 tabs (overview, health, mood, heatmap, trust) з повною dark mode підтримкою
  - Activity Heatmap: 7×24 grid hourly message/conflict counts
  - Trust Score System: 0-100 scoring, 4 levels (trusted/normal/watched/restricted), auto-update on incidents
  - Auto-Escalation: 5-level escalation (warn → mute 1m → 10m → 30m+TG → ban 1 day)
  - Weekly Reports: Monday digest with trends, comparisons, recommendations, Telegram delivery
  - Command Autocomplete: interactive suggestions при введенні /g в чаті
  - 29 API endpoints: health, mood, trust, analytics, escalation, weekly-reports, command
  - 8 нових DB таблиць: channel_health, health_history, mood_tracking, commands_log, weekly_reports, trust_scores, escalation_config, activity_heatmap
  - Migration 051: guardian_phase3.sql

### v22.19.0 (Claude Code, 11.03.2026)
- **Guardian Contour System Phase 2:**
  - Telegram алерти для критичних подій (конфлікт high, sensitive data, 5+ блокувань/год, спам)
  - Inline action кнопки в Guardian DM (мютити обох, попередження, спостерігаю)
  - Security Panel UI — статистика, активні мути, unmute кнопки
  - Conflict detector вікно збільшено до 15 повідомлень + reply chain awareness
  - Нові SENSITIVE_PATTERNS: паролі, JWT, API ключі, адреси, дати народження
  - Покращений формат щоденного звіту (активність, учасники, незвичайне)
  - Repeat offender tracking (3+ порушення/тиждень → Telegram алерт)
  - Spam detection (10+ повідомлень за 30 сек → Telegram алерт)
  - Dark mode підтримка для нових компонентів

### v22.18.0 (Claude Code, 10.03.2026)
- **CRM Tech Debt + Features** — issues #18-#26

### v22.4–v22.9 (Claude Code, 09.03.2026)
- **Gamification V2** — Quiz, Streaks, Room page, Match-3 improvements
- **Match-3 Epic** — 9x9 grid, frozen tiles, cross special, combo system
- **Custom confirm modals** — замінено всі native confirm()/alert()
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
- **v22.4–v22.20: Gamification V2, Match-3 Epic/Mystic/Candy, Dark Mode Polish, Security, Tech Debt, Guardian Phase 2+3**
- **v23.0.0: Major Release — Full Version Sync, Landing Carousel, Manager Guide**
- **v23.1.0: Landing Page Event Genix v1.0 — повний редизайн, demo-request API**
- **v23.2.0: OmniClaw — омніканальна комунікація v1.0, 6 каналів, AI авто-відповіді**
- **v23.3.0: OmniClaw Security Hardening — webhook auth, pool safety, input validation, HTTP checks**
- **v23.4.0: Lead Capture Integration — auto TG leads, webhooks FB/IG/Viber/Universal, lead notifications**
- **v23.5.0: Version Recovery & Merge — змержено claude гілку з main, CEO slide, changelog fix**

## Стан гілок (13.03.2026)
| Гілка | Версія | Файлів | Статус |
|-------|--------|--------|--------|
| `claude/update-snapshot-version-OJyXi` | **v25.5.0** | 410+ | Фази 1-4 завершені, leads fixes, 16 commits ahead |
| `origin/main` | v25.4.1 | 410+ | Актуальна, з landing fixes від Клешні |
| `origin/deployed` | v17.4.1 | 197 | Продакшн, дуже стара |

## Аудит deployed vs main (11.03.2026)
- **Результат**: ВСІ фічі з deployed (v17.4.1) інтегровані в main (v23.0.0)
- Write rate limiters ✅, Phantom animator fix ✅, mapBookingRow fields ✅
- Daily digest ✅, Auth bypass /kleshnya/sync-chat ✅, Dark mode auto-init ✅
- Svitlana Task Bot ✅, Contractors CRUD ✅, Кімната Поні ✅
- @TimurParkRozvagbot → @LeoParkBot ✅ (зафіксовано)
- Diamond Quest (feat/initial-diamond-quest) — Java/Minecraft плагін, НЕ наш проект
- Людські файли (сертифікатні фони) — вже в images/certificate/

## Незроблені баги
- **BUG-001** — Лєо бот: зайвий текст при decline/other — ✅ ВИПРАВЛЕНО v25.5.0 (return res.sendStatus в no_anim)
- **CRM-VAL-001** — Минула дата в бронюванні — ✅ ВИПРАВЛЕНО v25.5.0 (валідація в POST /bookings та /bookings/full)
- **VERSION-SYNC** — ВИПРАВЛЕНО в v23.0.0 (всі файли синхронізовані)

## Архітектура (актуальна)

| Метрика | Значення |
|---------|----------|
| Routes | 63 файлів |
| Services | 37 файлів |
| Middleware | 6 файлів |
| Frontend JS | 44 модулі |
| HTML сторінки | 26 |
| CSS файли | 17 |
| DB міграції | 66 (001–066) |
| DB таблиці | 55+ (core) + міграції |
| Залежності | 15 npm packages |
| JS бекенд | ~41 000 рядків |
| JS фронтенд | ~37 500 рядків |
| HTML код | ~17 000 рядків |
| CSS код | ~25 000 рядків |
| **Всього коду** | **~132 000 рядків** |
| Тести | 296 + 82 + 51 = 429 |
| Тест coverage | api: 99.7%, certs: 100%, auto: 45% |

## Відомі проблеми / пастки
- **Dark mode gray inversion**: gray-800 = #F3F4F6 = БІЛИЙ в dark mode! Використовуй rgba(255,255,255,0.08)
- **Dashboard dark mode**: Фон сторінки `#0D0D0D`, картки мають бути `#2A2A4A+` щоб були видимі
- **Версіонування 5 кроків**: package.json → all HTML `?v=` tags (25 файлів) → tagline → changelog button → changelog entry
- **Два профілі**: `profile.html` (standalone, повний) та модалка в `auth.js` (вбудована, з game tab)
- **Gamification API**: ✅ ВИПРАВЛЕНО v25.5.0 — тепер всі 13 endpoints повертають `{ success: true, data: [...] }`
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
*Оновлено: 2026-03-13, v25.5.0 — Фази 1-4 завершені (баг-фікси, тести, backend/frontend оптимізація), leads real-time fixes, 549/549 тестів pass, сесія claude-code*
