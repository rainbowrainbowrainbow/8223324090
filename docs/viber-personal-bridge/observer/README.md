# Read-only Viber research observers

## P1 prototype core: identity and command safety

`p1_bridge_core.py` adds a local, side-effect-free SQLite core for the first
implementation block. It binds one ledger to an exact
`bridge_id/account_id/account_epoch/business_context`, keeps newly discovered
chats unresolved, requires an explicit exact peer verification, and rechecks
the active source chat/peer immediately before dispatch. A repeated
`command_id`/`client_request_id` is idempotent; conflicting payloads abort.
After restart, every `dispatch_started` command becomes `unknown` and is never
eligible for automatic resend. `p1_daemon.py` and `p1_http_client.py` provide
the separate heartbeat, durable event ACK, scoped command pull and result
transport. They do not weaken the identity gate: without a reviewed exact-peer
UI adapter, remote Send remains disabled. `receive_healthy` and `send_text` are
reported separately.

The module does not open Viber, perform a UI gesture, contact CRM, or enable
production Send. Its SQLite file must live in the private bridge state directory
outside the repository/OneDrive. Synthetic verification:

`p1_g3_adapter.py` connects the existing marker-only G3 journal shape to this
outbox. It creates one durable unresolved chat per opaque source chat, derives a
separate HMAC source-event reference, and leaves direction `unknown` unless a
controlled test has supplied an explicit verified code mapping. Re-observation
uses the first persisted `observed_at`; a later poll time cannot turn one source
occurrence into a conflict or duplicate.

`p1_transport.py` builds protocol `1.0` event batches and accepts an injected
HTTP function for tests. `p1_http_client.py` owns the real outbound HTTPS
boundary. Timeout, exception,
non-200 or malformed/forged ACK keep the outbox pending. Only explicit event IDs
from a valid same-version response are acknowledged; partial ACK replays only
the remaining events.

`run_p1_daemon.py` starts that transport from a private JSON config outside the
repository. Use `--once` for enrollment/health verification; without it the
process keeps heartbeat, event ACK, command intake and the optional one-worker
dispatch loop active. It deliberately does not enable receive or Send until
separate reviewed adapters verify them.

`p1_live_inbound.py` is the first live receive adapter for exactly one enrolled
paired chat. It uses the existing PHONE/DESKTOP anchor logic, stores raw source
IDs only in the private local journal, sends CRM only opaque HMAC identities,
and reads messages after the anchor cursor. The daemon enables it only when the
private config contains `live_inbound.enabled=true`; otherwise old transport-only
behavior is unchanged. Required live fields are `source_db_path`, `journal_path`,
`reference_key`, `phone_marker`, and `desktop_marker`; optional `account_identity`
and `source_identity` deliberately let an operator pin the expected account/source
without exposing them to CRM. `reference_key`, source DB path and journal path
must stay outside the repository and must not be printed to logs. A failed schema,
source, peer or direction check marks receive unhealthy and blocks capture instead
of advancing the cursor.

`p1_dispatcher.py` is the Send orchestration boundary for a reviewed UI
adapter. It revalidates the Viber account, foreground window, exact peer,
controlled/empty composer, layout and DPI before the irreversible gesture. It
persists `dispatch_started` before Send, accepts `submitted_unconfirmed` only
after an outbound occurrence is reconciled in the same ChatID, records local
`failed` results separately, and converts timeout/crash/malformed outcomes to
`unknown`. Replaying a terminal or already-started command never calls the
adapter again. `Send-P1Controlled.ps1` is a bounded, one-shot, paired-chat
experiment with a durable local claim; it is not a product or production sender.

`p1_gate.py` evaluates only redacted P1 evidence. Synthetic results never enable
a live capability. A bounded test Send becomes eligible only after live account,
NEW-contact discovery, direction, duplicate/restart and 30 alternating B/C
exact-peer checks including same display names, rename and sidebar reorder. The
gate requires stable opaque source chat/peer refs and rejects evidence that used
display name or sidebar position as identity. One wrong-recipient or ambiguous
new-contact observation is `NO_GO`; production Send is always false in this
gate. If new-contact discovery cannot be proven, the capability matrix remains
`LIMITED`: verified paired chats may work, but full Viber inbox is not claimed.

