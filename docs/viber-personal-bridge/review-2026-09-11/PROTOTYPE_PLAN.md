# Viber Personal Bridge — план наступного прототипу

2026-09-11. **LIMITED, Send NO-GO.** Цей файл — план, не дозвіл запускати реальний акаунт. Поточна задача завершена документами; жодних Viber/CRM mutations. [Дослідження](RESEARCH.md), [контракт 1.0 draft](BRIDGE_CONTRACT.md).

## Вихідна точка

Існуючий локальний [G3 звіт](../G3_REPORT.md) описує вузьку перевірку двох identical-text source events, restart reader та local ACK. Поточна задача прочитала звіт, не відтворила його. G3 source/journal — не мережевий transport, не повний inbox та не sender. NEW/account/recipient/direction gates відкриті. Не будувати знову старий UIA reader і не скидати G3 baseline для повторення вже записаного DUP без нової причини.

## Тестове обладнання та дозволений набір

- Виділена Windows x64 машина або VM із перевіреною інтерактивною console session. Зафіксувати OS build, Viber build/signature, DPI, locale, Python/runtime, dependency lock і SHA власного моста. Старий звіт про Viber 26.3.2 — історичний зріз, не актуальний preflight.
- Один окремий тестовий Viber account A на телефоні й Desktop; тестові співрозмовники B/C (однакові display names, різні номери) та D (не у контактах, ніколи не листувався з A). Якщо акаунтів немає — external dependency, не PASS.
- Власник підтверджує передумови D та конкретний набір synthetic test messages. Для ручного Send наступний блок має явно дозволяти адресатів, кількість і часовий проміжок. Поточна задача цього не робить.
- Приватне локальне сховище поза repo/OneDrive; достатній вільний диск; ізольований synthetic HTTP sink без production CRM credentials. Windows-міст не розміщується як звичайний Railway web service.
- Жодних неперевірених APK/інсталяторів upstream. Runtime залежності фіксуються після review. DB access — лише read-only власного дозволеного тестового профілю; не запускати широке сканування приватного листування для діагностики.

## 1. Source та identity gate — перший блок

**Goal:** довести, що потрібні дані взагалі доступні без підміни особи.

**Scope:** існуючий source reader після review; один A, B/C/D; read-only observation та окремо дозволена навігація без Send.

**Steps:** звірити попередні redacted evidence і локальний код; перевірити build/schema compatibility. Зібрати перше звернення D без ручного pairing. Встановити source chat/contact relation, не покладатися на ChatInfo.Token. Перевірити account A незалежно від Windows SID/каталогу. Для B/C тридцять разів чергувати навігацію та перевірку фактично відкритого peer; включити rename, reordering sidebar, manual focus change. Наявність compose box не приймається як identity.

**Done when:** NEW від D визначений окремо від B/C, точні source occurrences не злиті; account continuity і recipient check мають конкретне джерело доказу. Кожна неоднозначність завершується abort до input. Нуль неправильних identity matches. Якщо NEW не працює — LIMITED paired-only; якщо exact peer/account недоступний — Send NO-GO. Не переходити до production transport, намагаючись обійти провал gate.

**Live-site QA:** production відсутній; тільки майбутній погоджений тестовий набір.

**Notes/Risks:** DB source identity не означає, що UI відкрив того самого адресата. Нестабільність після account switch/relink — окремий блокер. Необхідні нові дозволи отримати для конкретного тесту, не з тексту старих звітів.

## 2. Durable transport і command journal на fixtures

**Goal:** надійно переносити вже зібрані події та не повторювати зовнішню дію.

**Scope:** окремий каталог/репозиторій, синтетичний source/UI adapter, SQLite outbox/journal, loopback sink. Не додавати MCP/Matrix/брокер.

**Steps:** реалізувати контракт після gate 1, або як вузький fixture proof, якщо потрібно вирішити конкретне питання. Перевірити ACK loss, payload conflict, dual IDs, scoped auth, старий epoch, delayed result, store-full, expired lease/command. Fault points: до accepted; preparing; після durable dispatch_started, але до gesture; після gesture, але до result commit. Жодної arbitrary shell/SQL execution із команди.

**Done when:** 100 повторних/concurrent submissions одного command дають один journal entry і максимум одну fake Send-спробу. Той самий event після втрати ACK не створює другий запис. Дві однакові body із різними source IDs дають дві occurrence. Після dispatch_started restart не виконує gesture; результат unknown. Timeout worker не допускає перекриття з наступним. PARK key із DAR body відхиляється. Fixtures не зараховуються як Viber QA.

**Live-site QA:** немає; sink не має production URL/credentials.

**Notes/Risks:** при втраті/відкаті journal fail closed і reconciliation; не продовжувати зі свіжої baseline. Source capture completeness — окрема вимога від транспортної дедуплікації.

## 3. Контрольований текстовий двосторонній прототип

**Goal:** підтвердити роботу тексту між A та погодженими peers.

**Scope:** тільки після account/recipient gate і окремого дозволу test-send. Автовідповіді та attachments off.

**Steps:** peer journal із synthetic markers є незалежним ground truth. Узгоджений початковий ліміт-пропозиція: до 30 inbound (10 від кожного B/C/D), до 30 bridge outbound (10 кожному), до 6 external outbound із A phone/Desktop. Частину inbound зробити однаковими парами, українським/emoji/multiline текстом; збільшувати набір лише за нової потреби. Повторити кожну HTTP команду без нового реального Send. Перевірити непорожню draft, одночасні запити менеджерів, новий inbound під час navigation.

