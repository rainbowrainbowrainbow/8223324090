# G2 — локальна перевірка доступу до ключа Viber на Windows

Дата: **2026-09-11**. Production impact: no.

**Результат: GO для локального read-only доступу до DB; LIMITED для повного моста.** На поточному Windows Viber `26.3.2-0-g1354dae28ea` окремий Qt-reader успішно прочитав очікувану схему за допомогою параметра, отриманого лише в RAM. Без параметра schema не читалась. З ключем підтверджено всі перевірені поля Events/Messages/Contact/ChatInfo. Реальних message/contact rows не запитували; надсилання не виконувалось.

Це вже **доказ запуском**, що структурований reader на цій машині технічно можливий. Це ще не доказ приймання нових контактів, коректної синхронізації подій чи безпечного sender. Підсумковий результат: [G2_SCHEMA_RESULT.json](observer/G2_SCHEMA_RESULT.json).

## Авторизація й межі

Користувач прямо дозволив поточний власний акаунт: **«мій використовуй все ок»**. Цей дозвіл замінює попередню вимогу окремого тестового акаунта **для локального досліду доступу до DB/key**. Повторне підтвердження цього самого доступу не потрібне.

Дозвіл не використано як підставу для повідомлень реальним контактам, production CRM changes, копіювання сесії, завантаження ключів чи історії назовні. Send не реалізовано в інструменті. Для перевірок нових контактів, напрямків та доставки все ще потрібні визначені керовані співрозмовники й тестові повідомлення.

## Що виконано

Створено власні [presence probe](observer/probe_key_presence.py), [synthetic Qt fixture](observer/qt_readonly_fixture.py) та [schema probe](observer/probe_db_schema.py). GitHub bridge/hook-код не запускався. Використано Python 3.13.2, встановлений PowerShell, два офіційні Qt wheels 6.8.3 у тимчасовому стенді та встановлений Viber SQL plugin. CRM dependencies, lockfile, global site-packages і системні налаштування не змінювалися.

Qt wheels завантажені з Qt organization на PyPI, перевірені за SHA-256 і розміром та розпаковані власним [prepare_qt_runtime.py](observer/prepare_qt_runtime.py). Setup hooks не запускались; подальший import виконував native Qt code у нашому helper. Wheels мають LGPL/GPL ліцензії, це не MIT. Viber DLL не копіювалась у repo чи дистрибутив. Збіг hash підтверджує походження bytes, не повний security audit бібліотеки.

1. Звірено один процес, стандартний шлях executable, дійсний підпис Viber Media, час створення та власника процесу. Подальше читання використовувало той самий відкритий handle.
2. `OpenProcess` запитує тільки `PROCESS_VM_READ | PROCESS_QUERY_INFORMATION`. Немає debug privilege, suspend, injection, запису в процес чи зміни захисту сторінок.
3. Переглянуто тільки committed/private/readable data regions. Межі: 512 MiB, 15 секунд сканування, 100 000 regions; окремий worker із зовнішнім deadline 40 секунд, schema supervisor — 45 секунд. Chunk 64 KiB. Після перевірки SEE формат уточнено до парної довжини 2..1024 hex-символів, overlap 2304 bytes. Це межа пошуку, не припущення про довжину справжнього ключа.
4. Назовні повертаються лише fixed-status JSON, booleans і лічильники. Буфери не записуються; stderr/exception details не ретранслюються. У разі збігу scan зупиняється, значення ключа не повертається навіть викликачу цього presence-only інструмента.

### Підсумкова schema-проба