`p1_account_identity.py` adds the first concrete account proof. During a future
controlled enrollment it compares an expected strict E.164 value in memory with
the single guarded `ViberPC/<digits>/viber.db` directory. It returns only HMAC
account/source-generation refs; the number/path are not exported and the DB is
not opened. A mismatch or multiple account databases fails closed. This proof
still needs process/source continuity before the account gate can be marked live.

`verify_p1_account_live.py` is the bounded verifier for that continuity check.
It reads the expected E.164 value from stdin, loads only an existing protected
G3 session key, checks the signed same-owner Viber process before and after the
account-directory proof, and emits redacted JSON. It never accepts the number as
a command-line option and does not open the database.

When exactly one canonical private G3 session exists, use `--auto-session`.
The expected E.164 value is entered through hidden console input. The successful
2026-09-12 run verified account/process/source continuity without opening the DB
or emitting the number; only the redacted outcome is recorded in the report.

`verify_p1_direction_live.py` reads only the private marker journal after the
operator-controlled `PHONE`/`DESKTOP` pair. It reports only counts, direction
codes and same-chat equality. It never exports chat/contact IDs or other text.

`p1_paired_queries.py` implements the fallback for one already controlled chat.
It resolves the raw source chat only from the unique same-chat `PHONE` and
`DESKTOP` anchors, then accepts post-anchor inbound rows only while ChatID,
peer ContactID and direction remain exact. It does not discover other chats.
`verify_p1_paired_receive_live.py` runs one bounded read-only snapshot. By
default it emits only counters/booleans. Explicit `--reveal-latest` prints only
the latest inbound text from the marker-anchored chat for an authorized operator;
it must not be redirected to repository files or logs.

The active-feed/composer scripts are bounded live experiments. The 2026-09-12
run verified both exact anchors in one visible feed. Two separately claimed Qt
Invoke attempts remained `unknown`; neither outbound occurrence appeared and
their IDs cannot be retried. The exact owned draft was cleared. A third new ID
used exact draft validation, verified foreground Viber HWND and keyboard Enter;
read-only reconciliation found one outbound occurrence in the anchor chat with
the proven outbound direction. This is paired-only `submitted_unconfirmed`, not
provider delivery and not permission to address arbitrary chats. A later
authorized run submitted one Unicode reply with emoji through the same anchored
chat; reconciliation and visual inspection found exactly one outbound occurrence.
The UI scripts use DPI-aware coordinates so Windows display scaling does not crop
the composer during verification.

`verify_p1_seeded_reply_live.py` supports a bounded read after an explicitly
controlled outbound message in another chat. It requires that outbound text to
occur exactly once after the proven direction anchor, then reads only the newest
inbound row in the same ChatID and proven inbound direction. It exports no source,
chat or contact IDs. `--reveal-latest` is an operator-authorized private-text
mode; this verifier is read-on-demand and is not a background or CRM transport.

```powershell
py -3.13 -B -m unittest discover -s docs/viber-personal-bridge/observer -p "test_p1_*.py" -v
```

## Поточний шлях: Windows SID bootstrap без restart

[KEY_ORIGIN_REPORT](../KEY_ORIGIN_REPORT.md) і [SID_RECOVERY_RESULT.json](SID_RECOVERY_RESULT.json): на точному встановленому Viber 26.3.2 read-only schema recovery пройшов без RAM scan, CNG export або перезапуску. Ключ відтворюється тільки в RAM з перевіреного поточного Windows SID і fixed literal hash-pinned PE. Зміна binary hash блокує цей спосіб. SID не є Viber account ID.

`observe_g3_sid.py` — окремий opt-in launcher для **наявної** G3 session. Має один bootstrap і connection на короткий сеанс 0..45 секунд; `0` означає один poll. Тримає signed/same-owner process guard, не запускає legacy PRAGMA RAM scan. Приклад нижче використовує локальну змінну зі вже наявним session path; не створювати нову baseline для recovery:

