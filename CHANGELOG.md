# CHANGELOG — Event Genix CRM

> Журнал змін. Останні версії зверху, детально. Старі — коротко внизу.

---

## v0.51.5 - Sidebar Quick Icons Clean Surface (2026-05-16)

### Sidebar / Quick Counters [codex]
- **Outer Cards Removed** - quick-кнопки задач, алертів і воронки більше не мають власних card-рамок поверх загального контейнера.
- **Clean Icon Orbs** - видимими лишились чисті іконки та числові капсули, без вкладених прямокутників і візуальних накладок.
- **State Safety** - alert/action стани більше не можуть домальовувати старий background або border поверх нового icon-only дизайну.

---

## v0.51.4 - Sidebar Quick Icons Layer Fix (2026-05-16)

### Sidebar / Quick Counters [codex]
- **Layer Cleanup** - прибрано зайві внутрішні рамки та старі alert/action backgrounds, які накладались поверх нових icon-only плиток.
- **Cleaner Surface** - quick-картки задач, алертів і воронки тепер мають один чистий glass-surface без подвійних контурів і випадкових плям.
- **Counter Alignment** - іконки та нижні числові капсули вирівняно стабільніше, щоб блок виглядав зібрано у темному sidebar.

---

## v0.51.3 - Sidebar Quick Icons Polish (2026-05-16)

### Sidebar / Quick Counters [codex]
- **Text Removed** - прибрано обрізані підписи з верхніх quick-карток задач, алертів і воронки, щоб блок читався як чистий icon-only counter rail.
- **Unified Icons** - SVG-іконки перезібрано в один спільний stroke-style: задачі, сповіщення і воронка тепер виглядають як одна система, а не три різні випадкові символи.
- **Counter Polish** - лічильники перенесено в охайні нижні капсули, підсилено hover/focus стани й темний режим без втрати читабельності.

---

## v0.51.2 - Sidebar Logo Animation Polish (2026-05-16)

### Sidebar / Brand Logo [codex]
- **Logo Frame Removed** - прибрано глобальну рамку/outline з верхнього sidebar-логотипа, щоб значок Event Genix не виглядав як випадкова framed-картинка.
- **Soft Animation** - додано спокійну анімацію логотипа з легким підйомом, поворотом і glow, без агресивного миготіння.
- **Reduced Motion** - анімація логотипа вимикається через `prefers-reduced-motion`, щоб не ламати accessibility.

---

## v0.51.1 - Sidebar Dashboard Jump Polish (2026-05-16)

### Sidebar / Dashboard Jump [codex]
- **Label Cleanup** - прибрано малий підпис `Головний екран` із швидкої sidebar-кнопки, щоб блок не читався як дворядковий обрізаний віджет.
- **Readable Dashboard Title** - у плитці залишено тільки `Дашборд`, з більшим і стабільнішим title rhythm без зайвого uppercase-шуму.
- **Compact Button** - кнопку, іконку та arrow-control трохи зменшено, щоб вона займала менше вертикального місця й не обрізала текст у вузькому sidebar.

---

## v0.51.0 - AI Rail Live Center (2026-05-16)

### CRM Assistant Rail [codex]
- **Centered Header Slot** - верхній AI rail перенесено в окремий центрований host у header, щоб він не з'їжджав через різну ширину лівих і правих блоків.
- **Live Speaking Ticker** - speaking-стан тепер запускає живу subtitle-стрічку як поведінку комунікації, а не тільки як overflow-патч для довгого тексту.
- **Presence States** - thinking, listening і speaking отримали виразніші active states, glow і readable ticker у світлій та темній темі.
- **Text-Only Fallback** - якщо голос вимкнений або TTS недоступний, rail все одно показує відповідь як активну speaking-репліку й лишає останній текст видимим після завершення.

---

## v0.50.41 - Profile Cabinet Notes Panel Cleanup (2026-05-16)

### Profile / My Cabinet [codex]
- **Notes Removed** - блок `Нотатки` прибрано з власного профілю/кабінету, щоб нижня частина сторінки не показувала зайву порожню панель.
- **Right Panel Removed** - глобальний `role-panel` більше не підключається на `profile.html`, тому права floating-панель не перекриває і не дублює кабінет.
- **Data Safety** - нотатки не видалялись із backend/API; прибрано саме UI surface і зайвий fetch у профілі.

---

## v0.50.40 - Price List Categories Print Redesign (2026-05-16)

### Designs / Price List [codex]
- **Category Logic** - прайс-лист перебудовано у фіксований порядок `Меню -> Торти -> Розважальні програми -> Піньяти -> Костюми` з normalization layer для фактичних `products`.
- **Visual Hierarchy** - вкладка `Прайс-лист` отримала документний sales-flow з hero, category/subcategory блоками, item cards, ціною, деталями та fallback-сигналами для неповних даних.
- **Dark + Print** - screen view має окремий dark-mode pass, а друк/PDF отримав A4-friendly light layout без CRM chrome, з контрольованими page breaks.
- **Catalog Flow** - випускний каталог вбудовано в той самий sales-контур через bridge-блок із переходом до існуючого catalog viewer/PDF flow без дублювання даних.

---

## v0.50.39 - Dashboard Remove My Focus Widget (2026-05-16)

### Dashboard [codex]
- **Widget Cleanup** - `Мій фокус` retired from dashboard scene/grid/settings surfaces so it no longer renders as a separate widget.
- **Saved Config Safety** - old saved dashboard configs that still contain `my_focus` are filtered by the widget normalization layer.
- **Data Semantics Preserved** - task focus data and `focus_rank` logic remain intact for task/profile flows; only the dashboard widget surface is removed.

---

## v0.50.38 - Sidebar Stack Overlap Fix (2026-05-16)

### Sidebar / Aurora [codex]
- **Layout Contract** - dashboard jump, quick status block and accordion groups now keep separate vertical slots so sidebar cards do not visually stack on top of each other.
- **Accordion Spacing** - sidebar links and category rows use an explicit flex column rhythm with stable gaps and no negative/animated overlap between neighboring blocks.
- **Interaction Polish** - active dashboard jump no longer moves upward on hover/active state, preventing it from touching the first `CRM` accordion surface on compact heights.

---

## v0.50.37 - Dashboard Board Creative Workspace & AI Upgrade (2026-05-16)

### Dashboard / Board [codex]
- **Workspace Logic** - board отримав явний interaction contract для view, edit, draw, connect, text-edit і widget-inspect режимів, щоб widget click, drag, text edit і connector flow не билися між собою.
- **Creative Palette** - toolbar зібрано в grouped navigation, insert, draw, connect, AI і action flows, а не в один довгий ряд рівноправних кнопок.
- **Connectors** - додано connector model у board state, anchor buttons на об'єктах, relation types, line/arrow/curve styles і live reroute після move/resize.
- **AI Board** - додано Suno-style board-native presets: expand idea, mood pack, auto cluster, summarize, extract tasks, remix, name frame і prompt-to-board generation.
- **Visual Polish** - selected/editing/widget-inspect/connector/anchor states приведено до чистішої premium-мови без грубих обводок.

---

## v0.50.36 - My Cabinet Cluster Visual Polish (2026-05-16)

### Profile / My Cabinet [codex]
- **Cluster** - у верхньому My Cabinet cluster прибрано захист від усічених підписів і зафіксовано clean icon-only face.
- **Counts** - цифри піднято з нижнього badge-кута в центральний rhythm плитки та зроблено більшими й читабельнішими.
- **Notifications** - центральна плитка лишається bell-first shortcut для сповіщень, з окремим alert count акцентом.

---

## v0.50.35 - Catalog Viewer Wide-Screen Stability Fix (2026-05-16)

### Catalogs / Designs [codex]
- **Catalog UI Modes** - list, inline editor і fullscreen viewer зведено в один явний mode contract, щоб режими не лишали ghost-surfaces поверх каталогу.
- **Viewer Isolation** - fullscreen catalog viewer отримав `catalog-viewer-open` body-state, вищий stacking layer і блокування fixed/floating CRM panels під час перегляду.
- **Responsive Viewer** - catalog page lane стабілізовано для wide desktop, laptop, tablet і mobile через safe gutters, overflow isolation і ширший контрольований content width.

---

## v0.50.34 - Sidebar Category Density & Chevron Polish (2026-05-16)

### Sidebar / Aurora [codex]
- **Category Density** - category headers у sidebar стали компактнішими за висотою, padding і gap, щоб navigation rail виглядав щільніше та спокійніше.
- **Chevron** - legacy border-arrow замінено на SVG control chevron у власній mini-control зоні з акуратним open/closed станом.
- **Visual Rhythm** - hover, active і open surfaces для accordion groups зібрані в чистіший premium-патерн без зміни role/access logic.

---

## v0.50.33 - Version System Hardening (2026-05-16)

### Release / Version [codex]
- **Version Truth** - `package.json` тепер містить не тільки canonical `version`, а й canonical `eventGenix.releaseLabel`, з якого синхронізуються видимі release labels.
- **Hard Gate** - `scripts/version-sync.js` тепер ловить drift у login release badge, tagline, changelog CTA, modal heading, `CHANGELOG.md`, `?v=` asset tags, service-worker cache names і `/api/version` route contract.
- **Deploy Smoke** - додано `npm run version:smoke`, який звіряє live `/api/version` і login HTML з очікуваною версією перед завершенням релізу.

---

## v0.50.32 - HR Interactive Company Structure (2026-05-16)

### HR / Structure [codex]
- **Структура компанії** - замість порожнього текстового поля додано інтерактивну org-chart схему за затвердженою ієрархією з фото.
- **Інтерактивність** - кожен блок ролі клікабельний і показує коротку зону відповідальності у правій інформаційній панелі.
- **Сумісність** - збереження нотаток та інструкцій через існуючий `/api/hr/company-structure` залишилось без окремої нової системи.

---

## v0.50.31 - HR Schedule Dark Theme Polish (2026-05-16)

### HR / Schedule [codex]
- **Темний режим** - прибрано світлу заливку поточного дня у вкладці **Розклад**, щоб таблиця не вибивалась із dark theme.
- **Контраст** - кнопки навігації, дії, select шаблону та символи отримали темні стани й світлий текст.
- **Зміни** - shift-плашки та порожні клітинки отримали читабельні dark-mode кольори без білих плям.

---

## v0.50.30 - Dashboard New Leads Widget Links (2026-05-16)

### Dashboard / Leads [codex]
- **Нові ліди** - елементи віджета стали клікабельними і ведуть прямо у workspace конкретного ліда через `/sales-funnel?lead=<id>`.
- **UX** - додано зрозумілий hover/focus стан для списку, щоб було видно, що кожен лід відкривається.
- **Fallback** - якщо у рядка немає id, клік безпечно відкриває загальну воронку лідів.

---

## v0.50.29 - My Cabinet Icon Cluster Redesign (2026-05-16)

### Profile / My Cabinet [codex]
- **Icon Cluster** - верхній блок My Cabinet перезібрано в три великі icon-only плитки для задач, сповіщень і воронки без урізаних текстових підписів.
- **Notifications** - центральна плитка тепер використовує bell-іконку і відкриває наявну alerts-панель CRM.
- **Counters** - лічильники стабілізовано для `0..99`, зі зрозумілим `99+` для великих значень і без приховування нуля.

---

## v0.50.28 - Sound Log Dark Theme Contrast Fix (2026-05-16)

### Sound / Log [codex]
- **Dark Theme** - виправлено контраст вкладки **Лог подій**, щоб заголовок, subtitle, фільтри, дати, статистика, записи та теги були читабельні в чорній темі.
- **Action Labels** - для типів подій додано яскраві dark-mode accent-и, тому `Програвання`, `TTS`, `Створення`, `Зміни` та інші написи більше не зливаються з фоном.
- **Form Controls** - date-фільтри та chip-кнопки отримали стабільні темні стани hover/active без втрати видимості.

---

## v0.50.27 - Sidebar Group Animation Polish (2026-05-16)

### Sidebar / Navigation [codex]
- **Group Header** - виправлено active/open стан груп sidebar, щоб зелена підсвітка не виглядала так, ніби вилітає за межі картки.
- **Arrow Sync** - прибрано конфлікт двох chevron-систем, через який стрілка групи виглядала кривою та несинхронною.
- **UI Polish** - групи меню отримали рівний contained border, стабільне вирівнювання і спокійніший hover/active ритм у світлій та темній темах.

---

## v0.50.26 - Timeline Animator Visibility Fix (2026-05-16)

### Timeline / Booking Visibility [codex]
- **Animator Timeline** - виправлено видимість бронювань для акаунтів аніматорів: staff scope тепер враховує `bookings.line_id`, тобто реальну лінію таймлайну.
- **Женя / Staff Accounts** - додано fallback через зв'язку `users` -> `staff`, щоб прив'язані staff-акаунти не отримували порожній таймлайн через стару перевірку по `hosts`.
- **Regression Test** - додано тест, який гарантує, що аніматор бачить івенти своєї primary line навіть коли `hosts` є кількістю аніматорів, а не staff id.

---

## v0.50.25 - Omni Account Connections & Alerts (2026-05-15)

### Omni / Account Connectivity [codex]
- **Omni Accounts** - в Omni додано control-panel підключень каналів зі статусом Telegram, Viber, SMS, Facebook, Instagram і Binotel.
- **Alerts** - непідключені або обмежені канали тепер показують local alarm у Omni і додаються в global alerts bell як operational issue.
- **Guided Recovery** - `channel_unavailable` та disabled compose більше ведуть користувача до блоку **Підключення каналів**, а не лишають його з глухою помилкою.

---

## v0.50.24 - Chat Runtime Audit & Theme Stabilization (2026-05-15)

### Chat / Runtime Audit [codex]
- **Chat Audit** - виконано системний audit bootstrap, theme, overlay і right-panel interaction зон чату замість точкового cosmetic fix.
- **Theme** - стабілізовано manual/auto theme contract у chat: `pzp_dark_mode`, `pzp_autoNight`, нічне вікно, `body.dark-mode`, `body.night-auto` і `data-theme` тепер синхронізуються.
- **Stability** - додано відсутній runtime title node для right info panel, уніфіковано close behavior для status/theme/modals через outside click та Escape.

---

## v0.50.23 - Tasks Top Cleanup (2026-05-15)

### Tasks / UI Cleanup [codex]
- **Tasks UI** - прибрано окрему вкладку **Фокус** з верхньої навігації задач, щоб верх сторінки був спокійнішим.
- **Top Summary** - прибрано картки **Прострочено**, **Чекаю** та **Швидкі перемоги** з верхньої summary-lane; лишився компактний **Фокус дня**.
- **Safe Fallback** - старі переходи на `tasks.html?view=focus` більше не лишають сторінку в прибраному режимі й тихо відкривають `today`.

---

## v0.50.22 - Global CRM Assistant Rail (2026-05-15)

### CRM / Assistant Rail [codex]
- **All Pages** - верхня AI-строка стала shared CRM-компонентом і монтується у header на всіх authenticated сторінках без копіювання HTML.
- **Proactive Help** - якщо користувач лишається на сторінці 5 секунд і не починає активну роботу, асистент сам коротко пропонує допомогу з урахуванням сторінки та ролі.
- **Voice + Text** - одна й та сама підказка показується субтитрами і, якщо voice mode увімкнений, паралельно озвучується через TTS.
- **Global API** - додано `/api/crm-assistant/*` як основний namespace для reply, transcription і speech; dashboard namespace лишився legacy alias.

---

## v0.50.21 - Dashboard AI Guide Voice Mode (2026-05-15)

### Dashboard / Assistant Rail [codex]
- **Assistant Rail** - верхня AI-панель дашборду підключена до server-side OpenAI Responses API і тепер дає короткі CRM-підказки з урахуванням ролі, сторінки, widgets і role preview.
- **Voice Mode** - додано голосовий цикл: мікрофон у браузері, server-side transcription через OpenAI audio, AI-відповідь, TTS-озвучення і субтитри в rail.
- **CRM Guidance** - створено окремий instruction pack для Event Genix CRM, щоб асистент працював як in-product провідник, а не generic chat.
- **Secret Safety** - `OPENAI_API_KEY` використовується тільки на backend; frontend відправляє лише dashboard context і не отримує ключ.

---

## v0.50.20 - Dashboard Mixed Scene by Role (2026-05-15)

### Dashboard / Role Scenes [codex]
- **Dashboard Scene** - дашборд став єдиною змішаною сценою з логічно розкладеними widgets, контрольним центром і зонами для нотаток.
- **Role Logic** - для `creator`, `admin`, `manager`, `senior_manager`, `director`, `vice_director`, `hr` і `art_director` додано власні scene presets; creator може preview-ити сцену інших ролей.
- **Workspace Feel** - права writing lane, стабільний center control і керовано асиметричний лівий кластер формують dashboard як робочий простір, а не плоский список карток.

---

## v0.50.19 - Assistant Rail Expansion & Sidebar Status Polish (2026-05-15)

### Dashboard / Sidebar [codex]
- **Assistant rail** - центральний AI-блок у header розтягнуто на всю доступну зону, щоб субтитри та живий статус читалися як повноцінна інформаційна панель, а не як вузька смуга.
- **Текстова зона** - subtitle-track тепер має значно більше місця, показує дві строки перед ticker-режимом і краще працює для довших реплік.
- **Sidebar cells** - верхні картки `Задачі / Алерти / Воронка` перезібрані у чистіший формат з сильнішою іконкою, короткою назвою і менш шумною типографікою.

---

## v0.50.18 - Sidebar Dashboard Badge Cleanup (2026-05-15)

### Sidebar / Navigation [codex]
- **Dashboard badge** - прибрано помилковий лічильник alert-ів з кнопки `Дашборд` у sidebar.
- **Badge truth** - alerts лишаються тільки там, де їм місце: у сповіщеннях і відповідних dashboard surfaces, без фальшивого дублювання на jump-кнопці.

---

## v0.50.17 - Sidebar Dashboard Jump (2026-05-15)

### Sidebar / Navigation [codex]
- **Дашборд-кнопка** - повернуто окрему кнопку швидкого переходу на Dashboard над основним accordion-списком меню.
- **Дизайн** - кнопка винесена з status rail, має власну іконку, підпис `Головний екран / Дашборд`, активний стан і спокійно вписується в Aurora sidebar.
- **UX** - навіть коли групи меню згорнуті, головний екран лишається швидко доступним без розкриття CRM-розділу.

---

## v0.50.16 - Dashboard Assistant Voice Rail (2026-05-15)

### Dashboard / Assistant Rail [codex]
- **Header rail** - у центральній зоні dashboard header додано постійну assistant-панель для статусу, голосу й субтитрів.
- **Voice presence** - rail підтримує стани `Готовий`, `Думаю`, `Зайнятий`, `Слухаю`, `Говорю`, `Тиша` і `Помилка`, щоб користувач бачив, що робить асистент.
- **Subtitles ticker** - довгі репліки плавно прокручуються тільки коли не влазять у рядок; на hover/focus рух ставиться на паузу.
- **Hooks** - додано frontend-контракт `setAssistantRailState`, `toggleAssistantVoice`, `replayAssistantLine` і `demoAssistantSpeak` для майбутнього підключення реального голосового/LLM pipeline.

