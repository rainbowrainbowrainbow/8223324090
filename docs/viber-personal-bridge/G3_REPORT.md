# G3 — контрольоване приймання й відновлення reader

Дата: **2026-09-11**. Production impact: no.

**Актуальний результат: G3 SID bootstrap, DUP, restart reader і local ACK — PASS у контрольному сценарії.** Знайдено два вже надіслані exact DUP markers з різними EventID в одному чаті. Чотири fresh reader processes використали стару session `0B038E78` і baseline. Windows/Viber не перезапускали, RAM scan не запускали. Весь міст лишається **LIMITED; Send NO-GO** до нового контакту, account/recipient identity й інших gates.

## Фактичні SID reader запуски

Використано [observe_g3_sid.py](observer/observe_g3_sid.py) після [schema recovery proof](KEY_ORIGIN_REPORT.md), незалежного review та 113/113 focused synthetic G3 tests. Тривалість нижче — заданий poll interval; кожен процес також виконує bounded bootstrap/fixture.

| Fresh process | Polls | Нові journal записи | Повторні спостереження | Total / pending / acked | Evidence |
|---|---:|---:|---:|---|---|
| Перший, 0 s | 1 | 2 | 0 | 2 / 2 / 0 | [first](observer/G3_SID_FIRST_RESULT.json) |
| Повторний, 2 s | 3 | 0 | 6 | 2 / 2 / 0 | [reopen](observer/G3_SID_REOPEN_RESULT.json) |
| Local ACK test, 0 s | 1 | 0 | 2 | 2 / 0 / 2 | [ACK](observer/G3_SID_LOCAL_ACK_RESULT.json) |
| Ще один після ACK, 0 s | 1 | 0 | 2 | 2 / 0 / 2 | [after ACK](observer/G3_SID_AFTER_ACK_RESULT.json) |

Повторні спостереження рахуються за кожен poll: `6` означає дві ті самі події × три polls, а не шість нових повідомлень. У всіх чотирьох звітах `baseline_reused=true`, `pending_relations=0`, `source_file_continuity_verified=true`. Після ACK події не повернулися в pending. Local ACK/retry змінювали тільки власний тестовий журнал, **не CRM і не Viber delivery status**.

Для двох маркерів підтверджено один локальний ChatID, один ContactID і дві окремі source event identity. Потрібне поле Number було наявне в обох observations; його значення не виводилося. `ChatInfo.Token` був відсутній у **двох observations цього чату**. Тому його не можна вже зараз обіцяти як універсальний стабільний provider chat ID. Local IDs поки перевірені в межах цієї DB/session; переносимість між relink/DB recreation не доведена.

`NEW`, `PHONE`, `DESKTOP`, `RENAME` — по 0 у цьому контрольному вікні. `direction_semantics_verified`, `new_contact_globally_verified`, `recipient_verified`, `provider_delivery_verified` залишилися false. Наявність двох маркерів доводить вузький source/journal сценарій, але не повне покриття inbox, доставку на пристрій адресата або коректність Send.

Усі процеси завершилися. Постійного фонового observer не залишено. У файлах звіту — тільки counters/flags і дозволений run ID; SID, DB key, текст листування, номери й raw source IDs не експортовані. Власний приватний journal містить тільки metadata точних тестових маркерів. CRM не контактували; messages_sent=0.

Наступний gate — перше повідомлення `EGXG3-0B038E78-NEW` від акаунта поза контактами, з яким не було діалогу; потрібне підтвердження цих передумов оператором. Повторювати DUP або скидати baseline не потрібно. Sender gate лишається окремим.

## Історія попередніх спроб

**Попередній результат до SID recovery:** DUP test був заблокований до читання source DB. Початкові read-only запуски й restart reader зі збереженою baseline були успішні. Після підтвердження оператора «надіслав» завершений RAM-пошук дав `candidate_not_found`. Це історичний результат конкретного способу пошуку. Sender лишається NO-GO до доказу адресата.

Машинний evidence: [G3_RESULT.json](observer/G3_RESULT.json). Попередній доказ доступу до схеми та точний build/plugin fingerprint: [G2_REPORT.md](G2_REPORT.md). Тут перезапускали **наш reader**, а не Viber, телефон або Windows.

## Контрольний DUP run після підтвердження оператора

Користувач відповів «надіслав» на інструкцію двох exact DUP markers з іншого акаунта. Перший новий worker завершився `CANDIDATE_UNAVAILABLE` до відкриття private DB. Окремий presence-only diagnostic показав `scan_limited`: 15 000 ms, 294 866 944 bytes, 2784 regions, 0 read failures. Процес Viber перевірений. Це не перевірка відсутності повідомлень: source queries не виконано, а нульові поля journal у failed report є початковими значеннями, не читанням збереженого журналу.