```powershell
py -3.13 -I -B docs/viber-personal-bridge/observer/observe_g3_sid.py --session "$existingG3Session" --seconds 0
```

Наступний fresh запуск тієї самої команди перевіряє reread/dedup; `--local-ack-test` додавати лише для ACK власного test journal. Це не ACK CRM і не доставка Viber. Launcher сам обмежує child timeout (`45 + seconds`) і перевіряє фіксований JSON envelope. Немає `--prepare`, довільного SQL/key/account input, Send або permanent background mode. Фактичні marker результати: [G3_REPORT](../G3_REPORT.md).

`recover_sid_key.py --self-test` перевіряє тільки synthetic derivation. Його schema-only live mode із `--bindings` потребує зовнішнього child timeout 40 s, як у виконаному досліді; для поточного G3 використовувати supervised launcher вище. Огляди native helpers: [NATIVE_STATIC_REVIEW](../NATIVE_STATIC_REVIEW.md), [Capstone provenance](../CAPSTONE_REVIEW.md). Capstone потрібний для статичного дослідження, не для кожного reader bootstrap.

Нижче збережено попередні досліди й команди. Legacy `observe_g3.py --listen` автоматично на SID не перемкнено.

## Recovery: static binary audit та encrypted SEE fixture

[Актуальний звіт](../RECOVERY_RESEARCH.md), [Qt API evidence](../RECOVERY_QT_NOTES.md).

- `inspect_recovery_binary.py` — читає тільки чотири installed PE як файли даних, без DLL loading/account/RAM. Fixed identifiers/counts/SHA; перевірені path/reparse, file continuity й PE bounds. Результат: `RECOVERY_STATIC_RESULT.json`. Named symbol/literal absence не виключає internal functions або dynamic lookup.
- `verify_g3_see_session.py` — standalone власний encrypted WAL fixture через вже перевірені G2 bindings та installed hash-pinned plugin. Приймає тільки `--bindings`; запускати як disposable child із зовнішнім timeout 35 s, як виконано в цьому досліді. Код не є постійним observer. Результат: `RECOVERY_SEE_RESULT.json`, PASS: один READONLY reader, три polls `[0,2,0]`, pending 2 після journal reopen, fresh keyless read rejected, write rejected SQLite 8.

Для static audit: `py -3.13 -I -B docs/viber-personal-bridge/observer/inspect_recovery_binary.py`. Для SEE harness child використовує `-B` без `-I`, щоб імпортувати перевірені sibling modules; `subprocess.run(..., capture_output=True, timeout=35)` у supervisor. Не передавати account DB path або key. Temp fixture містить лише synthetic дані та видаляється після перевірки власного resolved target.

Ключ fixture генерується в RAM; application references прибрані після одноразового подання кожному keyed connection. Це не secure erasure і не proof key absence. Реальний Viber account/process/key цим fixture не використовуються. Тодішній recovery blocker закрив окремий SID experiment вище.

> **Оновлення G2:** на поточному Viber 26.3.2 вже підтверджено окремий read-only Qt/SEE schema reader. [Результат і межі](../G2_REPORT.md). Нижче збережена документація G1 UIA; вона не описує G2 DB probe.

## G3: контрольовані текстові маркери й локальний журнал

**Додано `--listen`:** один source connection до 600 секунд, progress/heartbeat, stdin `stop`, EOF/deadline і process/source-path continuity guard. Режим перевірено синтетичними lifecycle/subprocess tests і справжнім Qt plugin на власній DB. [Результат та межі](../G3_LISTENER_REPORT.md). Він починає тривале опитування тільки після успішного open; параметр відкриття поточної account DB сам не відновлює.

**Історичний RAM-bootstrap blocker:** після надсилання DUP завершений scan не знайшов PRAGMA-параметра. Тепер використовувати SID launcher вище з **тим самим** `session_path`; цей сценарій не потребує restart. Не запускати `--prepare` як recovery і не надсилати DUP повторно. [G3 evidence](../G3_REPORT.md).

