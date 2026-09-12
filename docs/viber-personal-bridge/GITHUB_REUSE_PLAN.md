# Власний Personal Viber Bridge: поглиблений GitHub-відбір і перевірка основи

Дата: **2026-09-11**. Production impact: no.

## Рішення

Користувач обрав продовжити перевірку **власного локального моста**. Hosted Wazzup/E-chat не є поточним напрямом реалізації. Вимога залишити сесію на машині моста зберігається.

**Обрана основа для вузького прототипу приймання — механізм Qt/QSQLITE доступу з `ibjelic/viber-linux-notifications`, MIT, commit `036756f1845c6a175bb9bc8b5dc80b270db83363`.** Використати його як довідник для невеликого перевіреного reader, а не запускати весь notification daemon. Незалежні schema references — MIT `mbv06/ViberDBViewer` і `abrignoni/ALEAPP`.

Це не готовий двосторонній міст. Готового компонента **personal send + незалежна перевірка адресата + повний inbox** у розширеному пошуку не знайдено. Пошук не доводить абсолютної відсутності такого коду, але не дає підстав інсталювати random sender чи називати upstream придатним для production.

Статус: **LIMITED; NO-GO для production Send до доказу адресації.** [G2](G2_REPORT.md) довів Windows Qt/SEE schema access, [G3](G3_REPORT.md) — початкові polls/restart reader зі збереженою baseline і 55 synthetic unit tests. Після операторського надсилання DUP параметр повторного відкриття DB не знайшовся навіть у завершеному дозволеному RAM scan: actual markers ще не прочитані. Поточна reacquisition не забезпечує безнаглядне відновлення. Наступний bounded дослід — операторський restart Viber й та сама session, без повторних повідомлень. [Evidence](observer/G3_DUP_RESULT.json). Sender, новий контакт і доставка не перевірені.

## Що додатково перевірено в GitHub

Основний пошук охопив 13 broad repository queries з `fork:true`: `viber userbot`, `viber desktop api`, `viber personal bridge`, `viber automation`, `viber protocol`, `viber database`, `viber desktop`, `viber client`, `viber unofficial`, `viber sqlite`, `viber decrypt`, `viber bridge`, `viber sender`. Для `viber client` прочитано дві сторінки. Результати — понад 200 різних repository names, **не 200 аудитів коду**: сторонні музичні/AI застосунки, bot SDK та повтори відсіювалися за metadata/деревом, релевантні реалізації — за кодом.

Code search: `viber://chat?number`, `ViberPC + EventInfo`, `viber + hexkey`, `com.viber.voip + conversation_id`; додатково перевірені native IPC (`QLocalSocket`, `WM_COPYDATA`, `QMetaObject`), Android AccessibilityService/send_text/phone_number_text та унікальні функції початкового bridge. Зроблено веб-пошук для discovery. GitHub code index неповний і переважно default-branch; порожня видача не дорівнює доказу неможливості.

### Початкові кандидати: нових виправлень немає