---

## v0.50.15 - Profile Photo Upload (2026-05-15)

### Profile / Avatar [codex]
- **Фото з пристрою** - у налаштуваннях профілю додано завантаження власної аватарки з комп'ютера або телефона.
- **Storage** - фото профілю проходить через documented storage surface: Supabase Storage `profile-avatars` із локальним fallback `/uploads/profile-avatars`.
- **Safety** - дозволені тільки JPG, PNG, WebP і GIF до 5 МБ; SVG та невідповідні MIME-типи блокуються до збереження.
- **UX** - preview аватарки оновлюється одразу після вибору файлу, а після збереження оновлюються профіль, header і sidebar.

---

## v0.50.14 - Dashboard Board Tools & Notes Repair (2026-05-15)

### Dashboard / Board Mode [codex]
- **Board tools** - у dashboard board mode додано text, frame, brush/highlighter/eraser foundation і кілька типів фігур: line, arrow, rect, round rect, ellipse, diamond.
- **Legacy notes repair** - старі board notes з payload keys `kind`, `content`, `body`, `noteText`, `label` тепер мігруються в canonical `text` і залишаються редагованими.
- **Clear all** - додано дію `Очистити все` з confirm flow, очищенням items/drawings і undo snapshot.
- **Config round-trip** - frontend і backend dashboard config тепер зберігають `boardState.drawings` та `activeTool`, не відрізаючи drawing state при save/load.

---

## v0.50.13 - Sidebar Status Cell Clarity (2026-05-15)

### Sidebar / Status Cells [codex]
- **Статусні комірки** - задачі, алерти й воронка отримали великі кастомні SVG-іконки, щоб призначення кнопок читалось без здогадок.
- **Підказки** - при hover/focus або утриманні відкривається опис, що саме робить комірка і куди веде клік.
- **UX** - лічильники стали більшими, а статусний rail лишився компактним і не забирає зайве місце в меню.

---

## v0.50.12 - Profile Dark Contrast (2026-05-15)

### Profile / Dark Mode [codex]
- **Темна тема профілю** - виправлено низький контраст у робочому профілі: ім'я, заголовки, метрики, задачі й активність тепер читаються на темному фоні.
- **Profile surfaces** - профільні картки, таби, бейджі, рядки задач і My Cabinet отримали окремі темні text/surface tokens замість помилкового `gray-100`.
- **UI guard** - додано static smoke check, який перевіряє наявність читабельних dark-mode правил для профілю.

---

## v0.50.11 - Dashboard Widget Cleanup (2026-05-15)

### Dashboard / Widget Density [codex]
- **Removed widgets** - з головного dashboard прибрано великі службові картки `finance_today`, `reports_today`, `account_stats` і `week_bookings`.
- **Compact widgets** - погода й курси валют стали нижчими та більше не виглядають як великі порожні блоки.
- **Layout** - dashboard grid тепер вирівнює віджети по природній висоті, без розтягування всього рядка до найвищої картки.

---

## v0.50.10 - Sidebar Profile Cleanup (2026-05-15)

### Sidebar / Dashboard Cleanup [codex]
- **Profile duplicate** - прибрано зайву окрему профільну картку, яка дублювала інформацію про користувача.
- **Dashboard menu** - sidebar став нижчим і чистішим: лишається один основний профільний блок.
- **UI guard** - додано static smoke check проти повернення `sidebar-now-card`.

---

## v0.50.9 - Sidebar Status Rail (2026-05-15)

### Sidebar / Status Rail [codex]
- **Status rail** - задачі, алерти й воронку зібрано в один горизонтальний segmented-блок замість трьох рядків.
- **Compact info** - кожен сегмент показує власний лічильник і короткий стан, а повний опис доступний через hover/assistive label.
- **Navigation** - сегменти лишились окремо клікабельними: задачі відкривають tasks, алерти відкривають сповіщення, воронка відкриває funnel.

---

## v0.50.8 - Sidebar Role Line (2026-05-15)

### Sidebar / Profile Card [codex]
- **Profile card** - прибрано обрізаний time-based greeting `Доброго...` біля імені користувача.
- **Roles** - під іменем тепер показується роль або ролі акаунта без привʼязки до часу доби.
- **UI guard** - додано static smoke check, який не дасть повернути greeting-рядок у sidebar.

---

## v0.50.7 - Sidebar AI Placeholder Cleanup (2026-05-15)

### Sidebar / Dashboard Surface [codex]
- **AI placeholder** - прибрано зайвий demo/AI-блок `Імітація / Почати` з верхньої частини меню.
- **Dashboard UX** - sidebar більше не витрачає місце на підготовчий блок, який не був потрібен у поточному dashboard flow.
- **Cleanup** - видалено рендер, таймери, CSS і публічний handler placeholder-картки.

---

## v0.50.6 - Sidebar Status Stack (2026-05-15)

### Sidebar / Compact Status [codex]
- **Status stack** - задачі, алерти й воронку згруповано в один компактний блок замість трьох великих окремих карток.
- **UX** - верхня частина меню стала нижчою, швидше сканується і не забирає стільки вертикального місця.
- **Visual polish** - статусні рядки отримали спільну рамку, щільні лічильники справа і мʼякі hover/critical-стани.

---

## v0.50.5 - Dashboard Board Notes Fix (2026-05-15)

### Dashboard / Board Notes [codex]
- **Нотатки** - board notes переведено з крихкого `contenteditable` на стабільний textarea-редактор.
- **Редагування** - клік у текст більше не запускає повний rerender board і не скидає фокус під час набору.
- **Накладання** - активна нотатка тимчасово піднімається над іншими board-обʼєктами, тому накладені нотатки можна нормально редагувати.

---

## v0.50.4 - Sidebar Dashboard Jump (2026-05-15)

### Sidebar / Navigation [codex]
- **Dashboard jump** - пасивний напис `Зараз` у верхній панелі sidebar замінено на інтерактивну кнопку переходу на Dashboard.
- **UX** - кнопка має компактний pill-стиль, hover/focus-стани і не конфліктує з кліком по профілю.
- **Навігація** - швидкий перехід на Dashboard тепер доступний прямо з верхньої картки sidebar.

---

## v0.50.3 - Sidebar AI Companion Placeholder (2026-05-15)

### Sidebar / AI Companion [codex]
- **AI-помічник** - у верхню картку sidebar додано компактне вікно майбутнього AI-чату з кнопкою старту розмови.
- **Режими індикатора** - помаранчевий означає демо/імітацію, зелений зарезервований для реального LLM-режиму.
- **Підготовка до LLM** - додано placeholder-фрази по ключових сторінках і стабільний frontend-контракт `mock|live` для майбутнього підключення справжнього аналізу.

---

## v0.50.2 - Sidebar Metrics Rail Polish (2026-05-15)

### Sidebar / Metrics [codex]
- **Метрики sidebar** - блок задач, алертів і воронки перероблено з трьох тісних колонок у компактний вертикальний rail.
- **Читабельність** - назви, числа і короткий опис більше не стискаються у вузьких картках і не виглядають як випадкові “вікна”.
- **Теми** - новий rail використовує ті самі CSS-змінні Aurora sidebar, тому лишається акуратним у світлій і темній темі.

---

## v0.50.1 - Dashboard Board Foundation Engine (2026-05-15)

### Dashboard / Board Foundation [codex]
- **Board mode** - додано керований режим board поверх існуючого dashboard config без окремого сховища або заміни grid dashboard.
- **Engine contract** - закладено `grid|board`, `view|edit`, `boardMeta.version`, нормалізований `boardState`, базову selection/object discipline та widget click-vs-drag контракт.
- **Надійність** - додано dirty-state indicator, debounced autosave, local recovery draft, undo/redo foundation і safe fallback для несумісного board config.
- **Governance** - phase 1 лишається personal-first: без realtime collaboration, без Miro-overreach і з performance cap для live widgets.

---

## v0.50.0 - Sidebar Aurora Redesign (2026-05-15)

### Sidebar / Navigation [codex]
- **Aurora UI** - sidebar винесено в окремий `css/sidebar-aurora.css` з живим aurora glow, spotlight за курсором, ripple-кліками та плавним активним індикатором.
- **Now card** - стара user-картка замінена на робочу картку "Зараз" з аватаром, живим часом і поточною/наступною подією з бронювань.
- **Pill-статистика** - задачі, алерти й воронка стали компактними pill-метриками замість великих stacked widgets.
- **Темна/світла тема** - новий sidebar працює через CSS-змінні та має однакову читабельність у двох темах.
- **Сумісність** - `NAV_ITEMS`, `SIDEBAR_ACCESS`, `data-page-access`, hash-action handlers і збережений стан груп лишилися на старих контрактах.

---

## v0.49.26 - Dashboard Funnel Widget Simplification (2026-05-15)

### Dashboard / Widgets [codex]
- **Dashboard** - велику панель "Робоча черга" прибрано з основного потоку dashboard, щоб головний екран не виглядав як операційна консоль.
- **Воронка** - замість важкого work queue slab додано компактний widget "Воронка" у форматі звичайних dashboard cards.
- **Архітектура** - widget бере дані з наявного `funnelInsights` через dashboard endpoint, без дублювання нового джерела даних.

---

## v0.49.25 - Sidebar Modern Icon System (2026-05-15)

### Sidebar / Navigation [codex]
- **Меню** - іконки sidebar приведено до єдиної сучасної SVG-системи з однаковими плитками, рамками й hover/active станами.
- **Кнопки** - віджети задач, сповіщень, воронки, quick-переходи та перемикач теми отримали спільну action-card мову без різнокаліберного вигляду.
- **Теми** - світла й темна тема тепер мають однакові контрасти, кольорові акценти і читабельні іконки без залежності від emoji-стилю ОС.

---

## v0.49.24 - Lead Customer Linking Dropdown (2026-05-15)

### Leads / Customers [codex]
- **Воронка** - привʼязка клієнта до ліда більше не просить вручну вводити ID.
- **Клієнти** - додано пошук і випадаючий список існуючих клієнтів з іменем, телефоном, Instagram і кількістю візитів.
- **UX** - оператор може або привʼязати існуючого клієнта, або окремою дією створити нового з даних ліда.

---

## v0.49.23 - Team Presence Clarity (2026-05-15)

### Dashboard [codex]
- **Команда онлайн** - зеленим тепер показуються тільки користувачі з реальним online-підключенням.
- **Присутність** - не-online користувачі у віджеті стали сірими: аватарка, статус-крапка і CRM-бейдж більше не виглядають як онлайн.
- **Теми** - light/dark режим отримали однакову логіку offline/recent станів без хибного зеленого сигналу.

---

## v0.49.22 - Sidebar Professional Polish (2026-05-15)

### Sidebar [codex]
- **Меню** - sidebar приведено до єдиної професійної системи карток для профілю, задач, сповіщень, воронки та швидких переходів.
- **Компактність** - верхній блок став щільнішим: коротші підписи віджетів, нижчі quick-кнопки та менше випадкового візуального шуму.
- **Теми** - світла й темна тема отримали однакову ієрархію, видимі стрілки, рамки, hover/active стани та спокійніші акценти.

---

## v0.49.21 - Work Queue Funnel Summary (2026-05-15)

### Dashboard / Leads [codex]
- **Робоча черга** - `Лід без руху` більше не показується як окремий пункт черги з дією `Відкрити кейс`.
- **Воронка** - у робочій черзі додано компактний блок стану funnel: активні ліди, скільки чекає дії та етапи з найбільшим навантаженням.
- **Інтеграція** - довідкові lead-сигнали тепер ведуть у нормальний модуль воронки, а не створюють паралельний формат ліда.

---

## v0.49.20 - Staff Schedule Dark Theme (2026-05-15)

### Staff Schedule [codex]
- **Графік** - темну тему вкладки `Графік роботи` перероблено для всієї schedule-сітки.
- **Таблиця** - темні стилі тепер покривають sticky-колонки, заголовки, групи відділів, статуси змін і hover-стани.
- **Стабільність** - dark mode працює і через `body.dark-mode`, і через `data-theme="dark"`, без світлого flash таблиці.

---

## v0.49.19 - Custom Sidebar Icons (2026-05-15)

### Sidebar Icons [codex]
- **Меню** - системні emoji замінено на власний SVG-набір іконок для sidebar.
- **Теми** - іконки отримали контрольовані кольори для світлої й темної теми без залежності від emoji-шрифту ОС.
- **Стиль** - віджети задач, сповіщень, воронки, quick-кнопки та accordion-групи тепер виглядають більш професійно й однаково.

---

## v0.49.18 - Sidebar Top Block Density (2026-05-15)

### Sidebar Top Block [codex]
- **Меню** - верхній блок із профілем, задачами, сповіщеннями та воронкою зроблено компактнішим.
- **Щільність** - зменшено висоту профільної картки, іконки, лічильники, padding і вертикальні проміжки віджетів.
- **Баланс** - блок займає менше місця, але ключові числа й назви лишаються читабельними.

---

## v0.49.17 - Sidebar Quick Buttons Density (2026-05-15)

### Sidebar Quick Nav [codex]
- **Меню** - кнопки `Графік`, `Таймлайн` і `Чат` зроблено трохи нижчими та компактнішими.
- **UX** - зменшено іконку, padding і проміжки, щоб quick-блок не займав забагато місця під віджетами.
- **Читабельність** - текст лишився достатньо жирним і контрастним у світлій та темній темах.

---

## v0.49.16 - Sidebar Accordion State Fix (2026-05-15)

### Sidebar Accordion [codex]
- **Меню** - кілька відкритих розділів sidebar тепер зберігаються одночасно, а не перетираються останнім кліком.
- **Стабільність** - стан accordion нормалізується, навіть якщо в `localStorage` лишився старий або битий формат.
- **UX** - після перемальовування меню попередньо відкриті розділи не зникають самі.

---

## v0.49.15 - Sidebar Action Trap Hardening (2026-05-15)

### Sidebar Legacy Actions [codex]
- **Меню** - старий блок `Дії` більше не може лишати користувача внизу sidebar без нормального виходу.
- **Стабільність** - додано JS-guard, який видаляє legacy action-кнопки навіть зі старого DOM або кешованої розмітки.
- **Навігація** - прибрано відновлення старого scroll-положення sidebar, щоб меню завжди стартувало з нормальної верхньої зони.

---

## v0.49.13 - Notification Center Redesign (2026-05-15)

### Notification Center [codex]
- **Сповіщення** - кнопка в лівому меню більше не відкриває маленький popover справа від header.
- **Меню** - верхній дзвіночок прибрано з shared header-flow, а sidebar відкриває окремий центр подій.
- **UX** - нова панель сповіщень має backdrop, більший робочий простір і постійно видимі дії для алертів.

---

## v0.49.12 - Sidebar Quick Navigation (2026-05-15)

### Sidebar Quick Nav [codex]
- **Меню** - над основними accordion-групами додано окремий блок швидких переходів.
- **Швидкий доступ** - `Графік`, `Таймлайн` і `Чат` винесені в компактний список для всіх користувачів.
- **UX** - блок має власні рамки, hover/active стани та читабельний вигляд у світлій і темній темах.

---

## v0.49.11 - Sidebar Funnel Widget (2026-05-15)

### Sidebar Funnel [codex]
- **Меню** - у pinned-зоні sidebar додано віджет "Воронка" для швидкого контролю лідів.
- **Алерти** - якщо є лід, що чекає дії, віджет підсвічується і показує червоний лічильник.
- **Навігація** - клік по віджету відкриває воронку, а при hot lead веде одразу в конкретний лід.

---

## v0.49.10 - Profile Avatar Settings (2026-05-15)

### Profile Avatar [codex]
- **Профіль** - у вкладці "Налаштування" додано робочий редактор аватарки.
- **Avatar** - підтримано emoji-аватар, колір фону, повернення до літери з імені та фото через URL.
- **Sidebar** - після збереження аватарка синхронізується з header/sidebar, AppState і localStorage.

---

## v0.49.9 - Light Sidebar Readability Fix (2026-05-15)

### Sidebar Light Mode [codex]
- **Меню** - у світлій темі підсилено контраст стрілок accordion-груп, щоб їх було видно так само впевнено, як у темній темі.
- **Рамки** - зроблено помітнішими межі між групами меню та active group border.
- **UX** - labels, arrows і active marker більше не губляться на білому sidebar-фоні.

---

## v0.49.8 - Tasks OS Foundation + Sidebar/Профіль Polish (2026-05-15)

### Tasks OS + My Cabinet [codex]
- **Tasks model** - додано foundation для `task_mode`, `task_kind`, `visibility`, `workflow_state`, focus/reminder/snooze metadata, subtasks і personal task preferences через міграцію `179_tasks_os_my_cabinet.sql`.
- **Tasks API** - розширено `/api/tasks`: фільтри personal/private/focus/workflow, `/api/tasks/my-cabinet`, focus/snooze endpoints і checklist endpoints.
- **My Cabinet** - у профілі додано вкладки "Мій день" і "Мої задачі" як персональну проекцію задач без дублювання повного board.
- **Tasks page** - додано OS views `Інбокс`, `Фокус`, `Наступні`, `Чекаю`, `Командні`, `Рутини`, focus lane і quick capture з personal/private/waiting/focus intent.
- **Dashboard** - додано snapshot-віджет "Мій фокус" поверх існуючої dashboard architecture.
- **Chat/Alerts** - task capture передає personal-aware payload; chat підтримує self-task flow, а alert-created tasks ідуть у canonical task model.

### Sidebar + Profile [codex]
- **Профіль** - особистий кабінет впорядковано як серйозний робочий профіль; клік по імені в header веде на новий `/profile`, а не на стару модалку.
- **Меню** - групи меню стартують згорнутими, профіль у sidebar клікабельний, аватарка підтримує фото, а pinned task mini-widget показує активні задачі.
- **Сповіщення** - pinned "Фокус дня" у sidebar замінено компактним дублем alerts з кількістю нових і preview, який відкриває існуючу панель сповіщень.
- **Dark mode** - виправлено контраст імені користувача, ролі, pinned-віджетів і груп меню в sidebar.

---

## v0.49.7 - Sidebar Alerts Duplicate (2026-05-15)

### Sidebar Alerts [codex]
- **Меню** - прибрано pinned-пункт "Фокус дня" з sidebar.
- **Сповіщення** - замість нього додано компактний дубль alerts з кількістю нових і коротким preview.
- **UX** - sidebar alerts відкриває існуючу панель сповіщень, не створюючи другого alert workflow.

---

## v0.49.6 - Professional Profile Workspace (2026-05-15)