| Перевірено запуском | Результат |
|---|---|
| Qt runtime і фактично завантажений plugin | 6.8.3; точний шлях/hash Viber `qsqlite.dll`; `CODEC=see` |
| Read-only synthetic fixture | SELECT працює; INSERT відхилено з SQLITE_READONLY; bytes незмінні; missing DB не створюється |
| Кандидат, використаний тільки в RAM | 1; scanner зупинився після chunk зі збігом, це не повний обхід ключів |
| Прочитано пам’яті для цієї schema-проби | 259 031 040 bytes |
| No-key baseline | Відкриття connection не дало читабельної schema |
| Нова read-only connection з кандидатом | Schema успішно прочитана |
| Очікувані поля | Events: EventID/ChatID/ContactID/TimeStamp/Direction; Messages: EventID/Body; Contact: ContactID/Number; ChatInfo: ChatID/Token — усі наявні |
| Кількість open attempts | 2: baseline + один кандидат; жодних permutations чи brute force |
| WAL/SHM | Обидва існували до і після; file identity основної DB збереглась |
| Реальні message/contact rows / повідомлення | 0 / 0 |

File identity не означає незмінність bytes живої DB: сам Viber може продовжувати її оновлювати. Наші connection відкриті `QSQLITE_OPEN_READONLY` до open, без fallback до запису. Додатково встановлено connection-only `query_only`; запити обмежені schema. Немає rekey/checkpoint, export або instrumentation. Sidecar/lock activity read-only SQLite не прирівнюється до нульового filesystem touch.

### Попередні presence-only проби

| Перший вузький пошук 64 hex-символів | Результат |
|---|---|
| Підпис/шлях/час створення/власник target | Підтверджено |
| Прочитані байти | 347 783 168, приблизно 332 MiB |
| Переглянуті regions | 5 386, включно з пропущеними за типом |
| Помилки читання | 0 |
| Час сканування | 14 943 ms |
| Пошук завершив прохід eligible regions | Так, у межах цього неатомарного обходу |
| Очікуваний формат параметра ключа | Не виявлено |
| Відкриття/дешифрування DB | Не виконано |
| Надіслано повідомлень | 0 |

Після статичного виявлення SEE виконано один уточнений presence-only пошук: кандидат знайдено за 1 145 ms після 33 792 000 bytes, 894 regions, 0 read failures. Ця проба ще не зберігала і не перевіряла ключ. Підсумкова schema-проба вище окремо знайшла параметр і перевірила його на schema pages; розташування рядків у RAM між пробами змінюється.

Presence результати: [G2_KEY_PRESENCE_RESULT.json](observer/G2_KEY_PRESENCE_RESULT.json). Окремо збережено [Qt fixture proof](observer/G2_QT_FIXTURE_RESULT.json) і попередній [static preflight](observer/G2_STATIC_PREFLIGHT.json).

Перші спроби зупинялися до читання RAM: у дочірньому Windows PowerShell 5.1 перевірка підпису дала `CommandNotFoundException`. Використання вже встановленого Codex PowerShell із його built-in modules усунуло цей блок. Підпис не пропускали; Windows policy, PATH і системні налаштування не змінювалися. Це не було відхиленням automatic approval review.

## Перевірки інструмента й приватність

Presence probe: **548 synthetic assertions пройшли**, включно з chunk/region boundaries, gaps, парністю/довжиною hex і redaction. Schema probe: **16 assertions пройшли** для hex-only PRAGMA, відхилення SQL injection і закритої output schema. На власному Python-процесі перевірено Windows memory-info ABI (48 bytes) та same-owner predicate. Фінальні helpers переглянуті перед виконанням; synthetic fixture і schema probe реально запущені. CRM suite не запускали: її код/конфігурація не змінювалися.

Точний зміст privacy boundary: сирі chunks пам’яті **тимчасово обробляються** і можуть містити приватні дані, крім шуканого параметра. Код не декодує їх у листування, не експортує і не зберігає; основні mutable buffers обнуляються. Це не гарантія secure erasure усіх копій Python, відсутності OS pagefile, crash dump чи дій установлених засобів захисту. Windows signature verification може робити certificate URL retrieval; власного мережевого клієнта або відправлення Viber-даних у probe немає.

