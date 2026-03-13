# CHANGELOG — Event Genix CRM

> Журнал змін. Останні версії зверху, детально. Старі — коротко внизу.

---

## v28.5.0 — Performance & Security Sprint (2026-03-13)
- **[CR-1] defer scripts** — 20 `<script>` тегів на index.html тепер з `defer` атрибутом, не блокують HTML parsing (FCP +1-3с на мобільному) [claude-code]
- **[CR-2] Landing rate limit** — `POST /api/leads/landing` обмежено до 5 заявок/15хв з одного IP (захист від spam-ботів) [claude-code]
- **[CR-3] Guardian phone whitelist** — привілейовані ролі (manager+) можуть ділитися телефонами в чаті; будь-хто може з префіксом "клієнт:", "підрядник:" тощо [claude-code]
- **[H-11] iOS safe-area** — `viewport-fit=cover` + `env(safe-area-inset-bottom)` для FAB, sidebar на iPhone X+ [claude-code]
- **[H-7] Landing fonts async** — Google Fonts завантажуються асинхронно (`media=print` → `onload='all'`), `script.js defer` [claude-code]
- **Cache bust** — index.html scripts оновлено `?v=25.4.1` → `?v=28.5.0` [claude-code]

## v28.1.0 — Manager Tab Fix (2026-03-13)
- **Sidebar init** — на сторінці Менеджера тепер відображається sidebar навігація (раніше `Sidebar.init()` не викликався — sidebar був порожній) [claude-code]
- **Role Panel** — додано `role-panel.js` + `role-panel.css` на сторінку Менеджера [claude-code]
- **Cache bust** — manager.html оновлено `?v=27.0.0` → `?v=28.0.0` [claude-code]

## v28.0.0 — Rock Sound Engine + Chat UX + Контур-2 (2026-03-13)
- **Rock Sound Engine** — `js/sound-engine.js` (333 рядки): Web Audio API синтезатор, рок-тема, 3 теми вибору (Rock/Classic/Subtle) [kleshnya]
- **Chat звуки** — грають навіть коли таб активний, якщо повідомлення не в поточному каналі [kleshnya]
- **Sound Settings** — toggle, гучність, вибір теми прямо в хедері чату [kleshnya]
- **Chat UX** — оновлені стилі `css/chat.css` (+117 рядків), покращений `chat.html` (+96 рядків) [kleshnya]
- **Контур-2 check** — Guardian перевірено: TELEGRAM_BOT_TOKEN ✅ SET, Guardian підключений до chat route ✅ [kleshnya]
- **Bug Fix** — виправлено `_playSound` (раніше ігнорував повідомлення коли таб активний) [kleshnya]
- **Landing cache fix** — JS кеш 5min revalidate замість 7 days immutable (`middleware/security.js`) [kleshnya]
- **Objections data** — `data/objections.json` з заперечення для Manager Copilot [kleshnya]
- **DB Migration 067** — `manager_copilot.sql` (Kleshnya version) [kleshnya]

## v27.0.0 — Manager AI Copilot (2026-03-13)
- **AI Live Coach** — підказки під час дзвінків з вибором сценарію та тону (debounce 800ms live mode) [claude-code]
- **Обробник заперечень** — 8 готових + AI-генеровані відповіді на кастомні заперечення [claude-code]
- **Скрипти дзвінків** — 5 інтерактивних покрокових скриптів з розгалуженнями [claude-code]
- **Шаблони повідомлень** — 7 персоналізованих шаблонів зі змінними [claude-code]
- **Дебрифінг дзвінка** — AI аналіз 1-10 з рекомендаціями покращення [claude-code]
- **Sales Academy** — SPIN/Challenger/MEDDIC методології, ринкові дані, профілі покупців [claude-code]
- **Battle Cards** — 6 карток порівняння з конкурентами [claude-code]
- **Meeting Prep** — AI-згенеровані бріфи з killer questions [claude-code]
- **Deal Pipeline** — Kanban з drag-and-drop [claude-code]
- **Моніторинг взаємодій** — повна історія з follow-up алертами [claude-code]
- **AI Writer** — генерація персоналізованих повідомлень [claude-code]
- **Нові файли**: `manager.html`, `css/manager.css`, `js/manager-page.js`, `routes/manager.js` [claude-code]
- **7 JSON data files**: objections, scripts, templates, battle-cards, sales-academy, sales-methodology, buyer-profiles [claude-code]
- **DB Migration 068** — `manager_copilot.sql` (3 таблиці + 4 нові колонки в leads) [claude-code]

## v25.5.0 — Stabilization Sprint (2026-03-13)
- **Фаза 1 — Bug Fixes** — telegram fallthrough fix, booking past date validation, gamification API format `{success, data}`, flaky test retry [claude-code]
- **Фаза 2 — Route Tests** — 119 нових тестів для 12 route модулів (dashboard, gamification, guardian, hr, chat, leads, sales, recurring, training, finance, center, warehouse) [claude-code]
- **Фаза 3 — Backend Optimization** — 5 DB indexes, warehouse pagination, N+1 batch fix, pool tuning [claude-code]
- **Фаза 4 — Frontend Optimization** — SW cache fix (v12→v24), scroll throttle, passive listeners, chat debounce [claude-code]
- **Leads Real-time** — WebSocket broadcast for all lead sources (FB, IG, Viber), dashboard widget fixes [claude-code]
- **549/549 тестів pass** (api: 296, certs: 82, auto: 52, routes: 119) [claude-code]

## v25.4.1 — Timeline Fix + Robust Rendering (2026-03-12)
- **Timeline Fix** — виправлено критичний баг: виклик неіснуючої функції updateQuickStats() вбивав весь рендер таймлайну — лінії аніматорів не відображались [claude-code]
- **Robust Rendering** — кожне джерело даних (lines, bookings, afisha) тепер ізольоване — падіння одного не блокує інші [claude-code]
- **Debug Logging** — console.log на кожному етапі renderTimeline для швидкої діагностики [claude-code]
- **Error Boundary** — зовнішний try-catch показує видиме повідомлення при критичній помилці замість порожнього таймлайну [claude-code]

## v25.4.0 — Штрафи, Оцінки, Завдання, Опитування, Курси (2026-03-12)
- **Штрафні бали** — система штрафів для персоналу з категоріями (дисципліна, якість, відвідуваність) та можливістю скасування [claude-code]
- **Оцінювання задач** — менеджер може оцінити завершену задачу від 1 до 10, з нарахуванням coins за оцінку [claude-code]
- **Домашні завдання** — система завдань у тренінгах: створення, здача, перевірка з 5 типами (homework, watch, read, create, practice) [claude-code]
- **Quick Poll в чаті** — опитування прямо в чаті з реальним часом через WebSocket, single/multiple/quiz режими [claude-code]
- **Curriculum Builder** — курси з лекціями, записи, прогрес-трекер, ресурси до кожної лекції [claude-code]
- **Meeting Notes** — нотатки зустрічей з action items та автоматичним створенням задач [claude-code]
- **Sales Pipeline** — стадії воронки продажів для лідів (new → contacted → demo → proposal → negotiation → won) [claude-code]

## v25.3.0 — Security Hardening + UX Polish (2026-03-12)
- **JWT_SECRET обов'язковий** — в production сервер не стартує без JWT_SECRET (раніше генерувався рандомний) [claude-code]
- **CORS hardening** — перевірка порту в origin, блокування port-spoofing на localhost [claude-code]
- **Rate limiters** — нові лімітери для change-password, impersonate, shop/buy [claude-code]
- **Global error handler** — window.onerror + unhandledrejection → червоний банер з повідомленням [claude-code]
- **Offline індикатор** — жовтий банер "Ви офлайн" при втраті з'єднання, автозникає при reconnect [claude-code]
- **Focus-visible** — глобальний :focus-visible стиль для keyboard navigation (WCAG 2.1) [claude-code]
- **Tab transitions** — fadeIn анімація при перемиканні табів замість різкого стрибка [claude-code]
- **Skeleton loading** — CSS .skeleton компоненти з shimmer анімацією [claude-code]
- **Empty states** — CSS .empty-state компонент для порожніх списків [claude-code]
- **API wrapper** — apiCall() — єдина обгортка для fetch з auth/error handling [claude-code]
- **npm scripts** — додано dev, test:unit, db:migrate, version:sync, health [claude-code]
- **safeQuery логування** — ігноровані DB помилки тепер логуються в debug [claude-code]