### Profile Workspace [codex]
- **Профіль** - особистий кабінет впорядковано як робочий профіль працівника: identity, role, Telegram status, задачі, зміна, дедлайни й остання активність винесені в чистий overview.
- **Navigation** - клік по імені користувача в правому хедері більше не відкриває стару profile-модалку, а веде на нову сторінку `/profile`.
- **Design** - gamification-first hero прибрано з першого екрану; ігрові механіки лишаються другорядними вкладками, не основним робочим станом.
- **UX** - вкладки профілю отримали стриманіші назви без зайвого візуального шуму.

---

## v0.49.5 - Sidebar Task Widget + Profile Link (2026-05-15)

### Sidebar Navigation [codex]
- **Меню** - групи навігації стартують згорнутими за замовчуванням і зберігають вибір користувача після відкриття.
- **Профіль** - імʼя та картка користувача в sidebar стали клікабельними й відкривають особистий профіль.
- **Задачі** - у меню закріплено міні-віджет "Мої задачі" з кількістю активних задач і позначкою протермінованих.
- **Avatar** - sidebar підтримує фото профілю в аватарці та компактну аватарку для вузького меню.

---

## v0.49.4 - Timeline + Chat Self-Task Flow (2026-05-15)

### Timeline First-Screen Flash [codex]
- **Navigation** - прибрано короткий flash стартового/login екрана при переході з Tasks на Timeline.
- **Shell** - timeline landing page вирівняно до shared authenticated first-paint contract: login shell більше не visible-by-default.
- **UX** - route transitions на Timeline відкривають робочий інтерфейс без проміжного першого екрана, а unauthenticated login показується тільки explicit auth flow.

### Chat Self-Task Flow [codex]
- **Chat** - додано швидкий сценарій "створи таску собі" прямо з task form у чаті.
- **Commands** - `/task` тепер підтримує self-формати: `/task собі ...`, `/task self ...`, `/task me ...`.
- **UX** - task form preselect-ить поточного користувача, лишаючи старий delegated flow через вибір іншого виконавця.

---

## v0.49.3 - Dashboard + Tasks Bootstrap Hardening (2026-05-15)

### Dashboard Work Queue [codex]
- **UI** - робочу чергу на dashboard ущільнено як справжній віджет: блок більше не розтягується на широку сторінкову секцію.
- **UX** - bucket-и винесено у власний scroll-контейнер, права зона вирішення стала коротшою, а рядки черги не створюють окремих високих action-блоків.
- **Density** - аналітика черги, chips, кнопки, картки тріажу й empty-state стиснуті для швидкого сканування без втрати мобільного fallback.
- **Follow-up** - видимий `v1`/службові пояснення з аналітики прибрано з основного шару віджета, ширину й висоту bucket-rail додатково зменшено.
- **Widget mode** - порожня права зона більше не резервує колонку до вибору пункту, а кнопка оновлення в шапці отримала компактний widget-size.

### Tasks Bootstrap + Standalone Audit [codex]
- **Tasks** - знайдено й закрито root cause класу `auth/runtime conflation`: runtime-помилки після успішної авторизації більше не редіректять користувача на головну як fake auth failure.
- **Chat** - додано fatal bootstrap boundary і boot markers, щоб сценарій "є звук, але білий екран" залишав видимий error state замість часткового background init без UI.
- **Stability** - додано shared standalone fatal error contract для page-local runtime failures; auth failure і init/render failure тепер розведені.
- **Audit** - перевірено standalone modules Tasks, Chat, HR, Analytics, Finance, Warehouse, Customers, Leads, Programs, Staff, Dashboard, Training, Designs, Graduation; critical same-class redirect risks закрито для HR, Finance та Analytics.

---

## v0.49.2 - Dashboard Work Queue + Navigation First Paint Fix (2026-05-15)

### Dashboard Work Queue [codex]
- **UI** - повністю українізовано блок робочої черги на dashboard: операції з відповідями, аналітика черги, робоча зона вирішення, історія дій і execution actions більше не показують англомовні службові заголовки.
- **UX** - work queue перебудовано в щільніший desktop master/detail layout: bucket-и лишаються зліва, а робоча зона вирішення стала компактною sticky-панеллю справа з mobile fallback в одну колонку.
- **Polish** - технічні risk/action keys на кшталт `missing_deadline`, `reply_escalated` і backend action labels мапляться у людиночитні українські назви перед показом у UI.

### Navigation First Paint [codex]
- **Shell** - `Sidebar.init()` ?????? ?? ?????? `shell-ready` ??????????; ????? shell ????? ???????? auth/page layer ????? explicit `showAuthenticatedPageShell()` / `Sidebar.markShellReady()`.
- **Pages** - top-level CRM pages ????????? ?? ??????????? `mainApp` baseline, ??? sidebar/header/content ?? ?????? ?? ?????????? auth ? ???????????? page bootstrap.
- **Chat** - ?????? hack `Show main app FIRST` ????????; chat shell ????????????? ????? ???????? first-paint ???????? ????? token/user bootstrap.

---

## v0.49.1 - Navigation Page Switch Flicker Fix (2026-05-15)

### Navigation Stability [codex]
- **Navigation** - прибрано visible old-shell delay під час переходів між CRM pages: sidebar click більше не тримає попередній DOM на 180ms.
- **Shell** - додано shared `shell-ready` lifecycle, який ховає broken intermediate shell до завершення sidebar baseline init.
- **Stability** - `Sidebar.init()` зроблено idempotent, прибрано дубльовані page-local sidebar toggle/init paths, а page-group animations запускаються тільки після shell readiness.

---

## v0.49.0 - Release 49 Rollout (2026-05-15)

### Release Marker [codex]
- **Visibility** - scoped visibility, reporting, parity and notification contours зібрані на canonical booking visibility без нового shadow engine.
- **Operations** - operations flow cluster зафіксовано в release 49 state: task assignment truth, chat-to-task rails, lead/customer identity, queue і accepted-vs-closed analytics.
- **Backoffice** - org/HR/inventory/pricing foundation піднято як стабільний release marker: staff department UI guidance, HR schedule truth, warehouse owner partition і Price Center product linkage.
- **Navigation Audit** - page-switch flicker root-cause audit виконано analysis-only; production fix лишається окремою наступною задачею.

---

## v0.48.15 - Org / HR / Inventory / Pricing Foundation v2 Comprehensive (2026-05-14)

### Backoffice Foundation Completion [codex]
- **Departments** - org/dept image-source у workspace не знайдено, тому фінальну taxonomy не вигадано; add-employee form переведено на наявний `StaffState.departments` legacy source з fallback, а role options стали department-aware тільки як UI guidance.
- **HR** - v1 source truth збережено: company structure/instructions, employee profile fields, reserve/blacklist, manual attendance fallback і task KPI лишаються на чинних HR/staff/task джерелах без auth-role redesign.
- **Warehouse** - існуючий `warehouse_stock.owner` явно оформлено як bounded owner partition (`park`, `dar`, `shared`) з `transferSemantics: missing-truth`, без fake multi-warehouse transfers або accounting semantics.
- **Pricing** - Price Center отримав `/api/center/prices/positions`, product-position audit у UI і виправлену привʼязку `price_rules.product_id`, яка більше не вимагає одночасної зміни value/name.
- **Tests** - додано `tests/backoffice-foundation-v2.test.js` для department fallback, department-aware form modal, price linkage і warehouse owner-partition stop-rules.

---

## v0.48.14 - Operations Flow Cluster v2 Comprehensive (2026-05-14)

### Operations Flow Completion [codex]
- **Tasks** - canonical `tasks.owner_user_id` лишається source of truth; chat-originated tasks повертають explicit source/notification meta, а bulk assignment більше не робить no-op update і не дублює assignment notifications.
- **Lead / Customer** - додано additive `leads.celebrants` і `customers.social_identities`; старі single-child/Instagram поля лишаються legacy projection, без auto-merge або fake duplicate engine.
- **Workspace Scope** - lead workspace рахує customer booking aggregates через canonical booking visibility, щоб customer context не розширював видимість поза дозволеним booking scope.
- **Analytics** - accepted-vs-closed deals report зафіксовано як snapshot-only semantics із `COUNT(DISTINCT leads.id)` duplicate protection і явною missing stage timestamp truth.
- **Tests** - додано `tests/operations-flow-v2.test.js` для schema governance, no-op assignment, celebrants/social identities, lead/customer link truth і reporting semantics.

---

## v0.48.13 - Org / HR / Inventory / Pricing Foundation v1 (2026-05-14)

### Backoffice Foundation [codex]
- **Departments** - org/dept image-source у workspace не знайдено, тому фінальну department taxonomy і registry не вигадано; hardcoded reuse points зафіксовані як legacy/UI/auth-sensitive.
- **HR** - `/hr#team` став canonical route для команди, profile deep-link відкриває картку співробітника, профіль підтримує адресу, дату народження, резерв і чорний список.
- **Schedule** - HR shifts синхронізуються у legacy `staff_schedule`, додано явну підміну зміни з audit context, а manual attendance fallback збережено.
- **Operations** - додано HR-owned структуру/інструкції, reserve/blacklist списки, структуровану анкету кандидата і task KPI на `tasks.owner_user_id` без нового task engine.
- **Warehouse / Pricing** - multi-warehouse promotion зупинено без durable stock-movement/location truth; price center лишився на існуючій working truth без fake link semantics.

---

## v0.48.12 - Operations Flow Cluster v1 (2026-05-14)

### Operations Flow [codex]
- **Задачі** - chat-to-task тепер створює canonical `tasks` з явним operator-selected `ownerUserId`; slash `/task` більше не створює окрему legacy chat-task і дубль у main tasks.
- **Notifications** - assignment/reassignment notifications стали typed-owner aware, bulk/reassign hooks використовують існуючу task notification доріжку, а no-op update більше не дублює повідомлення.
- **Lead/Customer** - lead workspace отримав explicit link/create-link клієнта; duplicate handling лишається suggest-only без auto-merge, а Telegram entry points ведуть у CRM Omni.
- **Analytics** - додано accepted-vs-closed deals report за вибраний date range із явною позначкою, що durable stage timestamp truth ще відсутня.
- **Stop-rules** - multi-social identity schema, multi-celebrant storage і task multi-responsible model не промоутяться без доведеної durable truth.

---

## v0.48.11 - Scoped Visibility & Operations Mega Completion v1 (2026-05-14)

### Visibility & Operations [codex]
- **Reporting** - booking-derived reporting, stats, center, board, settings fallback і helper/chat summaries доведено на canonical `services/bookingVisibility.js` rails без другого visibility engine.
- **Parity** - global search, customer booking aggregates/details і lead workspace shortcuts тепер не розширюють видимість поза booking/task/page scope.
- **Notifications** - Telegram digest/reminder/manual helper summaries і scheduled booking alerts отримали actor/system-scoped booking visibility та safe recipient checks.
- **Operational Scope** - підтверджено durable staff-host assignment; `team`, `line` і `location` лишаються explicit missing truth/deny-safe без fake promotion.
- **Tests** - додано regression coverage для route parity, notification scope, stable `reasonCode` contracts і заборони duplicate visibility systems.

---

## v0.48.10 - Scoped Reporting & Analytics Booking Visibility Hardening v1 (2026-05-14)

### Reporting Scope & Cache Safety [codex]
- **Reporting Scope** - booking-derived analytics, stats, center, board, settings fallback, room availability і Kleshnya/chat helper summaries тепер повторно використовують canonical `services/bookingVisibility.js`.
- **Role Guards** - `/api/stats`, `/api/center` і settings stats fallback вирівняно з page/sidebar semantics перед scoped aggregation, щоб auth-only маршрути не відкривали broad totals.
- **Cache Safety** - analytics/stats aggregates отримали actor-scoped cache keys; finance creator/director/accountant reporting лишився явно privileged full-role без redesign ролей.
- **Tests** - додано reporting visibility proof test, який блокує дубльовану reporting visibility engine і перевіряє guards/cache/finance semantics.

---

## v0.48.9 - Booking Visibility Scope v1.1 (2026-05-14)

### Durable Scope & Linked Entity Parity [codex]
- **Bookings** - розширено існуючий `services/bookingVisibility.js` без створення другої visibility-системи.
- **Scope Truth** - додано durable staff-host visibility через `employee_profiles.staff_id`, `bookings.hosts` і numeric `second_animator`; `team`, `line` і `location` лишаються явно missing durable dimensions.
- **Linked Parity** - booking-derived task routes ведуть в exact task context, а lead/customer route-outs використовують safe parent booking fallback, якщо linked entity visibility не доведена.
- **Tests** - додано перевірки staff-host scope, linked-route hierarchy і no-duplicate booking visibility system.

---

## v0.48.8 - Booking Visibility & Event Risk Scope Hardening (2026-05-14)

### Booking Visibility & Event Risk Scope Hardening v1 [codex]
- **Bookings** - додано канонічну object-level visibility policy для бронювань із full-role, operational compatible fallback, legacy exact-match fallback і deny-safe unknown scope.
- **Event Risk** - Work Queue, dashboard event-risk summaries, alerts, timeline list/occupancy та booking-derived route-outs тепер будуються тільки з visible booking scope.
- **Authz** - confirmation, linked-atomic update, PUT, payment update і delete більше не покладаються лише на page/action access, а повторно перевіряють booking object permission.
- **Compatibility** - legacy `created_by` / `second_animator` підтримуються тільки як exact compatible fallback; team/location scope явно позначено як missing durable dimension.
- **Tests** - додано booking visibility policy тести та fail-closed перевірку hidden booking confirmation route.

---

## v0.48.7 - 🛡️ 0.48 Unsafe Dismiss Full Legacy & Dynamic Cluster (2026-05-14)

### Unsafe Dismiss Hardening v2 Full Cluster [codex]
- **Lead Cluster Completion** - secondary lead overlays for lost reason and mailing entry now use guarded close semantics, and lead workspace switches respect active dirty lead surfaces before changing context.
- **Profile Safety** - profile password/settings modal close, backdrop, Escape and tab switches now route through shared dirty-state confirmation instead of direct hide.
- **Browser-Behavior Coverage** - unsafe-dismiss behavior tests now cover backdrop, Escape, route/selection transition, direct `closeModal()` bypass, confirmed discard, and read-only viewer dismissal.

---

## v0.48.6 - 🛡️ 0.48 Unsafe Dismiss Hardening v2 (2026-05-14)

### Unsafe Dismiss Hardening v2 [codex]
- **Guard Adoption** - lead customer card, art-director content/brand editors, finance account, warehouse quantity, sound announcement/project, dashboard pickers/settings та certificate flows тепер проходять через shared `UnsafeDismissGuard` там, де є editable або локально змінений state.
- **Bypass Removal** - certificates/settings більше не ховають dirty booking panel напряму, а generic `closeModal()` маршрутизує dirty editable surfaces через guarded close перед hide/remove.
- **Regression Safety** - додано behavior-level `jsdom` тест, який перевіряє dirty backdrop/direct close, rejected discard і confirmed discard без reliance тільки на static grep.

---

## v0.48.5 - 🪅 0.48 Client Pinata Operational Numbers (2026-05-14)

### Client Pinata as Service Separation v1 [codex]
- **Operations** - додано окремі поля `pinata_number` і `pinata_filler_number`, щоб номер піньяти та номер наповнювача жили як структуровані операційні атрибути.
- **Booking UI** - форма бронювання показує спільні поля номера для режимів `park` і `client`, але очищає їх у режимі `none`.
- **Server Truth** - create/update/recurring paths нормалізують номери разом із `pinata_mode`, щоб клієнтська піньята лишалась сервісом, а stale park/client поля не змішувались.
- **Operations Output** - booking detail, recurring generation, scheduler and warehouse pinata surfaces now carry the separate pinata/filler numbers where relevant.

---

## v0.48.4 - 🪅 0.48 Client Pinata as Service Separation v1 (2026-05-14)

### Client Pinata as Service Separation v1 [codex]
- **Booking Logic** - розділено піньяти парку та клієнтські піньяти через `pinata_mode` (`none`, `park`, `client`) і серверну нормалізацію stale-полів.
- **Services** - клієнтська піньята тепер зберігається як сервісна опція з ціною/нотаткою, а не як park pinata filler/catalog item.
- **Analytics** - pinata demand, складські pinata counters, scheduler tasks і product-sales категорії більше не рахують `client` mode як попит на піньяти парку.
- **UI** - форма бронювання явно показує сценарії `Без піньяти`, `Піньята парку`, `Клієнтська піньята (послуга)` і відповідні поля.

---

## v0.48.3 - ✅ 0.48 Confirmation & Event Risk Operations Cluster v1 (2026-05-14)

### Confirmation & Event Risk Operations Cluster v1 [codex]
- **Confirmation** - додано вузьку операцію підтвердження бронювання через `POST /api/bookings/:id/confirm` з `confirmed_at`, `confirmed_by`, note/source і audit trail.
- **Queue rails** - `needs_confirmation` отримав чесний inline confirm через narrow endpoint, а `event_soon` лишився окремим timing cue без fake readiness score.
- **Prep linkage** - booking-origin automation tasks тепер пишуть `source_type='booking'` і `source_id`, а prep summaries рахують тільки реально linked overdue tasks.
- **Dashboard** - додано visible-scope `event_risk_summary` для непідтверджених сьогодні/завтра, late preliminary, booking-linked overdue prep і resource warnings без universal risk score.

---

## v0.48.2 - 🛡️ 0.48 UX: unsafe dismiss hardening (2026-05-14)

### Unsafe Dismiss Hardening v1 [codex]
- **Єдина guarded-close policy** - додано shared `UnsafeDismissGuard`, який змушує editable modal/panel/overlay проходити dirty-state перевірку перед backdrop, Escape, cancel або close-all dismiss.
- **Критичні форми захищені** - lead edit, booking create/edit panel, task detail overlay, customer edit, finance transaction, design/catalog, staff/HR та content edit surfaces більше не мають прямого silent-close шляху для dirty state.
- **Booking/date/selection safety** - зміна дати або вибір іншої клітинки таймлайна тепер поважають dirty booking panel і не скидають форму без підтвердження.
- **Повторювані overlay patterns закриті** - catalog/design automation/page/image overlays, staff schedule/fill-week, HR shift/staff/correction і content business-card/post modals отримали guarded cancel/backdrop/Escape semantics.
- **Regression shield** - `tests/ui-check.js` тепер перевіряє shared unsafe-dismiss guardrails, щоб dirty critical forms не поверталися до direct backdrop/remove behavior.

---

## v0.48.1 - ✅ 0.48 Tasks: operations cluster hardening (2026-05-14)

### Task Operations Cluster v1 [codex]
- **Dashboard presence** - віджет `Команда онлайн` тепер розрізняє live WebSocket online та durable last-seen активність із `users.last_seen_at` / `employee_profiles.last_activity_at`.
- **Last seen UX** - dashboard показує readable стани `онлайн зараз`, `був N хв тому`, `сьогодні`, `вчора` або дату для старішої активності без reload усього dashboard.
- **Task dismiss safety** - task detail overlay більше не знищується напряму через backdrop/cancel; dirty form закривається тільки через guarded close confirmation.
- **Task stale guard UX** - task detail save передає поточний `version`, щоб backend optimistic-locking міг чесно відхилити stale write.

