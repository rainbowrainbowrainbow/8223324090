# Viber Personal Bridge — контракт 1.0, проєкт

2026-09-11. **DRAFT, API не реалізований.** Це уточнений самодостатній проєкт для наступної задачі, а не друга версія вже працюючого протоколу. Узгодити його з [попереднім контрактом](../BRIDGE_CONTRACT.md) перед кодом. [Докази](RESEARCH.md), [gates](PROTOTYPE_PLAN.md). JSON нижче містить тільки синтетичні значення. Production impact: no.

## 1. Компоненти й довіра

Windows: локальний read-only source adapter → SQLite journal/outbox → HTTPS supervisor. Окремий UI worker виконує лише дозволені дії одного акаунта. CRM: Express gateway → PostgreSQL inbox/commands → Omni. Matrix, MCP, LLM та автоматичні відповіді не потрібні.

Тільки міст відкриває вихідні HTTPS-з'єднання до фіксованого CRM origin: long poll для команд, POST для подій/results/heartbeat. Перевірка TLS hostname/certificate обов'язкова, redirects до іншого origin заборонені. На Windows не відкривається публічний порт. Viber session, activation, DB key і binary material залишаються локально, не потрапляють у CRM/logs.

Enrollment видає credential для одного `(bridge_id, account_id, account_epoch, business_context)`, з мінімальними правами own-events-write/own-command-read/own-results-write/heartbeat. Server визначає scope з credential, не довіряє body. Невідомий або порожній context відхиляється, не нормалізується мовчки в PARK. Production provisioning — окрема реалізація, не shared admin credential. Windows Credential Manager/DPAPI для secret; приватний spool поза repo/OneDrive, ACL одного користувача, захист диска. Логи: IDs, counters, error codes; без повідомлень, номерів, screenshots та secrets.

Один supervisor/worker через OS mutex, одна UI operation від початку до quiescence. HTTP heartbeat незалежний від UI. При timeout недостатньо скасувати coroutine: заблокувати наступні дії, завершити завислий worker та підтвердити завершення процесу. Фізичний input не контролюється mutex; потрібна виділена session, operator_pause і revalidation після повернення керування.

## 2. Identity і достовірність

| Поле | Джерело / гарантія |
|---|---|
| bridge_id | UUID встановлення, виданий CRM; не Viber ID |
| account_id | UUID прив'язки CRM до погодженого номера; account fingerprint треба перевіряти локально |
| account_epoch | Ціле покоління прив'язки, змінює CRM при rebind; stale commands заборонені |
| source_generation | Opaque UUID покоління локальної DB, фіксується при enrollment; не reset при звичайному restart |
| runtime_id | Новий UUID кожного supervisor; не reset dedup/history |
| chat_id / peer_ref | Локальні registry IDs для source chat і доказового locator; display name не ключ |
| binding_revision | Версія locator; команда зі старою версією не виконується |
| event_id / sequence | Durable UUID occurrence та decimal-string sequence, збережені мостом до HTTP |
| source_event_ref | Opaque scoped reference на DB event; сильніша дедуплікація лише після gate його стабільності |
| provider_message_id | Тільки ID, доказово отриманий від провайдера; інакше null |
| observed_at / provider_occurred_at | Час спостереження host / час джерела з підтвердженою семантикою; другий може бути null |
| text/direction | DB/UIA/OCR source зазначається явно; OCR та geometry — heuristic, не verified |

DB local EventID/ChatID валідні лише в підтвердженому source_generation; їх не вважати глобальними IDs Viber. Немає гарантії збереження при relink/DB recreation. Виявлення reset/regression/account mismatch блокує читання/Send до контрольованої звірки; старі записи не зливаються за номером чи назвою. Windows SID, каталог і ChatInfo.Token не є універсальним доказом акаунта/peer.

Discovery із невстановленим peer видає `chat.discovered` або `observation.ambiguous`, а не вигадане нормалізоване повідомлення. Draft UUID не виправляє невизначену особу. Нерозв'язана identity забороняє remote Send та автоматичний link до клієнта.

## 3. Версії, endpoints, доставка подій

`protocol_version=1.0`: major mismatch → 426; minor узгоджується у session. Unknown required field/capability/command → 422, optional additive fields можуть ігноруватися. UTC RFC3339 timestamps; порядок визначається sequence, не clock. IDs не повторюються після restart.

| Запит моста | Результат |
|---|---|
| POST /api/omni/bridges/v1/session | Узгодження версії, capabilities, server time, lease/fencing_token |
| GET /api/omni/bridges/v1/commands?wait_seconds=25 | Durable commands; порожній список — нормальний idle |
| POST /api/omni/bridges/v1/command-acks | Підтвердження durable локального прийняття, не Send |
| POST /api/omni/bridges/v1/events | Per-event ACK після commit у CRM, включно з command.result |
| POST /api/omni/bridges/v1/heartbeat | Стан transport/source/UI; не ACK подій і не receipt |

Authorization/fencing — headers, не query. Lease 60 s, heartbeat 15 s; перед dispatch має лишатися ≥10 s lease за monotonic clock, прив'язаним до останнього server response. Старий clock/lease → pause. Другий runtime отримує 409; автоматичний takeover не допускається без припинення попереднього UI worker: Viber не розуміє fencing_token.

