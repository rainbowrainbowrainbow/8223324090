# Viber Personal Bridge: технічне дослідження

> **Актуальний результат, 2026-09-11: LIMITED; NO-GO Send.** [Відновлення доступу без restart перевірено запуском](KEY_ORIGIN_REPORT.md); [G3 знайшов два однакові контрольні повідомлення й пройшов restart reader/local ACK](G3_REPORT.md). Немає RAM scan або перезапуску Windows/Viber. Наступні gates — невідомий контакт, Viber account identity і точний адресат. У контрольному чаті відсутній ChatInfo.Token; його універсальну наявність обіцяти не можна. [GitHub-відбір](GITHUB_REUSE_PLAN.md). Нижче збережено початковий аудит UIA-кандидатів; поточний пріоритет — власний read-only DB reader. [G1](G1_REPORT.md), [listener](G3_LISTENER_REPORT.md).

Дата зрізу: **2026-09-11**. Рішення: **LIMITED — лише ізольований прототип; NO-GO для повноцінного Omni на перевірених основах у поточному вигляді.**

Production impact: no. **Початковий статичний етап нижче** не запускав сторонній код і не підключав акаунти. Подальший дозволений G2 використовує власні helpers, офіційні Qt bindings у тимчасовому стенді й встановлений Viber plugin; реальних message/contact rows і Send не було. CRM не змінена. Контракт і тестовий план: [BRIDGE_CONTRACT.md](BRIDGE_CONTRACT.md), [PROTOTYPE_PLAN.md](PROTOTYPE_PLAN.md).

## 1. Висновок і вибір підходу

Для Windows рекомендується коротка **перевірка можливостей UI Automation** на окремій машині. `rusty4444/viber-matrix-bridge` придатний як джерело спостережень про Qt/UIA, селектори та невдалі підходи. Його цикл приймання, ідентифікацію за назвою й механізм надсилання не можна переносити без переробки. Matrix та MCP не потрібні між менеджером CRM і детермінованим worker.

Дві першочергові перешкоди: **доказове визначення відкритого адресата** і **виявлення першого повідомлення від неприв’язаного контакту**. У Windows-кандидата немає надійного рішення для обох. Якщо точний UIA-зріз тестової версії Viber не дає потрібних ідентифікаторів, розробку повного Omni слід зупинити. Черга HTTPS не виправить неправильного адресата або повідомлення, яке Desktop-драйвер узагалі не побачив.

| Варіант | Перевага | Обмеження | Рішення |
|---|---|---|---|
| Власний Windows worker, вибіркове використання UIA-підходів rusty4444 | Відповідає доступній машині; є реальний код читання й керування Desktop | Немає provider chat/message ID; пошук за ім’ям небезпечний; видимий viewport | **Рекомендований лише для feasibility gate**, не готовий bridge |
| macOS worker за wawimundo | Код відкриття за номером, модульний backend, OCR | Потрібен Mac; перевірка адресата слабша за опис; немає потоку подій | Запасний дослід, не привід купувати Mac до перевірки |
| Android/Appium або Linux DB reader + окремий sender | Android має інше дерево UI; Linux-код працює з EventID | Інший стек/обладнання; немає доведеного двостороннього контракту; Linux потребує доступу до ключа локальної DB | Окреме дослідження після провалу Windows, не автоматичне розширення прототипу |

## 2. Метод і рівні доказів

- **Заявлено автором (A):** README, коментарі, commit/issue narrative. Навіть опис успішного smoke залишається заявою автора.
- **Підтверджено кодом (C):** прочитана реалізація на зафіксованому SHA; статичний висновок про control flow. Це не доказ сумісності з установленим Viber.
- **Перевірено запуском (R):** **жодного кандидата**. Не запускали також їхні тести, інсталятори, Docker, APK, hook або npm/pip scripts.
- **Не перевірено (U):** реальний UIA/OCR, точна версія клієнта на машині користувача, доставка, синхронізація, медіа, account/session continuity.