---

## v0.48.0 - ✅ 0.48 Tasks: operations cluster v1 (2026-05-14)

### Task Operations Cluster v1 [codex]
- **Typed ownership як source of truth** - task owner тепер ведеться через canonical `tasks.owner_user_id`; legacy `assigned_to/owner` лишаються display/compatibility fallback без fuzzy mapping.
- **Object-level visibility** - task list/detail/history/actions, dashboard widgets і Work Queue task buckets проходять через спільну task visibility policy, щоб hidden tasks не потрапляли в queue або mutation routes.
- **Safe task execution rails** - Tasks page і manager queue підтримують durable complete, typed reassign і deadline reschedule з object-level authz, stale-write guard, feedback та refetch після mutation.
- **Task action accountability** - `task_action_history` фіксує `task_completed`, `task_owner_reassigned` і `task_rescheduled`; open-context/route-out не логуються як execution.
- **Task-local intelligence** - task items отримали пояснювані `priorityBand`, `riskTypes`, `recommendedAction`, `why`, `confidence` і visible-scope summary без універсального cross-domain score.
- **Operational UI** - Tasks detail modal показує owner state, task-local intelligence і compact Task Action History з loading/empty/error states.

---

## v0.47.23 - ✅ 0.47 Tasks: visibility, ownership & execution rails v2 (2026-05-14)

### Task Visibility, Ownership & Execution Rails v2 [codex]
- **Typed task ownership** - додано canonical `tasks.owner_user_id`, а legacy `assigned_to/owner` лишаються display/compatibility snapshot без fuzzy owner mapping.
- **Object-level visibility** - task list/detail/mutation і manager queue task buckets використовують централізовану policy з typed owner, department scope і чесним legacy fallback тільки для unmapped задач.
- **Task execution rails** - overdue/task items у Work Queue отримали перші safe inline actions: mark done, reassign typed owner і deadline +24h, з refetch після durable mutation.
- **Task action history** - додано вузький `task_action_history` для `task_completed`, `task_owner_reassigned` і `task_rescheduled` без глобальної audit-платформи й без логування open-context.
- **Manager workspace UX** - resolution workspace показує task owner state, task execution actions, compact `Task Action History`, loading/error/empty states і без stale history leak.

---

## v0.47.22 - 🧾 0.47 Черга: reply execution action history v1 (2026-05-14)

### Reply Execution Audit Trail / Action History v1 [codex]
- **Durable reply action history** - manager `waiting_reply` execution actions тепер пишуть вузький audit trail у `reply_action_history` з actor snapshot, source surface, old/new JSON і timestamp.
- **Reply-first event model** - clear expectation, SLA snooze, owner reassignment, manual escalation і linked escalation closure мають єдиний queryable формат без глобальної CRM audit-платформи.
- **Manager-only history endpoint** - Work Queue отримала bounded newest-first API для останніх reply execution events по conversation, з тими самими manager-up auth boundaries.
- **History panel у workspace** - resolution workspace показує компактний `Reply Action History` для reply items, із loading/empty/error/data станами і без stale history leak після refetch/next-item.
- **Regression shield** - оновлено work-queue тести для audit write/read, source surface, manager-only access, bulk actions і jsdom rendering.

---

## v0.47.21 - ⚙️ 0.47 Черга: execution engine v6 reply-first core (2026-05-14)

### Manager Queue Execution Engine v6 [codex]
- **Reply-first execution core** - Work Queue resolution workspace отримав bucket-aware execution shell: глибокі inline дії доступні лише для `waiting_reply`, де є canonical reply truth.
- **Durable reply outcomes** - clear expectation, `SLA +24г`, reassign owner і overdue escalation працюють через наявні canonical поля `reply_expected`, `reply_sla_at`, `reply_owner_user_id` та `conversation_reply` escalation anchor.
- **Safe next-item flow** - після успішної durable reply mutation черга refetch-иться, selection перевіряється заново і фокус переходить тільки до наступного видимого item, якщо попередній більше не є коректним фокусом.
- **Route-out rails для слабших bucket-ів** - task/callback/confirmation/event/idle items показують exact-context route-out і пояснення, чому inline execution тут ще не вмикається.
- **Без fake universal workflow** - `open exact context` не вважається resolution, а `event_soon` і `idle_lead` не отримують generic `done/defer/delegate` кнопок.

---

## v0.47.20 - 🧠 0.47 Черга: bucket-aware intelligence v1 (2026-05-14)

### Manager Queue Intelligence v1 [codex]
- **Priority bands без fake score** - Work Queue тепер збагачує видимі manager queue items структурою `intelligence` з `critical`, `action_today`, `watch` і `suggested` замість універсального числового score.
- **Bucket-aware рекомендації** - `waiting_reply`, overdue tasks, `callback_due`, `needs_confirmation`, `event_soon` і `idle_lead` отримують різну глибину рекомендацій, `riskTypes`, `why` і `confidence` відповідно до сили їхніх реальних сигналів.
- **Visible-scope summary** - `queue.meta.intelligence` рахує priority bands, top risks і bottleneck-и тільки з уже повернутих manager-visible queue items, без окремого глобального DB scan.
- **Weak buckets contained** - `idle_lead` лишається `suggested` / `summary_only` і не може обігнати canonical overdue reply або task pressure.
- **Dashboard surfacing** - Work Queue показує compact intelligence strip, band pills на items і сильніший selected-item intelligence snapshot у resolution workspace.

---

## v0.47.19 - 🧭 0.47 Черга: triage & resolution workspace v4 (2026-05-14)

### Manager Triage & Resolution Workspace v4 [codex]
- **Resolution workspace у Work Queue** - менеджер може вибрати пункт черги й одразу бачити причину, owner/risk snapshot, exact-context links і доступні дії без втрати фільтрів.
- **Bucket-specific глибина** - `waiting_reply` отримує inline reply actions, а callback/task/booking/idle buckets чесно лишаються inspect + route-out без фейкового універсального редактора.
- **Навігація по черзі** - workspace підтримує next/previous/return-to-queue flow і очищає stale selection після зміни scope/filter state.
- **Explainability без нової truth model** - панель використовує наявні queue fields, `meta.signal`, SLA/owner/escalation дані та exact hrefs без schema змін.
- **UI safety** - додані empty/no-selection/selected стани, focus handling, dark-mode styling і jsdom перевірка bucket-specific rendering.

---

## v0.47.18 - 💬 0.47 Комунікації: reply operations console v2 (2026-05-13)

### Reply Operations Console v2 [codex]
- **Console для reply debt** - Work Queue отримала єдиний manager-facing блок для `waiting_reply`: summary chips, preset-и, SLA/owner/escalation фільтри та швидкий reset.
- **Bulk selection** - менеджер може обрати видимі reply items або окремі розмови; hidden rows не потрапляють у bulk action після зміни фільтрів.
- **Bulk actions без нової truth model** - bulk reassign, `SLA +24г` і bulk clear працюють через canonical поля `reply_owner_user_id`, `reply_sla_at`, `reply_expected`.
- **Escalation coherence** - bulk дії повторно використовують існуючі reply helpers, тому escalation tasks синхронізуються або закриваються без дублів.
- **Без schema/RBAC розширення** - saved views зберігаються локально як preset/filter state; `reply_owner` лишається display label і не використовується для фільтрації чи mutation authority.

---

## v0.47.17 - 💬 0.47 Комунікації: reply owner picker v1 (2026-05-13)

### Reply Owner Picker / Assignee UX v1 [codex]
- **Picker замість ID prompt** - у Work Queue перепризначення відповідального для `waiting_reply` відкриває компактний список активних assignable users замість ручного введення numeric id.
- **Canonical user id** - вибір і збереження працюють тільки через `users.id`; display label `reply_owner` лишається snapshot/fallback, але не стає authority для reassignment.
- **Manager-safe source** - додано вузький manager-up endpoint для активних reply owner candidates; inactive/non-assignable користувачі не потрапляють у список і блокуються серверною перевіркою.
- **Interaction safety** - picker має loading/error/empty/disabled стани, Escape/Cancel close та фокус на select, без fallback на free-text label.
- **Без schema змін** - зміна використовує наявні `reply_owner_user_id`, `reply_owner` і manager-only backlog actions.

---

## v0.47.16 - 💬 0.47 Комунікації: reply backlog actions v1 (2026-05-13)

### Reply Backlog Actions v1 [codex]
- **Дії з черги** - Work Queue отримала manager-only дії для `waiting_reply`: змінити відповідального, перенести SLA на +24 години та явно очистити очікування відповіді.
- **Typed owner only** - перепризначення працює через `reply_owner_user_id` і активний `users.id`; display label `reply_owner` лишається лише snapshot/fallback.
- **SLA без callback coupling** - snooze змінює тільки `conversations.reply_sla_at`, не редагує `follow_up_date`, callback чи generic task deadlines.
- **Escalation coherence** - clear/snooze скасовують stale reply-escalation task, а reassign синхронізує її display assignee без переходу на повну task ownership migration.
- **Без нового schema** - зміна використовує вже наявні reply expectation / SLA / owner поля, старі рядки лишаються null-safe.

---

## v0.47.15 - 💬 0.47 Комунікації: reply backlog filters v1 (2026-05-13)

### Reply Backlog Filters v1 [codex]
- **Owner-aware backlog** - Work Queue отримала `replyScope=mine|team|all` для bucket `waiting_reply`, побудований тільки на `reply_owner_user_id`.
- **Мої відповіді** - `mine` показує лише розмови, де `conversations.reply_owner_user_id = current user id`; `reply_owner` label не використовується для фільтрації.
- **Команда без overclaim** - `team` означає поточний manager-visible backlog без моїх typed owner items, а не новий department/RBAC режим.
- **Null-safe legacy** - старі рядки без typed owner не потрапляють у `mine`, але лишаються видимими в `team/all`, якщо їх уже дозволяє поточна manager visibility.

---

## v0.47.14 - 💬 0.47 Комунікації: typed reply owner v1 (2026-05-13)

### Reply Owner Typing v1 [codex]
- **Typed reply owner** - `conversations.reply_owner_user_id` тепер зберігає канонічний `users.id` для власника активного reply expectation.
- **Display snapshot сумісність** - `reply_owner` лишається людською міткою для UI, історичних рядків і старих клієнтів.
- **Без фейкового backlog** - Work Queue, Customer Hub, workspace ліда та Omni payload віддають typed owner id, але не вводять owner-only фільтри чи нові permissions.
- **Межа задач** - reply escalation task і далі використовує чинну string ownership модель; повне retyping задач відкладено окремо.

---

## v0.47.13 - 💬 0.47 Комунікації: reply auto-escalation v2 (2026-05-13)

### Reply Auto-Escalation v2 [codex]
- **Idempotent escalation task** - overdue explicit `waiting_reply` тепер може створити одну task з `source_type='conversation_reply'` і `source_id=<reply_expected_message_id>`, без дублювання при повторних scheduler runs.
- **Race-safe linkage** - додано вузький partial unique index для reply-escalation anchors, щоб одна reply expectation не породжувала кілька відкритих або повторних задач.
- **Stale close** - inbound reply, delivery failure або explicit clear скасовують активну escalation task для відповідного reply anchor, не змішуючи це з `callback_due`.
- **Чесний trigger** - escalation стартує тільки з active overdue `replySlaState`; unread, звичайний outbound, provider accepted/read або `due_soon` не створюють задач.

---

## v0.47.12 - 💬 0.47 Комунікації: reply SLA severity v1 (2026-05-13)

### Reply SLA Severity v1 [codex]
- **Центральний SLA state** - додано `replySlaState` для активного `waiting_reply`: `none`, `on_track`, `due_soon`, `overdue`.
- **Work Queue severity** - bucket `waiting_reply` показує compact SLA cues з `reply_sla_at`, сортує SLA-очікування перед розмовами без SLA і не змішує їх із `callback_due`.
- **Контекстні бейджі** - Dashboard Work Queue, Omni, Customer Communication Hub і workspace ліда показують "SLA в нормі", "SLA скоро спливає" або "SLA прострочено" тільки для активного explicit очікування.
- **Без automation/schema** - auto callback/task escalation навмисно не створюється; старі розмови без `reply_sla_at` лишаються без fake severity.

---

## v0.47.11 - 💬 0.47 Комунікації: waiting reply queue + UI v1 (2026-05-13)

### Waiting Reply Queue + UI Surfacing v1 [codex]
- **Manager-visible waiting reply** - Work Queue тепер показує `waiting_reply` як окремий bucket із exact переходом у відповідну Omni-розмову.
- **Тільки explicit model** - bucket і UI-індикатори беруться з `reply_expected` / `awaiting_reply_since`, а не з unread, будь-якого outbound або provider accepted/read.
- **Контекстні індикатори** - Omni list/header, Customer Communication Hub і workspace ліда компактно показують "Очікуємо відповідь з..." там, де є активне explicit очікування.
- **Clear/failure truth** - surfaced стан поважає later inbound після `awaiting_reply_since` і delivery failure, щоб не лишати фейкове очікування відповіді.
- **Без нового schema/backfill** - зміна спирається на Canonical Reply Expectation v1; старі розмови без explicit поля не потрапляють у `waiting_reply`.

---

## v0.47.10 - 💬 0.47 Комунікації: canonical reply expectation v1 (2026-05-13)

### Canonical Reply Expectation v1 [codex]
- **Explicit waiting-reply model** - `conversations` тепер має явні поля `reply_expected`, `awaiting_reply_since`, `reply_expected_message_id`, `reply_owner` і `reply_sla_at`, щоб CRM не виводила очікування відповіді з unread/outbound евристик.
- **Manual Omni intent** - менеджер може позначити "Очікуємо відповідь" під час ручної відправки; звичайний outbound, provider accepted/delivered/read і unread самі по собі не створюють `waiting_reply`.
- **Safe clear/invalidate** - вхідне повідомлення після `awaiting_reply_since` очищає активне очікування, а immediate/later delivery failure не залишає фейковий waiting-reply.
- **Work Queue bucket** - черга отримала окремий `waiting_reply` bucket на основі durable reply expectation fields, при цьому `callback_due` і `follow_up_due` не змішуються з очікуванням відповіді.
- **Без backfill** - старі розмови лишаються `reply_expected=false`, бо історичний бізнес-намір очікувати відповідь не можна чесно відновити заднім числом.

---

## v0.47.9 - 📬 0.47 Комунікації: lifecycle receipts v1 (2026-05-13)

### Provider Lifecycle v1: Viber + TurboSMS [codex]
- **Viber receipts** - webhook callbacks `delivered`, `seen` і `failed` тепер класифікуються як provider lifecycle події та оновлюють оригінальний outbound row за `message_token`.
- **TurboSMS DLR** - статуси `DELIVRD`, `UNDELIV`, `REJECTD` і `EXPIRED` мапляться в durable delivery truth за `message_id`, без створення фейкових inbound SMS.
- **Нові durable стани** - `conversation_messages.delivery_status` розширено на `delivered`, `read` і `later_failed`, а provider event timestamp/source/type зберігаються окремими nullable полями.
- **Manager-safe Omni UI** - Omni показує confirmed delivery/read/late failure лише тоді, коли ці стани реально прийшли від Viber або TurboSMS; Telegram, Meta і Binotel залишаються без фейкових lifecycle claims.
- **Без backfill** - старі outbound повідомлення не отримують delivery/read статус заднім числом, бо provider receipt truth для них не доведений.

---

## v0.47.8 - 🛰️ 0.47 Комунікації: durable truth schema (2026-05-13)

### Durable Communication Truth Schema v1 [codex]
- **Durable delivery foundation** - `conversation_messages` тепер має nullable поля для provider ID, delivery status, помилки, часу спроби, provider acceptance і immediate failure без вигаданого final delivery.
- **Мінімальна модель статусів** - додано компактні стани `saved`, `attempted`, `accepted`, `failed`, `unknown`; `accepted` означає тільки прийнятий provider request, а не підтверджену доставку клієнту.
- **Timestamp-и для майбутнього reply logic** - `conversations.last_inbound_at` і `last_outbound_at` зберігають durable напрямок останньої комунікації, але `waiting_reply` ще не робиться канонічним станом.
- **Без фейкового backfill** - історичні outbound повідомлення не отримують delivery status, бо стару provider truth неможливо довести заднім числом.
- **Backward compatible Omni UI** - Omni читає durable поля, коли вони є, і лишає fallback на `meta.sendTruth` для старих рядків.

---

## v0.47.7 - 📡 0.47 Комунікації: чесна відправка в Omni (2026-05-13)

### Communication Send Truth v1 [codex]
- **DB save не маскується під доставку** - Omni send flow тепер повертає чесний `sendTruth`, щоб менеджер бачив різницю між "збережено в CRM" і immediate-result провайдера.
- **Нормалізація provider result** - Telegram `{ ok: false }`, Viber/SMS/Facebook/Instagram `success: false` та невизначені відповіді зводяться до зрозумілих станів `provider_attempted`, `provider_failed_immediate`, `provider_unknown`.
- **Inbound-only guard** - Binotel та інші не send-capable канали блокуються до створення outbound row і показують зрозуміле пояснення в Omni UI.
- **Чесні bubble/feedback стани** - outbound повідомлення показують, що фінальна доставка у v1 не підтверджується без durable delivery schema.
- **Без schema changes** - реліз використовує наявний `conversation_messages.meta`; `provider_message_id`, `delivery_status` і canonical `waiting_reply` лишаються окремим schema/task boundary.

---

## v0.47.6 - 🌙 0.47 Ліди: видимі списки вибору в темній темі (2026-05-13)

### Dark Stage Dropdown Fix [codex]
- **Темна тема для native dropdowns** - shared `css/dark-mode.css` тепер задає темний color scheme і контрастні `option` для відкритих `<select>`.
- **Етапи видно повністю** - у Manager Action Strip emoji та назви pipeline stages більше не зникають на білому option-фоні.
- **Схожі поля теж закрито** - фікс покриває інші select/date/time controls у dark mode, зокрема задачі, клієнтів, фінанси, модалки та фільтри.
- **Без зміни workflow** - логіка `pipeline_stage`, quick actions і права доступу не змінювались.

---

## v0.47.5 - ⚡ 0.47 Ліди: швидкі дії менеджера у workspace (2026-05-13)

