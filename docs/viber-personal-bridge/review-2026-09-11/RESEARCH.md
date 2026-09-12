# Viber Personal Bridge — повторна перевірка основи

Зріз: 2026-09-11, 18:58 UTC. **LIMITED для лабораторного прототипу; NO-GO для відправлення з Omni та повноцінного production inbox.** Production impact: no.

Це окремий результат поточної задачі. Наявні [попереднє дослідження](../RESEARCH.md), observer і звіти інших кроків не змінювалися. [Контракт](BRIDGE_CONTRACT.md) і [план](PROTOTYPE_PLAN.md) у цьому каталозі є пропозицією, а не реалізованим каналом.

## Рішення

Пріоритет — власний структурований read-only reader локальної Viber DB та незалежний, спочатку вимкнений, Desktop sender. Причина вибору reader: наявний локальний доказ двох різних подій з однаковим текстом; UIA-кандидат натомість ідентифікує повідомлення текстом. Готового надійного sender не знайдено. Копіювати цілий Windows/Matrix або macOS/MCP проєкт не рекомендовано.

До інтеграції потрібні три докази: отримання першого звернення невідомого контакту; підтвердження поточного Viber-акаунта; однозначна перевірка відкритого адресата без display name. Локальний ChatID, Windows SID, назва профілю чи відкритий compose box окремо цього не доводять. Якщо sender gate не проходить, результат залишається read-only/manual-assist, а не приховано небезпечним Send.

## Метод і межі доказів

| Позначка | Значення |
|---|---|
| A | Заявлено автором у README/issue; не наш тест |
| C | Підтверджено читанням коду на наведеному SHA |
| H | Наявний локальний звіт попереднього запуску; перечитаний, але запуск не повторений у цій задачі |
| R | Перевірено запуском у цій задачі: таких Viber-сценаріїв немає |
| U | Не перевірено або доказів недостатньо |

Виконано GET через GitHub connector: metadata, default-branch commits, recursive trees двох основних кандидатів, issues, потрібні файли. Запити пошуку: `viber bridge fork:true`, `viber personal`, `viber sqlite`, `viber-mcp fork:true` (перша сторінка до 30 результатів); додатково вебпошук personal bridge/Appium. Це обмежений публічний пошук, не доказ відсутності приватного рішення. Прямий GitHub API через локальну мережу був недоступний; connector успішно повернув дані. Непідтримуване читання API через web не використовувалося як доказ.

Чужий код, інсталятори, тести, APK і hook не запускалися; акаунт, сесія, пам'ять Viber, приватна DB, production API не відкривалися. Читали тільки наявні Markdown і redacted JSON-звіти. Попередні дозволи, описані у цих файлах, не використані як дозвіл нових дій.

## Кандидати на конкретних версіях

