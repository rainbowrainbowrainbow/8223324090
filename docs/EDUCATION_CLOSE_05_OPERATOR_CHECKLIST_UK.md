# EDU-CLOSE-05 — checklist фізичного оператора, поточний r5

Production impact: yes, якщо потрібні fixes. **BLOCKED_DEVICE:42 cases,0PASS.**

Поточний код: C:/Users/Plotva/.codex/worktrees/education-close-release-20261008-r5/EventGenix, base9667c381781e83f6a484f3718ad6c36a2ac07fc9, candidate0.82.73 НЕ випущений. Перед фізичною сесією звірити full source/harness inventory у output/education-ready/close06-followup-20261008/final-r5/final-inventory.json; після будь-якого fix попередні device proof можуть стати stale.

## Preview і вхід

**Current preview NOT PREPARED; адреси для пристроїв ще немає.** Старий eventgenix_education_close_devices — retained dataset іншого worktree. Чинний runner має fixed DB/ownership guard; його не запускати зr5 для автоматичного reset/reseed/reuse чужого preview. Потрібен окремий owned synthetic DB/current manifest до сесії. Planned anchor2026-10-08 у physical-current-blocked.json не означає, що preview dataset підготовлений. Не використовувати production, retained manual/devices DB або historical QR/URL для записів.

Після підготовки owned preview оператор отримує actual RFC1918 LAN host і адресу gateway3016. PC/пристрої — одна довірена локальна мережа, без public tunnel, firewall/production settings changes або0.0.0.0. CRM login чинний; секрети лише локальний приватний secrets файл, без screenshots/logs/chat. Надавати адресу/порядок входу лише після manifest/preflight/health/authenticated gateway proof. Lease обмежений; після сесії app/gateway listener закрити та перевірити teardown.

Для D06 потрібні2 різні synthetic оператори із scoped Dar доступом; створити другого чинним локальним Users workflow як prerequisite. Account provider/auth модель не змінювати. Два вікна одного username не доводять двох авторів; немає другогооператора — BLOCKED_FIXTURE.

Manifest має містити actual anchor Europe/Kyiv, owned DB/worktree/run ID, source/harness hashes, fixture counts/ownership та незалежні expectedReports. Oracle копіюється з конкретного manifest ДО mutations, не з продуктивної report-функції. Власні майбутні teacher/group/customer/child/lessons — окремі назви для кожного пристрою; без справжніх контактів/повідомлень. Невдалий UI-крок не ремонтувати API/SQL-записом.

##42 кейси

14перевірок на кожному з3 фізичних пристроїв: iPhone/Safari/VoiceOver, iPad/Safari/VoiceOver, Android/Chrome/TalkBack. На кожному рядку: actual model/OS/browser, ISOtime, operator, action/expected/actual/evidence, orientation/theme, keyboard/picker або spoken output де доречно. Емуляція/desktop WebKit/UA не device proof. Загальне «все нормально» не є14PASS.
| ID | Дії та очікування |
| --- | --- |
| D01 | Усі5 вкладок ×portrait/landscape ×light/dark; довгі назви, активна вкладка, navigation/Save доступні. Окремо перевірити перекриття cabinet label карткою в розкладі. Окремо перевірити цілі слова кабінетів і повну висоту рядків теми/часу. |
| D02 | Через teacher UI створити нового викладача; перше призначення новій групі. Через Customers створити fictional представника й НОВУ дитину; enroll→reload. Birthday2020-05-14 звірити UI/API/SQL; Очікування14.05.2020; будь-який mismatch — FAIL, навіть після software fix. Не підмінювати створення seeded дитиною. |
| D03 | Create своє заняття45 хв→reload/card→edit тільки тему; решта полів незмінні. Записати booking/group/teacher/child IDs для незалежного SQL. |
| D04 | Native date picker: date-only save→reload/card; тема/45 хв/time/teacher/group/cabinet незмінні. Today/day/week: old date absent/new present. Date change до відкриття journal; після старту журналу чинний date/group guard не обходити. |
| D05 | Серія2 елементів; перенесення одного до журналу, scope зрозумілий/інший незмінний. Cancel dialog cancel/confirm, скасувати тільки обраний. |
| D06 | Статуси present/absent/excused/clear; frozen roster, історія. Два оператори A/B відкрили один journal: A змінює child1/save; B child2 stale/save409, A mark unchanged, B draft retained. Explicit refresh/reapply/save, два authors+time. Не force/merge. |
| D07 | Historical report з oracle вище; кілька/архівна група, filter/reset/reload/native dates. Звірити linked group, no-journal/unmarked. Майбутня власна відмітка не додається до held totals. |
| D08 | Education settings: читабельність labels/кабінетів; одна scoped display зміна через UI/save/reload/відновити. Без auth/integrations. |
| D09 | Реальна клавіатура: тема/group name/search; cursor/field/sticky Save видимі, можна закрити, draft лишається. Перевірити viewport shrink та OS autozoom. |
| D10 | Native date/select: open/select/cancel/confirm; кінцеві date/value правильні, draft не зникає. Записати фактичний OS control. |
| D11 | Scroll форми/journal/report; rotation із клавіатурою/без; notch/safe area/home indicator/browser chrome не перекривають дії. |
| D12 | Реальний browser/pinch zoom200%→100%; labels/Save доступні, таблиці мають власний scroll. Desktop emulation не зараховувати. |
| D13 | Увімкнути OS VoiceOver/TalkBack. Gesture navigation/labels/values/actions/order; invalid duration0/date→озвучена помилка й focus. Записати дослівний фактичний spokenOutput; conflict409 також озвучується зі збереженим draft. |
| D14 | Screen reader: card/edit/series/confirm open/close, dialog name/focus trap/close/focus return. Реальне озвучення й gestures, не лише DOM aria inspection. |


## Запис результатів

Для кожного кейсу використати physical-current-blocked.json як план, а результати — новий manifest-bound operator template конкретного owned preview. PASS/FAIL потребують per-case observedAt не раніше manifest.preparedAt, кроків, фактичного результату та перевіреного evidence. Без виконання лишити BLOCKED_DEVICE/BLOCKED_FIXTURE/NOT_RUN. Для screen reader записати реальне озвучення та gestures, а не DOM aria лише.

Після fixes повторити зачеплені browser/functional checks та конкретний фізичний кейс на фінальному коді. Зберегти screenshots/video без секретів, DB ownership і teardown proof; не очищати retained datasets. Acceptance з0devicePASS не може стати fully-completeGO. Конкретний owner deferral, якщо буде, записується окремо з точними відкладеними кейсами та ризиком.