### Manager Action Strip v1 [codex]
- **Швидкі дії в workspace ліда** - у `/sales-funnel?lead=ID` додано Manager Action Strip з дзвінком, exact Omni-переходом, карткою клієнта, exact бронюванням, callback-задачею, відкриттям/виконанням exact task і підтвердженням preliminary booking.
- **Канонічний stage без дублювання** - зміна етапу в action strip використовує `pipeline_stage` через наявний lead stage flow, не створюючи паралельну workflow-логіку.
- **Exact-first дисципліна** - Omni, booking і task actions показуються як активні тільки коли є точний контекст; fallback-збіги лишаються навігаційними/недоступними й не маскуються під готові дії.
- **Callback-задачі з durable linkage** - створення callback із workspace тепер передає `source_type='lead'` і `source_id`, а backend `/api/tasks` зберігає цей зв'язок.
- **Без dead `cancelled` action** - task detail більше не пропонує статус `cancelled`, який не підтримувався поточним backend three-state flow.
- **Без fake-send UX** - strip не додає прямого надсилання повідомлень, щоб не обіцяти delivery там, де поточна provider-модель гарантує лише відкриття каналу або CRM-навігацію.

---

## v0.47.4 - 💬 0.47 Клієнти: комунікаційний хаб у картці (2026-05-13)

### Customer Communication Hub v1 [codex]
- **Картка клієнта як старт комунікації** - додано read-only communication hub у detail/card flow клієнта: дзвінок, Omni-перехід, кейс ліда та релевантне бронювання зібрані в одному місці.
- **Exact / suggested / unavailable** - customer→Omni handoff чесно показує точну live-розмову через `conversations.customer_id`, ймовірний збіг за телефоном/іменем або відсутність live-каналу.
- **CRM-журнал не видається за live-чат** - внутрішні записи `communication_log` візуально й текстово відділені від історії Omni, щоб менеджер не плутав нотатки з реальною перепискою.
- **Навігація без fake delivery** - хаб не додає пряме надсилання з картки й не обіцяє доставку там, де поточна система гарантує лише навігацію або CRM-персистентність.
- **Захист від регресій** - додано focused tests для exact/suggested/unavailable resolver, inbound-only каналів і статичний UI smoke для customer hub.

---

## v0.47.3 - 🧭 0.47 Ясність: фільтри й порожні стани без здогадок (2026-05-13)

### Explainability Kit v1 [codex]
- **Фільтри видно одразу** - додано reusable Explainability Kit для активних фільтрів, reset-дій і cause-aware empty states на manager-facing поверхнях.
- **Задачі без оманливих лічильників** - вкладки Tasks тепер рахують задачі у тому самому category-scope, який бачить менеджер, а порожній стан пояснює активну категорію або рольову видимість.
- **Ліди, клієнти, Omni** - `/sales-funnel`, `/customers` і `/omni` показують активний зріз, пошук/канал/дату/тип і дають швидкий шлях повернути повний список.
- **Робоча черга чесніше пояснює себе** - Dashboard Work Queue показує omitted/heuristic/warning meta з endpoint, щоб manager не плутав "порожньо" з unsupported або частково недоступним bucket.
- **Доступ не розширено** - role/access модель не змінювалась; UI лише краще пояснює, коли видимість або дія обмежена поточною роллю.

---

## v0.47.2 - ⚡ 0.47 Черга: робочі пріоритети менеджера (2026-05-13)

### Work Queue v1 [codex]
- **Канонічна робоча черга** - додано read-only endpoint `/api/work-queue`, який збирає існуючі durable сигнали в єдині buckets: `overdue`, `today`, `tomorrow`, `callback_due`, `needs_confirmation`, `event_soon`, `idle_lead`.
- **Джерела сигналів** - черга використовує `tasks.deadline/date/source_type/source_id`, `lead_interactions.follow_up_date`, `bookings.date/time/status`, `leads.event_date`, `leads.last_contact_at` і canonical `pipeline_stage`.
- **Dashboard UI** - для manager-up ролей додано компактний блок "Робоча черга" з лічильниками, короткими пунктами і переходами в кейс ліда, таймлайн бронювання або задачу.
- **Без fake waiting reply** - `waiting_reply` не додано як канонічний bucket, бо в поточній моделі це ще не durable стан; `idle_lead` позначається як suggested сигнал.
- **Захист від регресій** - додано focused tests для access gating, bucket generation, корисних href та заборони повертатися до legacy `status='new'` як джерела cold lead логіки.

---

## v0.47.1 - 🔗 0.47 Ліди: Omni Case Link і бронювання з ліда (2026-05-13)

### Omni Case Link v1 + Lead→Booking Repair [codex]
- **Omni Case Link v1** - `/omni?conversation=ID` тепер відкриває конкретну розмову і показує CRM-контекст із чесним статусом `exact`, `suggested` або `unresolved`.
- **Точні переходи** - Omni дає посилання на `/sales-funnel?lead=ID`, `/customers?open=ID` і таймлайн бронювання тільки коли ці ID реально відомі.
- **Workspace → Omni** - робочий простір ліда відкриває точну Omni-розмову через `conversation`, а `search` лишається fallback для сумісності.
- **Лід → бронювання** - конвертація ліда тепер переносить `leadId`, ім'я, телефон і дату в таймлайн/форму, а після створення бронювання записує `leads.booking_id`.
- **Захист від регресій** - додано focused-тести для exact/suggested Omni context і repair логіки `leads.booking_id`.

---

## v0.47.0 - ✨ 0.47 Ліди: видимий релізний milestone (2026-05-13)

### Релізна лінія 0.47 [codex]
- **Перший екран** - login-блок тепер показує помітний бейдж `✨ 0.47 Ліди`, щоб актуальний milestone було видно одразу.
- **Назва релізу** - кнопка "Що нового" оновлена до `🚀 Що нового у v0.47.0: Ліди` з акцентом на новому робочому просторі менеджера.
- **Версійна політика** - активну лінію переведено на `0.47.x`, а `package.json` лишається джерелом істини для синхронізації.
- **UI polish** - релізний акцент додано без зміни сценарію входу, прав доступу чи workspace-логіки `/sales-funnel`.

---

## v0.46.15 - Єдиний робочий простір менеджера для ліда (2026-05-13)

### Unified Manager Workspace Stage 2 [codex]
- **Sales Funnel Workspace** - на `/sales-funnel` додано lead-centric drawer, який стабільно відкривається через `?lead=ID` і збирає кейс менеджера в одному робочому просторі.
- **Case composition** - `GET /api/leads/:id/workspace` повертає lead, linked customer, customer card, active/related bookings, tasks/next actions, interactions, communication log, conversation summary та urgency/date cues.
- **Канонічний статус** - workspace читає етап з `pipeline_stage`; старі Copilot/workflow статуси не стали джерелом правди для менеджерського кейсу.
- **Навігація без втрати контексту** - додано відкриття `/customers?open=ID`, `/tasks?open=ID`, контекстний `/omni?search=...`, а `/omni` з'явився у sidebar для manager-up ролей.
- **Захист від регресій** - route smoke перевіряє case composition, UI smoke перевіряє workspace shell/deep links, access matrix перевіряє новий sidebar item.

---

## v0.46.14 - Видима кнопка продажів на Timeline (2026-05-13)

### Timeline: контраст кнопки продажів [codex]
- **Кнопка продажів** - виправлено колір тексту `📊 Продажі`, щоб напис був читабельним і у світлій, і у темній темі.
- **Теми** - додано окремі light/dark стилі для нейтральної action-кнопки, без повернення до вигляду перемикача режиму.
- **Захист від регресії** - UI smoke тепер перевіряє, що кнопка продажів має контрастний текст для обох тем.

---

## v0.46.13 - Чистий експорт і зручніша модалка продажів програм (2026-05-13)

### Продажі програм: UX та експорт [codex]
- **Модалка продажів** - перебудовано звіт на Timeline: компактні фільтри, зрозумілий блок експорту, повноширинна виписка та читабельні підсумки.
- **Експорт CSV** - файл тепер відкривається як одна чиста таблиця без секційних заголовків і без зайвих колонок.
- **Експорт Excel** - XLSX отримав форматовані таблиці з freeze row, autofilter, ширинами колонок і числовим форматом сум.
- **Оплати й борги** - прибрано `Оплачено` та `Борг` зі звіту продажів програм, бо фінансову звірку буде реалізовано окремо.
- **Захист від регресій** - smoke-тести перевіряють, що CSV/XLSX більше не містять оплат/боргів, а скасовані й пов'язані бронювання не потрапляють у вибірку.

---

## v0.46.12 - Продажі програм на Timeline (2026-05-13)

### Місячний звіт продажів програм [codex]
- **Timeline** - додано кнопку "Продажі", яка відкриває місячний звіт по проданих розважальних програмах без переходу в окремий модуль.
- **Аналітика** - `GET /api/analytics/product-sales` рахує тільки підтверджені бронювання за датою події, без скасованих і без дублювання пов'язаних бронювань другого аніматора.
- **Піньяти** - додано швидкий фільтр категорії `pinata`, щоб раз на місяць швидко отримати виписку з датами й сумами.
- **Експорт** - додано CSV та XLSX вивантаження з підсумком по програмах і детальною випискою продажів.
- **Захист від регресій** - route smoke і UI smoke перевіряють доступ manager-up, антидублювання `linked_to`, кнопку, фільтри та експортні заголовки.

---

## v0.46.11 - Виправлення layout gap у shell-сторінках CRM (2026-05-13)

### Layout gap cluster fix [codex]
- **Ліди** - прибрано structural duplicated shell offset: сторінка більше не вкладає `.main-content` всередину `.page-container`, тому контент стартує біля sidebar з нормальним відступом.
- **Designs** - прибрано крихкий inline `margin-left: 220px` на `main.page-container`; сторінка тепер покладається на shared layout rules.
- **Timeline/Kleshnya** - старий collapse path у `js/app.js` більше не пише inline `marginLeft/width`, а лишає геометрію shared CSS-класам.
- **UI Guard** - UI smoke тепер ловить nested shell anti-pattern, inline shell offsets і недокументовані `.main-content` shell pages.
- **Перевірка layout** - Chromium-заміри підтвердили, що Leads повернувся до нормального gap на 1440/1024/1000/768px і не зачепив standard shell pages.

---

## v0.46.10 - Єдиний вихід зі сторінок CRM (2026-05-13)

### Shared logout binding [codex]
- **Авторизація** - `js/auth.js` тепер централізовано прив'язує кнопку "Вийти" до canonical `logout()` на всіх сторінках, де є `#logoutBtn`.
- **Ліди** - виправлено сторінку лідів, де кнопка виходу була присутня в DOM, але не мала click handler без `js/app.js`.
- **CRM Shell** - локальні page-specific logout handlers замінено на shared binding, щоб не було розсинхрону між сторінками.
- **Сесія** - вихід всюди проходить через однаковий cleanup token/current user/session/private caches.
- **Захист від регресій** - UI smoke перевіряє, що сторінки з `#logoutBtn` підключають `auth.js`, а direct logout ownership лишається в shared auth layer.

---

## v0.46.9 - Аудит контрасту темної теми (2026-05-13)

### Аудит контрасту темної теми [codex]
- **Токени теми** - темна тема тепер явно задає shared `--text*`, `--surface`, `--card-bg`, `--bg-*` і `--border-color` aliases, щоб нові картки, форми, dropdowns і модалки не падали у світлі fallback-кольори.
- **Приглушений текст** - підсилено читабельність secondary/helper тексту в каталогах, контент-картках, нотатках профілю, порожніх станах, placeholders і task/notification muted controls.
- **Компонентні групи** - перевірено сповіщення, картки/списки, badges/pills, модалки/overlays, таблиці/рядки, форми, sidebar/topbar widgets і status states на очевидні dark-mode contrast провали.
- **Захист від регресій** - UI smoke тепер контролює shared dark-mode contrast tokens і найризиковіші muted selectors.

---

## v0.46.8 - Контраст сповіщень у темній темі (2026-05-13)

### Dropdown сповіщень [codex]
- **Primary text** - виправлено темний fallback у notification dropdown, через який заголовки карток майже зливалися з dark mode фоном.
- **Secondary/meta text** - додано окремий muted-рівень для описів, лічильників і заголовків груп без втрати читабельності.
- **Варіанти карток** - warning, critical та info елементи зберігають акцентні фони, але отримують контрастні foreground states.
- **Read state** - прочитані сповіщення більше не затемнюють всю картку через opacity, тому текст не провалюється в фон.
- **Захист від регресій** - UI smoke перевіряє dark-mode text tokens і variant coverage для notification dropdown.

---

## v0.46.7 - Українські релізні нотатки (2026-05-13)

### Мова релізних описів [codex]
- **Українська в UI** - записи модалки "Що нового" для актуальної релізної лінії переведені українською.
- **Правило на майбутнє** - `AGENTS.md` тепер прямо вимагає українські релізні описи для `index.html` і `CHANGELOG.md`.
- **Технічні назви** - endpoints, file paths, role ids, package names і API names залишаються у канонічному написанні, коли це потрібно для точності.
- **Контроль версії** - перший екран, cache tags і service worker cache names оновлюються через стандартний version sync.

---

## v0.46.6 - Виправлення відповідального в ліді (2026-05-13)

### Потік відповідального менеджера ліда [codex]
- **Список відповідальних для лідів** - модалка ліда тепер завантажує менеджерів з `/api/leads/assignees`, а не з creator/director-only endpoint керування користувачами.
- **Доступ без адмінки** - manager і marketer користувачі, які працюють з лідами, можуть завантажувати assignable users без відкриття `/api/users`.
- **Валідація відповідального** - lead create/update перевіряє `assigned_to` як активного assignable user і повертає зрозумілий 400 для неправильних значень.
- **Захист від регресій** - route smoke та UI checks покривають завантаження й оновлення відповідального ліда.

---

## v0.46.5 - Відновлення кнопок модалки ліда (2026-05-13)

### Дії модалки редагування ліда [codex]
- **Раннє підключення кнопок** - controls модалки ліда прив'язуються до async user/lead loading, тому save/cancel не губляться через повільний або невдалий data request.
- **Підтримка тапів iPad** - кнопки "Зберегти" і "Скасувати" обробляють touchend taps із захистом від duplicate synthetic click.
- **Захист від подвійного збереження** - save вимикається, поки триває lead update request, щоб не було повторних submissions.
- **Захист від регресій** - UI smoke checks покривають кнопки edit modal і їхній touch binding.

---

## v0.46.4 - Одноколонкові рядки ліда на iPad Safari (2026-05-13)

### Фікс модалки ліда для iPad Safari [codex]
- **Резервне правило Touch WebKit** - рядки форми ліда складаються в одну колонку на touch/WebKit пристроях.
- **Підтверджений фікс поля** - бажана дата й кількість дітей більше не ділять один рядок на iPad, що прибирає paint-overlap нативного Safari date-control.
- **Безпека картки клієнта** - customer-card form rows успадковують таку саму iPad-safe layout behavior.
- **Захист від регресій** - UI smoke checks прямо перевіряють touch/WebKit row-stacking rules.

---

## v0.46.3 - Посилення tablet/WebKit розмітки модалок (2026-05-13)

### Адаптивні форми модалок [codex]
- **Суміжні модалки** - customer, finance, art-director і Copilot two-column form rows використовують shrink-safe grid tracks.
- **Межі нативних контролів** - date, number, select і text controls у цих рядках залишаються всередині grid columns на tablet WebKit layouts.
- **Покриття регресій** - UI smoke checks покривають додаткові modal form surfaces, щоб майбутні релізи ловили stale `1fr 1fr` regressions.
- **Браузерна перевірка** - iPad-sized layout verification покриває lead, customer-card, customer edit, transaction edit і content edit modals.

---

## v0.46.2 - Виправлення iPad-розмітки модалки ліда (2026-05-12)

### Адаптивний UI для лідів [codex]
- **Фікс поля дати на iPad** - date inputs у lead edit modal залишаються всередині своєї grid column замість накладання на поле кількості дітей у tablet WebKit layouts.
- **Захист спільної сітки модалок** - двоколонкові рядки модалки ліда використовують shrink-safe grid tracks і form controls з явними min/max widths.
- **Покриття суміжної форми** - customer-card modal rows, які повторно використовують ту саму lead modal layout, покриті тим самим responsive fix.
- **Захист UI smoke** - static UI checks перевіряють поля date/children у lead/customer і WebKit-safe grid rules.

---

## v0.46.1 - Інструменти ремонту Guardian moderation (2026-05-12)

### Guardian repair and reconciliation [codex]
- **Ремонт із попереднім поясненням** - додано preview moderation-state для одного користувача, який порівнює durable event facts із derived `guardian_moderation_counters`.
- **Обмежене застосування** - privileged operators можуть ремонтувати тільки missing/mismatched `repeat_offender` / `hourly_blocks` counter rows для одного користувача за раз.
- **Безпечні межі** - stale/orphan counter rows показуються у звіті, але не видаляються автоматично, щоб історичні state changes лишалися явними.
- **Контроли Ops-консолі** - Guardian Ops має user-id repair panel із preview/apply actions, loading/error states і поясненнями issues.
- **Аудит відновлення** - applied repairs записують Guardian ops audit record з issue і applied-row counts.

---

## v0.46.0 - Узгодження Guardian delivery (2026-05-12)

### Guardian reliability convergence [codex]
- **Явні стани життєвого циклу** - Guardian delivery events розрізняють delivered, duplicate no-op, retryable failure, terminal failure, replayed і dead-letter outcomes.
- **Класифікація помилок** - Telegram/director delivery paths класифікують malformed payloads, missing targets, missing configuration, provider rejection і transient provider failures.
- **Dead-letter metadata** - `event_queue` і `event_dead_letter` зберігають Guardian convergence status, failure class, attempts, idempotency key, terminal reason і replay linkage.
- **Replay для оператора** - Guardian Ops окремо показує dead-lettered Guardian delivery events і дозволяє один privileged single-event replay.
- **Цільові тести** - додано convergence, delivery classification і ops replay coverage для retry, terminal, duplicate/no-op і dead-letter behavior.

---

## v0.45.9 - Консоль Guardian Ops (2026-05-12)

### Операторська поверхня Guardian [codex]
- **Захищена консоль** - додано `/guardian-ops` як internal operator page для Guardian reliability state.
- **Операційна видимість** - консоль показує pending/failed Guardian outbox work, event-queue failures, active mutes, durable escalation counters і recent Guardian actions.
- **Обмежене відновлення** - operators можуть requeue один Guardian outbox або failed event-queue item з консолі без bulk replay.
- **Вирівнювання доступу** - backend page access, frontend access і sidebar metadata відкривають Guardian Ops тільки ролям creator/director/admin/security.
- **Безпечні стани UI** - додано loading, empty, error, disabled і live-region states для operator surface.

---

## v0.45.8 - Операторські контроли надійності Guardian (2026-05-12)

### Guardian reliability phase 3 [codex]
- **Операторський знімок** - додано protected Guardian reliability inspection для pending/failed Guardian outbox events, event-queue failures, active mutes, recent actions і durable moderation counters.
- **Обмежене відновлення** - operators можуть requeue один unpublished Guardian outbox row або failed event-queue item без bulk replay controls.
- **Межа прав** - Guardian ops endpoints обмежені ролями creator/director/admin/security і відхиляють non-Guardian recovery targets.
- **Аудит** - requeue actions пишуть Guardian ops admin-audit entry з previous attempts/error context.
- **Цільові тести** - додано authz і recovery coverage для inspection, outbox requeue, event-queue requeue і unsafe target rejection.

