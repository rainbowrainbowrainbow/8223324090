# Viber Personal Bridge — P1 implementation report

Дата: 2026-09-12. Статус: **локальне ядро реалізовано; live account і direction gates пройдено; paired-only text Send підтверджено; довільний і production Send вимкнені**.

## Що реалізовано

- Окремий SQLite ledger, жорстко прив'язаний до одного `bridge_id`,
  `account_id`, `account_epoch` і `business_context` (`event_genix` або `dar`).
- Account/source continuity: зміна account reference або source generation
  фіксує mismatch, скидає receive/send readiness і потребує контрольованого
  rebind через новий epoch.
- Новий chat спочатку має `identity_level=unresolved`; display name не
  використовується як ключ. Exact peer verification переводить binding у
  verified і збільшує `binding_revision`.
- Зміна peer invalidates binding. Команди зі старою ревізією не виконуються.
- `command_id` та `client_request_id` мають спільну durable idempotency:
  ідентичний повтор повертає наявний запис, інший payload дає
  `COMMAND_ID_CONFLICT`.
- Безпосередньо перед dispatch повторно звіряються account health,
  binding revision, source chat і peer. Mismatch завершується без gesture.
- Одночасно допускається лише один `dispatch_started`; інша команда лишається
  `accepted` і отримує `UI_OPERATION_BUSY`.
- Після persisted `dispatch_started` повторний виклик не збільшує
  `dispatch_count`. Після restart незавершений dispatch переходить у `unknown`
  з `DISPATCH_INTERRUPTED`, без автоматичного повтору.
- `submitted_unconfirmed` не називається доставкою. `receive_healthy` і
  `send_text` відображаються окремо.
- Durable inbound outbox приймає лише opaque source/chat/peer references,
  зберігає дві однакові текстові occurrence як різні події, стабільно повторює
  event після втрати ACK і застосовує ACK атомарно.
- Подія нового unresolved chat зберігається для CRM як unresolved observation,
  але не відкриває Send. Raw phone/display name у payload не приймаються.
- Strict protocol `1.0` batch builder не передає raw source references.
  Timeout, exception, non-200, malformed або forged ACK залишають outbox pending;
  partial ACK видаляє лише явно підтверджені event IDs.
- Safe dispatcher працює тільки через injected UI adapter: active peer
  перевіряється до irreversible boundary, `dispatch_started` пишеться до
  gesture, exception/timeout/malformed result стає `unknown`. Повтор terminal
  або already-started command не викликає UI вдруге.
- Формальний evidence gate не дозволяє synthetic tests підвищити live
  capability. Він вимагає account/NEW/direction/duplicate/restart та 30
  alternating B/C exact-peer checks із rename/reorder. Один wrong recipient
  переводить verdict у `NO_GO`; production Send завжди false.
- Redacted G3 evidence закриває duplicate та reader restart. Окремі bounded
  live proofs закрили account identity і direction; NEW та exact peer відкриті.
- Реалізована concrete account identity primitive: expected strict E.164
  порівнюється в RAM з єдиним guarded `ViberPC/<digits>/viber.db`; назовні
  повертаються лише HMAC account/source-generation refs. DB не відкривається,
  номер і шлях не експортуються. Live account gate потребує ще process/source
  continuity у контрольному запуску.

## Live account evidence — 2026-09-12

Bounded `verify_p1_account_live.py --auto-session` завершився
`ACCOUNT_VERIFIED`. Exact expected E.164 збігся з єдиним guarded account DB
directory; signed/same-owner Viber process був живий до і після перевірки;
source file identity не змінилася. `account_value_exported=false`,
`database_opened=false`, `messages_queried=false`, `messages_sent=0`.

У звіт не записані номер, account path, HMAC account ref або source-generation
ref. Цей доказ закриває `account_identity`, але не доводить active peer,
NEW-contact, exact peer або delivery.

## Live direction evidence — 2026-09-12

Керований `DESKTOP` marker було надіслано з поточного Viber Desktop, а
`PHONE` marker — з іншого акаунта у той самий чат. G3 reader зберіг обидві
події як окремі occurrences. Bounded verifier підтвердив рівно один marker
кожного типу, один chat identity та різні direction codes: inbound `0`,
outbound `1`. Ідентифікатори, імена, номери та тексти поза exact markers не
експортувалися; CRM не контактували, повідомлень bridge не надсилав.
Обидві нові події підтверджені в локальному test journal: total `4`, pending
`0`, acked `4`; повторний ACK не змінив стан.
- Ledger заборонено створювати всередині repository/OneDrive tree.

## Доказ

Команда:

```powershell
py -3.13 -B -m unittest discover -s docs/viber-personal-bridge/observer -p "test_*.py" -q
```

Поточний повний результат: **191 tests passed**. Нові P1 tests покривають scope mismatch,
unresolved contact, stale revision, active-peer mismatch, 100 повторів однієї
команди, collision dual IDs, взаємне виключення UI operations, restart після
dispatch, fail-closed source/account change, durable inbound ACK/replay,
distinct identical-text occurrences, identity conflict, timeout/non-200,
partial ACK і forged ACK.

Це `verified by synthetic tests`. Реальний Viber UI, акаунти A/B/C/D,
доставка peer і CRM transport цим прогоном не перевірялися.

Короткий live SID probe після додавання `--auto-session` виконав 46 poll cycles,
підтвердив target/source continuity і не експортував приватний текст. Наступний
snapshot зафіксував по одному `PHONE` і `DESKTOP`; окремий verifier закрив
direction gate. Попереднє звичайне повідомлення було коректно проігнороване.

