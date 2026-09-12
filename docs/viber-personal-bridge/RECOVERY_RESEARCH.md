# Viber DB: відновлення доступу без перезапуску

Дата: **2026-09-11**. Production impact: no.

**Оновлений результат: SID recovery SCHEMA PASS без restart.** [Точний статичний ланцюжок і live proof](KEY_ORIGIN_REPORT.md) закрили описану нижче перешкоду bootstrap: нова READONLY connection відкрила наявну DB з незалежно відтвореним кандидатом; без нього схема не читалася. RAM scan, restart, CNG export і Send не використовувалися. Загальне рішення для моста лишається LIMITED до G3 inbox/recipient gates. Наступний текст зберігає попередній дослід і його тодішні невизначеності; поточний висновок визначає KEY_ORIGIN_REPORT.

**Новий runtime proof:** встановлений SEE driver успішно пройшов власний encrypted WAL тест: один reader, три polls, дві однакові події з різними EventID, pending збереглися після reopen власного journal. Ключ поданий reader лише один раз. Fresh connection без ключа читати не змогла. [Точний результат](observer/RECOVERY_SEE_RESULT.json). Це доказ придатності connection після bootstrap, не відновлення доступу до поточного акаунта.

У цьому блоці аналізували встановлені executable/DLL **як файли даних**, pinned GitHub code і первинну документацію. Повторних сканувань пам'яті Viber, читання його конфігурації/листування, перезапуску, injection або Send не було. Сесія G3 `0B038E78` і її початкова baseline залишаються чинними. Уже надіслані контрольні повідомлення повторювати не потрібно.

## 1. Що додала перевірка встановлених бінарних файлів

Власний [inspect_recovery_binary.py](observer/inspect_recovery_binary.py) прочитав `Viber.exe`, `Qt6Core.dll`, `Qt6Sql.dll`, `plugins/sqldrivers/qsqlite.dll`. Файли не завантажувалися як executable modules цим інструментом. Вихід — тільки allowlisted identifiers, counters і SHA256; довільні strings, account paths та key material не виводяться. Перевіряються розмір, PE bounds, відсутність reparse paths та file identity/mtime до і після читання. Це не disassembler і не аналіз data flow. Формат PE звірений з [Microsoft specification](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format).

Виконаний результат: [RECOVERY_STATIC_RESULT.json](observer/RECOVERY_STATIC_RESULT.json).

| Спостереження | Підтверджено запуском власного static reader | Межа висновку |
|---|---|---|
| `Viber.exe` | Один ASCII шаблон `PRAGMA hexkey='%1'`; загалом два ASCII входження `hexkey` | Підтримує вибір раніше успішного PRAGMA-патерна. Не визначає lifetime, адресу або джерело параметра |
| `Viber.exe` imports | Є `CryptUnprotectData`; named imports включають Qt SQL classes | DPAPI присутній у binary, але зв'язок із DB key не встановлено |
| `Viber.exe` literals | Є `Botan`; у `qsqlite.dll` цього literal немає | Бібліотеки в одному застосунку можуть мати різні задачі. Не підстава назвати Windows DB Botan/SQLCipher |
| `qsqlite.dll` | `CODEC=see`, `HAS_CODEC`, `hexkey`, `textkey`, `QSQLITE_OPEN_READONLY`; два named exports: `qt_plugin_instance`, `qt_plugin_query_metadata_v2` | Узгоджується з попереднім runtime SEE proof. Готового named-export getter ключа не виявлено |
| Усі чотири PE | Нуль named exports з prefix `sqlite3` | Не виключає static/internal functions, ordinal imports або dynamic lookup; не означає відсутності codec у binary |

Точні артефакти:

| Файл | SHA256 |
|---|---|
| `Viber.exe` | `7c6f4f7c463e631f43590a189ee40e3cad733759afd04d89fc80e25ae610f99b` |
| `Qt6Core.dll` | `2c9a13c52245d8bcb5252b3c38975cdb2d22503ef7aaa6de161eeac1b6c38416` |
| `Qt6Sql.dll` | `9b009ed4abc04cf67e83a4724f27615276b78479fd65a443a5c7d89b7509effd` |
| `qsqlite.dll` | `eee36d090b774f3295bea740a8de56fc17d609a617c85e6150ef5ee314eba268` |

Відсутність конкретного literal — лише негативний результат обмеженого пошуку. Зміна SHA після Viber update анулює прив'язку цього статичного зрізу до нової збірки. File continuity checks виявляють звичайну заміну під час читання; не є захистом від ворожого same-user процесу або ядра.

## 2. Чи дають GitHub-реалізації інший спосіб отримати ключ