---

## v0.45.7 - Стійкий стан Guardian moderation (2026-05-12)

### Guardian reliability phase 2 [codex]
- **Стійкі лічильники** - repeat-offender і hourly-block escalation tracking використовують database-backed moderation events і counters замість module-scoped memory.
- **Безпечний replay** - Guardian mute events записують stable source identities, щоб repeated processing того самого mute не збільшував escalation counters.
- **Зв'язка escalation** - repeat-offender і hourly-block Telegram alert requests публікуються з тієї самої mute transaction, коли перетинаються durable thresholds.
- **Restart-safe baseline** - додано focused tests для duplicate source suppression, rolling-window reset і one-alert-per-window behavior.

---

## v0.45.6 - Фундамент доставки Guardian alerts через outbox (2026-05-12)

### Guardian delivery reliability [codex]
- **Стійкий delivery envelope** - Guardian critical alert requests використовують явні outbox/event types для director DM і Telegram alert delivery.
- **Зв'язка mute alerts** - successful Guardian mute claims публікують director DM і Telegram escalation requests у тій самій transaction, що й `chat_mutes` та `guardian_actions`.
- **Зв'язка action follow-up** - `/api/guardian/action` warning follow-ups додають director DM delivery всередині action transaction замість лише post-commit direct call.
- **Duplicate-safe processing** - director DM delivery використовує stable delivery keys у message metadata, щоб уникати duplicate user-visible alerts на retry.
- **Цільові тести** - додано mocked delivery coverage для enqueue semantics, duplicate suppression, provider failure і Telegram request handling без live provider calls.

---

## v0.45.5 - Одноразові action controls Guardian (2026-05-12)

### Guardian stale-tap safety [codex]
- **Одноразові контроли** - Guardian DM action buttons несуть per-alert action tokens, тому stale repeated taps поглинаються на server boundary.
- **UI-контракт** - chat UI надсилає action token з `/api/guardian/action` і замінює button group результатом сервера після завершення.
- **Duplicate-safe fallback** - старі клієнти без action tokens зберігають existing deterministic idempotency fallback.
- **Цільові тести** - додано coverage для consumed tokens, repeated taps і separate alerts із separate tokens.

---

## v0.45.3 - Ідемпотентність Guardian mute/action (2026-05-12)

### Цілісність Guardian [codex]
- **Duplicate-safe auto mute** - Guardian mute creation використовує advisory-lock transaction і пропускає duplicate side effects, коли active channel/user mute вже існує.
- **Одноразові дії директора** - repeated `/api/guardian/action` taps claim-яться через deterministic idempotency keys до запуску muting, warning, watching або unmuting side effects.
- **Зменшення side effects** - duplicate mute rows, duplicate director action logs, duplicate director warning alerts, repeated trust penalties і repeated heatmap updates зменшені в покритих flows.
- **Цільові тести** - додано helper і route coverage для repeated mute claims, rollback on action-log failure, stale `mute_both` taps і duplicate director warning taps.

---

## v0.45.2 - Цілісність Guardian director DM provisioning (2026-05-11)

### Guardian DM provisioning [codex]
- **Атомарний director DM** - Guardian/director DM creation використовує один transactional helper замість окремих check-then-insert paths.
- **Детерміноване повторне використання** - provisioning повторно використовує stable `dm-guardian-director` slug і зберігає legacy DM channels, які вже з'єднують Guardian і director.
- **Атомарний membership** - Guardian і director membership initialization комітиться в тій самій transaction, що й channel provisioning, з rollback on member setup failure.
- **Цільові тести** - додано deterministic coverage для repeated provisioning, legacy DM reuse, slug-shell repair і rollback behavior.

---

## v0.45.1 - Сумісність Guardian phase3 schema (2026-05-11)

### Guardian schema compatibility [codex]
- **Вирівнювання phase3** - Guardian service queries використовують column names, визначені phase3 migrations для mood, health, heatmap, weekly reports, escalation і trust scores.
- **Міграція сумісності** - додано guarded schema support для `guardian_trust_history` і `guardian_escalation_config.updated_at` без видалення чи переписування production data.
- **Фікс резервного health path** - Guardian health fallback читає current health з `guardian_channel_health`, а history з `guardian_health_history`.
- **Цільовий guardrail** - додано static Guardian phase3 schema compatibility test, щоб stale phantom-column patterns ловились у fast unit baseline.

---

## v0.45.0 - Старт релізної лінії 0.45 (2026-05-11)

### Політика версій [codex]
- **Нова релізна лінія** - Event Genix використовує `0.45.x` як активну version line.
- **Канонічне джерело** - `package.json` залишається version source of truth, а version-sync переносить реліз у UI labels, cache-bust tags і service-worker cache names.
- **Майбутні мініоновлення** - наступні releases мають піднімати тільки patch: `0.45.1`, `0.45.2`, `0.45.3` тощо до наступного explicit version-policy transition.
- **Історичні лінії** - `0.44.x` і старші changelog entries лишаються historical references, а не active release markers.

---

## v0.44.17 - Booking and room chat provisioning integrity (2026-05-11)

### Chat channel provisioning [codex]
- **Atomic booking channels** - booking-linked chat channel provisioning now uses one transactional helper and deterministic slug conflict handling.
- **Atomic room channels** - room/line channel initialization now uses the same duplicate-safe provisioning pattern instead of check-then-insert.
- **Unique support** - added guarded partial unique index migration for active booking and room channels when production data is already duplicate-free.
- **Membership initialization** - newly provisioned booking/room channels initialize creator membership in the same transaction as channel creation.
- **Focused tests** - added coverage for repeated booking provisioning, deterministic slug conflict reuse, repeated room init, and membership initialization.

---

## v0.44.16 - Chat poll transactional writes (2026-05-11)

### Chat polls [codex]
- **Transactional poll creation** - poll message and `chat_polls` rows now commit or roll back together.
- **Locked vote updates** - voting now locks the poll row with `FOR UPDATE` before delete/insert/recount/update work.
- **Recount safety** - single-choice vote replacement and option vote counts are recalculated and stored inside the same transaction.
- **Rollback coverage** - focused tests prove poll creation rollback and vote replacement rollback do not leave split message/poll or vote/count state.

---

## v0.44.15 - Scheduled chat dispatch atomic claim (2026-05-11)

### Scheduled chat messages [codex]
- **Atomic claim** - due scheduled chat messages are now claimed with a transactional `FOR UPDATE SKIP LOCKED` update before dispatch.
- **Duplicate-send safety** - concurrent scheduler workers skip already claimed rows instead of selecting and sending the same message twice.
- **Failure semantics** - DB claim failures roll back so messages can retry; websocket broadcast failures after claim leave the message visible in DB and are not retried to avoid duplicate sends.
- **Focused tests** - added deterministic coverage for successful claim/broadcast, claim rollback, and post-claim broadcast failure behavior.

---

## v0.44.14 - Chat reminder idempotency (2026-05-11)

### Chat reminders [codex]
- **Stable source identity** - reminder-created tasks now use a deterministic `chat_reminder` `source_id` based on message, user, and canonical reminder time.
- **Duplicate-safe reminders** - repeating the same reminder request reuses the active task instead of creating a second task.
- **Transactional write path** - reminder task creation and task log creation now run in one DB transaction with an advisory lock.
- **No ambiguous fallback** - the old Kleshnya/direct-insert fallback path was removed for chat reminders, so partial failures roll back instead of creating duplicate follow-up work.
- **Focused tests** - added coverage for duplicate reminders, distinct reminder times, and rollback after simulated partial failure.

---

## v0.44.13 - Chat task authz and duplicate-safe creation (2026-05-11)

### Chat tasks [codex]
- **Update authorization** - chat-task status changes now require the assignee, creator, or an elevated chat-task manager role (`creator`, `director`, `admin`, `senior_manager`).
- **No broad task mutation** - unrelated authenticated users no longer update `chat_tasks` by id alone.
- **Duplicate-safe message tasks** - repeated task creation from the same chat message, title, creator, and assignee returns the existing active task instead of creating a duplicate.
- **Scoped repeatability** - channel-only tasks remain repeatable so legitimate recurring operational tasks are not blocked by title alone.
- **Focused tests** - added unit coverage for allow/deny update paths, elevated-role updates, duplicate message-task creation, and repeatable channel-only tasks.

---

## v0.44.12 - Guardian RBAC hardening for control routes (2026-05-11)

### Guardian authz [codex]
- **Exact-role guards** - Guardian admin/control routes now use explicit `creator` / `director` / `admin` role sets instead of generic authentication or legacy role expansion.
- **Owner-only controls** - channel Guardian toggles are limited to `creator` and `director`, while emergency stop is limited to `creator`.
- **Mute safety** - regular users can only see and clear their own active mute; Guardian admins can still view and manage all active mutes.
- **Command context** - `/api/guardian/command` now passes the authenticated user identity and exact admin flag into the Guardian command handler.
- **Focused tests** - added Guardian RBAC coverage for non-admin denial, admin allow, owner-only controls, self-unmute behavior, and command identity propagation.

---

## v0.44.11 - Chat upload durability and file safety (2026-05-11)

### Chat uploads [codex]
- **Durable storage path** - new chat uploads now prefer Supabase Storage bucket `chat-uploads` and store explicit provider/bucket/key/url metadata on the chat message.
- **Legacy fallback** - if Supabase is not configured or temporarily unavailable, uploads fall back to the existing `/uploads/chat` path so current chat attachment behavior remains usable.
- **File safety policy** - upload validation now rejects SVG and extension/MIME mismatches before storage or message creation.
- **Cleanup coverage** - deleting a chat message now removes the Supabase object when available, while preserving legacy local-file cleanup.
- **Focused tests** - added storage and route tests for Supabase metadata, local fallback, SVG rejection, MIME mismatch rejection, member upload success, and non-member denial.

---

## v0.44.10 - Chat poll authz and realtime broadcast fix (2026-05-11)

### Chat polls [codex]
- **Poll broadcast contract** - poll create/vote/close paths now call `broadcastToChannel(channelId, eventType, payload)` with explicit `chat:message`, `chat:poll-update`, and `chat:poll-closed` events.
- **Poll create realtime** - new poll messages are broadcast with the same `chat:message` contract as regular chat messages and use mapped message fields.
- **Poll authz coverage** - added focused tests for poll create, vote, results visibility, close, non-member denial, and realtime payload shape.
- **Client event bridge** - `js/ws.js` now forwards poll update/close events through the existing `ws:chat` channel for chat listeners.

---

## v0.44.9 - Root media cleanup and landing-page redirects (2026-05-11)

### Static asset cleanup [codex]
- **Duplicate root media removed** - exact duplicate banner/branding PNGs were removed from repo root; canonical copies remain under `images/banners/` and `images/branding/`.
- **Loose HTML resolved** - `sales-deck.html` now lives under `landing/sales-deck.html`, matching the existing landing manager guide pattern.
- **Legacy URL compatibility** - `/manager-guide`, `/manager-guide.html`, `/sales-deck`, and `/sales-deck.html` now 302 to canonical `landing/` pages instead of depending on loose root files.
- **Cleanup coverage** - added `tests/static-cleanup.test.js` and wired it into `test:unit` to catch duplicate root media returning or landing guide/deck routes drifting.

---

## v0.44.8 - Historical docs archive and static doc guard (2026-05-11)

### Docs/static exposure hardening [codex]
- **Historical archive** - moved stale Claude/OpenClaw handoff docs into `docs/archive/` and marked them as non-authoritative history.
- **Current docs clarified** - `README.md` and `AGENTS.md` now point to active sources of truth first and label archived docs as context only.
- **Static doc guard** - root static serving now blocks direct public access to root/archive `.md` and `.txt` docs while leaving intended HTML/assets and upload-style paths available.
- **Focused coverage** - added `tests/static-doc-guard.test.js` to prove README/archive docs and root `.txt` proofs are not publicly served through broad static middleware.

---

## v0.44.7 - Chat render safety tests and URL guards (2026-05-11)

### Chat render safety [codex]
- **Render test harness** - added focused jsdom coverage for `js/chat-page.js` message rendering helpers without initializing the full chat app.
- **Plain text and links** - tests now cover escaping for core message text, markdown/link formatting, and injected tag payloads.
- **Bot content** - tests lock down the limited safe bot tags while keeping injected HTML escaped.
- **File and preview surfaces** - attachment names, unsafe attachment URLs, and link-preview metadata now have explicit XSS regression coverage.
- **Attribute safety** - chat escaping now also encodes quotes, preventing user text from breaking out of HTML attributes.
- **URL guard** - file, GIF, voice, and link-preview renderers now strip unsafe non-http/non-relative URLs such as `javascript:`.

---

## v0.44.6 - Report-bot submit transaction and idempotency (2026-05-11)

### Finance/report integrity [codex]
- **Transactional submit** - `POST /api/report-bot/submit` now writes the submission queue row, finance transaction, and legacy report row in one DB transaction.
- **Duplicate guard** - submit uses a durable idempotency key from explicit request/raw payload IDs, with a stable payload fallback for repeat deliveries.
- **Rollback safety** - if the legacy report write fails after the finance write, the whole submit is rolled back instead of leaving split finance/report state.
- **Kyiv date** - the submit path now uses an explicit request date or Europe/Kyiv today instead of UTC-only `toISOString()` day slicing.
- **Focused coverage** - added tests for success, duplicate submit, and partial failure rollback.

---

## v0.44.5 - Atomic linked booking move/resize/shift (2026-05-11)

### Booking integrity [codex]
- **Atomic linked endpoint** - added `POST /api/bookings/:id/linked-atomic` so main + linked timeline updates commit together or roll back together.
- **Timeline drag/resize** - drag, cross-line move, resize, and their undo paths now use the atomic server path instead of serial linked `PUT`s.
- **Time shift undo/redo** - booking time shift, undo shift, and redo shift now update linked bookings in one bounded transaction.
- **Conflict rollback** - server-side conflict checks validate main and linked targets before any update, preventing partial linked-booking moves.
- **Focused coverage** - added self-contained tests for success, linked conflict rollback, and incomplete linked payload rejection.

---

## v0.44.4 - Route guard hardening for designs, music, reports, and chat (2026-05-11)

### Authz [codex]
- **Designs API guard** - `routes/designs.js` now requires the same manager-up/art-director/marketer access used by the design/art pages.
- **Music API guard** - `routes/music.js` now requires sound-page access instead of accepting any authenticated role.
- **Reports API guard** - `routes/reports.js` now matches the reports page matrix: creator/director/vice-director/senior-manager/accountant only.
- **Chat API guard** - `routes/chat.js` now blocks waiter-level users at the API boundary, aligned with `/chat` page access.
- **Focused coverage** - route smoke now covers allow/deny cases for designs, music, reports, and the actual chat router.

---

## v0.44.3 - Access source-of-truth and sidebar drift guard (2026-05-11)

### Access/Auth [codex]
- **Access drift check** - added `npm run check:access` and wired it into `npm test` to compare backend `PAGE_ACCESS`, frontend `PAGE_ACCESS`, sidebar access keys, and role metadata.
- **Unknown page deny** - frontend `canAccessPage()` now rejects unknown routes instead of allowing them by default, while normalizing hash/page aliases safely.
- **Sidebar reconciliation** - `/sales-funnel` and `/leads` share the same lead access; tasks/chat/Kleshnya/Afisha/Certificates no longer use broad sidebar `all` access where waiter should not see them.
- **Security role metadata** - added `security` to role permissions/departments/default widgets and shared role UI metadata.
- **Focused coverage** - route smoke checks security role exposure, `/sales-funnel` alias parity, and waiter exclusion from task page access.

---

## v0.44.2 - Dashboard auth and version-sync guardrails (2026-05-11)

### Dashboard/Auth [codex]
- **Analytics access** - `/api/analytics` now uses manager-up access, aligned with frontend/sidebar page access.
- **Widget backend guard** - `/api/dashboard/widgets/:type` enforces server-side role checks for sensitive widgets, and saved dashboard config filters unauthorized widgets.
- **Version sync guard** - `scripts/version-sync.js` checks dashboard first-screen version/changelog labels so dashboard-specific stale markers are caught.
- **Focused coverage** - route smoke covers analytics manager-up access and sensitive widget 403s; UI smoke checks dashboard labels against `package.json`.

---

## v0.44.1 - Sound storage pilot on Supabase Storage (2026-05-11)

### Storage [codex]
- **Manual sound uploads** - `/api/music/library/upload` now attempts to store new manual audio files in Supabase Storage under the `audio-library` bucket instead of relying first on Railway-local `uploads/sounds`.
- **Legacy fallback** - if Supabase is not configured or upload fails, the route falls back to the existing local `/uploads/sounds` behavior so operators are not blocked during rollout.
- **Explicit storage metadata** - added nullable `sounds.storage_provider`, `storage_bucket`, `storage_key`, `storage_url`, and `storage_migrated_at` fields for backfill-safe tracking and remote delete cleanup.
- **Delete cleanup** - sound deletion now removes Supabase objects when a storage key exists and still removes legacy local files for old records.
- **Focused coverage** - added `tests/audio-storage.test.js` and wired it into `npm run test:unit` / CI.
- **First screen** - updated the login version marker and "Що нового" entry for the sound storage pilot.

---

## v0.44.0 - Versioning convention transition to 0.44.x (2026-05-11)

### Version policy [codex]
- **Canonical version reset** - `package.json` now starts the active release train at `0.44.0`; `package-lock.json`, visible UI markers, asset cache-bust strings, service-worker cache names, and `/api/version` derive from that source.
- **Mini-update rule** - future small releases on this train must increment patch as `0.44.1`, `0.44.2`, `0.44.3`, and so on. Do not return to `43.x.x` or jump to `44.x.x` without an explicit version-policy task.
- **History preserved** - existing `v43.*` changelog entries, code comments, and migration notes remain historical references to earlier CRM work; they are not the active version source.
- **Version-sync discipline** - `scripts/version-sync.js` continues to enforce the single source of truth from `package.json` across package-lock, HTML asset tags, first-screen labels, latest changelog marker, service-worker cache names, and inline asset refs.
- **First screen** - updated the login version marker and "Що нового" entry for the new `0.44.x` line.

---

## v43.20.0 - Service Worker privacy cache and offline replay guardrails (2026-05-11)

