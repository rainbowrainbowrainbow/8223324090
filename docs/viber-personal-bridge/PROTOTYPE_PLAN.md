# Viber Personal Bridge — план тестового прототипу

> **Поточне рішення, 2026-09-11: LIMITED.** [SID recovery](KEY_ORIGIN_REPORT.md) та [G3 DUP/restart reader/local ACK](G3_REPORT.md) пройшли фактичні перевірки без restart Windows/Viber. Далі — NEW/account/active peer gates зі старою session. 113 focused synthetic tests доповнюють вузький live proof. Повторно надсилати DUP не потрібно. Production Send NO-GO. Історичні G2/G3 назви UIA етапів нижче не є статусами нових DB-дослідів.

Дата: 2026-09-11. Рішення на вході: **LIMITED**, без дозволу на production integration. Поточна основа: власний read-only Windows DB reader з build-pinned SID bootstrap; UIA лишається окремим sender experiment. `rusty4444/viber-matrix-bridge` — довідник реалізації й помилок, не готовий transport. [Докази](RESEARCH.md), [контракт](BRIDGE_CONTRACT.md).

**Виконано G1 UIA дослід, G2 schema proof, SID recovery і контрольний G3 DUP/restart/local ACK.** Власник дозволив поточний акаунт; окремий акаунт не є повторною передумовою цього читання. [G1](G1_REPORT.md) не довів адресата; [G2](G2_REPORT.md) довів схему; [G3](G3_REPORT.md) зберіг дві distinct DUP події без повторного запису після restart reader. NEW/PHONE/DESKTOP/RENAME, Send, restart самого Viber та мережеві faults не виконані. Зміни auth/DB/API та реліз CRM не входять у цей етап.

## Поточні наступні кроки DB-досліду

**Reboot Windows не потрібний для підтвердженого SID bootstrap.** [Bounded `--listen`](G3_LISTENER_REPORT.md) перевірений на власній DB; короткий SID reader уже використав стару baseline у чотирьох fresh processes. Crash, restart самого Viber, lock/RDP та update залишаються окремими fault gates. Повний transport/CRM продукт до source/recipient proof не будуємо.

Якщо обрано саме restart experiment: після попереднього «перезапустив» Windows показала uptime Viber **20 749 s**, отже новий process не був підтверджений. Для такого досліду перевірити нову process identity/uptime перед RAM probe; просте закриття вікна не зараховується. Цей факт не робить restart передумовою будь-якого подальшого дослідження. [Evidence](observer/G3_RESTART_ATTEMPT.json).

1. **G3 recovery/duplicates — виконано:** два EventID одного ChatID, повторне відкриття reader без нових записів, local ACK/retry і ще один restart після ACK. Total залишився 2, pending після ACK — 0. Та сама session/baseline. Це тест локального consumer, не ACK CRM. [Evidence](G3_REPORT.md), [команди](observer/README.md).
2. **G3 discovery/identity:** невідомий співрозмовник надсилає `EGXG3-0B038E78-NEW`; далі controlled PHONE/DESKTOP/RENAME. Потрібні інші керовані акаунти, підтвердження напрямку й передумови невідомого контакту; номери/листи у звіт не копіюються.
3. **Окремий sender gate:** доказ active recipient перед будь-яким Send; якщо його немає, залишаємо read-only/manual assist. Reader source ContactID не підміняє перевірку відкритого адресата.
4. **Після feasibility:** command ledger/outbound HTTPS/CRM ACK/fault tests, потім незалежний реліз CRM. Наявний G3 ACK лише локальна симуляція consumer. Без Sender proof повний продукт не будується.

Поточний інструмент використовує Python **3.13.2**, перевірені Qt 6.8.3 bindings з G2 і встановлений Viber SEE plugin. Власний стан — приватний Windows каталог поза OneDrive; Viber session/key туди не копіюються. Вимоги 3.12/UIA нижче стосуються попереднього плану, не поточного DPAPI/ACL helper.

