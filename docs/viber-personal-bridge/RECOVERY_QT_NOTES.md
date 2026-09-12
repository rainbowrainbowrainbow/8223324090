# G3: межа штатного відновлення через Qt / SQLite SEE

Дата: 2026-09-11. Статичне дослідження первинних джерел. У цьому блоці не читали пам'ять, DB, ключі чи контакти Viber; не запускали код, інсталятори або нові probes.

**Висновок: штатного способу заново відкрити поточну encrypted DB без придатного ключового матеріалу або власної вже відкритої connection не знайдено.** Завантаження того самого `qsqlite.dll` забезпечує сумісний codec, але не переносить стан відкритої Viber connection до нашого процесу. Це обмеження перевіреного API, а не доказ неможливості будь-якого reverse engineering без restart.

## Вихідні докази та їх межі

- [G2 schema result](observer/G2_SCHEMA_RESULT.json): окремий reader через встановлений Qt/SEE plugin прочитав очікувану schema після подання знайденого параметра; no-key baseline не прочитав її. Це вже виконаний попередній тест, у цьому блоці не повторювався.
- [PE preflight](observer/G2_STATIC_PREFLIGHT.json): у встановленому `qsqlite.dll` лише `qt_plugin_instance` та `qt_plugin_query_metadata_v2`, без `sqlite3_*` exports. Звичайний `GetProcAddress` / `ctypes` до `sqlite3_key*` або `sqlite3_db_handle` цієї DLL не є доступним готовим інтерфейсом.
- Завершені обмежені scans не знайшли підтримуваного повного `PRAGMA hexkey` рядка. Це **не** означає, що Viber втратив активний codec state, що жодного ключового матеріалу в його пам'яті немає або що encrypted DB пошкоджена. [G3 evidence](G3_REPORT.md).
- Upstream Qt `v6.8.3` прив'язаний до commit [`c07c2d5a527a644d36e7853d55132ae38921682f`](https://github.com/qt/qtbase/commit/c07c2d5a527a644d36e7853d55132ae38921682f), перевірено через [release tag object](https://api.github.com/repos/qt/qtbase/git/tags/4606ef4436469d631d8f15f5a312c9af206ecc43). Це reference Qt; весь vendor-specific код Viber DLL за цим SHA не відновлений.

## Що насправді дає Qt