### Client safety [codex]
- **API cache allowlist** - Service Worker now caches only public non-user-specific `/api/version` and `/api/status/public` GET responses; authenticated or sensitive API GETs are network-only.
- **Sensitive CRM exclusions** - finance, chat, HR, customers, reports, dashboard, analytics, leads, staff, tasks, bookings, warehouse, settings, auth-adjacent, and bot endpoints are explicitly classified as sensitive.
- **Logout cache clearing** - logout/token invalidation now clears `event-genix-api-*` caches and asks the Service Worker to clear private API caches plus the offline mutation DB.
- **Offline replay boundary** - generic offline mutation replay is disabled by default until a route is explicitly reviewed and allowlisted; private mutation bodies/auth headers are not queued broadly.
- **Focused coverage** - added `tests/service-worker-policy.test.js` and wired it into `npm run test:unit` / CI.
- **First screen** - updated the login version marker and "Що нового" entry for the Service Worker privacy cache release.

---

## v43.19.0 - Telegram callback idempotency and keyboard cleanup (2026-05-11)

### Bot flow safety [codex]
- **Callback classification** - audited Telegram callback families and treated animator, certificate use, task transitions, training approval/rejection, review rating, and auto-order decisions as single-use; kept `pulse:*` multi-use for shared group mood collection.
- **Keyboard cleanup** - completed single-use callbacks now clear or rewrite inline keyboards after success, and stale callbacks clear old buttons where the message can still be edited.
- **Task stale guard** - new task inline buttons include expected status tokens (`todo` / `in_progress`) so stale buttons from older task states cannot trigger conflicting transitions.
- **Decision idempotency** - training, review, and auto-order callbacks now check pending/duplicate state before creating side effects or sending contractor notifications.
- **Focused tests** - added `tests/telegram-callbacks.test.js` and wired it into `npm run test:unit` / CI to cover stale/double taps and the intentionally multi-use pulse path.
- **First screen** - updated the login version marker and "Що нового" entry for the Telegram callback safety release.

---

## v43.18.0 - CI baseline guardrails for push and pull requests (2026-05-11)

### Verification and CI [codex]
- **GitHub Actions baseline** - added `.github/workflows/ci.yml` for push and pull request verification.
- **Runtime alignment** - CI uses Node 22 from `.node-version`, aligns npm to `10.9.8`, installs with `npm ci`, and runs `npm test`.
- **Safety checks automated** - the CI gate now covers runtime drift, version sync, migration duplicate/gap/governance checks, JavaScript syntax, unit/auth-boundary smoke, and static UI smoke.
- **Honest scope documented** - README and AGENTS now state that CI does not replace PostgreSQL integration tests, live Railway health checks, browser automation, or manual UX/accessibility review.
- **First screen** - updated the login version marker and "Що нового" entry for the CI baseline release.

---

## v43.17.0 - DB migration governance and static migration guard (2026-05-11)

### Database governance [codex]
- **Migration check** - added `npm run check:migrations` to detect new duplicate migration numbers, undocumented numbering gaps, invalid future migration filenames, and missing safety metadata.
- **Governance rules** - added `DB_MIGRATION_GOVERNANCE.md` to document the current `initDatabase()` vs `db/migrations/` split and the intended source of truth for future schema changes.
- **Legacy baseline** - documented the existing duplicate `026_*` migration number, known numbering gaps, and risky legacy data/date/user migrations as controlled debt instead of a pattern to copy.
- **Verification baseline** - `npm test` now includes the migration governance check so future Codex work cannot quietly add unsafe schema/data migrations.
- **First screen** - updated the login version marker and "Що нового" entry for the database governance release.

---

## v43.16.0 - Credential seed guard and safe user bootstrap (2026-05-11)

### Security [codex]
- **Default credentials removed** - startup no longer seeds shared user passwords from code or silently resets existing `users.password_hash` values.
- **Explicit bootstrap** - fresh environments must use `BOOTSTRAP_CREATOR_*` env vars for the first creator; local-only dev seed requires `ALLOW_DEV_USER_SEED=true` plus `DEV_SEED_ADMIN_PASSWORD`.
- **Legacy seed guardrails** - v12.5 user upsert, Anna/Artem, and OpenClaw seed paths are marked without password updates; OpenClaw JWT login now requires `OPENCLAW_BOOTSTRAP_PASSWORD`.
- **Docs/tests cleaned** - removed published shared credentials from repo docs and examples; live API tests now require explicit `TEST_USER` and `TEST_PASS`.
- **Focused coverage** - added `tests/user-seed-policy.test.js` to lock the production/dev seed boundary.

---

## v43.15.0 - Auth boundary fix for public landing and query tokens (2026-05-11)

### Security and behavior [codex]
- **Public landing access** - `POST /api/landing/demo-request` and the active landing form path `POST /api/leads/landing` now bypass JWT auth intentionally instead of being blocked by the global API guard.
- **Query-token hardening** - global `?token=` JWT fallback is restricted to the approved graduation proposal/export `window.open` endpoints instead of every protected API route.
- **Boundary tests** - added focused tests for public endpoints, protected no-auth rejection, generic query-token rejection, allowed query-token paths, and report-bot/Telegram missing or wrong secrets.
- **Abuse guard** - added a burst limiter for public landing/demo lead submissions.

---

## v43.14.0 - Node 22 runtime and Railway baseline (2026-05-11)

### Platform baseline [codex]
- **Canonical runtime** - pinned Event Genix to Node `22.x` and npm `10.x` through `package.json`, `.nvmrc`, and `.node-version`.
- **Railway alignment** - documented that Railway/Nixpacks must use Node 22 and that any fallback to Node 18 or EBADENGINE warnings is a deploy-blocking runtime drift.
- **Verification guard** - added `npm run check:runtime` and made `npm test` run it before version, syntax, unit, and UI checks.
- **First screen** - updated the login version marker and "Що нового" entry for the runtime baseline release.

---

## v43.13.0 - Codex stabilization pack (2026-05-11)

### Stabilization [codex]
- **Repo rules** - added `AGENTS.md` and refreshed `README.md` with Codex-ready rules for dirty worktrees, deploy boundaries, version/changelog discipline, verification, and shared UI/access patterns.
- **Version source of truth** - aligned package, package-lock, visible UI version, cache-bust tags, service-worker cache names, changelog markers, and inline asset refs around `package.json`.
- **Verification baseline** - made `npm test` an honest fast local baseline and split live server/database checks into `test:api` and `test:integration`.
- **Telegram callbacks** - isolated and committed the single-use inline callback fix for contractor and report-bot choices.

---

## v43.12.0 - Codex version source-of-truth sync (2026-05-11)

### Versioning [codex]
- **Canonical version** - `package.json` and `package-lock.json` now carry `43.12.0`, matching the visible first-screen Codex test marker.
- **Cache/version sync** - asset `?v=` tags, service-worker cache names, and the public catalog CSS reference are aligned through `scripts/version-sync.js`.
- **Guardrail** - `scripts/version-sync.js` now checks package-lock, latest changelog markers, `sw.js`, standalone pages, and the inline catalog asset reference in `server.js`.

### Verification [codex]
- **Package scripts** - `npm test` now runs the fast local verification baseline via `npm run verify`.
- **Honest scopes** - unit/UI/version/syntax checks are separate from server+DB API and integration suites.
- **Syntax guard** - `scripts/check-js-syntax.js` adds a dependency-free Node parser check for repository JavaScript.

---

## v38.17.0 — Leaderboard + Daily Badge + Tasks Preview (2026-03-26)

### Profile Leaderboard [claude-code]
- **Seed data** — рейтинг заповнений для всіх юзерів (XP, coins, level)
- **Daily badge pulse** — CSS `badge-pulse` анімація на табі щоденних завдань
- **Tasks preview** — блок попереднього перегляду завдань на профілі
- **Migration 129 fixes** — ALTER TABLE daily_quests ADD all columns (IF NOT EXISTS)

---

## v38.16.0 — Profile Redesign: Hero, Inventory, Shop, Quests (2026-03-26)

### Profile Page [claude-code]
- **Hero glassmorphism** — картка профілю зі скляним ефектом, контрастні шрифти
- **Inventory** — RPG ячейки замінено на картковий вигляд (card layout)
- **Shop seed** — 17 items: кава 200₴, піца 800₴ + 6 їжі + 9 косметики
- **Quests seed** — 8 щоденних квестів у daily_quests таблиці
- **Кімната прибрано** — таб "Кімната" видалено з profile page

---

## v38.15.0 — Match-3 Enhanced Special Effects + Profile (2026-03-26)

### Match-3 Game [claude-code]
- **Спецефекти** — bomb, lightning, cross, rainbow анімації по центру клітинки
- **Клітинки** — фіолетовий тінт на білому фоні (light mode fix)
- **Profile API** — `/profile/:userId` повертає JSON замість redirect

---

## v38.14.0 — Каталоги: Image Picker + Premium Viewer (2026-03-26)

### Catalog UX [claude-code]
- **Image Picker** — 4 варіанти: AI генерація, upload, галерея, URL (замість prompt())
- **Premium Catalog Viewer** — 7 пакетів випускних з повноекранним переглядом
- **openCatalog fix** — виправлено infinite recursion (Maximum call stack)
- **submitCreateCatalog** — додано відсутню функцію створення каталогу
- **Graduation seed** — inline button styles + graduation catalog seed data

---

## v38.13.0 — Catalog Pages + Supabase Storage (2026-03-26)

### Catalog Pages [claude-code]
- **catalog_pages таблиця** — Migration 127: HTML-сторінки для каталогу (обкладинка + товарні)
- **API** — GET/POST/PUT/DELETE endpoints для сторінок каталогу
- **Fullscreen viewer** — ← → навігація, Escape закриття
- **Створення сторінок** — "+ Обкладинка" та "+ Сторінка" кнопки
- **Вставка зображень** — кнопка "🖼 Зображення" на кожній сторінці
- **Редагування** — назва, опис, ціна через "✏️ Редагувати"

### Supabase Storage [claude-code]
- **Постійне збереження** — AI зображення завантажуються в Supabase Storage (bucket: catalog-images)
- **Транслітерація filename** — UA→ASCII для Supabase (фікс "Invalid key" помилки)
- **Fallback** — якщо Supabase недоступний, зберігає Kie.ai temp URL
- **CSP** — дозволено img-src для *.supabase.co та *.aiquickdraw.com

### AI Image Generation [claude-code]
- **nano-banana-2** — оновлено модель (google/nano-banana → nano-banana-2)
- **Role access** — всі catalog endpoints дозволяють creator/director/art_director/manager
- **Error feedback** — toast на старті/успіху/помилці генерації

### CSS Architecture [claude-code]
- **css/designs.css** — 342 рядків витягнуто з designs.html
- **css/catalog.css** — 483 рядків + стилі catalog pages
- **designs.html** — 1541 → 725 рядків (-53%)

---

## v38.11.0 — Systematic Frontend Improvements (2026-03-26)

### AI Image Generation [claude-code]
- **Kie.ai prompt fix** — transliterate Ukrainian→English (Gemini rejected cyrillic)
- **Fallback save** — if apply-image fails, saves via PATCH directly
- **Error feedback** — toast on start/success/failure

### Centralized Notifications [claude-code]
- **js/notification.js** — single showNotification() with aria-live, replaces 9 duplicates
- **alert() → toast** — 16 alert() calls replaced across hr, sound, settings, warehouse

---

## v38.10.0 — Sidebar Active Fix + Catalog Improvements (2026-03-26)