## 1. Мета й межа MVP

Довести, що для одного звичайного тестового Viber-акаунта з номером можна без помилок визначати адресата, спостерігати текстові події, виконати не більше однієї Send-спроби на CRM command і не губити вже збережені події після crash/network failure.

Перша перевірка — **можливості джерела**, потім transport. Якщо не можна надійно відкрити/звірити адресата, remote Send не будується. Якщо не можна прийняти новий unpaired контакт, результат не називається повноцінним Omni, навіть якщо три заздалегідь відомі чати працюють.

Межа: один bridge, один business (`event_genix`), один account, три one-to-one тестові чати, текст. Без AI/автовідповідей, groups, campaign/broadcast, історичного імпорту, фото/PDF transport, перенесення сесій або production records. DAR використовується тільки як чужий synthetic scope у негативних protocol tests, не як другий реальний акаунт.

## 2. Що потрібно для наступного етапу

| Ресурс | Конкретна вимога / навіщо |
|---|---|
| Windows host | Окрема Windows 11 x64 машина, практичний старт 4 CPU cores / 8 GB RAM / 10 GB free disk. Це бюджет прототипу, не вимога Viber. Надійна мережа, живлення; бажано UPS для наступного soak |
| Desktop session | Окремий звичайний user, інтерактивний console desktop; міст і Viber у тій самій session. Не Windows service Session 0; logon запуск можна оформити пізніше. Не машинa, на якій одночасно працює менеджер |
| Екран | Перший baseline: один монітор 1920×1080, 100% DPI, зафіксований розмір Viber, без overlay. Потім обов’язково 125/150% DPI, resize, друге вікно й side panel; baseline не виправдовує тихий misroute поза ним |
| Bridge account A | Один окремий тестовий номер/SIM і телефон із Viber, без реальних контактів/історії; ручна реєстрація/QR Desktop activation власником. Session не копіюється в repo або хмарний диск |
| Peer accounts B/C/D | Три окремі тестові номери й пристрої/доступні тестові телефони. B і C — однаковий display name; D не доданий у контакти/registry A та має почати нове звернення. Можна використати три вже наявні виключно тестові акаунти |
| Desktop-повідомлення | Ручний send із Desktop A тільки під час `operator_pause`, після quiescence worker. Phone A можна використовувати паралельно для sync test. Друга Desktop session того самого акаунта не вважається гарантованою можливістю — її поведінку потрібно перевіряти окремо |
| Інструменти | Офіційний Viber installer, Python 3.12 x64, reviewed/pinned UIA dependencies, Windows Accessibility Insights/Inspect для тестового дерева. Нічого не встановлюється цим research task; перед виконанням потрібен окремий погоджений implementation block |
| Protocol test sink | Окремий локальний Node.js 22 / Express test harness із durable storage та HTTPS через trusted test CA; або isolated staging у наступному етапі. Windows довіряє test CA, TLS verification не вимикається. Це synthetic backend, не production CRM |
| Зберігання | Приватний каталог поза repo, OneDrive і shared folders; ACL + encrypted disk; journal/outbox та registry окремо від Viber DB. Credentials через Credential Manager/DPAPI |
| Evidence | Окрема таблиця synthetic test IDs, чисел і redacted diagnostics. Немає номерів телефонів, auth headers, листування чи full UI dumps у git. Зображення лише із синтетичних чатів і після перевірки відсутності приватних деталей |