Повідомлення оператора «перезапустив» перевіряти через час старту процесу перед RAM scan. У [першій такій спробі](G3_RESTART_ATTEMPT.json) uptime був 20 749 s: recent process restart не відбувся. Потрібне повне завершення застосунку, а не лише його вікна. До підтвердженого нового процесу не повторювати однаковий RAM scan.

`observe_g3.py` — окремий bounded reader, який використовує перевірений G2 Qt/SEE механізм. `g3_queries.py` повертає лише metadata точних тестових маркерів, `g3_journal.py` зберігає їх до локального test ACK, `g3_state.py` захищає власний HMAC seed через current-user DPAPI. Потрібен Windows Python **3.13+**, оскільки `mkdir(0o700)` використовується для Windows ACL. Результати фактичних запусків і неперевірені сценарії — у [G3_REPORT.md](../G3_REPORT.md).

Підготовка нової тестової session не відкриває Viber:

```powershell
py -3.13 -I -B docs/viber-personal-bridge/observer/observe_g3.py --prepare --bindings "<verified G2 bindings directory>"
```

Зберегти повернутий `session_path` локально. Він належить лише тестовому helper, а не акаунту Viber. Перший запуск встановлює початкову baseline; тестові повідомлення потрібно надсилати **після** його завершення:

```powershell
py -3.13 -I -B docs/viber-personal-bridge/observer/observe_g3.py --session "<session_path>" --seconds 0
py -3.13 -I -B docs/viber-personal-bridge/observer/observe_g3.py --session "<same session_path>" --seconds 30
```

Reader завершується після вказаного вікна; постійний background service не встановлюється. Повторний запуск використовує ту саму baseline і приватний journal. Події, що надійшли між запусками, теж входять у перевірку. `--prepare` не використовувати як restart: він створює інший run ID і новий тест.

Для одного довшого сеансу після відновлення доступу використовувати інтерактивний термінал із відкритим stdin:

```powershell
py -3.13 -I -B docs/viber-personal-bridge/observer/observe_g3.py --listen --seconds 600 --session "<same session_path>"
```

Зупинка — `stop` + Enter у тому самому терміналі або закриття stdin. `--local-ack-test` у listener не дозволений; pending зберігається. `source_poll_healthy` означає тільки свіжий успішний DB poll, `inbound_verified` залишається false. Проміжні records — JSONL `progress`/`heartbeat`, завершення — `finished`; legacy short probe лишає один JSON. Якщо початковий параметр не знайдено, listener завершується помилкою без автоматичних повторів або restart Viber. Для цього досліду використовувати один активний процес, не встановлювати service чи scheduled task.

Перший контрольний сценарій: інший керований акаунт надсилає на дозволений акаунт два окремі повідомлення з однаковим точним текстом `EGXG3-<RUN_ID>-DUP`. Пробіли, newline, цитата або інший регістр не є тим самим маркером. Успіх: два різні source EventID одного ChatID; повторне читання не збільшує journal total. Написати у власні нотатки — не доказ incoming від іншого акаунта. Новий раніше невідомий співрозмовник використовує `...-NEW`; відсутність старих локальних подій у чаті сама по собі не доводить, що контакту ніколи не було в телефонній книзі.

`--local-ack-test` перевіряє лише наш test consumer: переводить уже збережені контрольні події в `acked` і перевіряє повторний ACK як no-op. Це не CRM ACK, не Send і не delivery receipt. Звичайний запуск не підтверджує pending-події автоматично.

Для короткого SID probe на машині з рівно однією канонічною приватною G3 session можна не передавати її шлях:

```powershell
py -3.13 -I -B docs/viber-personal-bridge/observer/observe_g3_sid.py --auto-session --seconds 45
```

`--auto-session` відмовляє при нулі або кількох sessions і не дозволений у worker child; parent передає child лише вже перевірений канонічний шлях.