Оригінальний пошук виконував дві повні regex-перевірки кожного chunk. Додано швидкий відбір за ASCII/UTF-16 PRAGMA prefix, зі збереженням оригінального буфера для collector hook, регістру й overlap. Тимчасові mutable copies очищаються. Ліміти **15 s / 512 MiB / 100 000 regions не збільшено**. Presence self-test: **1540 checks PASS**; schema/collector self-test: **16 checks PASS**.

Після виправлення reader знову завершився `CANDIDATE_UNAVAILABLE`. Окремий diagnostic тепер завершив увесь дозволений обхід: **373 190 656 bytes / 5457 regions / 0 read failures / 1226 ms**, `private_region_scan_complete=true`, `candidate_not_found`. Прискорення усунуло timeout, але не відновило доступ. Це відсутність підтримуваного PRAGMA-патерна в цьому знімку дозволених ділянок, а не доказ відсутності криптографічного ключа у всій пам'яті Viber. Причинний зв'язок із приходом повідомлень не доведено.

Власний journal окремо перевірено read-only: baseline наявна, cursor валідний, total/pending/acked = 0. Повідомлення ще не потрапили в наш journal, оскільки source DB не відкрилася. Session не створювали заново, Viber не перезапускали, local ACK не викликали. Хід контрольного run: [G3_DUP_RESULT.json](observer/G3_DUP_RESULT.json).

**Рішення для наступного досліду:** оператор перезапускає застосунок Viber; потім використовується **та сама G3 session/baseline**, без повторного надсилання маркерів. Це перевірка гіпотези про доступність параметра після старту, не гарантія відновлення. Подальший reader має тримати відкриту read-only connection у довгоживучому процесі; його crash усе одно потребує окремого доведеного сценарію reacquisition. Постійний процес і автоматичний restart Viber зараз не реалізовані. Якщо відновлення потребуватиме ручного перезапуску Viber, це операційне обмеження LIMITED, не full Omni GO.

### Після повідомлення «перезапустив»

Повторний worker з тією самою session знову повернув `CANDIDATE_UNAVAILABLE` до source queries. Presence diagnostic завершив дозволений обхід: 373 538 816 bytes, 5473 regions, 0 read failures, 1187 ms; кандидат не знайдений. Однак окрема read-only перевірка Windows `Get-Process` показала **один процес Viber з uptime 20 749 seconds (5 h 45 m 49 s)**, FileVersion незмінна. Недавній перезапуск самого процесу не підтвердився. Закриття/відкриття лише вікна — можливе пояснення, UI-дії не спостерігалися.

Цей результат **не зараховується як failed recovery після actual Viber restart**: потрібна передумова ще не виконана. Наступний раз перед RAM probe спочатку перевірити малий uptime нового процесу. Оператор має повністю завершити застосунок і відкрити його знову; акаунт не деактивувати, маркери не повторювати, session/baseline не створювати заново. Helper не завершував Viber. [Повний redacted evidence](observer/G3_RESTART_ATTEMPT.json).

## Межі дозволу й даних

### Уточнення: reboot Windows не є вимогою

Перезапуск комп'ютера **не потрібний як технічна передумова**: G2 вже довів читання без restart Viber/Windows. Повний restart лише застосунку запропоновано як окремий спосіб повторно перевірити доступність параметра на старті; його необхідність для всіх можливих reader підходів і гарантована достатність не доведені.

Legacy режим `observe_g3.py` є короткою пробою: кожен новий worker викликає `collect_candidates`, а наприкінці закриває Qt connection. Це підтверджено кодом, не пояснення того, чому саме Viber перестав зберігати шуканий патерн. Новий `--listen` уже тримає один read-only connection до 600 s після успішного open — [звіт](G3_LISTENER_REPORT.md). Він зменшує залежність від повторного RAM scan між повідомленнями тесту, але не повертає вже закриту connection й не доводить live crash recovery.

Без restart уже виконано реалізацію bounded worker, перевірку його життєвого циклу на синтетичній DB, safe stop/deadline і збереження baseline/pending. Нового підтвердженого способу відкрити поточну Viber DB без наявного параметра в перевірених матеріалах не виявлено. Повторення завершеного RAM scan або збільшення його меж без нового обґрунтування не є recovery-рішенням. Впровадження hook/injection або пошуку іншого key format було б окремим неперевіреним дослідом.

