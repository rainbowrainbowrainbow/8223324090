# G3 — bounded reader зі збереженим з'єднанням

Дата: **2026-09-11**. Production impact: no.

**Поточне доповнення:** [SID recovery](KEY_ORIGIN_REPORT.md) відновив schema access без restart/RAM scan. [Короткий SID launcher уже пройшов DUP/restart/local ACK на контрольних маркерах](G3_REPORT.md). Цей звіт нижче описує попередній listener і його тодішній bootstrap blocker; довгий `--listen` автоматично на SID не переключений.

**Результат: режим `--listen` реалізовано й перевірено на синтетичних даних, включно зі справжнім встановленим Qt/SEE plugin.** Один успішно відкритий read-only source connection використовується протягом усього сеансу до 600 секунд. Це усуває закриття reader між окремими повідомленнями тесту. Фактичний доступ до поточного акаунта й читання надісланих DUP залишаються непідтвердженими: ця зміна не відновлює вже втрачений параметр відкриття DB.

Результат для всього моста — **LIMITED**. Цей етап виконано без перезапуску Windows/Viber, доступу до пам'яті/акаунта Viber, Send або змін CRM. Встановлена DLL використовувалася лише для власної синтетичної DB. [Попередній live blocker](G3_REPORT.md), [машинний результат](observer/G3_LISTENER_RESULT.json).

## Що змінилося

| Область | Реалізація |
|---|---|
| [observe_g3.py](observer/observe_g3.py) | Новий `--listen`, 1..600 s, default 600; один пошук параметра й один source connection на сеанс. Legacy short probes лишаються 0..45 s |
| [g3_listener.py](observer/g3_listener.py) | Supervisor одного власного child, bounded JSONL, статус, stdin `stop`, EOF cancellation, startup/stop/exit/deadline watchdog, reap саме створеного subprocess |
| [g3_process.py](observer/g3_process.py) | Listener тримає query-only handle перевіреного Viber process; exit цього процесу зупиняє reader. PID не шукається повторно щосекунди |
| Poll loop | Короткий source transaction з rollback після кожного poll; source path uniqueness і file identity звіряються повторно. Немає 10-хвилинної відкритої read transaction |
| Journal | Незмінна початкова baseline, source-ID dedup, atomic event/progress transaction; `stop` не підтверджує pending-події. Local ACK у listener вимкнений |
| Cleanup | Відмова одного close не пропускає cleanup інших ресурсів; помилка повертається fixed enum. Немає автоматичного повторного відкриття, перескановування RAM або restart Viber |

Зміни розташовані лише в `docs/viber-personal-bridge/`. Нові production dependencies, інтеграції, credentials, міграції, Railway settings і релізні зміни не додавались. Незалежні локальні зміни CRM збережено.

## Статус процесу та читання

Supervisor показує два незалежні факти:

- `worker_alive` — власний subprocess ще працює;
- `source_poll_healthy` — нещодавно надійшов валідний результат нового source poll; до першого успішного poll, після stop, stale poll або final цей прапорець false;
- `inbound_verified` — **завжди false у цьому дослідному статусі**. SQL progress і живий Viber process не доводять мережеве приймання, active account identity чи доставку.

Внутрішній worker надсилає progress після кожного успішного poll. Supervisor показує перший результат, зміни з обмеженням частоти та heartbeat кожні 5 секунд. Payload лишається закритим public JSON; приватні source IDs, імена, номери, ключі або Body не виводяться. `reobserved` — сума повторних спостережень за всі polls, а не число різних повідомлень.

Синтетичний приклад heartbeat:

```json
{"kind":"heartbeat","worker_alive":true,"source_poll_healthy":false,"inbound_verified":false,"last_progress_age_ms":null,"stop_requested":false}
```

## Запуск і зупинка

Запускати з інтерактивного термінала, щоб stdin лишався відкритим. Передавати **існуючий** `session_path` G3; `--prepare` не є відновленням.

```powershell
py -3.13 -I -B docs/viber-personal-bridge/observer/observe_g3.py --listen --seconds 600 --session "<existing session_path>"
```

Для дострокової зупинки в тому самому терміналі ввести `stop` і Enter. Закриття stdin також просить зупинку. Не передавати пароль, номер, ключ або довільні команди. `--local-ack-test` разом із `--listen` відхиляється. Не запускати кілька reader: старий session lock використовується й у новому режимі.

Startup має deadline 45 s. Після operator stop supervisor дає коротку паузу для cleanup, потім завершує тільки власний subprocess. Граничний час supervisor — startup + задане вікно + до 5 s cleanup. Окремий timer усередині worker завершує **сам worker** після закриття керуючого каналу/stop, якщо цикл не повертається; він не звертається до PID Viber. Постійний сервіс, scheduled task або автозапуск не встановлюються.

**Межа watchdog proof:** normal stop, EOF, invalid output, startup stall, deadline і KeyboardInterrupt перевірені. Симульований worker, що не перевіряє stop, завершився сам після EOF. Одночасне раптове знищення supervisor і native hang, який утримує Python GIL, не покрите абсолютною гарантією: kill-on-close Windows Job Object тут не реалізований. Це допустима межа короткого лабораторного досліду, не обіцянка production no-orphan.

## Виконані перевірки

Спільний цільовий прогін `test_g3_*.py` пройшов без помилок. Він включає попередні journal/query/adapter tests та нові lifecycle, supervisor, process guard і control-pipe tests. [Точні числа та додаткові focused runs](observer/G3_LISTENER_RESULT.json).

Lifecycle tests викликають фактичний `worker`, реальні `g3_queries`/`Journal`, але підміняють зовнішні Qt/source/process helpers власним synthetic adapter. Перевірені один open/один candidate scan для кількох polls, deepcopy progress, дві однакові події, stop без ACK, збереження pending після reopen, late hydration, query/cleanup failure і process exit.

Окремий [verify_g3_qt_session.py](observer/verify_g3_qt_session.py) запущено в обмеженому subprocess із перевіреними G2 bindings. Справжній встановлений Qt/SEE driver відкрив **одну власну plain SQLite DB read-only**. Після першого poll окремий Python writer додав два однакових маркери. Той самий Qt connection побачив обидва; наступний poll їх не продублював. Після reopen journal зберіг два окремі pending events. Попередній readonly fixture цього plugin теж пройшов.

Результат Qt harness: `SYNTHETIC_ONLY`, source connections = 1, polls = 3, distinct duplicate events = 2, pending after reopen = 2. Він не є тестом encrypted account DB або live Viber inbox. Загальну CRM suite і production QA не запускали: CRM не змінювалася.

## Наступний gate

Коли вдасться знову відкрити поточну Viber DB, запускати цей bounded listener зі старою session `0B038E78`, а не серію коротких probes. Уже надіслані `EGXG3-0B038E78-DUP` повторювати не потрібно. Потрібно побачити два source EventID одного ChatID, перевірити pending/replay і лише потім локальний ACK окремим кроком. Після цього — NEW/contact/direction/recipient gates.

Надійна reacquisition після crash, відсутній PRAGMA-параметр у поточному процесі, active recipient, offline/RDP/lock, оновлення Viber й реальні вкладення залишаються відкритими. Довгоживуче з'єднання допомагає **після успішного open**; іншого підтвердженого способу поточного open ця зміна не додає. Синтетичний PASS не змінює live DUP на PASS і не вмикає production Send.