## v25.2.0 — Profile Page Unification + Achievements (2026-03-12)
- **Єдина система рендерингу** — видалено стару System A (статичний HTML), залишено тільки #mainApp + profile-page.js [claude-code]
- **7 вкладок профілю** — Профіль, Ачивки, Інвентар, Магазин, Рейтинг, Кімната, Квести [claude-code]
- **Ачивки з фільтром** — категорії: Робота, Ігри, Квізи, Соціальні, Стріки, Особливі [claude-code]
- **Магазин** — lazy-load товарів, купівля за монети, відображення owned/can-afford стану [claude-code]
- **Лідерборд** — сортування за XP, монетами, ачивками з ранговими іконками [claude-code]
- **Інвентар** — відображення предметів з рарністю (common→legendary) [claude-code]
- **Очищення HTML** — видалено дубльовані CSS link теги в profile.html [claude-code]

## v25.0.0 — Training Knowledge Base + Quiz System (2026-03-12)
- **Повний редизайн сторінки Навчання** — glassmorphism картки, Space Grotesk шрифт, dark mode [claude-code]
- **4 вкладки** — Матеріали, Тести, Прогрес, Рейтинг [claude-code]
- **База знань** — 10 статей для 3 ролей (аніматори, адміни, менеджери) з модалкою читання [claude-code]
- **Система тестів** — квіз по одному питанню, прогрес-бар, пояснення відповідей [claude-code]
- **Бейджі** — 6 нагород: Перший крок, Книжковий черв'як, Всезнайко, Першій тест, Тест-страйк, Ідеальний результат [claude-code]
- **Лідерборд** — топ-10 співробітників за очками (прочитання × 10 + бали + тести × 20) [claude-code]
- **Конфеті** — анімація при успішному проходженні тесту [claude-code]
- **5 нових таблиць** — knowledge_base, progress, tests, test_results, badges [claude-code]
- **8 нових API endpoints** — CRUD бази знань, тести, прогрес, лідерборд [claude-code]

## v24.4.0 — QA Mega Fix + Adaptive Layout (2026-03-12)
- **8 сторінок виправлено** — додано відсутній ui.js (customers, chat, dashboard, leads, profile, shop, quiz, room) — confirmModal/showNotification були undefined [claude-code]
- **Адаптивний layout** — прибрано max-width обмеження (1800/1400/1200px), контент розтягується на повну ширину коли панель закрита [claude-code]
- **Smart hyperlinks** — в деталі бронювання: клікабельний tel:, Instagram, Telegram, CRM-картка клієнта з hover-actions [claude-code]
- **Copy-on-hover** — кнопки 📋 на рядках деталі бронювання + "Скопіювати все" [claude-code]
- **Sidebar gap fix** — прибрано візуальну дірку між навігацією і кнопками дій (flex:1 → margin-top:auto) [claude-code]
- **22 сторінки очищено** — видалено дубльовані script/CSS теги після merge conflicts [claude-code]
- **Script order fix** — profile.html, shop.html: page JS тепер завантажується після залежностей [claude-code]
- **showToast()** — додано alias в ui.js для chat-page.js [claude-code]
- **Version sync** — `scripts/version-sync.js` — один скрипт для синхронізації версій скрізь [claude-code]
- **Service Worker** — кеш v12→v24 для інвалідації застарілих версій [claude-code]
- **Afisha cascade** — DELETE тепер зберігає done таски [claude-code]
- **295 тестів pass** (api.test.js), 82 certificates, 51 automation [claude-code]

## v24.3.0 — Dashboard Per-Role + Customization (2026-03-12)
- **24 ролі** — DEFAULT_WIDGETS розширено для всіх ролей (executive, management, specialists, kitchen, field) [claude-code]
- **Нові віджети** — Сповіщення (alerts), Нові ліди (leads_new), Фінанси сьогодні (finance_today) [claude-code]
- **/api/dashboard/today** — агрегований endpoint для швидкого огляду дня [claude-code]
- **Drag & Drop** — налаштування порядку віджетів перетягуванням + toggle переключачі [claude-code]
- **Landing page** — дашборд тепер головна сторінка після логіну для всіх ролей [claude-code]
- **Dark mode** — повна підтримка для нових віджетів та модалки налаштувань [claude-code]

## v24.2.0 — Sidebar Rebuild (2026-03-12)
- **Єдине джерело** — sidebar тепер тільки через sidebar.js на всіх сторінках (включаючи таймлайн) [claude-code]
- **Логічні блоки** — 4 блоки: Щоденне, Управління, Продукт, Система з розділювачами [claude-code]
- **Матриця ролей** — SIDEBAR_ACCESS — кожна вкладка тільки для потрібних ролей [claude-code]
- **Порожні секції** — автоматичне приховування блоків без доступних пунктів [claude-code]
- **Таймлайн івентів** — перейменовано з "Таймлайн", emoji іконки замість літер [claude-code]
- **Smooth render** — виправлено стрибання вкладок при переходах між сторінками [claude-code]
- **roleSwitched** — sidebar автоматично перебудовується при зміні тест-ролі [claude-code]

## v24.1.0 — QA + Polish (2026-03-12)
- **BUG FIX** — FAB z-index виправлено (900), не перекриває sidebar overlay та модалки [claude-code]
- **BUG FIX** — API endpoints: stats тепер через /api/dashboard/widgets/quick_stats, team через team_online [claude-code]
- **BUG FIX** — Task counter оновлюється при виконанні задачі через checkbox [claude-code]
- **BUG FIX** — Impersonation banner з'являється після F5 (sessionStorage persist) [claude-code]
- **BUG FIX** — Test-role note: "Тільки зовнішній вигляд" при тесті ролі [claude-code]
- **POLISH** — FAB: вертикальна капсула з glassmorphism, writing-mode vertical, pulse badge [claude-code]
- **POLISH** — Panel: glassmorphism фон, stagger анімація блоків (0.05s кожен) [claude-code]
- **POLISH** — Checkbox: кастомна анімація checkIn, completing slide-out [claude-code]
- **POLISH** — Role Switcher dropdown: scale+translateY анімація появи, indigo стиль [claude-code]
- **POLISH** — Dark mode: повна підтримка для всіх нових компонентів [claude-code]
- **POLISH** — Mobile: bottom-sheet panel, compact FAB, responsive banner [claude-code]

## v24.0.0 — Role Panel + Role Switcher (2026-03-12)
- **Role Panel** — глобальна плаваюча панель справа: графік, задачі, зміна, статистика, команда, алерти [claude-code]
- **Role Switcher** — миттєве перемикання ролей + імперсонація для тестування (creator-only) [claude-code]
- **POST /api/auth/impersonate** — новий endpoint для тимчасового JWT від імені юзера [claude-code]
- **Dashboard Dev Tools** — секція на дашборді з dropdown ролей та юзерів (creator-only) [claude-code]
- **24 сторінки** — role-panel.js + role-panel.css підключено до всіх HTML-файлів [claude-code]