| Реалізація | Підтверджено pinned кодом | Придатність для поточного процесу |
|---|---|---|
| `ibjelic/viber-linux-notifications`, MIT, `036756f1845c6a175bb9bc8b5dc80b270db83363` | [memcpy hook](https://github.com/ibjelic/viber-linux-notifications/blob/036756f1845c6a175bb9bc8b5dc80b270db83363/src/hook_hexkey.c#L19) ловить 64-character hexkey під час копіювання; [setup](https://github.com/ibjelic/viber-linux-notifications/blob/036756f1845c6a175bb9bc8b5dc80b270db83363/setup.sh#L138) зупиняє Viber і запускає з `LD_PRELOAD` | Startup interception; не retrieval ключа вже відкритої DB. Цей hook не запускався і не переносився |
| `nemanjacosovic/viber-export-macos`, MIT, `afcea0151058b418e8895779306c5629236a4fef` | [QString argument reader](https://github.com/nemanjacosovic/viber-export-macos/blob/afcea0151058b418e8895779306c5629236a4fef/viber-export-macos.sh#L325), [LLDB breakpoints і launch](https://github.com/nemanjacosovic/viber-export-macos/blob/afcea0151058b418e8895779306c5629236a4fef/viber-export-macos.sh#L416) ловлять ключ у Qt SQL виклику під час запуску копії Viber | Не знаходить persistent SEE codec/key object у вже відкритій Windows DB; Mac ABI не переноситься дослівно |

Mac `_export()` [створює нову connection і подає вже перехоплені ключі](https://github.com/nemanjacosovic/viber-export-macos/blob/afcea0151058b418e8895779306c5629236a4fef/viber-export-macos.sh#L347). Його `QS`/`DB`/`QQ` — обгортки для викликів Qt, а не знайдений стійкий anchor ключа. У цьому коді також немає `QSQLITE_OPEN_READONLY`, тому README-формулювання не замінює перевірки flags.

Linux [memory page scanner](https://github.com/ibjelic/viber-linux-notifications/blob/036756f1845c6a175bb9bc8b5dc80b270db83363/src/viber_mem_watch.c#L218) шукає ймовірні plaintext SQLite leaf pages та тексти. Він не відновлює ключ, не забезпечує цілісного inbox і використовує text-hash dedup. Перехід на такий watcher не розв'язує наші вимоги до двох однакових подій, source identity та нового контакту. Його не запускали.

## 3. Відхилені штатні способи та непідтверджені напрямки

Деталі з pinned Qt 6.8.3 code: [RECOVERY_QT_NOTES.md](RECOVERY_QT_NOTES.md).

| Підхід | Результат перевірки |
|---|---|
| Взяти Viber connection за ім'ям / `cloneDatabase()` | Registry локальний для застосунку; clone копіює settings, не активний SQLite/codec state |
| `QSqlDriver::handle()` / existing-handle constructor | Потрібен локальний придатний `sqlite3*`; це не Windows HANDLE і не IPC attach до Viber |
| `password()` / bare PRAGMA / SEE activation | Не знайдено документованого getter ключа, поданого окремим hexkey PRAGMA. Activation не розшифровує довільну DB |
| Shared-cache / WAL SHM / online backup | Не дають новому процесу чужий plaintext codec state. Backup уже потребує читабельного source |
| `CryptUnprotectData` | **Лише нова статична зачіпка.** Немає встановленого DB-key blob, storage location, entropy та call path до hexkey. Приватні config/registry навмання не сканували |
| Persistent SEE state | **Окрема неперевірена reverse-engineering задача.** Точний codec layout, owner pointer та стабільний read-only спосіб його знаходження не відомі |

За [Microsoft DPAPI API](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata) потрібен придатний захищений blob і, якщо використана, та сама additional entropy. Один import функції не дає цих даних. [SEE manual](https://sqlite.org/see/doc/trunk/www/readme.wiki) описує подання ключа, але не надає source exact Viber codec або готового механізму міжпроцесного recovery. Документація SEE trunk рухома; не прирівнюється до API саме встановленої DLL.

Окремий обмежений public web search за чотирма запитами — `"Viber" "CryptUnprotectData"`, `"Viber" "DPAPI" database key`, `site:github.com Viber hexkey Windows registry`, `site:github.com Viber database decrypt entropy key Windows` — не дав первинного Windows implementation із доведеним storage/entropy path. Це не повний GitHub code index і не доказ відсутності будь-якої реалізації.

## 4. Виконаний тест на власній encrypted WAL DB

[verify_g3_see_session.py](observer/verify_g3_see_session.py) використовує вже перевірені G2 Qt bindings і той самий hash-pinned installed plugin. Нових залежностей не додавали. Запуск — disposable child з зовнішнім timeout 35 s; raw stderr пригнічений. Temporary directory перевірений як власний прямий нащадок temp перед cleanup. Потрібний вузький доступ до раніше підготовленого Temp runtime був дозволений automatic review.

Власний Qt writer створив synthetic source з випадковим тестовим ключем тільки в RAM. До першого poll writer і reader отримали ключ по одному разу; application references після цього прибрані. Це **не secure erasure**: Qt/SEE/allocator copies могли залишатися. `rekey` не викликався. Жодного Viber account key, session file чи message row не використовували.

| Перевірка | Actual результат |
|---|---|
| Той самий installed plugin / Qt 6.8.3 / SEE | Hash, loaded path і `CODEC=see` підтверджені |
| Synthetic source WAL | `journal_mode=wal`; наявні `-wal` та `-shm` до відкриття reader |
| Encryption controls | Стандартного plaintext SQLite header немає; fresh keyless connection schema не прочитала, helper перевіряє SQLite base error 26 |
| Reader write prevention | `CREATE TABLE` відхилено, SQLite base error 8 |
| Один reader після одноразового key submission | Три polls без reopen/rekey; writer додав EventID 11/12 після першого poll |
| Два однакові synthetic markers | `newly_journaled_per_poll=[0,2,0]`; два distinct events, replay без дублювання |
| Відновлення власного journal | Після close/reopen — total 2, pending 2, acked 0; ті самі event IDs |

Спершу той самий сценарій пройшов на default journal mode; після додавання WAL — повторний focused run PASS. Збережений JSON описує **останній WAL run**. Це новий standalone integration fixture; попередні 100 unit tests у цьому блоці не перезапускали. Parser checks виконані для двох нових Python helpers. CRM suite/production QA не запускали, CRM код не змінювався.

**Не перевірено:** persistent codec-state extraction, ключовий матеріал поточного акаунта, actual DUP/NEW, provider cipher mode, crash/restart Viber, lock/RDP/offline, sender і доставка. Синтетична DB створена цим SEE plugin, але її default cipher/key derivation не прирівнюються до реальної Viber DB. Fixture не доводить, що зниклий PRAGMA можна відновити.

## 5. Практичне рішення і межа наступного досліду

1. Продовжувати власний **read-only reader на встановленому Qt/SEE plugin**. Після успішного open утримувати connection в bounded listener, а не запускати серію коротких readers. Наявні event journal, baseline і HMAC refs зберігати.
2. Для подальшого дослідження без restart спочатку встановити конкретний persistent-state anchor або точний DPAPI call path на цій binary version. Потім перевірити на **власній encrypted fixture**, що метод повертає придатний матеріал після видалення application references до початкової PRAGMA. До цього немає підстав для чергового однакового RAM scan або широкого пошуку приватних секретів.
3. Операторський **повний вихід і запуск лише Viber** залишається окремим коротким експериментом повторного bootstrap. Він не вимагає reboot Windows, не доведений як єдиний спосіб і не гарантує успіху. Помічник у цьому блоці його не виконував. Попереднє закриття вікна не зараховано як restart: тоді process uptime був 20 749 s.
4. Лише після відновленого доступу перевірити вже надіслані DUP у старому вікні, потім NEW, account/chat identity і правильного адресата. **NO-GO Send / production Omni** залишається до цих gates. Ні успішна PRAGMA, ні bubble, ні натискання Send не означають доставку.

Цей блок не встановлює міст у background, не додає залежностей, transport, webhook або CRM integration. Якщо bounded persistent-state дослід не дасть придатного bootstrap, фіксувати blocker для unattended bridge, а не компенсувати його новими synthetic transport tests.

## 6. Рівні доказів та змінені файли

- **Заявлено авторами:** експорт/notification capability у сторонніх README. Не зараховується як наш runtime proof.
- **Підтверджено кодом:** startup-only interception у двох pinned helpers; локальні Qt connection/handle semantics; поведінка власних test helpers.
- **Перевірено запуском:** static reader на чотирьох встановлених PE; власна encrypted SEE WAL fixture і durable synthetic journal. Попередній G2 account schema read — окремий історичний доказ.
- **Не перевірено:** новий no-restart retrieval, поточні реальні контрольні події, exact recipient та production readiness.

Додано цей звіт, [Qt source notes](RECOVERY_QT_NOTES.md), два нових diagnostic/test helpers і їхні redacted JSON results. Оновлено current-status links у RESEARCH, PROTOTYPE_PLAN, G3_REPORT, BRIDGE_CONTRACT та observer README. Existing observer runtime logic, приватна G3 session, CRM, dependencies й чужі робочі зміни не змінювалися.