Отже, blocked лише актуальне live читання цим методом; **не вся підготовка прототипу**. Не позначати весь міст завершеним після синтетичних тестів і не реалізовувати весь HTTPS/CRM продукт до доказу source/recipient. Поточний результат залишається LIMITED.

Власник дозволив поточний акаунт; наступне «го» продовжило локальну перевірку. Повторна реєстрація/QR не потрібні для цього досліду. Не відкривали чати через UI, не натискали Send, не обирали адресатів, не змінювали CRM. Звичайне листування не використовується як тестовий набір.

SQL повертає metadata тільки для п'яти exact marker values цього run. Body, Number, Name, Token не повертаються в Python і звіти. Рушій DB читає приватні сторінки в RAM для пошуку; RAM-пошук ключа також тимчасово обробляє приватні bytes. Немає обіцянки secure erasure, захисту від процесу того самого Windows user або OS paging.

Ключ Viber залишається тільки в RAM worker. На диск записано власні: DPAPI-захищений HMAC seed, початкову baseline, локальний journal, claim і session lock. Вони лежать поза repo й OneDrive. У journal дозволені лише контрольний marker, source EventID, HMAC refs і локальний статус ACK; до CRM нічого не передавали.

## Реалізація й рішення

| Файл | Призначення |
|---|---|
| [observe_g3.py](observer/observe_g3.py) | Bounded supervisor, fresh Qt worker, read-only source, session lock, metadata sanitization і закритий публічний JSON |
| [g3_queries.py](observer/g3_queries.py) | Fixed prepared SQL, exact marker match, перевірка relations/cardinality, reread початкового вікна |
| [g3_journal.py](observer/g3_journal.py) | Власна SQLite transaction: observation + progress, source-ID dedup, локальний ACK |
| [g3_state.py](observer/g3_state.py) | Windows DPAPI, власна приватна session, перевірка шляхів, одноразовий claim перед журналом |
| [Тести й запуск](observer/README.md) | Три `test_g3_*.py`, команди self-test та інструкція відновлення |

Початкова `MAX(EventID)` фіксується один раз **до** контрольних повідомлень. Наступні сканування, включно з restart, читають усе обмежене вікно вище цієї baseline. Progress cursor не підміняє baseline: це дозволяє знайти запізнілий `Messages` або Contact/ChatInfo relation нижче вже спостереженого cursor. Максимум — 1000 Events у тестовому вікні, включно з немаркерними. Переповнення, регрес ID або неоднозначний JOIN зупиняють дослід; автоматичного reset немає.

Два однакові тексти з різними source EventID — дві події. Повторне читання того самого EventID не додає event; зміна його immutable metadata — явний конфлікт. Journal і cursor змінюються атомарно. `pending` зберігається до **локального test ACK**; повторний ACK не створює side effect. Це не готовий command ledger, мережевий outbox або CRM ACK.

Під час review виправлено дві суттєві recovery помилки: terminal fetch error Qt більше не виглядає як успішний частковий результат; зниклий/порожній журнал уже початої session не створюється заново зі свіжою baseline. Якщо crash стався до завершення першої baseline, session зупиняється як incomplete. Автоматично видаляти claim для «ремонту» заборонено.

## Що перевірено запуском

| Перевірка | Факт | Що це не доводить |
|---|---|---|
| Початковий G3 запуск | Fixture PASS, підписаний Viber process verified, DB readable, 1 poll, baseline збережена | Повнота inbox або коректність напрямку |
| Новий процес reader, та сама session | DB знову readable, `baseline_reused=true`, 31 poll за 30-секундне вікно | Перезапуск Viber/Windows або recovery з реальними pending-подіями |
| Повторна перевірка після паузи | Третій процес, 1 poll, та сама baseline, контрольних подій 0 | Поведінка після приходу реального тестового marker |
| Контрольні повідомлення | 0 observed; усі DUP/NEW/PHONE/DESKTOP/RENAME counters = 0 | Нуль тут не є PASS приймання й не є доказом втрати |
| Після «надіслав» | Два worker attempts зупинилися до source queries; завершений presence scan — без кандидата | Не відсутність повідомлень у Viber; actual DUP/restart/ACK tests заблоковані |
| Після «перезапустив» | Candidate unavailable, але Viber process uptime = 20 749 s; actual restart не підтверджено | Не доказ невдалого recovery після фактичного restart Viber |
| Синтетичні unit tests | **55 PASS**: 16 journal, 19 queries, 20 adapter | Поведінка самого Viber при дублях/новому контакті |
| DPAPI/path/claim RAM checks | **45 assertions PASS** | Secure erasure або захист від того самого user |
| Власні синтетичні temp-файли | **9 assertions PASS**: missing/empty/wrong header/unclaimed/sidecar guards | Fault injection у реальну Viber DB |
| Public result/HMAC self-test | **11 checks PASS** | Provider/account identity |