## v23.5.0 — Version Recovery & Merge (2026-03-12)
- **Відновлення** — змержено гілку claude/update-snapshot-version-OJyXi в main [kleshnya]
- **OmniClaw** — омніканальна комунікація (Telegram + Viber + FB + IG + Universal) [claude-code]
- **Lead Capture** — автоматичний захват лідів з усіх каналів (v23.4.0) [claude-code]
- **Security Hardening** — OmniClaw безпека та валідація (v23.3.0) [claude-code]
- **Landing** — Сергій Шарлай CEO & Засновник в командному каруселі [kleshnya]

## v23.4.0 — Lead Capture Integration (2026-03-11)
- **Telegram Lead Capture** — приватні повідомлення в бот автоматично створюють лід в CRM, автовідповідь юзеру [claude-code]
- **Universal Webhook** — `POST /api/leads/webhook/universal?source=tiktok|turbo|bnderoga` з Bearer token auth [claude-code]
- **Facebook Lead Ads** — webhook + Graph API v21.0 для отримання даних лідів [claude-code]
- **Instagram DM** — webhook для нових DM повідомлень → автоматичний лід [claude-code]
- **Viber Business** — webhook з HMAC-SHA256 signature verification [claude-code]
- **Lead Notifier** — `services/leadNotifier.js` — Telegram сповіщення менеджерам при новому ліді [claude-code]
- **UI оновлення** — 12 джерел у sourceFilter (TG, FB, IG, Viber, TikTok, Turbo, BnD, Google, Рек, Повтор, Ручний, Інше) [claude-code]
- **Source badges** — кольорові бейджі для кожного джерела (customers + leads pages) [claude-code]
- **DB Migration 053** — `external_id`, `raw_payload`, `source_channel` + unique index для дедуплікації [claude-code]
- **JWT bypass** — webhook paths відкриті без автентифікації [claude-code]

## v23.3.0 — OmniClaw Security Hardening (2026-03-11)
- **Webhook Signature Verification** — Viber HMAC-SHA256 (X-Viber-Content-Signature), Meta X-Hub-Signature-256 з timingSafeEqual, SMS/Binotel X-Webhook-Secret header [claude-code]
- **API Token Security** — FB/IG access_token перенесено з URL query string в Authorization: Bearer header [claude-code]
- **Graph API Update** — v18.0 → v21.0, конфігурується через FB_API_VERSION / IG_API_VERSION env [claude-code]
- **Pool Safety** — pool.connect() обгорнуто в try-catch у 5 функціях omni-hub.js (запобігає unhandled rejection при вичерпаному пулі) [claude-code]
- **Input Validation** — senderName/phone truncate до DB limits (255/50), getConversations whitelist status/channel, assignedTo type+length check, parseId на всіх route :id params [claude-code]
- **HTTP Status Checks** — перевірка statusCode в fbRequest, igRequest, turboSmsRequest, viberRequest (розрізняє 429/401/500) [claude-code]
- **Normalizer Hardening** — safeCoords() перевіряє Number.isFinite, safeString() з maxLen, isValidUrl() protocol check, JSON.stringify cap для unknown channels [claude-code]
- **Phone Validation** — normalizePhone() E.164 cap (15 digits max), reject < 7 digits [claude-code]
- **getUserProfile Security** — fields array sanitized з regex whitelist /^[a-z_]+$/i + encodeURIComponent [claude-code]
- **Нові env vars** — META_APP_SECRET, SMS_WEBHOOK_SECRET, BINOTEL_WEBHOOK_SECRET (всі опціональні, graceful skip) [claude-code]

## v23.2.0 — OmniClaw: Омніканальна комунікація v1.0 (2026-03-11)
- **OmniClaw Hub** — єдиний inbox для всіх каналів: Telegram, Viber, SMS, Facebook, Instagram, Binotel [claude-code]
- **Нормалайзер** — уніфікований формат повідомлень з 6 каналів [claude-code]
- **AI авто-відповіді** — Клешня відповідає клієнтам автоматично (toggle per conversation) [claude-code]
- **Швидкі відповіді** — шаблони відповідей для операторів [claude-code]
- **Webhooks** — публічні ендпоінти для всіх каналів [claude-code]
- **omni.html** — повноцінний UI inbox з real-time WebSocket оновленнями [claude-code]
- **DB** — міграція 052: conversations, conversation_messages, quick_replies [claude-code]