Межі: максимум 1000 Events після baseline, п'ять exact marker values; переповнення зупиняє дослід без пересування baseline. Неповні relations перечитуються у тому самому вікні. Конфлікт source ID, регрес ID, зміна DB file identity, відсутній/пошкоджений журнал уже початої session — зупинка, а не тихий reset. File identity не є доведеним Viber account/provider epoch. Direction лишається сирим кодом до контрольної звірки.

У SQL не повертаються Body, Number, Name або Token. Сам рушій читає сторінки приватної DB для exact match; тимчасова обробка приватних bytes у RAM не усувається. У власному локальному journal — лише контрольні маркери, source EventID, HMAC chat/contact/account/epoch refs, статус ACK. У repo — лише redacted counters/booleans і синтетичні тести. Сесія й ключ Viber не копіюються. Product sender, heartbeat і HTTPS transport цим інструментом не реалізовані; наявний лише bounded paired-chat sender experiment.

Синтетична перевірка без доступу до Viber:

```powershell
py -3.13 -B -m unittest discover -s docs/viber-personal-bridge/observer -p "test_g3_*.py" -v
py -3.13 -I -B docs/viber-personal-bridge/observer/g3_state.py --self-test
py -3.13 -I -B docs/viber-personal-bridge/observer/g3_state.py --self-test-files
py -3.13 -I -B docs/viber-personal-bridge/observer/observe_g3.py --self-test
```

## G1: попередній UIA observer

Окремий діагностичний інструмент G1. Не імпортується CRM, не є мостом і не вмикає Send. Використовує Windows PowerShell 5.1, вбудовані .NET UIAutomationClient/UIAutomationTypes і локально компільований `LegacyProbe.cs`. Завантажень, npm/pip install або змін системних налаштувань немає.

## Запуск

Відкрити потрібний чат Viber вручну й залишити вікно видимим. Із кореня EventGenix:

```powershell
powershell.exe -NoProfile -File docs/viber-personal-bridge/observer/Observe-Viber.ps1 -SelfTest
powershell.exe -NoProfile -File docs/viber-personal-bridge/observer/Observe-Viber.ps1
```

Для власного профілю спочатку вручну відкрити меню профілю:

```powershell
powershell.exe -NoProfile -File docs/viber-personal-bridge/observer/Observe-Viber.ps1 -Region Profile
```

Інструмент не активує вікно, не рухає мишу, не відкриває меню, не читає clipboard, DB або файли Viber. Якщо термінал перекриває заголовок Viber, винести його вбік. Адміністратор зазвичай не потрібен; потрібен доступ до тієї самої інтерактивної desktop session. Sandbox може бачити процес без доступного MainWindowHandle: це `target_not_unique` із count=0, а не доказ, що Viber вимкнений. Не обходити execution policy; якщо локальна політика блокує скрипт, зафіксувати блокування.

## Що читається

- RawViewWalker обходить максимум 500 вузлів, глибина до 16. Відомі `FeedDelegate`, `delegateLoader`, composer і Send-гілки відсікаються до читання тексту.
- Значення читаються лише в leaf-вузлах геометричної області Header або Profile. Області відносні, **евристичні**: інший layout може дати пропуск або захопити сторонній елемент. Це не гарантія повноти й не exact-recipient detector.
- Для вузла перевіряються Name, AutomationId, ValuePattern та TextPattern (до 256 символів). Parent TextPattern навмисно не читається, бо може агрегувати листування.
- .NET Framework не реєструє LegacyIAccessible property IDs у цьому середовищі. Малий COM helper читає 30090/30092/30093 через native IUIAutomationElement. Поточна реалізація проходить native RawViewWalker від window handle за шляхом дочірніх вузлів, отриманим у .NET raw tree; координатний hit-test більше не викликається. Перед читанням Legacy полів обов’язково звіряються ProcessId та повний RuntimeId, повторно перевіряється password flag. Зміна дерева може дати `tree_target_missing` або `tree_target_mismatch`; вони не дозволяють читання текстів. RuntimeId і шлях залишаються в RAM і не є chat ID. Це native зіставлення вже вибраних .NET вузлів, а не незалежне дослідження всіх native елементів. Вибір Header/Profile leaf-вузлів досі залежить від геометричної евристики.