Після дозволу на бойову перевірку реалізовано paired-only source mode. Він
знаходить один chat через контрольну пару `PHONE`/`DESKTOP`, приймає лише
події цього ChatID з підтвердженим inbound direction і очікуваним peer
ContactID, зберігає однакові тексти як різні EventID та fail-closed зупиняє
batch при зміні peer, chat, direction, надмірному розмірі або overflow.

Live read-only запуск на поточному Viber підтвердив anchor, direction і same
chat. Після anchor нових inbound occurrences на момент snapshot було 0, тому
цей запуск доводить готовність bounded paired query, але не нову post-anchor
доставку. Інші чати не читалися, текст та ідентифікатори не експортувалися.

Active-feed UIA verifier окремо знайшов обидва exact markers у поточному чаті.
Дві перші одноразові controlled Send-команди отримали durable local claims,
але завершилися `unknown`; reconciliation не знайшов їх outbound Events, а
повтор цих IDs заблокований. Точну власну test draft другої спроби видалено з
перевіркою порожнього composer.

Третя команда використала новий механізм: exact anchor check, один широкий Edit,
одну праву Send control, порожній composer, durable claim, точне введення,
повторну перевірку draft, перевірений foreground Viber HWND і keyboard Enter.
UI повернув `submitted_unconfirmed`, а read-only reconciliation знайшов рівно
один outbound Event того самого test ID у anchor ChatID з outbound direction.
Це **LIMITED paired-only Send proof**. Provider delivery/прочитання адресатом не
доведені; автоматичний Send для довільних чатів і production capability досі
вимкнені.

Окремий явно дозволений live-сценарій прочитав останній inbound лише з того самого
marker-anchored чату і надіслав одну Unicode-відповідь із emoji. Sender повернув
`submitted_unconfirmed`; read-only reconciliation знайшов рівно один outbound
Event із точним текстом у тому самому ChatID та з outbound direction. Візуальна
перевірка показала одну бульбашку в очікуваному чаті. Це доводить локальне
подання без дубля, але не provider delivery або прочитання адресатом. Для
Windows DPI scaling sender і діагностичні UIA scripts тепер явно вмикають
DPI-aware coordinates.

Другий явно дозволений live-сценарій виконав one-shot Unicode Send в інший
вручну відкритий чат. Контакт було підтверджено візуально до жесту, а після нього
візуально знайдено рівно одну бульбашку. Водночас exact header text цього layout
не був доступний через UI Automation, тому автоматична перевірка адресата
відмовила до dispatch. Відправлення через візуально підтверджений fallback є
лише операторським тестом і не закриває exact-peer gate для product sender.

Після відповіді в цьому чаті `latest_seeded_reply` знайшов у локальній Viber DB
єдине точне outbound-повідомлення, використав його ChatID як bounded seed і
прочитав найновішу post-seed inbound-подію з уже доведеним direction code.
Live verifier підтвердив `same_chat_verified=true` і
`direction_verified=true`, не експортував contact/chat IDs та нічого не
надсилав. Це вирішує ручне read-on-demand для такого тесту; background watcher,
durable outbox ingestion і CRM transport ще не підключені.

## Що лишається в P1

1. Підключити фактичний G3 reader adapter до готового inbound API ledger без
   збереження приватних ідентифікаторів у логах.
2. На тестових A/B/C/D довести account A, NEW від D, B/C з однаковими іменами,
   rename і 30 чергувань exact peer. До цього `send_text=false` у реальному
   adapter.
3. Реалізувати окремий UI worker, який отримує дозвіл ledger лише після
   фактичної перевірки відкритого peer. Оркестратор готовий, але concrete UI
   adapter навмисно відсутній до live identity gate.
4. Замінити injected test sink на реальний outbound HTTPS client із TLS,
   backoff/Retry-After та provisioning credential. Production CRM endpoints,
   auth, PostgreSQL і Railway не змінювалися.
5. Провести окремо дозволений bounded test-send лише після проходження identity
   gate. Поява бульбашки означає `submitted_unconfirmed`; delivery залишається
   `unknown` без незалежного підтвердження.

## Файли

- `observer/p1_bridge_core.py` — P1 identity і command ledger.
- `observer/test_p1_bridge_core.py` — синтетичні safety/recovery tests.
- `observer/p1_g3_adapter.py` — marker-only reader → durable outbox adapter.
- `observer/p1_transport.py` — strict batch/ACK layer без мережевих side effects.
- `observer/p1_dispatcher.py` — at-most-once orchestration для майбутнього UI adapter.
- `observer/p1_gate.py` — строгий evidence evaluator.
- `observer/p1_account_identity.py` — fail-closed account-directory proof.
- `observer/verify_p1_direction_live.py` — redacted controlled direction proof.
- `observer/p1_paired_queries.py` — fail-closed paired-only inbound query layer.
- `observer/verify_p1_paired_receive_live.py` — bounded live paired receive proof.
- `observer/Verify-ActiveMarkerChat.ps1` — exact-marker active-feed check.
- `observer/Inspect-ViberComposer.ps1` — redacted composer capability probe.
- `observer/Send-P1Controlled.ps1` — one-shot claimed paired-only sender; marker і Unicode reply перевірені як `submitted_unconfirmed`.
- `observer/Clear-P1ControlledDraft.ps1` — exact-owned test draft cleanup.
- `observer/verify_p1_send_reconcile_live.py` — read-only outbound reconciliation.
- `P1_GATE_CURRENT.json` — поточний redacted verdict без приватних даних.
- `observer/README.md` — запуск і межі.