### Sidebar [claude-code]
- **Active state rewritten** — exact match only, no startsWith. Fixes double-active (/art + /art-director, /designs + /designs#catalogs)
- **Hash logic** — hash items active only when URL hash matches; default first hash only when no non-hash sibling
- **Scroll restore** — saves/restores scroll position between page navigations

### Catalogs [claude-code]
- **"+ Створити каталог" button** — modal with name, emoji, description; POSTs to /api/catalogs/definitions
- **Viewer overflow fixed** — removed max-height:80vh that cut off catalog page content
- **Hash tab switching** — /designs#catalogs now switches tab BEFORE async loads
- **Null checks** — apiFetch responses checked before .json() (12 places fixed)
- **UI split** — "Готові каталоги" and "Каталоги товарів" sections
- **Price bug** — totalPerChild was string concatenation; fixed with parseFloat

### Match-3 Game [claude-code]
- **Special indicators** — 10→16px, dark bg, hover tooltip with label + description
- **Pause button** — ⏸ in header, overlay with blur, resume button
- **Bonus banner** — animated slide-across on special activation

---

## v38.9.0 — Stability & Page Fixes (2026-03-25)

### Critical Fixes [claude-code]
- **art-director-page.js, center-page.js, demo-page.js** — відновлено оригінальні файли (помилковий "fix" ламав initPage функції → сторінки Арт, Центр, Демо не працювали)
- **copilot-page.js** — додано `showAddInteractionForm` і `loadTrackerAlerts` до window.CopilotPage (кнопки в Менеджер AI не реагували)
- **designs.html** — видалено misplaced `<script>` тег всередині JS функції + fix openCatalog() race condition
- **server.js** — `/designs` тепер показує designs.html напряму (було 302 redirect на /art)

### Sidebar & CSS [claude-code]
- **Центр цін → Центр керування** 🎛️ (перейменовано в sidebar)
- **embed-mode CSS** — ховає sidebar/header в iframe (фікс дублювання sidebar в Звіти tab)

### Tooling [claude-code]
- **tests/ui-check.js** — 106 автоматичних DOM/JS перевірок через jsdom (синтаксис, структура, exports)
- **jsdom** додано як dev dependency

---

## v38.8.0 — Авто-каталог Fix + Dashboard Widget (2026-03-25)

### Catalog Fixes [claude-code]
- **Шрифти зменшено** — cover icon 56→40px, year 28→22px, title clamp(20,4vw,28)px, price clamp(18,3vw,24)px, h3 16→15px
- **Viewer overflow** — catalog-pages-container max-height: 80vh
- **Dashboard widget** — каталоги повернено до списку доступних dashboard віджетів

---

## v38.7.0 — Sidebar: Арт + Дизайнер Split (2026-03-25)

### Sidebar Restructure [claude-code]
- **Група "Продукт" розділена** на два окремих блоки:
  - **🎨 Арт** — Програми, Арт директор, Випускний, Афіша, Сертифікати (все пов'язане з розважальними програмами)
  - **📐 Дизайнер** — Дизайн-борд, Каталоги, Стайлгайд (все по дизайну та візуалу)
- **Каталоги переміщено** з `/art` → `/designs#catalogs` (де живе авто-каталог viewer з AI генерацією та PDF експортом)
- **data-page-group** оновлено: art-director/programs/graduation → `"art"`, designer/designs → `"designer"`
- **CSS page transitions** — окремі анімації для груп art (rotateIn) та designer (fadeScale)

---

## v38.6.0 — Business Logic Hardening + Full System Audit (2026-03-25)

### Booking System Hardening [claude-code]
- **Status whitelist** — тільки `confirmed`, `preliminary`, `cancelled` приймаються; будь-який інший рядок ігнорується
- **Cancelled→confirmed blocked** — скасоване бронювання не можна відновити, потрібно створити нове
- **Midnight span prevention** — бронювання не може перевищувати 00:00 (time + duration > 1440 хв = помилка)
- **mapBookingRow on payment** — `PATCH /:id/payment` тепер повертає camelCase замість raw snake_case

### Wallet Race Conditions Fixed [claude-code]
- **Transfer deadlock prevention** — lock обох wallets в порядку ID (менший перший) при переказах
- **Daily login idempotency** — подвійний guard: перевірка `last_login_reward` + перевірка `coin_transactions` за сьогодні

### Database Migration 126 [claude-code]
- **5 нових indexes** — `leads(assigned_to)`, `leads(status, created_at)`, `bookings(program_id)`, `finance_transactions(category_id)`, `staff(hire_date)`
- **FK ON DELETE** — `bookings.customer_id` і `discount_usage.customer_id` → `ON DELETE SET NULL`

### Frontend Fixes [claude-code]
- **setInterval cleanup** — agents-panel, alerts, status-page: `clearInterval` on `beforeunload`
- **innerHTML XSS** — escaped user data в hr-page, center-page, chat-page
- **CSS iOS zoom** — 3 inputs з font-size 13px → 16px (controls.css: timeline-search, night-settings, template-select)

### Code Cleanup [claude-code]
- **3 unused imports** видалено — `requireRole` з decisions.js, designs.js, points.js

### Testing [claude-code]
- **+11 нових тестів** (424 → 435): wallet (2), shop (3), minigame (3), booking validation (3)

### System Audit Findings (documented for next session) [claude-code]
- **29 route files** без dedicated тестів (wallet, shop, minigame, personal-accounts, recurring, chat та інші)
- **Server startup**: DATABASE_URL missing = тільки warning (має бути fatal)
- **Graceful shutdown**: не чекає in-flight requests перед закриттям DB pool
- **Stale data on reconnect**: після тривалого offline клієнт бачить суміш старих і нових даних
- **Response format inconsistency**: 4 формати pagination, 3 формати errors across routes

---

## v38.5.0 — Deep QA Sweep (2026-03-25)

### Security Hardening [claude-code]
- **Hardcoded API ключі видалено** — KIE.ai (2 місця) + OpenRouter: graceful 503 якщо env var не задано
- **SQL injection fix** — `routes/backup.js`: table name interpolation → `safeTableName()` з allowlist
- **Telegram HTML injection** — `esc()` для всіх user-controlled полів у notification templates (notes, names, descriptions)
- **IDOR fix** — `PATCH /bookings/:id/payment` додано `requireAction('edit_booking')`
- **innerHTML XSS** — escaped user data в hr-page, center-page, chat-page (4 місця)
- **10 missing PAGE_ACCESS** — додано auth записи для art-director, designs, game, leads, profile, quiz, report-agent, reports, room, shop

### Race Conditions Fixed [claude-code]
- **awardXP** — atomic SQL `xp = xp + $1` замість read-modify-write
- **purchaseShopItem** — `FOR UPDATE` lock на shop_items запобігає oversell
- **updateStreak** — atomic UPSERT з CASE логікою, без read-modify-write

### Performance [claude-code]
- **N+1 achievements** — 500+ queries → 9 parallel batch queries (Promise.all)
- **N+1 bulk messaging** — 1000 INSERTs → single batch INSERT
- **N+1 meeting action items** — loop INSERT → multi-row INSERT
- **52+ unbounded SELECT*** — додано LIMIT на всі queries без обмежень
- **Pagination caps** — chat limit=200, summary limit=100, days=365

### Frontend QA [claude-code]
- **401 blank screen fix** — 13 сторінок: `loginOverlay` → `window.location.href='/'`
- **434 buttons** — додано `type="button"` (запобігає accidental form submit)
- **Sidebar hash nav** — нормалізація pathname для in-page tab switching
- **Dark mode flash** — prevention script на 20 сторінках
- **Null-safe getElementById** — demo-page, art-director-page tab switching
- **setInterval leaks** — agents-panel, alerts, status-page: clearInterval on beforeunload
- **CSS iOS zoom** — 3 inputs з font-size 13px → 16px

### Timezone DST Fixes [claude-code]
- **music-delivery.js** — hardcoded UTC+3 → DST-aware `toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })`
- **agentTracker.js** — hardcoded +02:00 → dynamic DST offset
- **8 toLocaleDateString()** — додано `timeZone: 'Europe/Kyiv'` (graduation, certificates, finance, bot, templates)

### Memory & Stability [claude-code]
- **Guardian.js** — periodic cleanup (5 хв) для 9 in-memory caches (запобігає ~20MB leak за 7 днів)
- **contextCache.js** — periodic cleanup (10 хв) + hard cap 500 entries
- **WebSocket heartbeat** — snapshot iteration запобігає iterator invalidation; `_removeClient()` для повного cleanup
- **unhandledRejection** — тепер `process.exit(1)` (запобігає corrupted state)
- **API 404** — JSON `{ error: 'Not found' }` замість HTML для `/api/*` routes

### Database [claude-code]
- **Migration 126** — 5 missing indexes (leads, bookings, finance, staff) + ON DELETE SET NULL для bookings.customer_id, discount_usage.customer_id

### Telegram [claude-code]
- **Message truncation** — `truncate()` helper для 4096 char Telegram limit
- **Silent catches** — 3 `.catch(() => {})` → logging (order notify, lead notify, chat ID reg)

### Testing [claude-code]
- **+78 нових тестів** (346 → 424): auth-refresh (15), sql-safety (13), decisions (11), vacancies (9), graduation (10), dashboard-widgets (10), our-fixes (10)

### Documentation [claude-code]
- **CHANGELOG.md** — відновлено 20+ пропущених версій (v35.1–v38.2)
- **PROJECT_PASSPORT.md** — v22.18 → v38.5, routes 61→74, services 30→41, CSS 17→22
- **SNAPSHOT.md** — оновлено architecture counts
- **Cache-bust** — `?v=38.5.0` на всіх 34 HTML сторінках
- **Accessibility** — aria-label на 11 inputs (analytics, customers, dashboard, art-director, chat, demo, center)

---

## v38.4.0 — Security & Reliability Hardening (2026-03-25)

### JWT Refresh Tokens [claude-code]
- **Refresh token rotation** — short-lived access tokens (15m) + long-lived refresh tokens (30d)
- **Replay detection** — reuse of revoked token automatically revokes ALL user sessions
- **Session management** — `/api/auth/sessions` endpoint to list active sessions
- **Logout** — `/api/auth/logout` revokes refresh token; `allDevices: true` revokes all
- **Backward compatible** — legacy 24h token still issued for existing clients
- **Auto-cleanup** — scheduler job removes expired/revoked tokens weekly

### Transactional Outbox [claude-code]
- **Outbox pattern** — `publishInTransaction()` writes events in the same DB transaction as business data
- **Outbox relay** — scheduler processes unpublished events every 5 seconds via `FOR UPDATE SKIP LOCKED`
- **Dual-write prevention** — eliminates risk of event loss when DB commits but event publish fails
- **Auto-cleanup** — published outbox events cleaned up after 7 days

### pg_stat_statements [claude-code]
- **Enabled** via migration — provides query performance statistics (planning time, execution time, calls)
- **Migration 125** — `refresh_tokens` table, `outbox_events` table, pg_stat_statements extension

### SQL Safety Utilities [claude-code]
- **`utils/sqlSafe.js`** — `safeOrderBy()`, `safeTableName()`, `safeSets()` helpers
- **Audit complete** — all 12+ dynamic SQL locations verified using allowlists (no actual injection vectors found)

---

## v38.3.0 — Operations Intelligence (2026-03-24)

### Exceptions Inbox [claude-code]
- **Новий dashboard віджет "Що потребує уваги"** — агрегує 6 типів операційних проблем:
  - 💥 Конфлікти кімнат (перекриття часу бронювань)
  - 🎭 Бронювання без аніматора
  - ⏰ Прострочена підготовка (event-задачі)
  - 😞 NPS детрактори (оцінка 1-2/5 без follow-up)
  - 🧹 Прибирання з перевищеним SLA
  - 🔴 Непідтверджені бронювання за <2 години до старту
- **Авто-додано** до дашбордів: creator, director, vice_director, senior_manager, manager, admin, reception

### Event Pipeline [claude-code]
- **Автоматичний lifecycle бронювання** через event bus:
  - `booking.t24` — за 24 години до події (нагадування + задача підготовки)
  - `booking.day_of` — в день події (чек-лист підготовки кімнати)
  - `booking.completed` — після завершення (тригер для прибирання)
- **booking_pipeline** таблиця — відстеження стадій кожного бронювання (idempotent)

### NPS Follow-Up Automation [claude-code]
- **Detractor follow-up** — при оцінці 1-2/5 автоматично:
  - Створюється high-priority задача менеджеру
  - Telegram-алерт директору
- **Promoter referral** — при оцінці 5/5 автоматично:
  - Telegram-повідомлення з пропозицією рекомендації
- Нові поля event_reviews: `nps_score`, `follow_up_status`, `follow_up_task_id`

### Cleaning Task Chain [claude-code]
- **cleaning_tasks** таблиця — автоматичне створення задач прибирання після завершення подій
- **SLA tracking** — дефолт 15 хвилин на прибирання, відстеження в exceptions inbox
- Прив'язка до кімнати та бронювання

### Event Bus Rules [claude-code]
- 5 нових default правил: `booking_t24_reminder`, `nps_detractor_followup`, `nps_promoter_referral`, `booking_cleaning_auto`, `booking_day_prep`
- Scheduler jobs: `checkEventPipeline` (5 хв), `checkNpsFollowUp` (hourly), `checkCleaningTasks` (5 хв)

---

## v38.2.0 — Тестовий деплой + Deep Research підготовка (2026-03-24)

### Research & Deploy [claude-code]
- **Deep Research** — підготовлено промпти для глибокого аналізу CRM (бізнес + технічний)
- **Тестовий деплой** — перевірка стабільності системи

---

## v38.1.0 — HR: Команда + Вакансії + Підбір персоналу (2026-03-22)

### Team Tab Fix [claude-code]
- **initTabs()** — null-safe panel lookup + loader object pattern
- **loadTeam()** — spinner, null-check для hrFetch, error states

### Roles Sync [claude-code]
- **ROLE_LABELS** — 7 → 15 ролей (+trampoline_instructor, waiter, bartender, cook, head_cook, director, vice_director, hr_manager)
- **teamRoleFilter** — optgroup структура (Керівництво/Аніматори/Кухня/Технічний)

### Vacancies Module [claude-code]
- **Migration 123** — `job_vacancies` + `job_applications` таблиці з індексами, тригер auto-update applications_count
- **routes/hr.js** — 8 нових ендпоінтів (vacancies CRUD, applications CRUD, hire з auto-staff creation)
- **hr.html** — новий таб "Вакансії" зі статус-фільтром, stat cards, канбан кандидатів

---

## v38.0.0 — Sound Module (2026-03-22)

### Sound Page [claude-code]
- **sound.html** — повний rewrite з 4 табами: Оголошення / Бібліотека / Плейлисти / Лог
- **Migration 122** — sounds.url column, extended category/type checks
- **routes/music.js** — POST /generate-tts (TTS), GET/POST/DELETE /library (file upload), GET/POST/DELETE /projects
- **js/sound-page.js** — логіка табів, API calls, модалки
- **css/sound.css** — Design System v4.0 токени, dark mode, мобільна адаптація

### v38.0.1 — Sidebar Fixes [claude-code]
- **Арт директор** — додано до окремої групи sidebar
- **Ukrainian labels** — локалізація sidebar меню

---

## v37.8.0 — Visual Polish (2026-03-22)

### UI Enhancement [claude-code]
- **Cards** — глибші тіні, hover-lift з border-glow
- **Buttons** — gradient backgrounds, glow-shadow, scale active
- **Inputs** — inset shadow, hover border, покращений focus ring
- **Login** — gradient кнопка, стильніші інпути, inner glow
- **Tooltip** — backdrop-blur, rounded 12px
- **Tabs/Filters** — gradient active, hover-lift
- **Dashboard** — widget hover-lift, stat-items gradient tint
- **Dark mode** — оновлено empty-state

---

## v37.7.0 — Page Transitions (2026-03-22)

### Animations [claude-code]
- **5 анімацій входу** — унікальна анімація для кожної групи sidebar (CRM, Управління, HR, Творче, Система)
- **Exit анімація** — 180ms fade-slide-down при навігації
- **prefers-reduced-motion** — вимикає всі переходи

---

## v37.6.0 — Sidebar Visual Upgrade (2026-03-22)

### Sidebar Redesign [claude-code]
- **Nav icons** — 28px rounded boxes з gray-50 background, colored on active
- **User card** — gradient card з border, shadow, 36px avatar
- **Active state** — gradient background + 4px glow indicator bar
- **Hover** — translateX(2px) slide animation
- **Custom scrollbar** — 4px thin (webkit + firefox)
- **Dark mode** — всі нові стилі адаптовано

---

## v37.5.0 — Cache Bust Fix (2026-03-22)

### Browser Cache [claude-code]
- **Проблема** — браузер кешував старі JS файли (config.js, sidebar.js) бо ?v= не змінився
- **Фікс** — оновлено ?v=37.5.0 на всіх 30 HTML сторінках

---

## v37.4.0 — Системний QA Чекап (2026-03-22)

### QA [claude-code]
- **Version bump** — 37.3.0 → 37.4.0
- **Changelog entry** — 13 пунктів всіх змін сесії
- **Cache-bust** — ?v=37.4.0 на всіх 30 HTML сторінках

---

## v37.3.0 — Sidebar Always Expanded (2026-03-22)

### UX Change [claude-code]
- **Collapse видалено** — display:none !important
- **Всі 5 груп відкриті** — defaultOpen: true (CRM, Управління, HR, Творче, Система)
- **localStorage очищено** — pzp_sidebar_collapsed + pzp_sidebar_groups removed on init

---

## v37.2.0 — HR Group in Sidebar (2026-03-22)

### Navigation [claude-code]
- **Нова 5-а група** — HR (🤝) з Графік, Команда, Кадри, Навчання
- **Навчання** — переміщено з CRM до HR групи
- **Управління** — залишено тільки бізнес-елементи (Клієнти, Ліди, Фінанси, Аналітика, Звіти, AI)

---

## v37.1.0 — Sidebar Responsive Fix (2026-03-22)

### Responsive [claude-code]
- **Root cause** — group labels з uppercase + letter-spacing:1.2px overflow 220px sidebar
- **layout.css** — letter-spacing 1.2→0.8px, text-overflow:ellipsis
- **Tablet (769-1023px)** — font 12px, group label 9px для 200px sidebar
- **Mobile (≤768px)** — accordion groups в collapsed off-canvas sidebar 280px

---

## v37.0.0 — UI Polish Bundle (2026-03-22)

### 7 Improvements [claude-code]
- **Profile** — null-safe getElementById для currentUser
- **Афіша** — 🎭 кнопка додана до timeline top-bar
- **Statistics** — приховано з dropdown menu
- **History** — видалено дублікат з dropdown (залишено тільки sidebar)
- **sound.html** — нова сторінка з Library/Projects/Upload табами
- **routes/sound-library.js** — CRUD API для звуків
- **designer.html** — нова сторінка з 5 табами (Catalogs, Guideline, Brand Book, Styleguide, Templates)

---

## v36.0.0 — Decision Screen (2026-03-22)

### Центр прийняття рішень [claude-code]
- **decisions.sql** — PostgreSQL таблиця з пріоритетами, джерелами, індексами
- **routes/decisions.js** — 4 ендпоінти: GET pending, POST create, PUT approve/reject/defer, GET history
- **js/decision-screen.js** — IIFE модуль з локальними утилітами, блокуючий overlay на Dashboard
- **css/decision-screen.css** — overlay z:99999, sticky header, card animations
- **Priority cards** — critical (red), important (yellow), normal (blue)
- **Dark mode** — повна підтримка

### v36.1.0 — Decision Screen for All Roles [claude-code]
- Зняте обмеження по ролях для /pending, /:id/:action, /history

### v36.2.0 — Seed Decisions [claude-code]
- **Migration 116** — 3 тестових рішення (critical/important/normal) для першого деплою

---

## v35.1.0–v35.11.0 — Sidebar Polish & Site Health (2026-03-22)

### Sidebar Improvements [claude-code]
- **v35.1.0** — чисті emoji іконки (прибрано gray badge box), додано /reports до Управління
- **v35.2.0** — compact nav-links (padding 10→7px, font 14→13px), smart defaultOpen (тільки активна група)
- **v35.3.0** — додано Каталоги до Творче групи, фікс user card onclick
- **v35.4.0** — видалено improvementFab (перекривав Клешню)
- **v35.5.0** — 🌙/☀️ theme toggle кнопка в sidebar

### API & Page Fixes [claude-code]
- **v35.6.0** — API bugfixes: copilot columns (updated_at→last_contact_at, full_name→name), warehouse route ordering
- **v35.7.0** — додано /copilot до PAGE_ACCESS в auth.js
- **v35.8.0** — unified sidebar на всіх 24 сторінках
- **v35.9.0** — фікс blank copilot page (auth flow broken — тепер робить свій apiVerifyToken)

### Site Health [claude-code]
- **v35.10.0** — CSS cache bust + Nunito font на всіх 27 сторінках
- **v35.11.0** — full site health fix: overlays, scripts, fonts, versions (0 remaining issues)

---

## v35.0.0 — Sidebar Full Rebuild (2026-03-22)

### Sidebar Accordion Groups [claude-code]
- **Accordion Navigation** — 4 групи (CRM, Управління, Творче, Система) з CSS grid-template-rows анімацією
- **Unified Nav** — однакове sidebar меню на всіх 24 сторінках замість різних hub-dropdown
- **Collapse Button** — `sidebarCollapseBtn` додано на всі 23 standalone сторінки
- **Nav Icons** — збільшено emoji розмір (15px → 17px collapsed), scale(1.08) анімація при hover

### Cross-Page Actions [claude-code]
- **Афіша/Сертифікати/Налаштування** — кнопки працюють з будь-якої сторінки через `?open=` auto-open
- **`sidebarOpen*` helpers** — якщо на таймлайні → модалка, якщо на іншій сторінці → redirect `/?open=`
- **`_checkAutoOpen()`** — app.js читає `?open=` параметр і відкриває панель після ініціалізації

### New Routes [claude-code]
- **`/afisha`** → redirect 302 → `/?open=afisha`
- **`/certificates`** → redirect 302 → `/?open=certificates`
- **`/designer`** → sendFile або redirect → `/art`
- **`/sound`** → sendFile або redirect → `/`
- **PAGE_ACCESS** — додано `/designer`, `/sound`, `/afisha`, `/certificates`

### Bugfixes (E1-E11) [claude-code]
- **E1** — `sidebar-group-inner { min-height: 0 }` для grid collapse анімації
- **E2/E6** — `#sidebarActions` приховано `display:none` (не видалено — app.js/auth.js мають обробники)
- **E3** — collapse button на всіх сторінках
- **E4/E5** — `showAfishaModal` / `openCertificatesPanel` graceful з redirect
- **E7** — `/staff` двічі → `noActive: true` на "Команді" запобігає подвійному підсвічуванню
- **E8** — collapsed sidebar: `.sidebar-group-items { display: none }`
- **E9** — спрощений onclick без зайвого `window.X` дублювання
- **E10** — collapsed nav-link padding override
- **E11** — `toggleGroup` додано в `return {}`

### Dark Mode [claude-code]
- Accordion стилі: border, hover, arrow, group icon, vertical track
- Nav icon active: `box-shadow: 0 2px 8px rgba(16,185,129,0.25)`

### Infrastructure [claude-code]
- **8 unclosed `<div>` tags** — виправлено в changelog секції index.html (v20.0.0 → v12.3.0)
- **346/346 тестів pass**, 0 fail
- **31 файл змінено**, 654 insertions, 310 deletions

---

## v32.0.0 — Premium Каталог Випускних (2026-03-16)
- **Premium Catalog Redesign** — повний редизайн каталогу випускних на рівні друкованих каталогів 2025 [claude-code]
- **Geometric Mosaic** — CSS полігональний фон з унікальною пастельною палітрою для кожного з 7 пакетів [claude-code]
- **Info Cards** — нова структура: "ВИПУСКНИЙ" label + назва великим текстом + іконки ⏱ тривалість / 👥 діти / ₴ ціна [claude-code]
- **Services Card** — кольоровий акцентний блок з переліком послуг UPPERCASE [claude-code]
- **Description Card** — детальні описи кожної послуги (catalog_description) з DB [claude-code]
- **Fullscreen Viewer** — immersive перегляд з sticky topbar, навігація ◀▶, Escape/Arrow/Swipe [claude-code]
- **7 Package Themes** — лавандовий (best-dj), золотий (super-party), блакитний (science), м'ятний (handmade), жовтий (pizza), червоний (squid-game), рожевий (neon) [claude-code]
- **Print A4** — 1 пакет = 1 сторінка, geometric mosaic зберігається при друку, компактна типографіка [claude-code]
- **Export** — повний каталог (обкладинка + 7 сторінок) з premium дизайном для друку/PDF [claude-code]
- **Share** — Web Share API + clipboard fallback для поширення пакету [claude-code]
- **DB Migration 086** — min_kids/max_kids для пакетів, catalog_description для послуг [claude-code]
- **automation.test.js fix** — 28 тестів виправлено: додано 'auto_complete' до valid task type filter [claude-code]
- **Version sync** — всі 360 cache-bust ?v= тегів синхронізовані [claude-code]
- **SNAPSHOT.md** — повне оновлення з v24.3 до v31.8 з актуальними метриками [claude-code]

## v30.3.0 — Пошук, Шаблони, Повтори (2026-03-14)
- **Пошук по таймлайну** — Ctrl+F відкриває search bar, підсвітка знайдених блоків, навігація ▲▼ по результатах, авто-скрол, dimming непотрібних блоків [claude-code]
- **Redo + Hotkeys** — Ctrl+Z скасувати, Ctrl+Shift+Z / Ctrl+Y повторити, повний redo стек (до 10 дій) [claude-code]
- **Шаблони бронювань** — DB таблиця `booking_templates`, CRUD API `/api/booking-templates`, dropdown + кнопка 💾 у формі бронювання, лічильник використань, сортування по popular+favorites [claude-code]
- **Повторювані бронювання UI** — модалка з вибором патерну (щотижня, через тиждень, будні, вихідні, щомісяця), дні тижня, дата завершення. Кнопка 🔄 в деталях бронювання [claude-code]
- **Bulk-операції** — Shift+Click для multi-select блоків на таймлайні, floating action bar (видалити, підтвердити, зробити попередніми) [claude-code]
- **PDF експорт** — кнопка "Друк PDF" з print stylesheet (ховає UI, зберігає кольори блоків) [claude-code]
- **Міграція 075** — `booking_templates` таблиця з індексами на favorite та usage_count [claude-code]

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