Спочатку записати точні Windows build, Viber product/file version, Python і бібліотеки, locale, DPI, screen dimensions, selector fingerprint. На поточному ПК підтверджено Viber **26.3.2**; решта доступних характеристик і прогалини наведені в [G1_REPORT.md](G1_REPORT.md). Підтримувані платформи Viber та порядок activation перевіряються за [офіційними платформами](https://help.viber.com/hc/en-us/articles/9210039148189-Supported-platforms) і [Desktop setup](https://help.viber.com/hc/en-us/articles/9084593040285-Set-up-Viber-on-your-desktop).

Не застосовувати чужі bundled APK/.exe/.so/install-service scripts. Android/Appium-проєкт має сторонній APK, scripts збереження session і налаштування export; вони не потрібні Windows-прототипу. Linux DB hook — окрема можлива research-гілка, без extracting keys у цьому плані. Не вимикати захист усієї робочої Windows заради UI automation: lock/disconnect повинні приводити до безпечної паузи. Обмеження RDP/service описані в [pywinauto remote execution](https://pywinauto.readthedocs.io/en/latest/remote_execution.html).

## 3. П’ять послідовних етапів із stop gates

Оцінка — 4–6 робочих днів після надання обладнання/акаунтів, включно з 24 h soak; це планувальне припущення, не обіцянка готового продукту. **G1 timebox — до одного робочого дня**. Якщо потрібне принципово нове джерело identity, не витрачати решту часу на HTTPS-обгортку.

### Етап 1 — G1: account/recipient/discovery feasibility

**Goal:** перевірити, чи може UIA дати дані, достатні для personal Omni.

**Scope:** лише test A/B/C/D, read-only observation/navigation. До G1 Send вимкнений у worker.

**Steps:** вручну зареєструвати тестовий A, зафіксувати build; створити мінімальний reviewed observer без upstream `bridge.py` startup; дослідити account/profile, chat list, message viewport і contact profile. B/C однаково назвати, змінити одну назву; перевірити стійкий locator незалежно від query/display name. D пише A вперше, без pre-pairing; спробувати знайти подію й точний peer. Порівняти UIA дані до/після Viber restart. Окремо перевірити, чи можна отримати direction/occurrence ID або лише geometry/text.

**Done when:** збережена таблиця «поле → actual UI source → stable across restart/rename → точні обмеження», не повний приватний dump. Peer verified locator має належати **відкритому чату**, account verification — запущеній сесії. Присвоєння UUID або successful navigation не проходять gate. Мінімум 30 відкриттів B/C у змінному порядку, нуль помилкових звірок; неоднозначність завжди abort. D прийнятий без ручного додавання до registry — окремий full-Omni gate.

**Live-site QA:** відсутній; тільки тестові Viber accounts на лабораторній машині в наступному етапі.

**Notes/Risks:** якщо exact recipient unavailable — **NO-GO remote Send**, лише manual-assist. Якщо unavailable new-contact discovery — **LIMITED paired-only**, зафіксувати блокер повного Omni. Не маскувати це ручним `pairhere`. Якщо неможливо відрізнити повтори — history completeness залишається false, full GO заборонений.

### Етап 2 — G2: durable transport без реального Send

**Goal:** перевірити контракт незалежно від крихкого Desktop.

**Scope:** окремий каталог/репозиторій моста, synthetic sink, SQLite journal/outbox, HTTP fault injector; fake Desktop adapter лише як явний тестовий double, не product stub.

**Steps:** реалізувати outbound HTTPS poll/events/ACK/heartbeat, scope validation, command/result states і dual-ID idempotency. Одна атомарна transaction observation+cursor+outbox; один active supervisor і окремий worker process. Впровадити crash points до/після durable `dispatch_started`, ACK loss, network fault, clock offset, expired command, storage full. Не імпортувати runtime upstream. Не запускати shell або довільні selectors із command body.

**Done when:** protocol tests T08–T17 нижче проходять на synthetic fake adapter, send gesture counter ніколи >1 на command; дублікати events не збільшують CRM record count; усі unacked events переживають restart. `unknown` не стає failed/retryable. Heartbeat працює при завислому UI process. Це доказ нашого transport, **не доказ Viber delivery**.

**Live-site QA:** не потрібен; production endpoint недоступний із test config.

**Notes/Risks:** локальна DB моста дозволена лише implementation block наступного етапу; PostgreSQL/CRM schema зараз не змінюється. Provisioning/auth для production не реалізовувати в межах лабораторного sink.

### Етап 3 — G3: текстове receive/send з доказовим адресатом

**Goal:** під’єднати лише можливості, реально підтверджені G1.

**Scope:** три текстові one-to-one чати, operator-issued commands, Viber UI worker; attachments і AI off.

**Steps:** прибрати name/topmost/blind-click acceptance, Enter fallback після click і sender-independent echo suppression; перевіряти exact locator перед кожним Send. Вести registry revision, conservative viewport matcher, external outbound observations і explicit gaps. Не очищувати існуючий draft. Реалізувати `operator_pause`/resume із quiescence та revalidation. Спочатку навігація без тексту, потім test command в один чат, далі B/C із однаковими назвами й усіма concurrency сценаріями.

**Done when:** щонайменше 60 synthetic outbound commands (по 20 на B/C/D, якщо D ідентифікований і дозволений) із 0 wrong-recipient, 0 повторними Send-спробами. Кожен command викликається повторно через transport; саме число реальних повідомлень визначається independent peer observation. Якщо D не проходить G1, третій paired test chat можна створити вручну лише для LIMITED-перевірки й явно не зараховувати як unknown-contact pass.

Вхідний набір: 30 синтетичних messages на peer, серед них 5 пар однакових підряд; порядок/кількість зіставити з незалежним журналом відправника. По 10 outbound із телефона A та Desktop A; не зникли і не стали inbound. Для identical text і concurrency помилка/неоднозначність записується як gap; для full GO жодної такої невирішеної події бути не має.

**Live-site QA:** тільки test sink + Viber test accounts, без Omni production.

**Notes/Risks:** payload може бути реальним повідомленням тестового Viber, але в звіті тільки synthetic marker/count. `submitted_unconfirmed` лишається unknown delivery навіть при появі бульбашки. Перевірка приймання на peer потрібна для acceptance test, не для вигаданого автоматичного receipt.

### Етап 4 — G4: recovery, update і 24 h soak

**Goal:** виміряти деградацію й відновлення, а не лише happy path.

**Scope:** той самий account/чати/build; контрольовані аварії bridge, Viber, мережі й desktop session.

**Steps:** виконати fault matrix; кожний crash point повторити 5 разів на синтетичних commands, зберігаючи результат ledger. Тестувати RDP minimize/disconnect, lock/unlock, Viber offline і login screen, зміну DPI/window. Unknown outcomes вручну звірити на peer, не надсилати повторно. Протягом 24 h ручні bursts у визначені оператором моменти, без автоматичних відповідей. Якщо доступне офіційне оновлення Viber, провести stop/update/revalidate; інакше лише simulated version mismatch і позначка U для actual upgrade.

**Done when:** усі durable events ACKed після відновлення sink; немає відновленого Send із `dispatch_started`; немає перекриття UI workers. Heartbeat stale ≤45 s, receive stale ≤90 s для трьох чатів. У здоровому стані prototype target p95 capture→sink ≤30 s; збирається також max. Ці числа не SLA product. Locked/offline інтервали позначені gaps/blocked, не «успішним прийманням».

**Live-site QA:** тільки лабораторні акаунти. Reboot/lock застосовувати виключно до виділеної машини.

**Notes/Risks:** 24 h та нуль помилок на обмеженому наборі не доводять необмеженої стабільності. Update compatibility без actual update test лишається U. Відкриття чатів reader може змінювати unread/read стан Viber — це окремо виміряти, не приховувати.

### Етап 5 — G5: рішення й окреме завдання на інтеграцію

**Goal:** прийняти рішення на основі evidence manifest.

**Scope:** результати, залишкові gaps, перелік capabilities; без релізу CRM.

**Steps:** для кожного тесту записати PASS/FAIL/NOT RUN, build, count, result IDs, fault point, evidence source. Зіставити observed events із peer/phone journal; провести final sanity pass. Перед майбутньою інтеграцією окремо прочитати актуальні Omni send/client_request_id/businessContext/diagnostics/AI paths і запропонувати adapter, unique constraints та async result mapping.

**Done when:** один із висновків нижче, затверджена capability matrix й перелік невиконаних тестів. Новий integration task містить конкретні protected зміни, scoped auth, DB migrations, tests та release stages; цей research не дає дозволу їх виконати.

**Live-site QA:** у майбутньому релізі — один test bridge/test account, read-only production diagnostics і тільки погоджені safe test records. Поточний етап не має live QA.

**Notes/Risks:** не видавати smoke test або працездатний README за готовий канал менеджерів. При провалі G1 закрити feasibility висновком; не добудовувати всю інфраструктуру «на майбутнє».

## 4. Acceptance / fault matrix

У колонці «очікування» — вимоги, **не результати виконання**. Стан усіх T01–T25 зараз: **NOT RUN**.

| ID | Перевірка | Очікування / gate |
|---|---|---|
| T01 | B/C однакові імена, різні номери; 30 alternating opens | Exact opened peer звіряється без name-only; за неоднозначності 0 Send. G1 |
| T02 | Rename контакту + Viber/worker restart | Незмінний local chat_id, registry прив’язаний до того самого peer; старий locator не підставляється. G1 |
| T03 | D пише вперше, не у контактах, registry порожній для D | Подія знаходиться без manual pairing, identity unresolved не auto-links client. Відсутність discovery = full-Omni blocker. G1 |
| T04 | Два `Так` підряд, два emoji-only, однаковий multiline, довгий текст | Кожна реальна occurrence збережена окремо; Cyrillic не «verified» через порожню ASCII signature. G3 |
| T05 | CRM→peer, phone A→peer, Desktop A→peer, peer повторює той самий текст | Правильні direction/origin або явна ambiguity; не губиться відповідь peer; жодної автопересилки назад. G3 |
| T06 | Два managers дають різні commands одночасно | FIFO/детермінований порядок, один UI owner, адресат звірений для кожної операції. G2/G3 |
| T07 | Новий inbound переміщує sidebar row між locate і click; оператор змінює focus/window | Worker revalidates exact peer; mismatch abort/pause, нуль wrong-recipient. G3 |
| T08 | 100 concurrent/repeated copies одного command_id/client_request_id | Рівно один journal entry, максимум одна Send-спроба; повертається original state. G2 |
| T09 | Той самий command_id з іншим text/target; новий command_id зі старим client_request_id | 409, нуль додаткових side effects. G2 |
| T10 | Sink commit event, але загубити ACK; повторити event 10 разів | Один normalized record, durable duplicate ACK; outbox видаляє payload лише після valid ACK. G2 |
| T11 | Timeout одразу після Send; delivery на peer могла відбутися | `unknown`, retry_safe=false, без resend; peer evidence записується незалежно. G2/G4 |
| T12 | Crash до accepted; після accepted; у preparing; після durable dispatch_started до click; після click до result commit | До dispatch — eligible continuation лише після revalidation/expiry check; після dispatch_started — unknown, без автоматичного повтору. Кожний point ×5. G2/G4 |
| T13 | UI worker завис, timeout wrapper повернувся, старий worker намагається клікнути пізніше | Черга заблокована до завершення worker; жодної другої UI operation паралельно. Heartbeat supervisor живий. G2/G4 |
| T14 | Bridge restart при outbox>0; 15 min CRM network offline, потім відновлення | Усі durable events доставлені, same IDs; cursor не просувається окремо від outbox. G2/G4 |
| T15 | Втрачена/стара SQLite journal backup | `JOURNAL_LOST`, send disabled; відновлення inventory/epoch не запускає старі commands. G2 |
| T16 | PARK credential із DAR body, інший account/bridge/epoch, expired/revoked credential | Reject до читання чужої команди й до UI; жодного default scope. G2 |
| T17 | Command expiry у черзі/перед click; clock skew; invalid TLS; unknown major; oversized packet | Fail closed, нуль Send; transport retry не змінює IDs. G2 |
| T18 | Lock Windows; RDP minimize/disconnect; unlock/reconnect | receive blocked/stale незалежно від heartbeat; перед resume account/peer revalidation. Поведінка capture під lock вимірюється, не припускається. G4 |
| T19 | Viber offline при активній CRM; peer offline; reconnect | Не називати локальну bubble доставленою; queued Viber message може піти пізніше, тому без resend. G4 |
| T20 | Viber restart/logout/account switch; старі UIA handles | Нова attachment/identity перевірка, stale handles не використовуються; account mismatch блокує command. G1/G4 |
| T21 | Понад 20 inbound між scans, scroll away, два однакові marker, missed overlap | Backlog зібраний або явний gap; жодного silent oldest-half discard. Full GO потребує розв’язаної completeness проблеми. G3/G4 |
| T22 | Непорожній draft, resize/DPI 125/150%, side panel, інша мова UI | Draft не знищено; exact target збережений або abort; layout mismatch вимикає Send. G3/G4 |
| T23 | Офіційний Viber update / simulated build mismatch | Автопауза, зміна capability revision, повтор G1/G3; simulated pass не зараховується як actual update pass. G4 |
| T24 | Peer вручну надсилає synthetic PNG і односторінковий PDF; CRM просить attachment send | Зафіксувати, чи видно лише marker/filename/thumbnail; не називати їх file bytes. Attachment send відхиляється до UI. Binary transfer лише окремим етапом. G3 |
| T25 | 24 h soak, silent inbox, UI reader failure, disk full, out-of-order events і poison event | Окремі transport/receive health; stop new send при storage failure; quarantine не ACK-втрата; per-chat coverage/gaps видно. G4 |

## 5. Evidence manifest і критерії готовності

Один локальний redacted manifest для run: `run_id`, timestamp, Windows/Viber/Python/dependency versions, tested SHA нашого worker, protocol version, selector fingerprint, test ID, input occurrence count, expected peer alias, actual peer alias, received event count, dispatch gesture count, unknown count, capture gaps, recovery time, PASS/FAIL/NOT RUN, evidence method. Номери, session paths, tokens і text поза synthetic corpus не зберігати.

Для доставки ground truth — тестовий телефон **адресата** та журнал synthetic markers/counts. Видимий outbound на A або status worker є лише локальним свідченням. Результати fake adapter, real UI navigation і independent peer delivery мають різні evidence labels. Відомі gaps не перетворюються на PASS через ручне дочитування без позначки.

| Рішення | Умови |
|---|---|
| **GO: наступний обмежений інтеграційний реліз** | Exact account/recipient gate, new-contact discovery, duplicate/echo/restart/fault cases пройдено на конкретному build; немає unresolved loss/misroute; 24 h evidence. Текстовий scope, delivery лишається honest unknown без receipt; це не обіцянка all-platform/all-version stability |
| **LIMITED: paired-text/manual-assist** | Адресат безпечний лише для явно зареєстрованих чатів або потрібен оператор; new-contact discovery/повнота не доведені. `send_text=false`, якщо exact locator unavailable. Не замінює повноцінний Omni inbox |
| **NO-GO** | Хоча б один wrong-recipient, повторна Send-спроба після unknown, неможливо встановити account/peer, приховані втрати/небезпечне overlap. Зупинити побудову продукту, зберегти причину й розглядати інший source approach окремо |

Навіть при GO фото/PDF, повна історія, доставлено/прочитано та сумісність із майбутніми Viber updates лишаються unsupported до окремих доказів. **Рекомендована наступна дія зараз — виділити тестовий комплект і виконати лише G1.** Якщо G1 не дає exact recipient або unknown-contact discovery, зафіксувати blocker до розробки transport та інтеграції CRM.