Пропоновані межі MVP: text ≤4000 Unicode code points та 16 KiB UTF-8, batch ≤50 events/10 commands, request ≤256 KiB. Це межі нашого прототипу, не тарифні/технічні гарантії Viber. Невідповідність відхиляється до UI. Жодного shell, довільного SQL, URL чи UI selectors у command payload.

Source adapter атомарно записує occurrence, progress і outbox в одну локальну transaction. Pending source relations не губляться при просуванні high-water mark: reread/reconciliation або явний gap. Повтори HTTP використовують той самий event_id. CRM transaction зберігає inbox dedup, нормалізований запис/result і ACK-стан. Лише після commit повертається ACK; пустий 200 не ACK. Після втрати відповіді CRM повертає duplicate ACK для вже записаної події. Конфлікт того самого ID з іншим payload → 409, quarantine, не overwrite.

Події з незалежними source identities не зливаються за текстом. Без source ID застосовується occurrence matcher з явною uncertainty; нерозв'язана повторність не дозволяє history_complete=true. Transport dedup забезпечує повторюваність уже зібраного event, а не повноту Viber capture. Payload outbox видаляється тільки після ACK; компактні dedup tombstones зберігаються на весь account epoch. 422 quarantined event лишається локально з діагностикою. 429/503 враховує Retry-After; network retry 1–30 s із jitter, без зміни identity.

Приклад вхідної події (умовний build, вже пройдений peer gate; це не поточні capabilities):

```json
{
  "protocol_version": "1.0",
  "type": "message.observed",
  "bridge_id": "11111111-1111-4111-8111-111111111111",
  "account_id": "22222222-2222-4222-8222-222222222222",
  "account_epoch": 1,
  "business_context": "event_genix",
  "source_generation": "33333333-3333-4333-8333-333333333333",
  "runtime_id": "44444444-4444-4444-8444-444444444444",
  "event_id": "55555555-5555-4555-8555-555555555555",
  "sequence": "12",
  "observed_at": "2026-09-11T12:00:00Z",
  "chat_id": "66666666-6666-4666-8666-666666666666",
  "data": {
    "peer_ref": "test-peer-b",
    "binding_revision": 1,
    "identity_level": "verified_local",
    "source": "local_db",
    "source_event_ref": "test-source-occurrence-12",
    "provider_message_id": null,
    "provider_occurred_at": null,
    "direction": "inbound",
    "direction_evidence": "controlled_build_test",
    "origin": "peer",
    "text": "SYNTHETIC-DUP",
    "related_command_id": null
  }
}
```

ACK після CRM commit (контекст перевірений headers та body):

```json
{
  "protocol_version": "1.0",
  "bridge_id": "11111111-1111-4111-8111-111111111111",
  "account_epoch": 1,
  "accepted": [{"event_id": "55555555-5555-4555-8555-555555555555", "status": "stored"}],
  "rejected": []
}
```

Для повтору status=`duplicate`. Два однакові тексти, але різні source occurrences → два event_id та два повідомлення. PHONE/Desktop outbound зберігаються з direction=outbound, origin=external_or_unknown, а не запускають новий Send. Збіг тексту/часу з командою не є достатнім доказом її виконання; related_command_id лишається null без сильного кореляційного доказу.

## 4. Команди та невизначеність

Обидва IDs унікальні в account epoch: command_id і client_request_id. Точний повтор повертає попередній стан; той самий ID з іншими account/target/text/attachment/revision або новий command_id зі старим client_request_id → 409. Payload fingerprint містить точний текст без trim/нормалізації, chat, binding revision, epoch і checksum вкладення, коли воно буде дозволене. Pending команди не зникають після HTTP видачі.

```json
{
  "protocol_version": "1.0",
  "type": "send.text",
  "bridge_id": "11111111-1111-4111-8111-111111111111",
  "account_id": "22222222-2222-4222-8222-222222222222",
  "account_epoch": 1,
  "business_context": "event_genix",
  "source_generation": "33333333-3333-4333-8333-333333333333",
  "command_id": "77777777-7777-4777-8777-777777777777",
  "client_request_id": "88888888-8888-4888-8888-888888888888",
  "chat_id": "66666666-6666-4666-8666-666666666666",
  "binding_revision": 1,
  "expires_at": "2026-09-11T12:05:00Z",
  "data": {"text": "SYNTHETIC-REPLY", "attachment_id": null}
}
```

State machine: `accepted → preparing → dispatch_started → submitted_unconfirmed | unknown`. До dispatch дозволені terminal `rejected`, `expired`, `cancelled`, `failed_before_dispatch` лише за доказу, що gesture не було. Локальний command-ack видається після durable accepted. Безпечне продовження preparing потребує нового scope/lease/expiry/account/peer/draft check.