| Механізм | Доказ у pinned Qt 6.8.3 | Наслідок для нашого reader |
| --- | --- | --- |
| `QSqlDatabase::database(name)` / `connectionNames()` | Registry — `Q_APPLICATION_STATIC`, локальний `QHash` connections: [qsqldatabase.cpp L41](https://github.com/qt/qtbase/blob/c07c2d5a527a644d36e7853d55132ae38921682f/src/sql/kernel/qsqldatabase.cpp#L41) | Знаходить connection нашого застосунку; не шукає її у Viber за назвою |
| `cloneDatabase()` | Створює новий driver і копіює settings: [L1259](https://github.com/qt/qtbase/blob/c07c2d5a527a644d36e7853d55132ae38921682f/src/sql/kernel/qsqldatabase.cpp#L1259), [copy L199](https://github.com/qt/qtbase/blob/c07c2d5a527a644d36e7853d55132ae38921682f/src/sql/kernel/qsqldatabase.cpp#L199) | Clone не відкритий; активний SQLite/codec state не копіюється |
| `password()` / `setPassword()` | Getter повертає Qt `pword`: [L977](https://github.com/qt/qtbase/blob/c07c2d5a527a644d36e7853d55132ae38921682f/src/sql/kernel/qsqldatabase.cpp#L977); upstream SQLite `open()` ігнорує password: [qsql_sqlite.cpp L745](https://github.com/qt/qtbase/blob/c07c2d5a527a644d36e7853d55132ae38921682f/src/plugins/sqldrivers/sqlite/qsql_sqlite.cpp#L745) | Це не getter SEE key, поданого окремим PRAGMA |
| `QSqlDriver::handle()` | Повертає `d->access`, тобто `sqlite3*`: [L989](https://github.com/qt/qtbase/blob/c07c2d5a527a644d36e7853d55132ae38921682f/src/plugins/sqldrivers/sqlite/qsql_sqlite.cpp#L989) | Pointer належить connection у поточному процесі |
| `QSqlResult::handle()` | Повертає `sqlite3_stmt*`: [L625](https://github.com/qt/qtbase/blob/c07c2d5a527a644d36e7853d55132ae38921682f/src/plugins/sqldrivers/sqlite/qsql_sqlite.cpp#L625) | Це statement pointer, не ключ і не Windows HANDLE |
| `QSQLiteDriver(sqlite3*)` | Просто зберігає переданий pointer: [L696](https://github.com/qt/qtbase/blob/c07c2d5a527a644d36e7853d55132ae38921682f/src/plugins/sqldrivers/sqlite/qsql_sqlite.cpp#L696). Destructor викликає close; close викликає `sqlite3_close`: [L862](https://github.com/qt/qtbase/blob/c07c2d5a527a644d36e7853d55132ae38921682f/src/plugins/sqldrivers/sqlite/qsql_sqlite.cpp#L862) | Потрібна вже придатна локальна connection та правильне ownership. Це не attach до іншого процесу |

Windows має окремі адресні простори процесів. Числове значення чужого pointer не стає нашим SQLite object; дублювання OS file handle також не відтворює heap, mutexes, callbacks і codec state. Це висновок із [Microsoft memory model](https://learn.microsoft.com/en-us/windows-hardware/drivers/gettingstarted/virtual-address-spaces), [opaque SQLite connection](https://sqlite.org/c3ref/sqlite3.html) та наведеного Qt коду. Копія bytes opaque struct не є підтримуваним ABI перенесення connection.

## SEE: подання ключа не є його отриманням

Офіційний [SEE manual, розділи 5–7](https://sqlite.org/see/doc/trunk/www/readme.wiki) описує C key setters, `key`/`hexkey`/`textkey` PRAGMA та URI parameters. Ключ задають перед читанням; успішне завантаження параметра не доводить його правильності — потрібний успішний read. `ATTACH` без окремого ключа успадковує ключ `main` тієї самої connection. Це не успадкування від іншого процесу. `rekey` змінює файл і потребує розшифрування сторінок старим станом, тому не є recovery без ключа. Activation API активує SEE library, а не розшифровує довільну DB. Документованого getter поточного ключа, включно з bare `PRAGMA hexkey;`, у цьому manual не знайдено.

Поточна документація містить `sqlite3_key_v3(..., zCodec)` та старі `_v2` references. Наявність нового API в manual **не доводить** його наявності у нашій DLL. Назва `sqlite3CodecGetKey`, якщо зустрічається в сторонньому codec, теж не доводить доступного API цієї збірки.

SEE implementation доступний ліцензіатам: [офіційна сторінка доступу](https://sqlite.org/see/doc/trunk/www/index.wiki). Його приватний source і точний commit встановленого Viber codec не отримані. Посилання SEE `trunk` є рухомим; immutable SEE revision для цього аудиту встановити не вдалося. Не видаємо manual за аудит внутрішньої структури ключа.

## Інші штатні API не прибирають цю передумову

- `sqlite3_db_handle(stmt)` повертає connection, яка створила локальний statement; не відкриває чужу. [SQLite API](https://sqlite.org/c3ref/db_handle.html).
- `sqlite3_file_control()` працює з уже наданою connection; стандартні file/VFS pointers не є getter ключа. Непідтверджений vendor opcode не можна вважати реалізованим recovery. [SQLite API](https://sqlite.org/c3ref/file_control.html).
- SQLite shared-cache діє в межах процесу. Увімкнення `QSQLITE_ENABLE_SHARED_CACHE` не під'єднає reader до Viber heap. [SQLite shared-cache API](https://sqlite.org/c3ref/enable_shared_cache.html).
- `-shm` містить WAL index та координаційні дані, не вміст таблиць. Це не спільна розшифрована DB. [SQLite WAL format §1.3](https://sqlite.org/walformat.html#the_wal_index_or_shm_file).
- Online backup потребує source і destination `sqlite3*` та читає source. Це не спосіб отримати читабельний source із невідомим ключем. [SQLite backup API](https://sqlite.org/c3ref/backup_finish.html).

## Рішення для G3

Єдиний уже доведений локальний access path — **придатний параметр → встановлений Qt plugin → нова READONLY connection → schema validation**. Довге утримання цієї connection прибирає повторне відкриття між polls, але допомагає лише після успішного bootstrap. Закриту connection попереднього reader listener не відновлює.

Для поточного no-restart recovery штатний API шлях залишається **не підтвердженим**. Немає підстав виконувати ще один no-key open, clone, shared-cache або backup як нібито альтернативний спосіб розшифрування.

Якщо продовжуємо саме без restart, найменша окрема дослідницька задача — визначити, чи зберігає **точна встановлена SEE збірка** придатний ключ/codec state у стабільно визначеній структурі. Спочатку потрібні статичне встановлення конкретного codec та синтетичний доказ на власній encrypted fixture з відомим тестовим ключем. Це ще не реалізований спосіб доступу до поточного Viber і не гарантія переносимості стану. Hook або виконання SQL усередині Viber були б іншою інтеграцією з додатковими ризиками; у цьому досліді їх не робили.

**Рівні доказів:** Qt поведінка підтверджена pinned кодом; SEE API — офіційною документацією з названою version-межею; G2 read — попереднім локальним запуском; no-restart reacquisition через persistent codec state — не перевірена. Дані для доказу DUP / нового контакту / адресата і Send цей документ не додає.