Journal tests включають окремий child process із `os._exit(77)` до COMMIT: попередні події й cursor збереглися. Також перевірені пізня поява marker нижче cursor, ACK replay, foreign epoch/account, source conflict і заборона приватних полів. Query tests перевіряють дві однакові події, новий невідомий synthetic contact без allowlist, пізню появу relations, binary match і JOIN fanout. Adapter tests доводять, що fetch error не приймається як повна відповідь.

Під час підготовки Windows App virtualization перенаправляла власний каталог EventGenix у `Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local`. Початковий guard коректно відмовив на lexical/resolved mismatch. Додано лише цей відомий canonical варіант; усі його ancestors повторно перевіряються на reparse/junction, а стан лишається поза синхронізованими каталогами. Існуючі файли не переносили й не видаляли. Доступ до temp/runtime вимагав вузького sandbox escalation, який automatic review дозволив; відхилень approval не було.

## Які identities ще не доведені

| Поле | Походження / рівень довіри |
|---|---|
| `source_event_id` | Числовий Events.EventID з локальної DB; схема підтверджена G2, значення контрольних live-подій ще не спостерігали. Не provider delivery ID |
| Chat/contact refs | HMAC локальних ChatID/ContactID; display name не бере участі. Стабільність при rename/restart Viber ще не доведена |
| Account ref | HMAC шляху локального account-каталогу; лише локальне прив'язування, не доказ номера активної сесії |
| Source epoch | HMAC file identity; евристика виявлення заміни файлу. Relink/restore без зміни file identity не покритий |
| `direction_code` | Сирий код 0..3 або null; семантика incoming/outgoing **не визначена** |
| `number_present` / `token_present` | Лише ознаки непорожнього поля. Значення не виводяться, recipient verification не виконано |
| Новий локальний чат | Відсутність старих Events цього ChatID до baseline. Це не доказ невідомого контакту на всіх пристроях |
| Локальний `event_id` | UUID нашого journal; повторне читання зберігає його. Не ID повідомлення, виданий Viber |

## Наступний конкретний тест

Підготовлена session: run ID **`0B038E78`**. Початкова baseline уже записана. **Оператор повідомив про надсилання DUP; повторно надсилати їх зараз не потрібно.** Спочатку потрібен операторський перезапуск застосунку Viber і спроба відкрити DB з тією самою session. Reader не є постійним сервісом; читання між запусками можливе лише після успішного повторного доступу й доки вікно не перевищить 1000 Events.

1. **Оператор підтвердив надсилання:** два окремі повідомлення `EGXG3-0B038E78-DUP` за попередньою інструкцією іншого акаунта. Це операторська передумова incoming, автоматична семантика Direction ще не доведена. Наступна дія — відновити read-only доступ після операторського restart Viber; маркери не повторювати.
2. Reader має знайти два distinct EventID одного ChatID. Запустити reader ще раз: `journal_total=2`, `newly_journaled=0`, pending збережений. Лише тоді live duplicates/restart gate може бути PASS. Local ACK test виконати окремо після цього.
3. Далі інший раніше невідомий керований контакт надсилає **`EGXG3-0B038E78-NEW`**. Перевірити автоматичне знаходження без попереднього pairing, relations та відсутність давніх локальних подій. Власник окремо підтверджує передумову «раніше невідомий».

Після цього — controlled PHONE/DESKTOP/RENAME для direction/echo/identity, потім exact active recipient gate без Send. Lock Windows, RDP disconnect, offline, Viber restart/update, вкладення й довгий soak **не виконувалися**. Для них потрібні керовані співрозмовники та окреме вікно роботи, де можна переривати Viber/мережу. Повний Omni не оголошується готовим до доказу нового контакту та безпечної адресації.

**Заявлено upstream:** механізм Qt доступу з GitHub залишається reference з попереднього дослідження. **Підтверджено кодом:** marker-only reader, durable local journal, guards і швидкий prefix filter. **Перевірено запуском:** початкове порожнє live-вікно, restart reader, синтетичні тести та наступна невдала reacquisition після «надіслав». **Не перевірено:** actual incoming markers, recovery після Viber restart, provider identities/delivery і двостороння робота. CRM transport та інтеграція залишаються окремим релізом.