Джерела API: [Microsoft: TextPattern.DocumentRange](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.textpattern.documentrange), [Microsoft: control pattern properties](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-control-pattern-propids), [Microsoft: native UIA interface declarations](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/UIAutomationClient.h).

## Privacy і значення результату

JSON містить лише локальний порядковий номер вузла, depth, числовий control type, статуси наявності тексту й `phone_like` boolean. Самі номери, імена, тексти, AutomationId, RuntimeId, назви вікон і screenshots не виводяться. Винятки provider не друкуються. Значення тимчасово читаються в RAM; це не обіцянка secure memory erasure. Автоматичного запису звіту на диск немає. Локальна компіляція Add-Type може використовувати стандартний temp Windows; приватні UI значення не входять до вихідного коду.

`phone_like` — лише збіг формату міжнародного номера з `+`, не його валідність, правильний адресат чи доказ приймання. Локальні номери без `+` не розпізнаються. `state=unsupported`, `empty`, `unavailable`, `present` розрізняються. Для Legacy головний статус — `legacy_status`; порожні поля після mismatch не означають відсутності номера.

`complete` означає лише завершення обмеженого огляду без відомих прогалин; не повноту UIA/історії. Нуль eligible nodes, помилки, досягнуті межі й невирішений Legacy дають `partial`. `verified_recipient` завжди false. Весь огляд не атомарний: перемикання чату користувачем під час обходу може змішати спостереження; звіт не можна використовувати для дозволу Send.

Батьківський процес запускає окремий прихований worker і припиняє тільки його після 25 секунд. `-TimeoutSeconds` дозволяє 5–60; `-MaxNodes` — 20–2000. Timeout не повертає часткові дані як успіх. `-Worker` — внутрішній параметр, його прямий запуск обходить supervisor timeout. Статуси `observer_timeout` і `worker_failed` завершуються кодом 2; `partial`/`target_not_unique` можуть мати код 0, тому перевіряти JSON, а не лише exit code.

## Перевірено

2026-09-11: 7 synthetic перевірок redaction/classifier пройдено; C# helper компілюється; виконано пряме читання запущеного Viber. Початковий live-зріз: 53 вузли, 14 відсічених гілок, 7 eligible leaf-вузлів; Name/Value порожні, TextPattern unsupported, усі 7 Legacy probes дали mismatch. Це прогалина Legacy coverage, не доказ його непридатності. Після цього статус виправлено на partial для таких результатів. Актуальний повторний результат — у `../G1_REPORT.md`.

Повтор із Viber на передньому плані виконано: Header — 6 Legacy read і 1 mismatch; Profile — 1 read і 2 mismatch. Додані `legacy_same_process` і `legacy_same_runtime_id` містять лише boolean/null, не самі ID. У всіх залишкових mismatch процес збігається, runtime ID — ні: hit-test повертає інший елемент Viber. Номера в прочитаних полях не знайдено. Детальні знеособлені зрізи збережені в `G1_HEADER_DIAGNOSTIC_RESULT.json` та `G1_PROFILE_DIAGNOSTIC_RESULT.json`.

Після заміни hit-test на native raw-tree path: Header — **7/7 Legacy read**, Profile — **3/3 Legacy read**, без mismatch/errors; `complete=true` лише для обмеженого огляду. Номерів у прочитаних полях не знайдено. Зрізи: `G1_HEADER_NATIVE_RESULT.json`, `G1_PROFILE_NATIVE_RESULT.json`; поле `legacy_lookup=native_raw_tree_path` відрізняє їх від старих результатів.

`Test-NativeProbe.ps1` перевіряє 8 synthetic випадків меж шляху й відхилення некоректних targets до COM. `-LiveMismatch` додатково звіряє навмисно неправильний synthetic RuntimeId на корені Viber: очікується відмова без текстів. Обидва режими виконані успішно, privacy self-test — 7/7. Команда:

```powershell
powershell.exe -NoProfile -File docs/viber-personal-bridge/observer/Test-NativeProbe.ps1
```