| Кандидат | SHA / останній default-branch commit | Ліцензія, ОС, залежності | Висновок |
|---|---|---|---|
| [rusty4444/viber-matrix-bridge](https://github.com/rusty4444/viber-matrix-bridge/commit/a69a755e0d63cd0d3bacadd32566af34d5fc47b0) | `a69a755e0d63cd0d3bacadd32566af34d5fc47b0`, 2026-06-11 | MIT, текст LICENSE прочитаний. Windows, Python; matrix-nio 0.25.2, aiohttp, aiosqlite, PyYAML, uiautomation, pywinauto, pyperclip, pywin32, psutil. Більшість залежностей лише з нижньою межею | A: підтримку припинено. C: реальний UIA read/send; не production bridge |
| [wawimundo/viber-mcp](https://github.com/wawimundo/viber-mcp/commit/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4) | `af1d0ed1b880dc28a18f2d5198a4d09b52047bd4`, 2026-07-08 | MIT, LICENSE прочитаний. Python ≥3.14, MCP ≥1.28.1, macOS PyObjC ≥12.2.1; uv.lock. A: macOS 15/26 Apple Silicon, Viber 28.2.0 | C: macOS automation/OCR; Windows backend — NotImplementedError. Немає готового Windows порту |
| [ibjelic/viber-linux-notifications](https://github.com/ibjelic/viber-linux-notifications/commit/036756f1845c6a175bb9bc8b5dc80b270db83363) | `036756f1845c6a175bb9bc8b5dc80b270db83363`, 2026-04-03 | MIT за metadata; Linux Flatpak, Qt6/C++, C, Bash, Python3; конкретний Viber build не встановлений | C: DB reader/notifications, не sender. Корисний reference для структури джерела |
| [fi3ik-mme/viber-android-automation](https://github.com/fi3ik-mme/viber-android-automation/commit/c6258fc4e904d47afe44cc8d20cd248a4131c22b) | `c6258fc4e904d47afe44cc8d20cd248a4131c22b`, 2026-08-05 | MIT за metadata; Android/Appium. Попередній аудит визначив Java 21/Appium client 10.1.1; dependency-файл повторно не перевірявся | C: пошук contactName та перший результат, потім Send; точний peer не доведений. Запасний окремий дослід |

[Windows requirements](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/requirements.txt), [macOS pyproject](https://github.com/wawimundo/viber-mcp/blob/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4/pyproject.toml), [Windows scaffold](https://github.com/wawimundo/viber-mcp/blob/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4/backends/windows.py). Транзитивний dependency/CVE-аудит не проводився. MIT-вимоги щодо notices потрібно зберігати при запозиченні коду; власний новий код не потребує копіювання всього upstream.

Metadata rusty4444: pushed_at 2026-07-27, але default-branch SHA від 2026-06-11; не плутати push інших refs із виправленням runtime. Обидва головні кандидати мають forks_count=0, network_count для rusty4444=0; покращеного прямого форка пошук не показав. Це не повний аудит усіх forks endpoints.

У rusty4444 отримано 49 issue/PR записів: 33 issues closed, 16 PR, два PR open (#48/#49, залежності). Історія [#31](https://github.com/rusty4444/viber-matrix-bridge/issues/31), [#32](https://github.com/rusty4444/viber-matrix-bridge/issues/32), [#33](https://github.com/rusty4444/viber-matrix-bridge/issues/33) документує збої селекторів і адресації; closed не означає наш PASS. У wawimundo та ibjelic issues API повернув порожній список.

Recursive trees головних кандидатів не містять набору tests. [CI rusty4444](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/.github/workflows/ci.yml) працює на Ubuntu/Python 3.12, а pytest має `|| true`; це не Windows/Viber E2E gate. У wawimundo workflow у дереві немає. Фактичні workflow runs у цій задачі не перевірялися.

## Підтверджені проблеми коду

| ID | Симптом / мінімальний сценарій | Доказ C | Вплив / вимога до нашого рішення |
|---|---|---|---|
| C1 | Два контакти з однаковим ім'ям; пошук не має збігу | Windows [вибір рядка](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/viber_client.py#L1211): допускається topmost без збігу, перевіряється pane/input | Неправильний адресат. Тільки точний locator + перевірка фактично відкритого peer |
| C2 | Новий контакт пише першим | [scan](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/bridge.py#L155) перебирає лише mappings | Немає шляху для нового inbox; потрібен окремий discovery gate |
| C3 | Два однакові тексти; restart; marker поза viewport | [state](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/state.py#L39) dedup за name/sender/text; [reader](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/viber_client.py#L1532) тримає marker в RAM, на першому read нічого не повертає | Втрата distinct occurrences/backlog. Потрібні source identity і durable outbox |
| C4 | Відповідь із телефона/Desktop або збій пересилання | scan пропускає outgoing; reader просуває marker раніше ACK | Неповна історія. Зберігати external outbound, атомарно journal+cursor, не покладатися на content-hash echo |
| C5 | Timeout/exception після Send | [send](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/viber_client.py#L1558) повертає True після gesture, False при exception | True не receipt, False може бути unknown. Durable dispatch marker до gesture, без повтору |
| C6 | Timeout UI thread, потім друга команда | [bridge](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/bridge.py): wait_for(to_thread) та lock | Скасування coroutine не зупиняє thread. Supervisor має дочекатися припинення worker до наступної UI operation |
| C7 | macOS відкрив старий чат; текст українською | [send logic](https://github.com/wawimundo/viber-mcp/blob/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4/viber_send.py#L95) приймає compose placeholder/timeout settle; signature коротше 6 ASCII symbols дає True | Немає доказового peer verification; OCR success не receipt |
| C8 | macOS нове повідомлення/історія | [OCR](https://github.com/wawimundo/viber-mcp/blob/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4/viber_ocr.py) повертає рядки вікна, включно з sidebar | Не структурований event stream, немає стабільних IDs/ACK |
| C9 | Linux restart, muted/outgoing, тимчасово відсутній JOIN | [daemon](https://github.com/ibjelic/viber-linux-notifications/blob/036756f1845c6a175bb9bc8b5dc80b270db83363/scripts/viber-notify#L100) відсіює частину подій і бере нову baseline | Notifications не lossless inbox. Переписати collector, не переносити restart/filter policy |

Для C6 повторно прочитано [реалізацію timeout](https://github.com/rusty4444/viber-matrix-bridge/blob/a69a755e0d63cd0d3bacadd32566af34d5fc47b0/scripts/bridge.py#L229); concurrency runtime не виконувався. Linux [query helper](https://github.com/ibjelic/viber-linux-notifications/blob/036756f1845c6a175bb9bc8b5dc80b270db83363/src/viber_query.cpp#L45) приймає довільний SQL/ключ із env, не встановлює явний read-only mode в прочитаному блоці. Цей helper не слід запускати як наш production reader. Сесія й доступ до DB мають залишатися локальними; ця задача не видобувала ключів.

## Відсіяні підходи й форки

| Проєкт | Класифікація й перевірка | Результат |
|---|---|---|
| [RegionallyFamous/mautrix-viber](https://github.com/RegionallyFamous/mautrix-viber/blob/5b2fb19ec879e7efee349ad02a803650ea050633/internal/viber/send.go#L145), fork directentis1/mautrix-viber | C: запит `/pa/send_message` на Bot API. Форк знайдений повторним пошуком, його code delta цього разу не аналізувався | Не personal client |
| serhiizghama/viber-mcp, fork [kidfrommorgue/viber-mcp](https://github.com/kidfrommorgue/viber-mcp) | H: Bot API config; поточна metadata форка прямо описує Bot API | Не плутати з wawimundo |
| [we-digital/android-nomad-gateway](https://github.com/we-digital/android-nomad-gateway), pppscn/SmsForwarder | A/H: Android notification forwarding; не повторний повний code review | Не підтверджують двосторонній Viber inbox, files або new-contact identity |
| [ned-kelly/viber-franz](https://github.com/ned-kelly/viber-franz) | A/H: Linux Viber у remote GUI/noVNC | Віддалений робочий стіл, не API моста |
| [R4Ajeti/n-relay-bridge](https://github.com/R4Ajeti/n-relay-bridge) | A: PWA передає текст у Viber для ручного Send. Metadata: push 2026-08-15, license=null | Не автоматичний приймач/відправник; не копіювати без ясної ліцензії |
| [mbv06/ViberDBViewer](https://github.com/mbv06/ViberDBViewer), ViberExtractor та його форки | A/H: offline DB browsing/export | Можуть допомогти зі schema, не доводять live personal transport |

## Покриття потрібних сценаріїв

| Сценарій | Поточний доказ / залишок |
|---|---|
| Новий невідомий контакт | C2 не підтримує; локальний NEW=0 (H). U, блокер повного Omni |
| Account/chat/recipient, однакові імена, rename | C1/C7 небезпечні; local account/recipient_verified=false. U, блокер Send |
| Однакові повідомлення поспіль | C3 втрачає; локальний reader має H-доказ двох distinct DUP та local ACK, не загальну повноту |
| Вихідні CRM/phone/Desktop, echo | C4; PHONE/DESKTOP=0 у локальному run, direction semantics false. U |
| Конкуренція, новий inbound, manual focus | C6; реальні race tests U; жоден mutex не контролює фізичний input користувача |
| Timeout після Send | C5/C7; потрібне unknown, жодних автоматичних повторів |
| Restart/offline | Windows marker RAM; локально H доведено тільки fresh-reader/local ACK, не Viber restart/relink/upgrade |
| Lock/RDP | [pywinauto remote guide](https://pywinauto.readthedocs.io/en/latest/remote_execution.html) описує обмеження input/active desktop. Поведінка нашого DB reader під lock U; не узагальнювати на всі UIA reads |
| Viber update | Немає compatibility gate. Exact build mismatch повинен вимикати sender до повторної перевірки |
| Фото/PDF | Двосторонній binary pipeline у обраних Desktop основах не доведений; attachments=false. Filename/thumbnail не bytes |

## Наявний локальний доказ, який не слід втратити

Прочитані [G1](../G1_REPORT.md), [G3](../G3_REPORT.md), [контракт](../BRIDGE_CONTRACT.md), [GitHub reuse](../GITHUB_REUSE_PLAN.md) та [redacted after-ACK JSON](../observer/G3_SID_AFTER_ACK_RESULT.json). Це H, не новий R.

G1 описує Viber 26.3.2 на Windows x64 build 26100.9445. G3 JSON: journal_total=2, acked=2, DUP=2, NEW/PHONE/DESKTOP/RENAME=0, missing_token_observations=2; recipient_verified=false, direction_semantics_verified=false, provider_delivery_verified=false, messages_sent=0, crm_contacted=false. Отже, структурований reader має вузький доказ, а `ChatInfo.Token` не можна робити обов'язковим універсальним chat ID. Назва Windows user/SID чи HMAC шляху не є Viber account identity.

## CRM і наступна дія

Поточний локальний checkout `5381d9a8799a7e31ab855ae586268944863a4a4f` має ahead 1 / behind 226 та чужі зміни HR/Hermes/UI; не оновлювався. Прочитані AGENTS, README, package, businessContext і пошукові зрізи Omni. Це не поточний live audit. Видимі canonical contexts: `event_genix` (PARK), `dar`; connection upsert за `(business_context, channel)`. Перед інтеграцією повторно звірити live SHA та routing на актуальному коді. Відсутність client_request_id у застарілому зрізі не означає його відсутності в production.

**Рекомендована наступна дія:** виконати тільки gate невідомого контакту й account/recipient identity на визначених тестових акаунтах. Не повторювати старий DUP із новою baseline без причини; підтвердити provenance та сумісність існуючих результатів. Не реалізовувати весь HTTPS/CRM канал до цього gate. Створено лише ці три документи; код CRM, observer, production secrets, права, schema та webhook не змінені.