## v23.1.0 — Landing Page Event Genix v1.0 (2026-03-11)
- **landing/** — публічний лендінг продукту (повний редизайн) [kleshnya]
- **9 секцій** — Nav, Hero з мокапом, 12 модулів, Story таймлайн, Команда, Ціни, Соціальний доказ, Demo форма, Footer [kleshnya]
- **Demo форма** — заявка → Telegram сповіщення директору [kleshnya]
- **Нові фічі** — iOnboard, OmniClaw, Центр цін в описі модулів [kleshnya]
- **API** — POST /api/landing/demo-request [kleshnya]

## v23.0.0 — Major Release: Full Version Sync (2026-03-11)
- **Version Sync** — повна синхронізація версій по всіх 25+ HTML файлах, package.json, swagger.js, SNAPSHOT, CHANGELOG [claude-code]
- **Landing Carousel** — команда з каруселлю, Anli Lektor, swipe/dots/arrows [kleshnya]
- **Manager Guide** — нова сторінка landing/manager-guide.html для менеджерів з продажу [kleshnya]
- **Cache Busting** — ?v=23.0.0 на всіх CSS/JS ресурсах (25 HTML файлів)
- **Swagger API** — версія OpenAPI spec оновлена з 20.12.0 до 23.0.0
- **Dashboard fix** — версія в login subtitle оновлена (було v22.18.1)
- **game.html fix** — нормалізований ?v= тег (було 22.20.0.1)

## v22.20.0 — Guardian Phase 3: Analytics & Intelligence (2026-03-11)
- **14 Guardian chat commands** — /g help, status, stats, mood, health, top, history, mute, unmute, trust, report, rules, learn, config [claude-code]
- **Channel Health Score** — real-time 0-100, 🟢🟡🔴 indicator, auto-calculation, history [claude-code]
- **Sentiment Tracking** — keyword-based mood analysis per message, per-user summaries [claude-code]
- **Guardian Analytics Panel** — 5 tabs: overview, health, mood, heatmap, trust [claude-code]
- **Activity Heatmap** — 7×24 hourly grid [claude-code]
- **Trust Score System** — 0-100, 4 levels (trusted/normal/watched/restricted) [claude-code]
- **Auto-Escalation** — 5-level: warn → mute 1m → 10m → 30m+TG → ban 1 day [claude-code]
- **Weekly Reports** — Monday digest with trends + Telegram delivery [claude-code]
- **29 API endpoints + 8 DB tables** — migration 051 [claude-code]

## v22.19.0 — Guardian Contour System Phase 2 (2026-03-11)
- **Telegram алерти** — критичні події Guardian → директору в Telegram [claude-code]
- **Inline action buttons** — дії з Guardian DM (мютити обох, попередження, спостерігаю) [claude-code]
- **Security Panel UI** — статистика, активні мути, unmute кнопки [claude-code]
- **Conflict detector** — вікно 15 повідомлень + reply chain awareness [claude-code]
- **Sensitive patterns** — паролі, JWT, API ключі, адреси, дати народження [claude-code]
- **Repeat offender tracking** + **Spam detection** [claude-code]

## v22.18.0 — CRM Tech Debt + Features (2026-03-10)
- Issues #18–#26: технічний борг та нові фічі
- Version bump та синхронізація

## v22.12.0–v22.17.0 — Match-3 Candy Crush Edition (2026-03-09–10)
- **v22.17.0** — UI polish: contrast, style, mystical vibe [kleshnya]
- **v22.16.0** — Candy Crush icons + idle/combo/special animations [kleshnya]
- **v22.15.0** — Icon fix: replace v4 icons with consistent v3/final candy style [kleshnya]
- **v22.12.0** — Match-3 custom art assets [kleshnya]

## v22.10.0–v22.11.0 — Dark Mode Polish + Mystic Edition (2026-03-09)
- **v22.11.0** — Match-3 Mystic Edition: tarot cards, bosses, events, modern UI [claude-code]
- **v22.10.0** — Dark Mode Polish: 92 нових overrides + JS color fixes [claude-code]
- Security Hardening — input validation, race conditions, error disclosure [claude-code]
- Gamification Hardening — DB integrity, bug fixes, tests [claude-code]

## v22.4.0–v22.9.0 — Gamification V2 + Match-3 Epic (2026-03-09)
- **v22.9.0** — Match-3 Epic Edition: 9x9 grid, frozen tiles, cross special, combo system [claude-code]
- **v22.8.0** — Redesigned confirm dialogs, replaced native confirm()/alert() [claude-code]
- **v22.7.0** — Match-3 upgrade: special pieces, scoring fix, dashboard & profile fixes [claude-code]
- **v22.6.0** — Stability audit + version bump [claude-code]
- **v22.5.0** — Custom confirm modals, purchase effects, cooldown reset, chat fix [claude-code]
- **v22.4.0** — Gamification V2: Quiz, Streaks, Room page, Match-3 improvements [claude-code]

---

## v22.0.0–v22.3.0 — Dashboard, Gamification, Game Profile (2026-03-08–09)

### v22.3.0 — Game Profile (09.03.2026)
- Таб "Гра" в профілі (клік на нікнейм) — досягнення, магазин, інвентар, лідерборд
- XP progress bar, рівень, титул, монети в шапці
- Купівля предметів і екіпування з профілю
- Dashboard dark mode fix — картки #2A2A4A з видимими бордерами
- 8 API helper функцій для gamification, 300 рядків CSS

### v22.2.0 — Gamification MVP (09.03.2026)
- Gamification service (727 рядків): XP, рівні, монети, стріки
- Achievement catalog — 20 досягнень з рідкостями та нагородами
- Character items — backgrounds, frames, hats, weapons, shields, outfits, effects, badges
- Shop — магазин предметів за монети з інвентарем
- Leaderboard — таблиця лідерів по XP/монетах/досягненнях
- API: /api/gamification/* (10 ендпоінтів)
- DB: міграція 039_gamification.sql (10 нових таблиць)
- Standalone profile.html + profile-page.js

### v22.1.0 — Messenger UX (09.03.2026)
- Пошук емодзі з фільтрацією по ключових словах
- Lightbox для зображень з галереєю
- Unread separator, scroll badge, reaction popup, drag overlay
- ARIA, keyboard navigation, touch/mobile, safe-area-inset
- Dashboard SQL fix (price, label, staff_schedule)

### v22.0.0 — Dashboard + 25 Roles + Navigation (08.03.2026)
- Персоналізована HOME-сторінка /dashboard з віджетами
- 25 ролей (було 10): бухгалтер, арт-директор, маркетолог, IT, HR, шеф-кухар, кондитер, рецепція та ін.
- Тест-панель creator для переключення ролей
- Onboarding wizard, Widget API з кешем
- role_definitions таблиця з departments та parent_role

---

## v21.12.0–v21.15.0 — Navigation, Polish, Accessibility (2026-03-08)

### v21.15.0 — Unified Navigation
- Sidebar NAV_ITEMS: 9 → 18 пунктів навігації
- Sidebar.init() на всіх 15 standalone-сторінках
- Уніфікована toast система на всіх page-JS файлах

### v21.14.0 — Polish + A11y + Tablet
- Синхронізація ?v= тегів на 13 standalone-сторінках
- iOS zoom prevention (16px на input/select/textarea)
- Touch targets 44px+ (WCAG 2.1)
- Tablet breakpoint 769-1023px
- Dark mode auto-init на всіх standalone-сторінках

### v21.12.0–v21.13.0 — Dark Mode Fix + Role Hierarchy
- Виправлено dark mode toggle + auto night theme
- Configurable night time (start/end)
- Role hierarchy display, dashboard в sidebar

---

## v20.9.12–v20.9.15 — CRM Big Sprint (2026-03-03)

**Supabase міграція, Ліди, Банкети, Staff Extension**

### v20.9.15 — Staff Extension
- `staff.contract_type` VARCHAR(20) — fulltime/parttime/contract
- `staff.skills` TEXT[] — масив навичок
- HR модалка: telegram_username, тип контракту, навички
- Міграція: 026_leads_banquet_staff.sql (частина 26.3)

### v20.9.14 — Banquet Booking
- `bookings.banquet_menu` TEXT, `banquet_guests` INT, `banquet_tables` INT
- Форма бронювання: автоматичне показ/приховання банкетних полів при category=banquet
- Таймлайн: банкетні блоки з amber стилем (border-left #F59E0B, gradient)
- POST/PUT бронювань включають банкетні дані

### v20.9.13 — Leads Page
- Standalone сторінка `/leads` з воронкою, фільтрами, пошуком
- `leads.instagram`, `leads.source`, `leads.lost_reason`, `leads.booking_id` (FK)
- GET `/api/leads/stats` — статистика по статусах
- Кнопка "Конвертувати в бронювання" з pre-fill
- Sidebar: додано навігацію "Ліди"

### v20.9.12 — Supabase Customers
- `db/supabase.js` — Supabase клієнт з lazy init та fallback
- `routes/customers.js` — повний CRUD через Supabase (fallback на Railway DB)
- POST `/api/customers/migrate-to-supabase` — ендпоінт для міграції існуючих клієнтів
- Inline створення клієнтів у бронюваннях — також через Supabase

---

## v20.7.0 — Sales Features (2026-02-26)

**Продажні фічі за Якубою ч.2 — ліди, конверсія, рекомендації, скрипти**

### Hot Leads (Гарячі ліди)
- Таблиця `leads` — трекінг запитів від клієнтів
- API: GET/POST/PATCH/DELETE `/api/leads`, GET `/api/leads/hot`
- Крон 09:00 та 15:00 — автоматичне створення задач для лідів без відповіді 24+ год
- Telegram алерт при наявності гарячих лідів
- UI блок "🔥 Гарячі ліди" в /center Overview

### Manager Conversion (Конверсія менеджерів)
- GET `/api/analytics/conversion` — бронювань/підтверджено/конверсія%/середній чек по менеджерах
- Таблиця з прогрес-барами конверсії в /center Overview

### Age Recommendations (Рекомендації по віку)
- AGE_RECOMMENDATIONS: 3-5 / 6-8 / 9-12 / 12+ → відповідні програми
- Показуються в модалці бронювання після введення дати народження дитини
- Клік на рекомендовану програму → автоматичний вибір

### Sales Scripts (Скрипти продажів)
- Таблиця `sales_scripts` (7 seed фраз: заперечення, закриття, апсейл)
- API: GET/POST/PUT/DELETE `/api/scripts`
- Quick-access в модалці бронювання — вкладки по категоріях + кнопка "Копіювати"

### Auto Follow-up Tasks
- При створенні бронювання автоматично створюється задача
- Дедлайн: за 2 дні до події
- Текст: "Підтвердити свято: [клієнт] [дата]"

### Other
- `bookings.source` — нова колонка для джерела бронювання
- Міграція: 024_page_statuses_leads_scripts.sql

## v20.6.0 — Status Badges + Menu Refactor (2026-02-26)

**Статус-бейджики на sidebar + рефакторинг timeline menu**

### Status Badges
- Таблиця `page_statuses` — 5 статусів: building (🔴), testing (🟠), updated (🟡), in_tests (🔵), ready (🟢)
- API: GET `/api/page-statuses`, PATCH `/api/page-statuses/:path`
- sidebar.js автоматично завантажує статуси і рендерить бейджики
- CSS: крапка (collapsed) або pill з текстом (expanded)

### Menu Refactor
- Видалено дублюючі навігаційні посилання з timeline dropdown (Програми, Задачі — вже є в sidebar)

### Bugfixes
- `/auth/verify` тепер читає роль з БД а не з JWT (фікс для кешованих ролей після міграції)
- `routes/center.js` — замінено hardcoded `role !== 'admin'` на `requireMinRole('senior_manager')`
- Cache-busting: всі HTML `?v=` бампнуті до 20.70

---

## v17.1.0 — AI Team & Contractor Cards (2026-02-22)

**Редизайн AI-команди: акордеон-панелі, журнал, відправка на завдання**

### AI Team картки (HR → AI Команда)
- **Повний редизайн** — замінено зламану grid-сітку на повноширинні картки
- **Акордеон-панелі** — Можливості, Інтеграція, Журнал розкриваються по кліку
- **Відправка на завдання** — ручна форма для відправки AI-працівника
- **Журнал виконання** — in-session трекінг завдань з таймстемпами
- **Dark mode** — повна підтримка темної теми для всіх елементів

### Виправлення
- **Changelog CSS** — змінено `changelog-entry` → `changelog-section` (існуючий клас з CSS)
- **Версійний workflow** — повне оновлення 5 точок (package.json, CSS/JS tags, tagline, button, entry)

---

## v17.0.0 — Export, Budget & Procurement (2026-02-22)

**3 великі фічі: Export Excel/PDF, Бюджетне планування, Система закупок**

### Export Excel/PDF
- **Excel (.xlsx)** — експорт фінансів, клієнтів, закупок через `exceljs`
- **3 ендпоінти** — `/api/finance/export-xlsx`, `/api/customers/export-xlsx`, `/api/procurement/export-xlsx`
- **PDF** — print-friendly CSS на сторінці складу та закупок (Ctrl+P → PDF)
- **Стилізовані файли** — заголовки, формат, автоширина колонок

### Бюджетне планування (план vs факт)
- **Таблиця `budget_plans`** — план по категоріях × місяцях, UNIQUE(year, month, category_id)
- **Upsert API** — `PUT /api/finance/budget` (створення або оновлення)
- **Порівняння** — `GET /api/finance/budget/comparison?year=2026&month=2` з % виконання
- **Фронтенд** — новий таб «Бюджет» в Фінансах з KPI-картками та таблицею план/факт/різниця/%

### Система планування закупок
- **2 таблиці** — `procurement_lists` (списки) + `procurement_items` (позиції)
- **Відділи** — аніматорська, хозка, кафе, техніка, адміністрація
- **Статуси** — чернетка → затверджено → в процесі → закуплено → доставлено
- **Повний CRUD** — 10 API-ендпоінтів для списків та позицій
- **Авто-поповнення** — `GET /api/procurement/suggestions/low-stock` генерує списки з нестач
- **Авто-реstock** — `POST /api/procurement/:id/complete` поповнює склад + записує в історію
- **Фронтенд** — новий таб «Закупки» на сторінці складу з фільтрами, картками, деталями
- **Excel export** — вивантаження списків закупок з фільтрами

### Технічне
- **Міграція 009** — `budget_plans`, `procurement_lists`, `procurement_items` + індекси
- **routes/procurement.js** — новий маршрутний модуль (300+ рядків)
- **exceljs** — нова залежність
- **22 нові тести** — budget CRUD, procurement CRUD, items, suggestions, complete, excel export
- **288 тестів** загалом (287 pass)
- Cache bust: `?v=17.0` all files

---

## v16.2.0 — Swagger API Docs (2026-02-22)

**Інтерактивна документація API — /api-docs**

- **Swagger UI** — інтерактивна документація на `/api-docs` з можливістю тестувати ендпоінти
- **OpenAPI 3.0** — повна специфікація: 136 ендпоінтів, 54 схеми, 25 тегів
- **Нові модулі в spec** — Customers, Finance, Analytics, HR, Designs, Contractors, Warehouse (раніше не задокументовані)
- **JSON spec** — `/api-docs.json` для автогенерації клієнтських бібліотек
- **Публічний доступ** — Swagger UI не потребує авторизації
- **swagger-ui-express** — нова залежність
- Cache bust: `?v=16.2` all files

---

## v16.1.0 — Analytics v2 (2026-02-22)

**Єдиний дашборд — бронювання + фінанси + HR + CRM**

- **Сторінка «Аналітика»** — `/analytics` з KPI-картками, графіками, порівнянням
- **KPI-дашборд** — 6 карток: виручка, бронювання, середній чек, фінанси (дохід/витрати/прибуток), нові клієнти, HR (години/працівники)
- **Порівняння періодів** — автоматичний розрахунок vs попередній період з % зміни (▲/▼)
- **Графіки** — доходи бронювань по днях, фінансові потоки по днях, топ-10 програм, навантаження по днях тижня
- **Фінансові категорії** — горизонтальні бари з кольорами та іконками
- **Сегменти клієнтів** — чемпіони (5+), лояльні (3-4), нові (1-2), неактивні
- **Періоди** — сьогодні, тиждень, місяць, квартал, рік, довільний діапазон
- **API** — 3 ендпоінти: `/api/analytics/overview`, `/charts`, `/comparison` (5-хвилинний кеш)
- **Навігація** — посилання «Аналітика» на всіх 11 сторінках
- **Нові файли:** `analytics.html`, `js/analytics-page.js`, `routes/analytics.js`
- **Тести:** 8 нових тестів (overview, charts, comparison, static page)
- Cache bust: `?v=16.1` all files

---

## v16.0.0 — Finance Module (2026-02-22)

**Фінансовий модуль — каса, P&L, зарплати**

- **Сторінка «Фінанси»** — `/finance` з 4 табами (дашборд, транзакції, місячний звіт, зарплати)
- **Дашборд** — доходи/витрати/прибуток за період, графік по днях, розбивка по категоріях, методи оплати
- **Транзакції CRUD** — створення/редагування/видалення операцій, фільтри по типу/категорії/оплаті/даті
- **P&L звіт** — щомісячна таблиця доходів/витрат/прибутку за рік + графік по місяцях
- **Зарплатний звіт** — розрахунок зарплат з HR (ставка × години), таблиця працівників
- **Категорії фінансів** — 12 початкових (5 доходу + 7 витрат), CRUD для користувацьких категорій
- **Автозапис з бронювань** — підтверджені бронювання автоматично створюють транзакцію доходу
- **Спосіб оплати** — `bookings.payment_method` (готівка/картка/переказ/змішаний)
- **Вартість сертифікатів** — `certificates.value_uah` поле
- **CSV-експорт** — вивантаження фінансових операцій (UTF-8 BOM, `;` separator)
- **Навігація** — посилання «Фінанси» на всіх 10 сторінках
- **Нові файли:** `finance.html`, `js/finance-page.js`, `routes/finance.js`
- **БД:** `finance_categories`, `finance_transactions` + індекси
- **Тести:** 21 новий тест (categories, CRUD, dashboard, monthly, CSV, static page)
- Cache bust: `?v=16.0` all files

---

## v15.1.0 — CRM Phase 2 (2026-02-22)

**Повна клієнтська база з аналітикою**

- **Сторінка CRM** — `/customers` з таблицею клієнтів, пошуком, пагінацією
- **Фільтри клієнтів** — по джерелу (Instagram, Google, рекомендація), візитах, даті, сортування
- **RFM-аналітика** — Recency/Frequency/Monetary з 5 сегментами: чемпіони, лояльні, потенційні, під загрозою, втрачені
- **Автопривітання ДН** — щоденний Telegram о 09:00 з іменинниками та контактами батьків
- **Зв'язок сертифікатів** — `certificates.customer_id` + відображення в картці клієнта
- **CSV-експорт** — вивантаження бази клієнтів з усіма полями (UTF-8 BOM, роздільник `;`)
- **Stats API** — `/api/customers/stats` — огляд бази (кількість, джерела, топ клієнти, середні)
- **Навігація** — посилання «Клієнти» на всіх 9 сторінках
- **Нові файли:** `customers.html`, `js/customers-page.js`
- **Тести:** 11 нових тестів (filters, stats, RFM, CSV, certificates)
- Cache bust: `?v=15.1` all files

---

## v15.0.0 — HR Module (2026-02-22)

**Повноцінний HR-блок**

- **HR-модуль** — нова сторінка `/hr` з 4 табами
- **Хто зараз** — live-табло присутності з кнопками clock-in / clock-out
- **Розклад** — планування змін на тиждень/місяць, шаблони, копіювання тижня, bulk-операції
- **Команда** — картки профілів, контакти, екстрений контакт, ставки, фільтрація за ролями
- **Звіти** — місячна аналітика відвідуваності, підрахунок зарплат, CSV-експорт
- **Cron-jobs** — авто-закриття незакритих змін (23:55 Kyiv), no-show детектор (13:00 Kyiv)
- **Міграція 007** — hr_shifts, hr_time_records, hr_shift_templates, hr_audit_log + розширення staff
- **API** — 20+ ендпоінтів `/api/hr/*` (staff, shifts, clock-in/out, reports, templates)
- **Навігація** — HR-лінк додано у всі сторінки

---

## v14.4.0 — Тест 35 (2026-02-22)

**Тест 35**

---

## v14.3.0 — Тест 34 (2026-02-22)

**Тест 34**

---

## v14.2.0 — Тест 33 (2026-02-21)

**Тест 33**

---

## v13.0.0 — Kleshnya Chat v2 (2026-02-18)

**Kleshnya Chat v2 — ChatGPT-style multi-session redesign:**
- Sidebar сесій (desktop 280px, mobile overlay по свайпу/кнопці)
- Multi-session: створення, перемикання, перейменування, pin, emoji, видалення
- Context menu (right-click / long press): rename, pin, clear, delete
- Media bubbles: image, audio, video з proxy через /api/kleshnya/media/file/:fileId
- Reactions (👍/👎) toggle на assistant повідомленнях
- Generation indicator з animated progress bar (~30 сек)
- WebSocket real-time: kleshnya:thinking, kleshnya:reply, kleshnya:media
- Voice input (Web Speech API)
- FAB на мобільному для "Новий чат"
- Rename modal з emoji picker
- Повна dark mode підтримка для всіх нових компонентів
- JS виділено в окремий файл js/kleshnya-page.js

**Smart Chat engine (12 навичок):**
- 📊 Бронювання — деталі, клієнти, кімнати, ціни по датах/тижням/місяцям
- 📋 Задачі — мої/всі/прострочені з пріоритетами та статусами
- ✏️ Створення задач — "Створи задачу купити серветки" прямо з чату
- 🔥 Стрік і бали — стрік, бали, лідерборд команди
- 👥 Команда — хто на зміні по відділах з часами
- 💰 Фінанси — виручка, середній чек, % росту порівняно з минулим періодом
- 🎪 Афіша — заплановані події по датах
- 🎭 Програми — каталог з категоріями, цінами, деталями
- 🎫 Сертифікати — активні, що скоро спливуть
- 🏠 Кімнати — завантаженість по кімнатах
- 📈 Аналітика — порівняння місяців, топ програм
- ❓ Допомога — повний список навичок з прикладами

**Фільтр по категоріях послуг:**
- "Скільки піньят за тиждень?" → кількість, виручка, список по кожному бронюванню
- Підтримує: піньяти, квести, шоу, анімації, майстер-класи, фото
- Розуміє періоди: сьогодні/завтра/тиждень/місяць/вихідні

**Suggestion chips:**
- Після кожної відповіді 2-4 кнопки follow-up запитів
- Контекстні — залежать від теми відповіді
- Анімоване з'явлення, dark mode підтримка

**Backend:**
- `services/kleshnya-chat.js` — новий skill engine з реальними DB запитами
- `services/kleshnya-bridge.js` — Telegram Bridge для OpenClaw (227 рядків)
- `routes/kleshnya.js` — повний CRUD sessions, paginated messages, reactions, media proxy
- `services/websocket.js` — kleshnya:thinking, kleshnya:reply, kleshnya:media events
- `db/migrations/005_kleshnya_chat_v2.sql` — chat_sessions, kleshnya_media

**Cache bust:** `?v=13.0` на всіх CSS/JS всіх 7 сторінок

---

## v12.1.0 — Розумна тема + UX (2026-02-17)

**Авто Dark Mode:**
- Темна тема автоматично з 20:00 до 07:00, світла вдень
- Спільна функція `initDarkMode()` в config.js — єдине джерело правди
- Працює на всіх 6 сторінках (таймлайн, задачі, програми, графік, дизайни, клешня)
- Ручний вибір через toggle зберігається в localStorage і перезаписує авто

**Dark mode на /designs:**
- Повне покриття: картки, фільтри, drop zone, таби, прайс-лист, календар, модалки
- Інтегровано і `body.dark-mode` і `[data-theme]` для повної сумісності

**Мобільний UX /designs:**
- Картинки: `object-fit: contain` — повний дизайн без обрізання
- Таби: горизонтальний скрол (нічого не обрізається)
- Фільтри: один компактний рядок замість 3
- Drop zone: тонкий бар замість великого блоку
- Кнопки: `min-height: 36px` для зручного натискання

**Фікс авторизації /designs:**
- Прибрана залежність від `pzp_session` (ніколи не записувався)
- Тепер використовує `/api/auth/verify` як tasks/programs/staff

**Фікс горизонтального скролу:**
- `overscroll-behavior-x: contain` на всіх scroll-контейнерах
- Жест на мобільному більше не зсуває всю сторінку

**Cache bust:** всі HTML файли оновлені до `?v=12.1`

---

## v11.0.6 — Клешня знає твоє ім'я (2026-02-15)

- **Персоналізація:** привітання тепер звертаються по імені з акаунту користувача
- **Фікс:** "Денний" більше не з'являється — displayName передається з JWT токена
- **Шаблони:** GREETINGS тепер функції з параметром імені
- **Кеш:** очистка кешу привітань при кожному старті сервера

---

## v11.0.4 — Клешня без пафосу (2026-02-15)

- **Привітання:** жива українська замість "сканування завершено" / "системи активовано"
- **Відповіді:** просто та корисно без "місій", "оперативників", "сенсорів"
- **Кнопки:** Задачі (замість Місії), Аніматори (замість Оперативники)
- **Divider:** "ШВИДКІ ЗАПИТИ" замість "МОДУЛІ ЗАПИТІВ"
- **Footer:** "Відкрити чат" замість "Повний термінал"

---

## v11.0.3 — Голографічний Термінал (2026-02-15)

- **FAB:** radial gradient + обертове dashed-кільце + sonar pulse з neon glow
- **Popup:** темний термінал (#1a1520), scan line overlay, monospace шрифт (Courier New)
- **Header:** блимаючий зелений status dot, "KLESHNYA v3.0 / ONLINE" в стилі командного центру
- **Greeting:** typing-анімація (символ за символом) з блимаючим курсором █
- **Answer:** термінальний блок з `>>` prompt, зеленим акцентом, typing ефект
- **Buttons:** sweep-ефект (gradient пролітає по кнопці), ◈ іконки з обертанням на hover
- **Divider:** "МОДУЛІ ЗАПИТІВ" з gradient-лініями
- **Footer:** "Повний термінал →" з ⬡ іконкою
- **Dark mode:** посилений glow на FAB/popup/buttons
- **Responsive:** адаптовано для 480px

---

## v11.0.2 — Футуристична Клешня (2026-02-15)

- **Floating widget:** інтерактивна кнопка 🦀 (FAB) замість статичного банера в stats bar
- **Popup:** привітання + 4 кнопки швидких питань (бронювання, задачі, стрік, аніматори) + посилання на повний чат
- **Футуристичний стиль:** всі привітання та відповіді переписані в стилі командного центру (скан, місії, оперативники, модулі аналізу)
- **Dark mode + responsive:** повна підтримка для нового віджету
- CSS: layout.css, dark-mode.css, responsive.css — нові стилі для FAB + popup
- JS: timeline.js — initKleshnyaWidget(), handleKleshnyaQuestion()

---

## v11.0.1 — Документація та Swagger (2026-02-15)

- **PROJECT_PASSPORT.md:** повна актуалізація до v11.0 (30 таблиць, 17 routes, 13 services, Kleshnya greeting/chat, особистий кабінет, schedulers)
- **CLAUDE.md:** виправлені невідповідності (19 JS, 11 CSS, 364 тести, повна файлова структура)
- **swagger.js:** v8.6.1 → v11.0.0 (+25 endpoints, +10 schemas: points, kleshnya, recurring, stats, auth profile/achievements/password, task logs)
- **SNAPSHOT.md:** коректна кількість тестів (364)

---

## v11.0.0 — Дофамінові покращення (2026-02-15)

**Kleshnya Greeting & Chat:**
- Quick stats bar → two-column layout: статистика ліворуч, Kleshnya banner праворуч
- Персоналізовані привітання на основі бронювань, задач, стріків, часу доби
- Greeting cache в БД (4h TTL) для rate-limit майбутніх AI agent викликів
- Повна чат-сторінка `/kleshnya` з історією повідомлень
- Template-based responses (agent-ready hook для майбутньої AI інтеграції)
- API: GET/POST `/api/kleshnya/greeting`, GET/POST `/api/kleshnya/chat`
- Dark mode + responsive support

**Особистий кабінет — повна перебудова:**
- 4 таби: Сьогодні / Задачі / Стати / Налашт.
- **Сьогодні:** shift block, SVG progress ring, actionable inbox (прострочені + майбутні задачі з done/start), admin team overview grid
- **Задачі:** inline status actions (start/done), blocked task indicators, dependency awareness, priority highlighting, animated task completion
- **Стати:** stat cards з week-over-week deltas, бали з task links, escalation history, certificate details, 12 achievements grid
- **Налашт.:** зміна пароля, user details, logout
- 12 досягнень (first_task, streak_3/7/30, booking_pro тощо) з auto-grant логікою
- `user_action_log` таблиця + POST/GET endpoints для UI click tracking
- `user_achievements` + `user_streaks` таблиці
- PATCH `/tasks/:id/quick-status` для inline task actions з профілю
- 23 паралельні SQL запити у `/profile` endpoint (Promise.allSettled)
- ~500 рядків нових CSS стилів (tabs, progress ring, shift block, inbox, team grid, achievements)

**БД (+3 таблиці):**
- `kleshnya_messages` (greeting cache), `kleshnya_chat` (chat history)
- `user_action_log`, `user_achievements`, `user_streaks`

**Файли:**
- `kleshnya.html` — нова сторінка чату
- `services/kleshnya-greeting.js` — новий (greeting engine)
- `routes/kleshnya.js` — новий (API greeting + chat)
- `routes/auth.js` — розширений `/profile` з 23 queries
- `js/auth.js` — перебудований profile modal з 4 табами
- `js/api.js` — +kleshnya API methods
- `js/timeline.js` — kleshnya banner на головній
- `css/modals.css` — +500 рядків profile styles
- `css/layout.css`, `css/dark-mode.css`, `css/responsive.css` — kleshnya layout

---

## v10.5.0 — Verification Bump (2026-02-15)

- **Profile modal на суб-сторінках:** tasks.html, programs.html, staff.html — додані modals.css та profile modal HTML
- **Modal UX:** close (×), backdrop click, Escape key в initProfileHandler
- **Auto-init:** profile click handler через DOMContentLoaded на всіх сторінках
- Всі 221 тестів пройдено

---

## v10.4.0 — Особистий кабінет PRO (2026-02-15)

- **Кабінет PRO:** повна переробка з 15+ SQL запитами через Promise.allSettled (паралельні)
- **Увага:** блок "Потребують уваги" — прострочені задачі, дедлайни < 24 год
- **Мої задачі:** inline-список з пріоритетами, дедлайнами, статусами (overdue виділені)
- **Бали:** транзакції останніх нарахувань з причинами (ON_TIME, EARLY, LATE тощо)
- **Лідерборд:** ранг #N серед усіх користувачів
- **Бронювання:** розбивка по статусах (підтверджені/попередні/скасовані), виручка (admin only), топ-3 програми
- **Сертифікати:** видані по статусах (активні/використані)
- **Задачі:** середній час виконання, кількість ескалацій, розбивка по категоріях
- **Зміна пароля:** PUT /api/auth/password з валідацією та bcrypt
- **Активність:** збільшено до 20 записів + пагінація "Показати ще"
- **Telegram:** статус підключення у профілі (badge)
- **UX:** мобільний responsive (3+2 grid на малих екранах), 5 stat cards замість 4

---

## v10.3.0 — Особистий кабінет (2026-02-15)

- **Особистий кабінет:** клік по імені користувача відкриває модальне вікно з персональною інформацією
- **API:** GET /api/auth/profile — консолідований профіль (user info + points + tasks + bookings + activity)
- **Профіль:** аватар, роль, дата реєстрації, статистика (бронювання, задачі, бали), остання активність
- **UX:** username кликабельний з underline hint, повна keyboard accessibility

---

## v10.2.0 — Reliability (2026-02-15)

- **Logging:** замінені всі `/* non-blocking */` catch блоки на log.warn з context (scheduler, afisha)
- **ROLLBACK safety:** distributeAfishaForDate — ROLLBACK з .catch() і логуванням помилки
- **Graceful shutdown:** drain in-flight Telegram запитів перед закриттям DB pool (drainTelegramRequests)
- **Body limit:** /api/backup/restore збільшений до 50mb (великі SQL дампи)

---

## v10.1.0 — Data Integrity (2026-02-15)

- **Migration 004:** unique partial indexes для дедуплікації recurring bookings, tasks, afisha (template_id + date)
- **Migration 004:** додані відсутні індекси: bookings(status), tasks(assigned_to), tasks(assigned_to, date)
- **Atomic dedup:** scheduler recurring tasks і afisha використовують INSERT ON CONFLICT замість SELECT → INSERT (race condition fix)
- **Optimistic locking:** updateTaskStatus перевіряє version column перед UPDATE (захист від конкурентних змін)
- **DB:** додана колонка `tasks.version` (INTEGER DEFAULT 1) для optimistic locking

---

## v10.0.1 — Security Hotfix (2026-02-15)

- **RBAC:** tasks write-операції (POST/PUT/PATCH/DELETE) обмежені ролями admin/user, viewer = read-only
- **RBAC:** points leaderboard = admin/user, individual points = own + admin, history = own + admin
- **Security:** parseInt валідація в Telegram callback handlers (NaN guard з early return)
- **Security:** приховані DB error messages у backup endpoints (no schema leakage)
- **Security:** валідація `type` параметра в tasks GET query filter
- **Security:** обмежений offset в points history (max 10000, DoS prevention)

---

## v10.0.0 — Tasker & Kleshnya (2026-02-15)

**Tasker — операційний центр:**
- Централізований задачник з двома типами: `human` (людина) / `bot` (система)
- Дві ролі: `owner` (менеджер, ескалація) + `assigned_to` (виконавець)
- Дедлайни, вікна виконання, залежності між задачами
- `control_policy` (JSONB) — правила нагадувань та ескалації на рівні задачі
- `source_type` — відстеження джерела задачі (booking, trigger, recurring, kleshnya)

**Клешня (services/kleshnya.js) — центральний інтелект:**
- Створення задач з логуванням + нотифікацією
- 4-рівнева ескалація: м'яке → жорсткіше → увага → директор
- Автоматичне нарахування балів при завершенні задач
- Персональні Telegram-повідомлення (chat_id) + групові (@mention)
- Журнал змін (task_logs) з повною історією

**Система балів:**
- `user_points` — постійні (накопичувальні) + місячні (обнуляються 1-го)
- `point_transactions` — повна історія нарахувань
- Правила: вчасно +5/+2, з запасом +7/+3, high priority +10/+5, прострочено -2..-5
- API: GET /api/points (leaderboard), GET /api/points/:username/history

**Scheduler (3 нові, всього 11):**
- `checkTaskReminders` — щохвилинна перевірка дедлайнів + ескалація
- `checkWorkDayTriggers` — тригери початку дня (10:00/12:00), автозадачі піньят/футболок
- `checkMonthlyPointsReset` — обнулення місячних балів 1-го числа

**Telegram бот (+3 команди, всього 10):**
- `/tasks` — мої задачі на сьогодні (з визначенням юзера через telegram_username)
- `/done <id>` — завершити задачу з нарахуванням балів
- `/alltasks` — всі задачі команди, згруповані по виконавцях
- Inline-кнопки: `task_confirm`/`task_reject` для підтвердження

**БД (+4 таблиці, +15 колонок):**
- tasks: +task_type, +owner, +deadline, +time_window_start/end, +dependency_ids, +control_policy, +escalation_level, +source_type, +source_id, +last_reminded_at
- users: +telegram_chat_id, +telegram_username
- Нові: task_logs, user_points, point_transactions

**Файли:**
- `services/kleshnya.js` — новий (центральний процесор)
- `routes/points.js` — новий (API балів)
- `services/bot.js` — +3 команди (/tasks, /done, /alltasks)
- `services/scheduler.js` — +3 scheduler функції
- `routes/tasks.js` — інтеграція з Клешнею (logs, owner, task_type)
- `routes/telegram.js` — +task_confirm/reject callbacks, auto-register chat_id
- `server.js` — +points route, +3 schedulers
- `db/index.js` — +4 таблиці, +15 колонок, +12 індексів

---

## v9.1.0 — Live-Sync (2026-02-15)

**WebSocket підключено:**
- `services/websocket.js` підключено до `server.js` через `initWebSocket(server)`
- Graceful shutdown: WSS закривається перед DB pool
- `routes/bookings.js`: broadcast після create/create-full/update/delete
- `routes/lines.js`: broadcast після зміни ліній
- `js/auth.js`: ParkWS.connect() при логіні, disconnect() при logout
- userId coerced to String для коректного excludeUser

**SessionStart hook:**
- `.claude/hooks/session-start.sh`: старт PostgreSQL + npm install + env vars
- Працює тільки в remote (Claude Code на вебі)

---

## v9.0.2 — Доступність (2026-02-15)

- Skip-links на всіх 5 сторінках
- `@media (prefers-reduced-motion: reduce)` — вимкнення анімацій
- programs.html: cache bust v7.9.2 → v9.0.2

---

## v9.0.1 — Стабілізація (2026-02-15)

- Staff toolbar: кнопки винесені в окремий `.schedule-toolbar`
- Cache bust staff.html і tasks.html

---

## v9.0.0 — Розумна платформа (2026-02-15)

- **Drag-and-drop** на таймлайні (мишка/палець + resize + undo)
- **Повторювані бронювання** (шаблони щотижня/через тиждень/щомісяця, авто-генерація 14 днів)
- **Аналітика** (дашборд виручки, топ програм, завантаженість)
- **Оптимістичне блокування** (updated_at + PL/pgSQL тригер + HTTP 409)
- **Offline режим** (Service Worker + IndexedDB mutation queue)
- **Міграції БД** (db/migrate.js + 3 міграції)
- **Тести:** certificates.test.js (82) + automation.test.js (51)

---

## v8.6.1 — Оновлений дизайн сертифікатів (2026-02-14)

- Новий фон + QR у лівий нижній кут (150px замість 216px)

---

## v8.6.0 — Розумний розподіл (2026-02-14)

- Birthday blocks: pill-форма з градієнтом + 🎂 + пульсуюча анімація
- Авто-розподіл афіші перед дайджестами та нагадуваннями

---

## v8.5.0–v8.5.2 — Сертифікати (2026-02-13)

- v8.5.0: Панель сертифікатів (slide-in, статистика, градієнтні картки)
- v8.5.1: Графічні сертифікати (Canvas PNG, Містер Зак)
- v8.5.2: Сезонний маскот (4 seasonal ілюстрації)

---

## v8.4.0 — Сертифікати MVP (2026-02-13)

- Реєстр CERT-YYYY-NNNNN, Telegram-сповіщення, scheduler expiry

---

## v8.3.0–v8.3.3 — Автоматизація + Bugfixes (2026-02-12)

- v8.3.0: Automation rules engine + Drag-to-Move афіша
- v8.3.1: МК Футболки (розміри XS-XL в extra_data, 2 автоматизації)
- v8.3.2: Фікс історії (афіша/автоматизація рендеринг) + extra_data в linked bookings
- v8.3.3: Bugfixes (undo в історії, share/copy invite crash fix)

---

## v7.8–v7.9.2 — Задачі & Програми & Мобільна адаптація (2026-02-11–12)

- v7.8: Standalone Tasks & Programs pages + recurring task templates
- v7.8.1–v7.8.9: Мобільна адаптація (свайп, CSS Grid toolbar, glassmorphism, WCAG 44px touch targets)
- v7.8.10: Дайджест для 2го ведучого + афіша ±1год
- v7.9.0: Дошка задач (5 вкладок, канбан, авто-задачі з афіші, категорії)
- v7.9.2: Стилізовані емодзі іконки з градієнтними колами

---

## v7.0–v7.6.1 — Каталог, Бот, Афіша, Задачник (2026-02-11)

- v7.0: Product Catalog MVP (products таблиця, API, кеш 5хв, seed 40 програм)
- v7.1: Admin CRUD каталогу (create/edit/deactivate, requireRole middleware)
- v7.2: Clawd Bot (7 команд: today/tomorrow/programs/find/price/stats/menu)
- v7.3: Афіша в Telegram (дайджест + нагадування з подіями)
- v7.4: Типи подій (event/birthday/regular), іменинники в Telegram
- v7.5: Задачник MVP (tasks CRUD, статуси todo/in_progress/done, пріоритети)
- v7.6: Афіша → Задачі (генерація, шаблони, каскадне видалення)
- v7.6.1: Переключення ліній аніматорів + z-index bugfix

---

## v6.0 — Test Mode (2026-02-08)

- Безпарольний login: будь-який username → admin role, token 24h
- **УВАГА:** тимчасова версія для тестування

---

## v5.30–v5.51 — UI/UX Overhaul & Design System (2026-02-07–08)

| Версія | Що |
|---|---|
| v5.30 | Design System v4.0 (emerald, CSS tokens, 10-file architecture) |
| v5.31–v5.33 | Segmented controls, program cards, booking panel mobile |
| v5.34–v5.35 | Responsive (4 breakpoints, tablet overlay, desktop grid) |
| v5.36–v5.38 | Афіша/Історія UI, dark mode coverage, favicon/PWA |
| v5.39–v5.41 | Bugfixes, security headers, rate limiting, performance (indexes) |
| v5.42–v5.48 | Design tokens, modals polish, dashboard, invite overhaul, inline cleanup |
| v5.49 | Program search |
| v5.50 | Duplicate booking |
| v5.51 | Undo for edit & shift |

---

## До v5.30

- v5.29: Modular backend (routes/, services/, middleware/)
- v5.28: Structured logging, request IDs
- v5.19: Free rooms, booking linking
- v5.18: Room selection

---

*Формат: останні версії детально, старі — коротко.*