**Done when:** 0 wrong-recipient і 0 повторних Send-спроб для одного command; кожна дозволена occurrence збережена або явно позначена unresolved. Для GO невирішених loss/identity gaps не лишається. PHONE/Desktop не губляться і не стають inbound. Поява бульбашки має execution=submitted_unconfirmed, delivery=unknown. Незалежний peer підтверджує тест, не створює вигаданий provider receipt у продукті.

**Live-site QA:** test sink та тестові акаунти; CRM production не використовується.

**Notes/Risks:** якщо peer не доведений — тільки observation/manual-assist, цей блок не починається. Усі цифри є планом тесту, не чинним дозволом надсилання.

## 4. Recovery і рішення про інтеграцію

**Goal:** з'ясувати, чи прототип переживає реальні робочі збої.

**Scope:** ті самі test accounts, виділена машина, погоджене вікно. Тексти з попереднього набору не надсилати повторно для «перевірки доставки».

**Steps:** пройти матрицю нижче; перезапускати reader і Viber як різні тести. Провести 24 h soak із погодженими ручними bursts у межах ліміту; повідомляти max/p95 capture latency, gaps, unknown, duplicate occurrences. Actual update тестувати лише якщо доступна погоджена офіційна версія; simulated mismatch не прирівнювати до update PASS. Наприкінці підготувати integration card для Omni на фактичному live SHA.

**Done when:** unacked events переживають crash/offline; source-generation/account зміна блокує старі commands; жодного silent reset/outgoing replay. Heartbeat stale виявляється ≤45 s, source stale ≤90 s; початкова ціль healthy capture→sink p95 ≤30 s для трьох чатів, без обіцянки SLA. Невирішені обмеження явно знижують verdict.

**Live-site QA:** поточний етап — без production. Майбутній Omni release: fixtures/PostgreSQL concurrency → version/commit/push → CI exact SHA → ручний Railway deploy → погоджений тестовий діалог. Production impact: yes лише у тому окремому релізі.

**Notes/Risks:** новий provider має connection/account binding для кожного діалогу; Bot API не підміняється personal sender. Provisioning, права, schema, secrets і deployment settings мають окремі конкретні межі. Немає причини випускати декоративний «підключено» до доказу каналу.

## Матриця перевірок

Усі наведені сценарії **NOT RUN у поточній задачі**. H означає лише наявний вузький попередній доказ.

| Тест | Очікування / доказ |
|---|---|
| NEW від незнайомого D | Без pairing; source/chat relation, identity unresolved не auto-link |
| B/C duplicate names, rename | Exact peer, а не title; old binding_revision rejected |
| Account switch / source DB recreation | Account/epoch mismatch → pause, старі історії не злиті |
| Два однакові тексти | Дві distinct source occurrence; H: лише попередній DUP=2/local ACK |
| Phone/Desktop outbound | Правильний direction/origin, без echo suppression за текстом |
| Одночасні commands / manual input | Один worker; revalidate/abort при зміні адресата |
| Timeout до/після gesture | До dispatch можна відмовити; після — unknown, не resend |
| ACK loss / out-of-order results | Durable dedup, monotonic result_revision |
| Restart reader / Viber / Windows | Три окремі перевірки; H: тільки reader/local ACK |
| Offline CRM / Viber / peer | Окремі стани; local bubble не delivery; outbox відновлюється |
| Lock / RDP minimize/disconnect | Виміряти read/input окремо; blocked не healthy |
| Window/DPI/locale change | Не сліпий click; capability downgraded при невідповідності |
| Storage full / lost or stale journal | Stop Send, quarantine/reconciliation, не reset |
| Повідомлень більше за viewport | Backlog доступний або explicit capture.gap; не silent discard |
| Source JOIN з'явився пізніше | Reread/reconciliation без пропуску нижче high-water mark |
| Фото/PDF | До окремого gate unsupported; назва/thumbnail не file bytes |
| Build update | Revalidate source/schema/identity; simulated та real результати різні |

## Evidence та критерії рішення

Для кожного run зберігати: перевірений SHA, OS/Viber/runtime versions, source fingerprint без приватних значень, test IDs, PASS/FAIL/NOT RUN, кількість occurrences/dispatches/ACK/unknown/gaps, source evidence, час відновлення. Screenshots і клієнтські тексти за замовчуванням не зберігати. Доказ receipt — тільки власне джерело receipt, а peer observation тесту окремо. Приватний журнал не комітити.

| Verdict | Критерій |
|---|---|
| GO для обмеженого текстового релізу | Account/exact peer/new-contact, повнота повторів, external outbound, recovery/concurrency пройдені; залишилися лише оголошені unsupported capabilities |
| LIMITED | Reader/manual-assist або paired-only із видимими gaps; remote Send вимкнений без exact peer |
| NO-GO | Неправильний адресат, повтор Send після unknown, приховані втрати або неможливо встановити акаунт/peer |

**Наступний конкретний крок:** підготувати A/B/C/D і виконати етап 1, використовуючи наявні G3 результати як передумову лише після звірки build/provenance. Передавати наступному чату ці три документи й перевірений SHA власного observer; не доручати одразу весь production hotfix.