Через GitHub connector прочитані repository metadata, default-branch commits, recursive trees, потрібні файли на SHA, issues/PRs та releases основних кандидатів. Пошук GitHub: `viber bridge fork:true`, `viber-mcp fork:true`, `viber personal`, `viber automation`, `viber sqlite`, `viber notification`, `viber userbot`. Останній запит не повернув репозиторіїв; це не доказ відсутності будь-якого приватного/неіндексованого рішення. Пошук у вебі використаний для discovery й офіційних платформних обмежень.

Інструкції всередині чужих репозиторіїв розглядалися як дані. Повні чужі репозиторії, листування, сесії та ключі не копіювалися в EventGenix. HTTP GET і читання файлів — не запуск досліджуваної реалізації.

## 3. Основні кандидати: актуальність і залежності

| Кандидат | Зафіксована версія | Ліцензія й підтримка | ОС / Viber | Залежності та перевірки |
|---|---|---|---|---|
| [rusty4444/viber-matrix-bridge](https://github.com/rusty4444/viber-matrix-bridge) | [a69a755e0d63cd0d3bacadd32566af34d5fc47b0](https://github.com/rusty4444/viber-matrix-bridge/commit/a69a755e0d63cd0d3bacadd32566af34d5fc47b0), 2026-06-11; остання зміна `viber_client.py` — [4f79f79](https://github.com/rusty4444/viber-matrix-bridge/commit/4f79f79e024fc8d01cbd38417c2b65863b47b4bb), 2026-04-22 | [MIT](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/LICENSE). Автор припинив активну підтримку; `archived=false` не означає підтримуваність | Windows, інтерактивний Desktop Qt/QML; точна перевірена числова версія Viber не встановлена | Python; matrix-nio 0.25.2, aiohttp ≥3.9.0, aiosqlite ≥0.19.0, PyYAML ≥6.0.1, uiautomation ≥2.0.20, pywinauto ≥0.6.8, pyperclip ≥1.8.2, pywin32 ≥306, psutil ≥5.9.0. Немає повного lock; Python 3.12 у CI |
| [wawimundo/viber-mcp](https://github.com/wawimundo/viber-mcp) | [af1d0ed1b880dc28a18f2d5198a4d09b52047bd4](https://github.com/wawimundo/viber-mcp/commit/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4), 2026-07-08; package 0.1.0 | [MIT](https://github.com/wawimundo/viber-mcp/blob/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4/LICENSE); не archived, але довгострокова підтримка не доведена | A: macOS 15/26, Apple Silicon, Viber 28.2.0. C: macOS реалізований, Windows methods — `NotImplementedError`, Linux не реалізований | Python ≥3.14; mcp[cli] ≥1.28.1; macOS-only PyObjC Cocoa/Quartz/Vision ≥12.2.1; є `uv.lock`. У дереві немає автоматизованих tests/CI |

Джерела залежностей: [Windows requirements](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/requirements.txt), [MCP pyproject](https://github.com/wawimundo/viber-mcp/blob/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4/pyproject.toml), [Windows scaffold](https://github.com/wawimundo/viber-mcp/blob/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4/backends/windows.py#L40). Залежності не встановлювалися, CVE-аудит транзитивного дерева не проводився.

GitHub metadata `pushed_at` для rusty4444 — 2026-07-27, для wawimundo — 2026-07-08. `pushed_at` охоплює інші refs; це не дата останньої зміни default-branch runtime. У першого останній default-branch commit додає CI, а не виправляє Viber.

### Issues, форки й сила CI-доказів

- rusty4444: отримано 49 записів issues API: **33 issues, усі closed; 16 PR, із них 2 open**. Відкриті [#48](https://github.com/rusty4444/viber-matrix-bridge/pull/48) і [#49](https://github.com/rusty4444/viber-matrix-bridge/pull/49) — dependency updates, а не підтвердження роботи GUI. Приклади предметної історії: [#17 — echo](https://github.com/rusty4444/viber-matrix-bridge/issues/17), [#31 — зміна QML selectors після restart](https://github.com/rusty4444/viber-matrix-bridge/issues/31), [#32 — неправильна прив’язка](https://github.com/rusty4444/viber-matrix-bridge/issues/32), [#33 — неправильний адресат](https://github.com/rusty4444/viber-matrix-bridge/issues/33). Closed — статус issue, не результат наших тестів.
- [CI rusty4444](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/.github/workflows/ci.yml): Ubuntu, ruff, `pytest --tb=short || true`; failures pytest не блокують цей крок. У дереві немає тестового набору; немає Windows/Viber E2E gate. Workflow runs у цьому дослідженні не перевірялися.
- wawimundo: issues API повернув порожній список; немає published GitHub releases. У rusty4444 releases також порожні. Це не свідчить про відсутність багів.
- Repository metadata обох основних кандидатів показує **0 форків**; GitHub search з `fork:true` не знайшов покращеного прямого форка. Пряме читання `/forks` connector відхилив як непідтримуваний endpoint, тому результат обмежено metadata + пошуком, не повним network audit.

## 4. Ключові статичні знахідки

### Windows: rusty4444

**C1 — chat identity = display name.** У [state.py](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/state.py#L19) primary key `mappings.viber_name`. Немає provider account ID, chat ID або peer ID. Пошук допускає exact/prefix/substring/all-words, далі topmost row без збігу; однакові імена не розрізняються. [Вибір рядка й перевірка](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/viber_client.py#L1211) підтверджують наявність pane/input, а не особу адресата; після невдалої перевірки є `return True`. Коментар про безпечність такого fallback — твердження автора, яке не підтверджує identity.

**C2 — приймання лише mapped chats, без inbox discovery.** [Bridge._scan_viber](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/bridge.py#L155) перебирає наявні mappings. [Selectors](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/viber_selectors.py#L9) описують рядки списку без доступних імен/дітей. Нове невідоме звернення не має автоматичного шляху до Matrix.

**C3 — повтори й restart втрачають події.** [Reader](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/viber_client.py#L1532) тримає `_last_seen_per_chat` тільки в пам’яті, marker — останній текст. Перший read запам’ятовує останній текст і повертає порожній список; restart не відновлює durable cursor. Якщо marker зник, повертається лише друга половина видимих messages. SQLite [hash_msg](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/state.py#L39) = chat name + sender + stripped text: дві різні події з однаковим текстом мають один hash. До очищення seen-cache друга відкидається; це видно з умов у `_scan_viber`, без запуску.

**C4 — немає durable outbox.** Reader просуває текстовий marker до успішного `matrix.send_text`. Якщо відправка в Matrix завершується помилкою, `mark_seen` може не відбутися, але наступне читання вже починає після marker. Крім того, `MatrixClient.send_text` не перевіряє тип відповіді `room_send`. SQLite mappings/seen-cache не є чергою подій до ACK. Повний backlog після офлайн не забезпечений.

**C5 — echo і зовнішні вихідні повідомлення.** `_scan_viber` після content-hash suppression виконує `if m.outgoing: mark_seen(...); continue`. Отже, коректно розпізнана відповідь із телефона/Desktop не потрапляє в історію; при помилковій геометричній класифікації може з’явитися як вхідна. Sender-independent `consume` може поглинути однакову відповідь співрозмовника. Вихідний hash записується ще **до** Send, навіть коли Send не відбудеться. Власний callback Matrix не використовує `event_id` для durable command dedup. README-обіцянка нормального forward повідомлень із телефона не узгоджується з цим кодом.

**C6 — `True` означає спробу input.** [send_message](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/viber_client.py#L1558) очищує draft, вставляє текст, клікає Send або натискає Enter і повертає `True`. Немає acknowledgement Viber, перевірки provider message ID або доставки. Exception після click повертає `False`, хоча повідомлення вже могло піти. Автоматичний resend у CRM за таким `False` створить дубль.

**C7 — lock корисний, але неповний.** У `bridge.py` є `_viber_lock`. `_viber_call` використовує `wait_for(to_thread(...))`: timeout coroutine не зупиняє underlying thread, який може продовжувати UI input після звільнення lock. Це ризик перекриття наступної операції. Manual input не захищений lock. Reader у scan синхронний і може затримувати event loop. Команди `scan` та частина attach також не охоплені однаковим guard.

**C8 — runtime poll toggle суперечить README.** `_viber_loop` перевіряє `poll_enabled` перед циклом: якщо стартує off, нескінченно спить; якщо on, наступні ітерації не перевіряють toggle. Команда `!poll` змінює тільки config у пам’яті. Заявлене перемикання on/off під час роботи цим кодом не реалізоване.

### macOS: wawimundo

**C9 — номер для navigation є, перевірки точного відкритого номера немає.** [resolve_recipient/open_chat](https://github.com/wawimundo/viber-mcp/blob/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4/viber_send.py#L67) приймають E.164 або локальний alias і відкривають `viber://chat?number=...`. Але `_wait_for_sendable_chat` приймає перше слово імені будь-де в OCR, будь-який `type a message`, або чотири секунди без error screen для номера. Старий відкритий чат теж може задовольнити ці умови. Це не fail-closed recipient verification. [Search scoring](https://github.com/wawimundo/viber-mcp/blob/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4/viber_send.py#L288) вибирає верхній із рівноцінних збігів; однакові назви лишаються неоднозначними.

**C10 — read повертає OCR-рядки вікна, не повідомлення.** [viber_ocr.py](https://github.com/wawimundo/viber-mcp/blob/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4/viber_ocr.py#L22): `read_open_chat` не відрізає sidebar; `list_chats` відбирає ліві 30% вікна. [MCP server](https://github.com/wawimundo/viber-mcp/blob/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4/server.py) — on-demand tools, без inbox watcher, durable event IDs, cursor, outbox, command journal чи global operation lock. `reply` надсилає в поточний чат без адресата.

**C11 — OCR verification дає хибну впевненість.** [Verification](https://github.com/wawimundo/viber-mcp/blob/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4/viber_send.py#L152) бере до 24 ASCII alphanumeric символів; якщо їх менше шести, `_text_landed` повертає `True`. Український або emoji-only текст не перевіряється змістовно. Старий такий самий текст також може збігтися. `send_message` повертає `sent: true` незалежно від `verified: false/null`, якщо сам click не кинув exception. Немає receipt.

## 5. Покриття сценаріїв

Усі результати нижче — **C / статичний висновок або U**, а не R.

| Сценарій | rusty4444 Windows | wawimundo macOS | Наслідок для прототипу |
|---|---|---|---|
| Новий невідомий контакт | Немає discovery, лише mappings | OCR може показати новий видимий рядок; немає event pipeline/стійкого peer ID | Блокер повного Omni; manual pairing не є проходженням цього тесту |
| Account/chat/peer identity | Назва як key; session provenance відсутня | Введений номер відомий, відкритий peer не доведений | Локальні UUID + окремий доказ identity; за неоднозначності Send заборонений |
| Однакові імена / rename | Collisions, старий mapping більше не знаходить той самий peer | Aliases допомагають navigation; OCR/search tie лишається | Ніколи не робити dedup/link за display name |
| Два однакові тексти | Text marker і hash можуть втратити другий | Лише OCR snapshot, розрізнення occurrence не реалізоване | Два різні occurrence ID; transport dedup тільки за event ID |
| CRM + телефон + Desktop | Suppression/skip outgoing гублять або неправильно позначають події | Немає reconciliation | Зовнішні outbound зберігати; невідоме походження не вигадувати |
| Concurrent commands / focus / новий рядок | Lock не захищає від людини, таймаутованого thread чи reorder | Немає global lock; координатні clicks | Один worker; revalidation безпосередньо перед side effect; втручання → pause |
| Timeout після Send | `False`/exception не означає відсутність доставки | `sent/verified` не є receipt | `unknown`, durable terminal result, без blind retry |
| Restart / офлайн | Cursor у пам’яті, перший read пропускає історію, outbox відсутній | Persistence та recovery відсутні | Journal/outbox + явний capture gap; гарантія лише вже збереженим подіям |
| Windows lock / RDP disconnect | Input/focus залежні від desktop session; recovery не доведений | Windows не реалізований | Блокувати GUI operations, heartbeat залишити; після unlock перевірка identity |
| Viber update / DPI / розмір | Префікси допомагають, але лишаються geometry fallbacks | Pixel offsets, англійські OCR markers | Version fingerprint, pause при зміні, повтор acceptance matrix |
| Фото / PDF | Текстові bubbles; немає binary pipeline | OCR видимого тексту; немає download/upload API | `attachments=false`; preview/filename ≠ файл |
| Повна історія / delivery receipts | Не реалізовані | Не реалізовані | Не обіцяти ні history completeness, ні delivered/read |

Обмеження input на locked/disconnected RDP та service sessions підтверджені [документацією pywinauto](https://pywinauto.readthedocs.io/en/latest/remote_execution.html). Це обмеження застосованих методів, не твердження, що будь-який UIA read завжди неможливий при lock. Офіційно Viber Desktop потребує попередньої реєстрації на телефоні; Windows 10 x64/11 зазначені у [supported platforms](https://help.viber.com/hc/en-us/articles/9210039148189-Supported-platforms). Підтримка ОС самим Viber не підтверджує підтримку automation-кандидатом.

## 6. Інші проєкти та форки: класифікація за кодом

| Проєкт / SHA / дата commit | Клас і докази | Придатність |
|---|---|---|
| [fi3ik-mme/viber-android-automation](https://github.com/fi3ik-mme/viber-android-automation/commit/c6258fc4e904d47afe44cc8d20cd248a4131c22b), 2026-08-05 | MIT; Java 21, Appium Java client 10.1.1, SLF4J 2.0.16; adb/emulator, host scripts Windows/POSIX. [SendMessageScenario](https://github.com/fi3ik-mme/viber-android-automation/blob/c6258fc4e904d47afe44cc8d20cd248a4131c22b/src/main/java/viber/automation/scenarios/SendMessageScenario.java#L27) шукає contactName й відкриває first result; [ChatPage](https://github.com/fi3ik-mme/viber-android-automation/blob/c6258fc4e904d47afe44cc8d20cd248a4131c22b/src/main/java/viber/automation/pages/ChatPage.java#L30) натискає кнопку/Enter. Є community DOM collection, profile parsing, image processing | Справжнє керування UI особистого клієнта, не notification forwarding. Але не готовий двосторонній bridge: send не доводить адресата/receipt; merge повідомлень евристичний. Числова версія Viber/Android compatibility не доведена; bundled APK не завантажували/не аналізували |
| [ibjelic/viber-linux-notifications](https://github.com/ibjelic/viber-linux-notifications/commit/036756f1845c6a175bb9bc8b5dc80b270db83363), 2026-04-03 | MIT; Linux Flatpak, Qt6/C++, C, Bash, Python3. [Query code](https://github.com/ibjelic/viber-linux-notifications/blob/036756f1845c6a175bb9bc8b5dc80b270db83363/src/viber_query.cpp) використовує драйвер Viber, [daemon](https://github.com/ibjelic/viber-linux-notifications/blob/036756f1845c6a175bb9bc8b5dc80b270db83363/scripts/viber-notify#L156) читає Events/Messages з EventID та Direction | Потенційно корисніший напрям для стабільного source identity; лише reader/notifications, sender відсутній. На restart baseline береться від MAX(EventID); не готовий lossless outbox. Ключ/пам’ять/бінарники не чіпали. Немає доказу сучасної числової версії Viber або перенесення на Windows |
| [RegionallyFamous/mautrix-viber](https://github.com/RegionallyFamous/mautrix-viber/commit/5b2fb19ec879e7efee349ad02a803650ea050633), 2025-11-11; fork [directentis1](https://github.com/directentis1/mautrix-viber/commit/5b2fb19ec879e7efee349ad02a803650ea050633) має той самий HEAD | Go 1.24, mautrix 0.25.2, sqlite3, Redis, OpenTelemetry. LICENSE — коротка декларація Apache 2.0, metadata `NOASSERTION`, не повний текст ліцензії. [Client](https://github.com/RegionallyFamous/mautrix-viber/blob/5b2fb19ec879e7efee349ad02a803650ea050633/internal/viber/client.go#L22) явно Bot API; [send](https://github.com/RegionallyFamous/mautrix-viber/blob/5b2fb19ec879e7efee349ad02a803650ea050633/internal/viber/send.go#L145) викликає `/pa/send_message` | **Bot API — виключити.** Назва mautrix та великий README не доводять personal login. `BackfillChatHistory` у [backfill.go](https://github.com/RegionallyFamous/mautrix-viber/blob/5b2fb19ec879e7efee349ad02a803650ea050633/internal/viber/backfill.go#L31) не отримує історію |
| [serhiizghama/viber-mcp](https://github.com/serhiizghama/viber-mcp/commit/886f261cabf2a3192a31810d1dca63f4ba951d65), 2026-08-29; fork [kidfrommorgue](https://github.com/kidfrommorgue/viber-mcp/commit/f53ebde3d4e153052c26245bdee7badc3b598187), 2026-06-11 | MIT; Node ≥20, MCP SDK ^1.29.0, Zod ^4.4.3, pnpm lock. [Config](https://github.com/serhiizghama/viber-mcp/blob/886f261cabf2a3192a31810d1dca63f4ba951d65/src/config.ts#L10) вимагає Bot token і `chatapi.viber.com/pa`; дерево форка зберігає Bot tools | **Bot API — виключити**, хоч назва збігається з personal macOS MCP. Реалізація send-file тут не доводить personal attachments |
| [pppscn/SmsForwarder](https://github.com/pppscn/SmsForwarder/commit/ce931a03739a6a2b0dfc83161bf812a94fd5e45e), 2026-07-27 | BSD-2-Clause за metadata; Android Kotlin/Gradle, AndroidX/Room/WorkManager/Retrofit. [NotificationService](https://github.com/pppscn/SmsForwarder/blob/ce931a03739a6a2b0dfc83161bf812a94fd5e45e/app/src/main/kotlin/cn/ppps/forwarder/service/NotificationService.kt#L49) читає `EXTRA_TITLE/TEXT/BIG_TEXT` | **Android notification forwarding**, не повний Viber inbox. Viber-specific compatibility та reply не перевірені; SMS-функції не означають Viber-send |
| [ned-kelly/viber-franz](https://github.com/ned-kelly/viber-franz/commit/0d2260483493123f43ae77d8fd6182c079e3d5a2), 2018-08-15 | MIT за metadata; Docker Ubuntu bionic, Qt5, TigerVNC/noVNC, Franz. [Dockerfile](https://github.com/ned-kelly/viber-franz/blob/0d2260483493123f43ae77d8fd6182c079e3d5a2/viber-docker/Dockerfile) перепаковує Viber Linux package | Віддалений GUI особистого акаунта, **не API/event bridge**. 8 форків у metadata, знайдені пошуком, але їхні runtime не пройшли повний review. Старий remote desktop wrapper не вирішує identity/ACK |
| [ptmorris03/ViberExtractor](https://github.com/ptmorris03/ViberExtractor/commit/d9cfcc3754145e9b6fb37158ad92a27799038c55), 2021-09-14 | GPL-3.0 за metadata; Python stdlib sqlite3. [main.py](https://github.com/ptmorris03/ViberExtractor/blob/d9cfcc3754145e9b6fb37158ad92a27799038c55/main.py#L67) читає supplied SQLite DB | Лише offline export старої схеми; ні personal session client, ні sender, ні доказ читання нинішньої encrypted DB |
| [R4Ajeti/n-relay-bridge](https://github.com/R4Ajeti/n-relay-bridge/commit/b7ef03881eb1889dff44e69fe148d6c1572152c1), 2026-08-15 | JS/PWA/Firebase; ліцензію в metadata/tree не знайдено. [app.js](https://github.com/R4Ajeti/n-relay-bridge/blob/b7ef03881eb1889dff44e69fe148d6c1572152c1/src/app.js#L583) створює `viber://forward?text=...` | Handoff у програму з вибором/діями користувача; **не двосторонній Viber transport** |

Для Android/Appium, Linux reader та RegionallyFamous issues API повернув порожні списки; для serhiizghama — один closed PR, без issues. Metadata: Android і Linux reader мають по 0 форків; RegionallyFamous і serhiizghama — по 1, зазначені вище. Для відсіяних SmsForwarder/Franz/Extractor не проводився повний issue/network/dependency security audit; Viber-specific версії не встановлено. Жоден додатковий проєкт не перевірявся запуском.

Android notification key і назва з notification не тотожні Viber chat ID. Події залежать від того, що Viber опублікував у notification; тиша, прихований preview, групування й активний чат можуть залишити прогалини. `RemoteInput` — механізм відповіді через наявну action, не загальний Viber API адресації. Джерела: [NotificationListenerService](https://developer.android.com/reference/android/service/notification/NotificationListenerService), [Android notification reply actions](https://developer.android.com/develop/ui/views/notifications/build-notification#reply-action). Сценарій нового невідомого контакту і фото/PDF цим не доведений.

Офіційний [Viber REST Bot API](https://developers.viber.com/docs/api/rest-bot-api/) працює з bot token та subscriber IDs. Personal number акаунта адміністратора не перетворює bot endpoint на personal inbox. Публічного підтримуваного personal-client API у перевірених джерелах не знайдено. Це не твердження про всі можливі закриті продукти.

## 7. Контекст EventGenix і межі майбутньої інтеграції

Локально прочитані `README.md`, `package.json`, `services/omni-viber.js`, `services/omni-hub.js`, `services/omni-accounts.js`, `services/businessContext.js`, `routes/omnichannel.js`, `tests/omni-send-truth.test.js` та Omni workflow docs. Локальний HEAD: `5381d9a8799a7e31ab855ae586268944863a4a4f`; tracking status на початку: ahead 1 / behind 171. Гілку не оновлювали, чужі зміни Hermes/taskReschedule/tests та інші untracked документи не чіпали. Це **не аудит поточного production**.

Видимий `services/omni-viber.js` — чинний **Bot API** adapter, його не слід підмінювати personal bridge непомітно. В `omni-hub` є збереження send truth, включно з unknown. Контекст задачі про `client_request_id` приймається як вимога: у цьому застарілому локальному send-route/flow він не знайдений, тому актуальну реалізацію треба звірити перед окремим інтеграційним релізом, не заявляти її відсутність у live CRM.

Локальні canonical business keys: `event_genix` для PARK та `dar` для DAR. У протоколі використовуються ці ключі, а не довільні labels. Bridge credential прив’язується рівно до одного business/account/bridge; невідома або пропущена scope не має мовчки переходити в PARK через existing normalize fallback. Ідентичний номер/чат у різних scope не зливається.

Окремий майбутній adapter має зберігати `client_request_id`, асинхронні results, external outbound events та невизначеність доставки; **жодної автоматичної відповіді** після inbound. Account diagnostics/heartbeat не можна прирівняти до receive readiness. Зміни auth/API/DB, provisioning та production — окремий погоджений реліз після проходження gates.

## 8. Межа GO

**GO для лабораторного кроку:** прочитати UIA тестового акаунта, встановити, чи можна без імені/координат однозначно звірити account та peer і побачити новий unpaired чат. Встановлення software і test-account дії — тільки наступний етап.

**LIMITED:** доказів вистачає лише для явно прив’язаних, однозначно розпізнаних текстових чатів з оператором. Відомі gaps показуються; attachments/history/receipts не обіцяються. До identity gate навіть цей режим лишається read-only/manual-assist.

**NO-GO для повного Omni зараз:** C1/C2/C3/C5/C9/C10 порушують базові вимоги; жодного R-доказу немає. Перейти до продукту можна лише після записаних результатів тестів, а не через додавання README, Docker чи HTTPS-обгортки.