Примусове зависання provider, закрита/заблокована session, DPI matrix, rename/restart та synthetic B/C/D ще не перевірені. SelfTest не перевіряє точність provider або privacy scope геометричних областей. Наступний дослід — окрема оцінка локального OCR на synthetic fixtures, оскільки перевірені UIA-поля не дали номера. Це не доказ відсутності номера в усіх можливих UIA interfaces/layouts. Не послаблювати перевірку RuntimeId заради статусу read.

Локальний OCR дослід тепер виконано окремим [Test-LocalOcr.ps1](Test-LocalOcr.ps1): [метод і результати](OCR_RESULTS.md). При 2× збільшенні 12/12 повних synthetic номерів розпізнані точно, але clipping negative test провалений. Це не перевірка реальних B/C/D і не дозвіл на автоматичну адресацію.

## G2: Qt/SEE schema probe

Окремі діагностичні інструменти, не імпортуються CRM і не є постійним мостом:

- `probe_key_presence.py` — 512 MiB / 15 секунд read-only огляду одного перевіреного процесу; тільки наявність рядка очікуваного формату. 548 synthetic assertions.
- `prepare_qt_runtime.py` — завантажує два exact-version офіційні wheels, перевіряє SHA/size та ZIP paths, розпаковує в новий temp-каталог. Не запускає setup hooks і не змінює global/repo dependencies. LICENSE/dist-info зберігаються з wheels.
- `qt_readonly_fixture.py` — тільки disposable synthetic DB. Перевіряє actual Viber plugin path/hash, Qt 6.8.3, `CODEC=see`, SELECT, SQLite READONLY rejection і missing-file behavior. `--worker` має запускатися під зовнішнім deadline; для звичайного запуску використовувати supervisor нижче, який повторює fixture перед приватним доступом.
- `probe_db_schema.py` — supervisor 45 секунд, fixture prerequisite, максимум чотири знайдених у RAM hex-кандидати; кожен на fresh read-only connection. Приймає лише `--bindings`, не SQL/key/account path. Вибирає тільки один `ViberPC/*/viber.db`, при неоднозначності зупиняється. Query allowlist — тільки schema/column presence. 16 synthetic guard assertions.

Після явного дозволу власника акаунта:

```powershell
py -3.13 -I -B docs/viber-personal-bridge/observer/probe_key_presence.py --self-test
py -3.13 -I -B docs/viber-personal-bridge/observer/probe_db_schema.py --self-test
py -3.13 -I -B docs/viber-personal-bridge/observer/prepare_qt_runtime.py
```

Остання команда повертає `bindings_path` тільки для бібліотек стенду. Передати його:

```powershell
py -3.13 -I -B docs/viber-personal-bridge/observer/probe_db_schema.py --bindings "<bindings_path from prepared result>"
```

У Codex доступ до temp-каталогу потребував вузького sandbox escalation; automatic review дозволив підготовку й ці перевірені запуски. Default sandbox `Access denied` був проблемою доступу до стенду, не відмовою Viber decrypt. Не обходити failed fixture або plugin hash mismatch після оновлення Viber.

Параметри ключа обробляються лише в RAM нашого worker, не через CLI/env/file; значення не потрапляють у stdout, repo, OneDrive чи CRM. Це не обіцянка secure erasure або відсутності OS paging. Сканування сирих private memory chunks може тимчасово захоплювати інші приватні bytes. Windows trust verification може виконувати certificate URL retrieval. Raw Qt errors/stderr не виводяться. JSON — fixed enums/booleans/counters; exit code сам по собі не є PASS, читати `status`.

Успішний `SCHEMA_READABLE` доводить доступ до цієї локальної DB й наявність полів, **не** active account/peer identity, заповненість номерів, повноту історії, inbox або доставку. Live WAL використовує наявні sidecars/locks; якщо WAL є, а SHM відсутній, probe зупиняється. File identity check не стверджує незмінність bytes, які може змінювати сам Viber. Немає send, rekey, checkpoint, process injection чи restart Viber.