- **rusty4444**: [HEAD a69a755](https://github.com/rusty4444/viber-matrix-bridge/commit/a69a755e0d63cd0d3bacadd32566af34d5fc47b0), 2026-06-11; metadata `forks_count=0`, `network_count=0`. Перевірено 4 branches та 16 PR. Відкриті [PR48](https://github.com/rusty4444/viber-matrix-bridge/pull/48/files) і [PR49](https://github.com/rusty4444/viber-matrix-bridge/pull/49/files) змінюють тільки dependencies. Стара `fix/issue-7-admin-notice` стосується повідомлення Matrix, не Viber identity. Закриті [issue32](https://github.com/rusty4444/viber-matrix-bridge/issues/32) та [issue33](https://github.com/rusty4444/viber-matrix-bridge/issues/33) виправляють кліки/геометрію; fallback усе одно довіряє видимому стану без незалежного доказу номера.
- **wawimundo**: [HEAD af1d0ed](https://github.com/wawimundo/viber-mcp/commit/af1d0ed1b880dc28a18f2d5198a4d09b52047bd4), 2026-07-08; одна `main`, 0 PR/issues/forks/network. Нового Windows backend або event stream не виявлено.
- **ibjelic**: лише `master` на обраному SHA, PR collection порожня, 0 forks. **fi3ik**: одна `main` на попередньому SHA, PR collection порожня. Endpoint `/forks` обмежений connector; де доступні лише metadata counts, це не названо повним обходом fork network.

Їхні початкові runtime/dependency/license findings збережені в [RESEARCH.md](RESEARCH.md) та [ALTERNATIVES_DECISION.md](ALTERNATIVES_DECISION.md).

### Нові релевантні знахідки та відсів

| Проєкт / останній commit | Ліцензія / стек | Фактичний результат читання коду |
|---|---|---|
| [ron3545/spreadsheet_to_viber](https://github.com/ron3545/spreadsheet_to_viber/blob/f209caa9aa969304e15b7a9d7e1d4775279e9a7e/viber_ui.py#L191), 2026-07-03 | LICENSE не знайдено; Windows Python, pywinauto, Pillow/clipboard | Реальний personal Desktop sender. Пошук за ім’ям, перший рядок; перевірка header за substring. L243 пропускає recipient check, якщо header не читається. Enter → True без receipt. Inbox немає. Фото вставляє, доставку не доводить |
| [YevhenManushkin/ViberSender](https://github.com/YevhenManushkin/ViberSender/blob/c41673e7f8e0bc4fabb8e33716535c9677b3e810/WinApi.cs#L98), 2017-02-14 | LICENSE не знайдено; .NET4.6, System.Data.SQLite1.0.104, UIA/Win32 | Вводить номер, далі фіксовані координати Qt5 та Enter; exact active peer не звіряє. [DB status](https://github.com/YevhenManushkin/ViberSender/blob/c41673e7f8e0bc4fabb8e33716535c9677b3e810/ViberDB.cs#L31) — останній EventInfo за номером без кореляції з поточною командою. Це може бути попереднє повідомлення. Проєкт позначений як exported from assembly; не переносити код без визначеної ліцензії |
| [MShkretov/ViberMessageSender](https://github.com/MShkretov/ViberMessageSender/blob/de8a62da0675475abf4e0020238c4d0387c73d18/HotelBookingAPI/Services/ViberMessageService.cs#L16), 2023-08-19 | LICENSE не знайдено; C#/ASP.NET/EF | Метод `SendViberMessage` лише додає запис у власну БД. Це CRUD API, фактичного Viber send у перевіреному service немає |
| [rhcpist/viber-client-interface](https://github.com/rhcpist/viber-client-interface/blob/504ebc180220b382008c8089f69da59c21d1e621/modules/viber_sender.py#L118), 2017-06-06 | LICENSE не знайдено; Python/Tornado/HTTP | Send через Infobip `/omni/1/advanced`, власні кампанії. Не локальний персональний акаунт |
| [vm2mv/SQLite3-Encryption-Viber](https://github.com/vm2mv/SQLite3-Encryption-Viber/commit/0c89bb7a6449815db0ac43c7de7874285cc829e7), 2016-04-05 | [SQLite public domain + wxWindows Library Licence](https://github.com/vm2mv/SQLite3-Encryption-Viber/blob/0c89bb7a6449815db0ac43c7de7874285cc829e7/LICENSE.md); wxSQLite3.3.0, SQLite3.9.2, Premake | Fork `rindeal/SQLite3-Encryption`. Загальний AES codec/build wrapper; назва з Viber не доводить сумісності з Botan/Qt6 сучасного клієнта. Немає підтвердженого отримання Viber key, sender або event stream |
| [serkidb/viber-desktop-db-extractor](https://github.com/serkidb/viber-desktop-db-extractor/blob/cbf9ff88d60741e7796c33cccec85ca36422a732/src/main/java/DatabaseConnection.java#L34), 2019-06-19 | LICENSE не знайдено; Java/JDBC SQLite | Пряме `jdbc:sqlite` і `SELECT * FROM Contact`, експорт контактів. Не відкриває підтверджено поточну захищену БД, не отримує inbox і не надсилає |
| [coreply/coreply](https://github.com/coreply/coreply/blob/842957f5aeaf49ef5f95b136c062038bf6c80fe8/coreply-android/app/src/main/java/app/coreply/coreplyapp/applistener/SupportedApps.kt#L194), 2026-05-23 | AGPL-3.0; Android/Kotlin AccessibilityService; 17 forks за metadata | Є Viber selectors. [Reader](https://github.com/coreply/coreply/blob/842957f5aeaf49ef5f95b136c062038bf6c80fe8/coreply-android/app/src/main/java/app/coreply/coreplyapp/applistener/AppListener.kt#L87) бачить лише active window; `DROP_OLDEST`/debounce. Direction за геометрією, `Me/Others`, без IDs. Довідник accessibility, не повний bridge |
| [abrignoni/ALEAPP](https://github.com/abrignoni/ALEAPP/blob/eeb2d2c413b1c7b1d7918920651af0b53c9dcfec/scripts/artifacts/Viber.py#L185), 2026-09-10 | MIT; Python forensic parser | Структурований SQL для conversation ID, номерів, direction, attachments. Потрібні вже доступні DB-файли. Parser не виводить message `_id`/token і має INNER JOIN; не можна перенести як lossless reader. Live extraction/send відсутні |

В ALEAPP [sample metadata](https://github.com/abrignoni/ALEAPP/blob/eeb2d2c413b1c7b1d7918920651af0b53c9dcfec/scripts/artifacts/Viber.py#L65) автор називає Android16/Viber versionCode1281010 — 17 message rows; Android14/versionCode1233020 — 5051. Це корисний авторський evidence про сучасні Android DB, **не наша перевірка** і не proof нового контакта. Іншу функціональність forensic-проєкту, зокрема обробку hidden-chat PIN, до моста не включати.

Додатковий відсів:

- [duraki/viber-tcp-mitm](https://github.com/duraki/viber-tcp-mitm/blob/754e0fd3ad30ded4f8101a4f4cd0153454bb6df3/viber2proxy.py#L4), 2022-10-02, без LICENSE: raw TCP proxy із помилками constructor/forwarding, без protocol decode/identity/send.
- [gon1332/desktop-viber-scripts](https://github.com/gon1332/desktop-viber-scripts/blob/6ddd30c4caf959f8210f2d29a1e34d8a8f59e7fb/viber_ls_contacts.sh#L6), 2016-01-18, MIT: plaintext list/delete contacts; fork `demogorgonz` має той самий HEAD. Не виконувались.
- [iM-ALiX/ViberPy](https://github.com/iM-ALiX/ViberPy/tree/7f7fa37a150f27d9f81c78974d9e115ab743fb97), 2026-08-26, MIT: тільки README/LICENSE. Реалізації SDK немає.
- [shampadsharkar/Communicator-main](https://github.com/shampadsharkar/Communicator-main/blob/bb016bc79b7a67267de4e9c147f37419a3a61e10/Test/pages/viber_page.py#L128), 2021-10-20, без LICENSE: Android search phone → generic `chat_person` → Send; independent peer verification відсутня.
- [LDmitriy7/viber_poster](https://github.com/LDmitriy7/viber_poster/blob/c2448a2ff934917fc02da678813ad0e6a0d8c082/api/send_post.py), 2021-10-28, без підтвердженої ліцензії: pyautogui, title/coordinates/Enter, не inbox.
- `toantv/ViberDesktop`: API повідомляє empty repository; `intel1337/viber`: music player; `LaputanMachines/vibersvp`: volunteer RSVP через email/Twilio; `mlodybercik/viber`: audio fingerprinting. Назва не є доказом стосунку до Rakuten Viber.

## Факти з поточної Windows: виконано, не припущено

Перевірка власними read-only командами, без виконання чужого коду. [Машинний звіт](observer/G2_STATIC_PREFLIGHT.json).

| Перевірка | Результат | Що це доводить |
|---|---|---|
| Running Viber | Один процес; FileVersion `26.3.2-0-g1354dae28ea` | Версія саме поточного executable |
| Qt runtime і SQL driver | `Qt6Core.dll`, `Qt6Sql.dll`, `qsqlite.dll`: `6.8.3.0` | SQL-plugin присутній; є сенс дослідити Qt reader |
| Статична PE export table `qsqlite.dll` | 64 bit, лише `qt_plugin_instance`, `qt_plugin_query_metadata_v2`; 0 `sqlite3_*` exports | Простий direct SQLite FFI до цієї DLL не є готовим шляхом; потрібний Qt plugin mechanism. DLL не завантажувалась |
| Заголовок локальної `viber.db` | Один файл; прочитано тільки 16 байтів; стандартного `SQLite format 3` немає | Старий plain SQLite reader не можна вважати сумісним. Це **не визначає cipher/key** і не є тестом дешифрування |
| WSL | У registry 2 distro entries; `wsl --list --verbose` → `E_ACCESSDENIED` | WSL CLI існує, але працездатність Linux-середовища не встановлена; це не твердження, що Linux відсутній |

Жодного message row, номера/імені контакта, session token або ключа не прочитано в цьому preflight. Сирі байти заголовка й account directory paths не виводилися і не зберігалися. Viber не перезапускався; повідомлення не надсилались. Дані та executable не змінювались.

## Що беремо за основу і що пишемо самі

| Компонент | Джерело / рішення |
|---|---|
| Qt connection + encrypted DB query | [ibjelic `viber_query.cpp`](https://github.com/ibjelic/viber-linux-notifications/blob/036756f1845c6a175bb9bc8b5dc80b270db83363/src/viber_query.cpp#L53) — Linux code reference. Власний Windows Qt helper уже прочитав schema через встановлений SEE plugin; upstream як ціле не запускався. Це новий доказ [G2](G2_REPORT.md) |
| Структура event/chat/contact | [ibjelic SQL](https://github.com/ibjelic/viber-linux-notifications/blob/036756f1845c6a175bb9bc8b5dc80b270db83363/scripts/viber-notify#L156), [DBViewer Android reader](https://github.com/mbv06/ViberDBViewer/blob/daa7eac1e0c8fde3d14721fdc01397f447367d8a/app/src/main/java/com/mbv/viberdbviewer/data/AndroidViberDatabaseReader.kt#L46), ALEAPP як незалежна звірка. Desktop/Android schemas не змішувати |
| Доступ до key | [Linux hook](https://github.com/ibjelic/viber-linux-notifications/blob/036756f1845c6a175bb9bc8b5dc80b270db83363/src/hook_hexkey.c#L33) — лише reference; не запускати plaintext key writer. Користувач дозволив власний поточний акаунт. Власний bounded Windows RAM probe знайшов параметр; schema reader перевірив його без argv/env/file чи експорту. Повтор після restart/оновлення ще не доведений |
| Durable collector | Власний цикл за source ID/cursor; зберігати кожну occurrence до просування cursor; не залежати від memory scanner, unread, notification або текстового hash |
| Command journal / HTTPS | Вимоги [BRIDGE_CONTRACT.md](BRIDGE_CONTRACT.md); реалізовувати після доказу джерела. Не потрібні Matrix/MCP/LLM |
| Sender | **Придатного готового не знайдено.** Deeplink від wawimundo — кандидат тільки для навігації; exact active peer і результат Send потребують окремого доказу |

Не переносити з ibjelic: `setup.sh`, автозапуск, arbitrary SQL CLI, memory-text trigger, `eval` notification commands, старт із `MAX(EventID)`, фільтрацію outgoing/muted та plaintext key output. Не переносити text dedup/sent=True/невизначені timeout retries з UI sender-проєктів.

Для reader потрібні явний read-only open, обмежений набір параметризованих SELECT, короткі транзакції, busy timeout і зупинка при невідомій схемі. Qt документує [`QSQLITE_OPEN_READONLY`](https://doc.qt.io/qt-6/sql-driver.html#qsqlite-for-sqlite-version-3-and-above); synthetic fixture вже підтвердив відмову запису для саме встановленого Viber plugin. Тривала робота й recovery ще не перевірені. Не виконувати rekey, міграції, checkpoint або write-запити на Viber DB. Не копіювати лише main DB під час живого WAL і називати це узгодженим snapshot.

`EventID > cursor` — лише кандидат для читання нових записів, **не доведений change feed**. Монотонність ID треба перевірити. Receipt/status, редагування, видалення чи запізніле заповнення message row можуть змінити вже прочитаний запис. Перший дослід обмежений новими текстовими повідомленнями; неповні записи зберігаються як pending, а зміни/status потребують окремого reconciliation і тесту. Проходження new-message gate не означає повної синхронізації змін історії.

## Один конкретний експеримент замість повної розробки

**Мета:** довести читання структурованих подій із локального personal Viber та окремо визначити, чи існує безпечна адресація для sender. Reader success не відкриває Send автоматично.

**Поточне середовище:** наявний Windows ПК і власний Viber-акаунт користувача; дозвіл «мій використовуй все ок» покриває локальну read-only перевірку DB/key. Повторно вимагати окремий акаунт для цього самого доступу не потрібно. Qt 6.8.3 bindings підготовлені з перевірених офіційних wheels у тимчасовому стенді, CRM dependencies не змінені. B/C/D для контрольованих повідомлень ще потрібно визначити. Для постійного моста згодом потрібна окрема машина; Linux/VM тепер запасний варіант, не передумова продовження Windows-досліду.

1. **Доступ до даних — schema PASS, relations ще не перевірено.** [G2_SCHEMA_RESULT.json](observer/G2_SCHEMA_RESULT.json): один кандидат у RAM; no-key baseline не читається; нова read-only connection з кандидатом читає очікувані Events/Messages/Contact/ChatInfo поля. Тестові relations/IDs не вивчалися, реальних message/contact rows не запитували. Не називати цей успіх повноцінним inbox. Перед довгим collector потрібна перевірка повторного доступу після restart reader/Viber.
2. **Події — один контрольований сеанс.** D першим пише A; B надсилає два однакових тексти; B/C мають однакові імена, одне перейменовується; далі outgoing із телефона/Desktop, restart reader і короткий offline. PASS: кожна очікувана подія має окремий source ID, правильні chat/peer/direction, після restart немає втрат/повторів у власному journal. Невідомі типи не викидати мовчки. Локальні IDs прив’язувати до account/database epoch; relink не вважати автоматично тією самою нумерацією.
3. **Адресація — спочатку без Send.** Перевірити відкриття B/C за номером і незалежне підтвердження exact peer у поточному активному чаті при 30 чергуваннях, rename, фокусі/overlay. Ні successful deeplink, ні збіг display name, ні наявність цього контакта десь у DB не є підтвердженням активного адресата. Якщо такого джерела немає — sender лишається NO-GO, результат reader-only.
4. **Одна Send-спроба на команду — лише після gate 3 і визначення тестових адресатів/повідомлень.** Durable command journal перед input; account-level lock; timeout/crash після межі відправлення → unknown без retry. Після send корелювати саме новий event, не останній рядок за номером. Поява outgoing у локальній DB не означає доставку іншому пристрою. Статус delivered потребує окремого перевіреного receipt.

Загальний бюджет — **до двох робочих днів після готовності стенду**, без релізу CRM. Це timebox досліду, не обіцянка готового bridge. Немає читання/адресата → конкретний FAIL; не продовжувати коло OCR під іншою назвою. Якщо проходить лише reader — **LIMITED receive-only**. Якщо всі gates проходять — можна переходити до окремого текстового bridge prototype та довшого fault/soak тесту за контрактом.

## Межа результату цього етапу

- **Заявлено авторами:** сумісність і успіх їхніх локальних запусків/fixtures.
- **Підтверджено кодом:** наведені read/send paths, schemas, небезпечні fallback та відсутня реалізація в окремих SDK/sender.
- **Перевірено локально:** Windows metadata/PE/header preflight; actual Qt/SEE plugin і read-only synthetic fixture; локальне отримання параметра в RAM та читання очікуваної schema після невдалого no-key baseline. [G2 proof](G2_REPORT.md).
- **Не перевірено:** реальні event/contact values і relations, new-contact events, ID continuity, повторний доступ після restart/update, безпечний sender, delivery та вкладення.

GitHub bridge/hook upstream не запускали. Власні helpers працювали з перевіреними офіційними Qt wheels у тимчасовому стенді й встановленим Viber plugin. Production, auth, DB schema CRM та Railway не змінювали. Наступний блок — керовані текстові B/C/D події на поточному дозволеному Windows-акаунті; співрозмовників і повідомлення ще потрібно визначити. Linux-стенд не потрібен для продовження цього перевіреного шляху.