Безпосередньо перед UI gesture worker записує durable dispatch_started. Crash навіть між цим записом і gesture → unknown, без автоматичного повтору. Після gesture поява бульбашки → submitted_unconfirmed, delivery=unknown; timeout/exception → unknown. Максимум одна Send-спроба на command, а не обіцянка exactly-once provider delivery. Не повторювати Enter після невизначеного click. Непорожня чернетка → DRAFT_PRESENT без її стирання.

Command result використовує той самий event envelope; нижче поле data події command.result:

```json
{
  "command_id": "77777777-7777-4777-8777-777777777777",
  "client_request_id": "88888888-8888-4888-8888-888888888888",
  "result_revision": 2,
  "execution_state": "unknown",
  "delivery_state": "unknown",
  "provider_message_id": null,
  "reason_code": "TIMEOUT_AFTER_DISPATCH",
  "retry_safe": false,
  "evidence": {"dispatch_started": true, "bubble_observed": false, "provider_receipt": false}
}
```

Результат зберігається в outbox до ACK. CRM застосовує result_revision монотонно: старий delayed accepted не перекриває unknown. Ручна звірка — окремий запис actor/time/outcome/evidence; не змінює provider receipt. Перевірка статусу читає journal, ніколи не надсилає повторно. Після unknown нова команда з тим самим наміром потребує явної нової дії менеджера після звірки, не автоматичного створення нового client_request_id.

## 5. Heartbeat і capabilities

Приклад heartbeat data для поточного рівня доказів:

```json
{
  "runtime_id": "44444444-4444-4444-8444-444444444444",
  "worker_alive": true,
  "source_poll_healthy": true,
  "last_source_check_at": "2026-09-11T12:00:00Z",
  "last_successful_inbound_at": null,
  "inbound_verified": false,
  "receive_coverage": "test_markers_only",
  "account_verified": false,
  "recipient_verified": false,
  "ui_state": "not_checked",
  "pending_events": 0,
  "pending_commands": 0,
  "capabilities": {
    "observe_text": "experimental",
    "discover_unknown_chats": false,
    "stable_source_ids": "same_source_generation_only",
    "send_text": false,
    "attachments": [],
    "delivery_receipts": false,
    "history_complete": false
  }
}
```

Heartbeat stale після 45 s, source check stale після 90 s — початкові налаштування прототипу. Відсутність нового звернення не помилка. Receive-ready вимагає свіжої успішної перевірки джерела, account continuity, відомого coverage та відсутності gaps; heartbeat сам по собі цього не доводить. Missing timestamp → null, не поточний час. Health updates не підтверджують доставку на телефон співрозмовника.

Capabilities прив'язані до перевіреного build/schema/adapter revision, повертаються консервативно. `send_text=false` до exact account/recipient gate; attachments порожні до binary tests. SMS/ботові формати не успадковуються автоматично. Для непідтримуваної події — diagnostic event, не вигаданий текстовий файл. Новий build або scope mismatch негайно знижує capabilities.

## 6. Помилки та відновлення

| Код | Дія |
|---|---|
| AUTH_REVOKED / SCOPE_MISMATCH / ACCOUNT_MISMATCH | Stop commands; не fallback до іншого акаунта/бізнесу |
| PEER_UNVERIFIED / BINDING_STALE / DRAFT_PRESENT | Reject до gesture; потрібна локальна звірка |
| SOURCE_UNREADABLE / SCHEMA_CHANGED / SOURCE_GENERATION_CHANGED | Receive unhealthy; зберегти outbox/baseline; контрольоване відновлення |
| CAPTURE_GAP / IDENTITY_AMBIGUOUS | Durable diagnostic; не history_complete; unresolved peer не auto-link |
| UI_BLOCKED / UI_WORKER_STUCK | Pause; підтвердити quiescence, потім account/peer revalidation |
| STORAGE_FULL / JOURNAL_LOST | Stop Send; не створювати порожній journal зі свіжою baseline |
| TIMEOUT_AFTER_DISPATCH / RECOVERED_INFLIGHT | Unknown; без resend, навіть після reinstall/restart |
| PAYLOAD_CONFLICT / UNSUPPORTED_CAPABILITY | 409/422 до UI; quarantine/явна помилка |

Старий journal backup також може повторити вже виконану команду: відновлення потребує CRM command inventory reconciliation і нового контрольованого epoch, зі старими unresolved commands заблокованими. Звичайний restart зберігає epoch/source generation/cursor/IDs. Відкриття DB після crash, relink і update — різні gates. Повторний memory scan, injection чи rekey не є автоматичним fallback цього контракту.

## 7. Сумісність Omni

UI label: «Viber — особистий акаунт». Channel може лишитися viber лише якщо кожна conversation/command надійно прив'язана до окремого connection/account ID. Бот і personal provider не перемикаються для старого діалогу через один поточний channel setting. Existing `(business_context, channel)` upsert потребує окремого рішення на актуальному SHA; схема не змінюється тут.

Omni send повертає accepted/queued, а не delivered. Async events оновлюють історію, unknown і ручну звірку, зберігаючи client_request_id. Polling має оновлювати controls без втрати draft. Нові auth/API/DB contracts і міграції — окремий погоджений інтеграційний реліз із PostgreSQL concurrency tests. Поки gates не пройдені, не показувати конектор як готовий до повсякденної роботи.