`private_region_scan_complete` означає завершення одного проходу доступних областей за фільтром. Це не snapshot усього процесу. Пам’ять змінюється під час обходу; інші формати ключа, mapped/image/execute pages та строки, знищені після старту Viber, не перевірялися. Сам збіг формату — лише кандидат: довільний текст може мати такий формат. Підсумкова проба підтвердила читання schema pages через правильний codec, а не лише `PRAGMA` success або `SELECT 1`.

## Що це змінює у виборі основи

Linux upstream [hook_hexkey.c](https://github.com/ibjelic/viber-linux-notifications/blob/036756f1845c6a175bb9bc8b5dc80b270db83363/src/hook_hexkey.c#L44) перехоплює параметр **під час виконання `memcpy`**. Наш presence-probe читає вже запущений процес і не є Windows-портом цього hook. Негативний результат сумісний зі сценарієм, коли SQL-рядок живе тільки під час відкриття DB; це пояснення залишається гіпотезою.

Встановлений Windows plugin має `CODEC=see`, `HAS_CODEC`, `hexkey`, `textkey`; runtime fixture підтвердив `CODEC=see` запитом. SQLite version literal — 3.50.0, plugin SHA-256 `eee36d090b774f3295bea740a8de56fc17d609a617c85e6150ef5ee314eba268`. Це SEE-enabled driver; конкретний cipher не встановлено. Припущення про Botan з іншої платформи/версії сюди не переноситься. [SEE documentation](https://sqlite.org/see/doc/trunk/www/readme.wiki) описує змінну довжину hex input і інші key-setting APIs; negative scan рівно 64 hex був недостатнім.

Цей Qt helper уже працює на поточній машині. Перезапуск чи instrumentation Viber для успішної проби не знадобилися. Надійність повторного отримання параметра після наступного запуску/оновлення залишається невідомою: рядок у RAM може зникнути. Поточний helper не зберігає ключ і не є постійним reader.

**Наступний gate — керовані текстові події**, не ще один пошук готового GitHub bridge: від нового співрозмовника, два однакові тексти, однакові імена/rename, outgoing з телефона/Desktop, restart reader. Потрібні визначені тестові співрозмовники B/C/D. Перевіряти source ID, напрямок, chat/contact relation й курсор без експорту приватної історії. Після цього — незалежний доказ exact active peer до Send. Наявність `Contact.Number` у схемі не доводить, що номер завжди заповнений або відповідає активному вікну.

## Джерела й рівні доказів

- **Заявлено авторами:** можливість отримати ключ під час запуску на Linux/macOS; не наша перевірка Windows.
- **Підтверджено кодом:** [Linux Qt query](https://github.com/ibjelic/viber-linux-notifications/blob/036756f1845c6a175bb9bc8b5dc80b270db83363/src/viber_query.cpp#L53), [macOS mechanism](https://github.com/nemanjacosovic/viber-export-macos/blob/afcea0151058b418e8895779306c5629236a4fef/viber-export-macos.sh#L370), наш read-only presence-probe.
- **Перевірено запуском:** Qt/SEE/read-only fixture, локальне schema reading із параметром після невдалого no-key baseline, наявність очікуваних полів, synthetic/self-process checks.
- **Не перевірено:** значення/стабільність EventID/chat/contact relations, нові контакти, sender, receipts, вкладення, offline/restart recovery моста, повторний доступ після оновлення Viber.

API references: [ReadProcessMemory](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-readprocessmemory), [VirtualQueryEx](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-virtualqueryex), [Qt 6.8.3 SQLite open flags](https://github.com/qt/qtbase/blob/c07c2d5a527a644d36e7853d55132ae38921682f/src/plugins/sqldrivers/sqlite/qsql_sqlite.cpp#L766), [офіційний PySide6-Essentials 6.8.3](https://pypi.org/project/PySide6-Essentials/6.8.3/), [SQLite unknown PRAGMA](https://sqlite.org/pragma.html), [read-only WAL](https://sqlite.org/wal.html#read_only_databases).
