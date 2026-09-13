# SYS-MB — Задачі для продовження та завершення

Підготовлено 2026-09-12. Це продовження D-01–D-06 і D02-C1–C4, а не новий план з нуля. Документ не є дозволом на виконання production-операцій.

Новіший checkpoint задачі 6: `ACCEPTANCE_REPORT.md` + `D06_VERIFICATION.json`, деталізація — `D06_*_REPORT.md` і access/denial/orphan/compatibility matrices. Виконано actual local `server.js` → disposable PostgreSQL → real browser acceptance; точні статуси й остаточний run ID наведено у звіті. Виправлено вибір API-контексту та branding продуктів Дару/custom-бізнесу; D01–D05 cumulative diff збережено. `PARK_DAR_RELEASE_READY = HOLD`, `GLOBAL_MODEL_COMPLETE = false`: відтворено неприйнятні глобальні читання staff/certificates/Art/payroll settlement і contractor/procurement, лишаються protected linkedTo, OWN-01–08/mapping та compatibility/cutover прогалини. Це завершене локальне приймання з FAIL/NOT_TESTABLE, а не готовий реліз. До задачі 7 спочатку закрити конкретний scope із `D06_REVIEW_SCOPE.md`; старі дозволи не є новим release/QA блоком. Докладні попередні checkpoint-и нижче збережено; на вході D06 збіглися всі 314 записів SHA256 D05.

Поточний checkpoint після незалежної частини задачі 5: `D05_IMPLEMENTATION_REPORT.md` + `D05_VERIFICATION.json`. Локально закрито прямі intake-входи без дозволеного контексту, виправлено atomicity/scoped matching та unavailable UI; додано containment income notifications і приватних chat/AI HTTP/engine/socket входів. Повний D05/SYS-MB лишається HOLD: Telegram envelope, secret bridge/background storage, HR/payroll/certificates, payment/provider ingress та Art мають явно описані NOT_MIGRATED/BLOCKED частини. Задача 4 не виконана: погоджених рішень і реального mapping досі немає; її перевірка — `LEGACY_OWNERSHIP_TASK4_REPORT.md`. Жодного commit/push/deploy або production-запису. Під час D05 попередні 204 записи SHA256 збіглися; старі докази збережено.

Попередній checkpoint після задачі 3: `OWNERSHIP_DECISIONS_REPORT.md` + `OWNERSHIP_DECISIONS_VERIFICATION.json`. D01, D02-C1/C2, D03 і незалежна частина D04 реалізовані локально; cumulative diff ще незакомічений. У задачі 3 перевірено і збережено попередні 136 source SHA256 та 30 artifact SHA256 з `RELATED_RECORDS_VERIFICATION.json`; runtime не змінено. `DECISIONS.md` містить OWN-01–08 зі статусом PENDING, preflight виконано лише на синтетичному PostgreSQL, реальний mapping — UNPOPULATED. Задача 4 лишається BLOCKED до фактичного read-only джерела, погодженого mapping і політик. Захищений `linkedTo` також `BLOCKED_PROTECTED_CHANGE`, scope — `LINKEDTO_PROTECTED_SCOPE.md`. База `a5180def01a1e47f8f4fc75e2f7a43092f205828`, гілка `codex/sys-mb-auth-p0-20260912`. Локальний marker 0.81.132 не підтверджує версію сайту. Незалежна інвентаризація решти доменів може тривати; production cutover лишається HOLD.

Порядок: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Read-only аналіз задачі 3 можна виконувати паралельно з 1/2; записи в спільні файли — тільки з визначеним ownership. Задача 4 залежить від конкретних рішень задачі 3. Невизначені частини не блокують незалежну роботу.

## Спільний вступ для нового чату

```text
Продовжуємо SYS-MB «акаунт → організації → бізнеси» за наявним планом.

Джерело:
C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912
Гілка: codex/sys-mb-auth-p0-20260912
Початкова база: a5180def01a1e47f8f4fc75e2f7a43092f205828

Прочитай AGENTS.md та docs/workstreams/sys-multibusiness/:
CONTINUATION_TASKS.md, DOMAIN_ISOLATION_INVENTORY.md,
LEGACY_CONTAINMENT_PLAN.md, LEGACY_CONTAINMENT_IMPLEMENTATION_REPORT.md,
LEGACY_CONTAINMENT_VERIFICATION.json і звіти вже завершених наступних задач.

Звір git status, фактичний diff і останній перевірений checkpoint.
Тут є незакомічені cumulative-зміни: не втрать їх, створюючи checkout від HEAD,
і не вигадуй implementation commits для cherry-pick. Не переписуй чужу роботу.
Якщо є новіший checkpoint, використовуй його; стару базу не відновлюй reset-ом.

Не переробляй завершені P0/lifecycle/profile/streaming/D01/D02-C1/C2.
Кожну зміну роби мінімальним логічним патчем. Зберігай API-сумісність,
ціни/формули та дизайн shared menu/router/theme. Не додавай залежності,
не читай/друкуй secrets і не запускай реальні provider/message/payment дії.
Працюй ізольовано від HR та інших активних потоків.

До релізних задач — локальна реалізація й потрібні перевірки, без commit/push/deploy
та production-записів. Production rollout — лише за чинним точним блоком.
Не перепитуй за погоджені звичайні кроки. Якщо бракує бізнес-рішення або
дозволу на конкретну захищену зміну, заблокуй лише залежну частину.

Після задачі збережи implementation report, verification manifest із SHA256,
зміни/тести/ризики й наступні READY/BLOCKED частини. Старі докази не стирай.
Локальні fixtures не називай live PASS. Пояснюй українською.
```

## 1. SYS-MB-D03 — Повноцінне керування кабінетами — IMPLEMENTED_LOCAL

Результат і фінальні перевірки: `BUSINESS_CABINET_IMPLEMENTATION_REPORT.md`, `BUSINESS_CABINET_VERIFICATION.json`. Наведений нижче оригінальний запит збережено для перевірки scope. Live QA та delivery ще не виконані; новіший checkpoint зазначено на початку документа.

```text
Виконай SYS-MB-D03 за спільними правилами CONTINUATION_TASKS.md.

Мета: другий бізнес створюється та керується через узгоджений lifecycle,
а його назва, модулі й доступ відповідають серверному реєстру.

Межі: services/businessContext.js, businessProfile.js, timelineContext.js,
timelineResources.js; organization lifecycle/routes; наявні profile/admin UI;
routes/graduation.js і відповідні тести. Спочатку звір фактичні прогалини.

Кроки:
1. Визнач семантику modules: порожній/disabled/відсутній конфіг, legacy fallback.
   Не вмикай модулі через неявні defaults; перевір наслідки для чинних конфігів.
2. Розділи «модуль підтримується бізнесом» і «користувач має право».
   Узгодь registry, branding та серверну/клієнтську перевірку.
3. Дороби наявний owner/admin UI: організації/бізнеси, працівники,
   різні ролі, default business, деактивація та зрозумілі unavailable стани.
   Зберігай правила останнього owner; не створюй другий редактор доступу.
4. Винеси створення default resources із GET у явну ідемпотентну ініціалізацію.
5. Перевір custom graduation: явний context і пропущений context при активному
   custom-бізнесі. Немає підміни Парком; conversion доступний лише за підтримки.

Готово коли: owner керує другим підтримуваним бізнесом; працівник бачить лише
свої модулі/дані; unsupported модуль не вмикається через API; GET не робить INSERT.
Є HTTP/PG/browser перевірки двох організацій, різних ролей і порожніх конфігів.

Live QA: сценарій створення кабінету/працівника підготуй для задачі 7.
Ризики: не додавати реальне надсилання invitations, не вмикати немігровані модулі.
```

## 2. SYS-MB-D04 — Цілісність зв’язків між записами — IMPLEMENTED_LOCAL / linkedTo BLOCKED

Результат: `RELATED_RECORDS_IMPLEMENTATION_REPORT.md` + `RELATED_RECORDS_VERIFICATION.json`. Сервісні ownership/parent guards, rollback/savepoints, caller propagation, явний 409 після deadlock та сумісність зовнішніх кодів MD перевірені локально. Фінальні HTTP/service PostgreSQL — 70/70, без skip. Це не live PASS. `linkedTo` окремо відтворений через actual HTTP/PG: шість сценаріїв приймають чуже/відсутнє батьківське бронювання. Точні hunks і потрібна область захищеної правки — `LINKEDTO_PROTECTED_SCOPE.md`; зміни не застосовані. Залишкові питання порядку блокувань, mailing race і MD cutover зазначені у звіті. Оригінальний запит нижче збережено для traceability; незалежну частину не виконуй повторно.

```text
Виконай SYS-MB-D04 за спільними правилами CONTINUATION_TASKS.md.

Мета: сам сервіс не дозволяє зв’язати lead/customer/booking/product різних
бізнесів навіть тоді, коли майбутній HTTP або background caller пропустить перевірку.

Межі: services/leadStageTransition.js, services/leadBookingLink.js,
фактичні виклики й PostgreSQL-тести. Не міняй ціни, формули та booking identity.

Кроки:
1. Відтвори supplied foreign booking ID, foreign product ID та parent UPDATE=0.
2. Перевіряй батьківські записи й ownership у сервісній транзакції;
   невдале батьківське оновлення не залишає link/upsert чи частковий запис.
3. Перевір replay, конкурентну зміну, rollback і різні організації.
4. Для generic booking linkedTo зроби окремий мінімальний reproducer.
   Якщо потрібна захищена правка — підготуй точні hunks, тест і область дозволу;
   не змінюй field priorities, modal ownership чи protected manifest без нього.

Готово коли: HTTP і прямі виклики сервісів однаково відхиляють чужі ID;
власні зв’язки працюють; rollback не лишає сиріт. Захищена підчастина має
окремий PASS або конкретний BLOCKED, а не приховане обходження.

Live QA: лише approved synthetic зв’язки у задачі 7.
Ризики: не називати latent service gap доведеним live exploit без відтворення.
```

## 3. SYS-MB-OWNERSHIP-DECISIONS — Історичні власники й публічність — ANALYSIS_COMPLETE / DECISIONS_PENDING

Результат: `DECISIONS.md`, `OWNER_MAPPING_FORMAT.md`, schema/синтетичний приклад/офлайн-валідатор mapping, `PUBLIC_ASSET_JOB_POLICY.md`, `OWNERSHIP_PREFLIGHT_REPORT.md` і `OWNERSHIP_PREFLIGHT.synthetic.json`. Підсумок і checkpoint — `OWNERSHIP_DECISIONS_REPORT.md`, `OWNERSHIP_DECISIONS_VERIFICATION.json`. Виділеного operator read-only підключення немає: реальні counts/owners/links/jobs не зібрані. Collector перевірений на локальних fixtures (10 unit, 8 PostgreSQL та окремий permission-denial сценарій); це не production preflight і не live PASS. OWN-01–08 залишаються PENDING; формат-valid не означає дозвіл міграції. Власників не призначено, публічні links/assets/jobs не змінено. Оригінальний запит нижче збережено для scope; не повторюй виконаний аналіз з нуля.

```text
Виконай пакет рішень D02-C3/C4 та передумов D05; production-записи не змінюй.

Мета: отримати конкретне джерело ownership і правила публічності до міграцій.

Межі: наявний audit-multibusiness-ownership.js, LEGACY_* audits,
catalog/template/recurring schema, assets/jobs і домени D05.

Кроки:
1. Повтори read-only preflight на явно визначеному джерелі. Якщо доступної
   read-only БД немає, завершуй аналіз на fixtures та вкажи прогалину доказів.
2. Склади компактну таблицю рішень: власники старих каталогів/шаблонів/серій;
   організаційна бібліотека й правила копій; public/private links/assets;
   дозволені фонові jobs; невизначені та змішані записи.
3. Для кожного рішення дай рекомендацію, наслідки й точну відповідь, якої бракує.
   Не призначай усе Парку за username, роллю, продуктом чи першою появою.
4. Підготуй restricted owner mapping та окремий агрегатний звіт без PII/tokens.
   Узгодь межі HR/фінансів/інтеграцій із фактичним ownership інших потоків.

Готово коли: є DECISIONS.md, preflight evidence і машинно-перевірний формат mapping;
кожен пункт має APPROVED/PENDING та джерело рішення. Невизначені рішення
залишають залежні операції BLOCKED, не маскуються вибором агента.

Live QA: дозволена лише read-only інвентаризація; жодного revoke/generate/backfill.
Ризики: реальні mappings не комітити у загальнодоступні звіти; counts не доводять owner.
```

## 4. SYS-MB-LEGACY-OWNERSHIP — Міграція каталогів, шаблонів, серій та jobs — DEPENDS_ON_3

Поточний стан після аналізу: **BLOCKED_SOURCE_MAPPING_AND_POLICY**. До виконання потрібні погоджені OWN-01–08 у відповідному scope, реальна restricted inventory/mapping, перевірене джерело та точний дозвіл на майбутню міграцію. Документи задачі 3 не є таким погодженням. Наявний private containment не знімати через синтетичний PASS.

```text
Реалізуй погоджені D02-C3/C4 після задачі 3 за спільними правилами.

Мета: безпечно повернути legacy-функції бізнесам із доведеним ownership.

Межі: additive SQL migration, каталоги/шаблони/recurring та їх services,
public catalog handler, catalog assets/provider-job persistence і тільки
відповідні scheduler/storage ділянки. Номер міграції визнач за актуальним repo.

Кроки:
1. Додай durable owner, FK/uniqueness і правила дочірніх записів;
   застосовуй тільки затверджений mapping. Mixed/unassigned записи ізолюй.
2. Scope усі reads/writes/joins, settings/history та прямі ID-операції.
   Recurring використовує бізнес і ресурси власної серії, без Park constants.
3. Реалізуй погоджені public-token та asset правила без blanket блокування
   продуктових/меню зображень. Зв’яжи business/request/provider job/destination.
4. Перевір активний catalog refresh; dormant recurring scheduler не вмикай.
5. Знімай C1/C2 обмеження окремо для модуля тільки після перевірки всіх
   private/public/background входів і відсутності чужих записів.

Готово коли: empty/production-like/partial/mixed/rerun/rollback-preflight
PostgreSQL сценарії PASS; foreign ID/task/destination/token відхиляються;
власні дані працюють. Готові migration manifest і безпечний rollback/runbook.

Live QA: реальна міграція, токени й jobs — тільки у точному блоці задачі 7.
Ризики: ні вгаданого backfill, ні реальних provider викликів; protected booking
підчастини погоджуються окремо. Зовнішні копії старих public assets не відкликаються кодом.
```

## 5. SYS-MB-D05 — Ownership решти доменів — PARTIAL_LOCAL / HOLD

Результат: `D05_IMPLEMENTATION_REPORT.md`, `D05_VERIFICATION.json` та окремі D05 intake/income/chat/people-finance/provider-Art звіти. Виконані локальні патчі й executable denial/retry/rollback перевірки. Увімкнені NOT_MIGRATED поверхні не вважати закритими через registry або вузький PASS; точні наступні ownership/containment scope наведені в контрактах. Оригінальна картка нижче збережена.

```text
Закрий D05 за спільними правилами, окремими контрольованими доменними патчами.

Мета: жоден увімкнений модуль чи інтеграція не обходить організацію/бізнес.

Межі: warehouse photo intake; staff/payroll/certificates/finance references;
income notifications; general chat/personal AI; Telegram/provider/payment ingress.
Art та роботу HR/інших агентів не переносити непомітно в цей patch.

Кроки:
1. Для кожного домену зафіксуй owner, source of truth, ingress/read/write,
   retries/idempotency та статус SUPPORTED/BLOCKED/NOT_MIGRATED з доказом.
2. Intake: ownership від створення draft до matching/status/confirm;
   retries не змінюють бізнес. Старі drafts — лише за approved mapping.
3. Staff/payroll/certificates: окрема модель належності й правил розподілу;
   не відкривай їх лише за user membership і не виправляй ізоляцію фільтром сум.
4. Notifications/chat/providers: явний tenant до читання/відправлення;
   жодних default-to-Park чи global creator broadcast як запасного шляху.
5. Для HR/payments/Art та інших захищених частин підготуй окремі конкретні
   патчі/контракти й потрібний точний дозвіл; незалежні частини продовжуй.

Готово коли: для кожного увімкненого домену є executable denial/retry/ownership
тести. Незавершене лишається доведено недоступним і явно BLOCKED із власником
наступної роботи; увімкнений NOT_MIGRATED домен блокує повне закриття SYS-MB.

Live QA: лише затверджені synthetic records; реальні платежі, зарплати, Telegram
та provider виклики заборонені без окремого точного дозволу.
Ризики: не міняти ціни/формули, secrets, зовнішні контракти та чужі активні зміни.
```

## 6. SYS-MB-D06-LOCAL — Наскрізне приймання і готовність — ACCEPTANCE_COMPLETE_WITH_BLOCKERS

Результат: `ACCEPTANCE_REPORT.md`, `D06_VERIFICATION.json` і п'ять `D06_*_MATRIX.md`. Поточні case-level PASS/FAIL/NOT_TESTABLE не замінюють необхідний наступний повтор після виправлення блокерів. Окремо лишається D06-UI-01/P2: intermittent відкриття editor до API-запиту, причина ще не доведена; наступний PASS не вважається fix цього історичного збою. Оригінальний запит нижче збережено для перевірки повноти.

```text
Виконай незалежне наскрізне приймання SYS-MB після готових задач 1–5.

Мета: довести поведінку повного сценарію, а не скласти попередні unit PASS.

Межі: actual local app + disposable PostgreSQL + browser; наявні тести та
нові acceptance fixtures. Попередні partial reports не вважай сертифікатом домену.

Кроки:
1. Один акаунт — два бізнеси з різними ролями; один акаунт — дві організації;
   owner/admin/member, останній owner, default/active business, деактивація.
2. Перевір усі enabled домени: bookings/timeline, clients/leads, tasks, finance,
   stock, products/graduation і домени D05; прямі чужі ID та aggregate read-only.
3. Same-JWT revoke, role change, cross-tab, refresh/back/forward і late responses;
   форми/клавіатура/light-dark/390-768-1440; console/network errors.
4. Сформуй access/denial matrix, orphan/conflict report, compatibility-usage
   telemetry та readiness для кожного бізнесу. Підтверди повноту збору.
5. Запусти npm test і ризик-релевантні actual HTTP/PG/browser suites.
   Виправ локальні регресії, онови точні hashes та ownership документів.

Готово коли: ACCEPTANCE_REPORT.md має PASS/FAIL/NOT_TESTABLE для кожного сценарію,
безпечні докази й окремі рішення PARK_DAR_RELEASE_READY та GLOBAL_MODEL_COMPLETE.
Відсутня подія в непрацюючій telemetry не рахується нульовим usage.

Live QA: підготуй точний сценарій/кількість fixtures/TTL/cleanup для задачі 7.
Ризики: незакритий доступ між бізнесами в enabled модулі означає HOLD.
```

## 7. SYS-MB-PARK-DAR-RELEASE — Production delivery і live QA — BLOCKED_BY_D06_FINDINGS

```text
Підготуй і після чинного точного дозволу виконай production delivery SYS-MB
для Парку та Дару. Production impact: yes.

Мета: підтверджений cumulative diff працює на сайті, з exact SHA та live evidence.
Прочитай AGENTS.md і docs/CODEX_PRODUCTION_AUTONOMY.md.

Кроки:
1. Read-only звір live /api/version, production branch і Railway target.
   Очікування: codex/eventgenix-production; fortunate-appreciation / production /
   service 8223324090. Розбіжність — з’ясувати, не переналаштовувати hosting.
2. Створи чистий release worktree від актуальної production-бази; перенеси
   тільки перевірені cumulative SYS-MB hunks/new files, зберігши інші потоки.
3. До production push/deploy/migrations підготуй конкретний RELEASE_MANIFEST.md:
   candidate/base SHA, source/target, migration files та класифікація, auth scope,
   approved mappings, попередній live SHA, rollback і точний live-fixture план.
4. Якщо відповідного активного дозволу немає, один раз запроси точний named
   migration/auth/release/QA блок на цей manifest, максимум 6 годин/3 спроби.
   Старі дозволи й старі номери міграцій не вважай автоматично чинними.
5. У межах дозволу: product commit, окремий version/cache/changelog commit,
   push exact candidate, необхідний green CI для SHA, штатний Railway helper
   з явною confirmed branch. Без raw railway up/force-push/reset чужих змін.
6. Перевір live SHA/branch/version/label та owner/worker сценарії. Створення
   й деактивація QA membership/account/business — лише затверджені fixtures;
   cleanup тільки власного registry-набору, ніяких реальних записів.

Готово коли: RELEASE_EVIDENCE.md і LIVE_QA_REPORT.md підтверджують точний реліз,
успішні live сценарії, cleanup та rollback reference. Fixture PASS ≠ live PASS.

Live QA: другий бізнес, працівник лише в одному, різні ролі, негайний revoke,
відсутність чужих даних, products/graduation; no real payments/messages/generation.
Ризики: обмежений safe Park/Dar реліз не дорівнює GLOBAL_MODEL_COMPLETE;
міграцію не відкочувати сліпо старим кодом, потрібен перевірений rollback план.
```

## 8. SYS-MB-FINAL-CUTOVER — Майстерня/CRM і завершення compatibility — ПІСЛЯ_7

```text
Після стабілізації Парку/Дару заверши модель для Майстерні долі та CRM продажів.
Це окремі cutover/release блоки, не продовження старого дозволу.

Мета: всі бізнеси використовують organization/business membership;
legacy user arrays/global operational roles перестають бути джерелом доступу.

Кроки:
1. Read-only preflight окремо для maysternya_doli та crm: користувачі, ролі,
   ownership/default conflicts, enabled modules, історичні дані й інтеграції.
2. Підготуй й погодь точний mapping без розширення прав; локально перевір
   migration/rerun/partial/rollback і повну domain matrix. Нічого не вгадуй.
3. По одному бізнесу підготуй manifest і виконай окремо авторизований release
   за workflow задачі 7: exact candidate CI, helper deploy, live owner/worker QA.
4. Виміряй usage compatibility на всіх фактичних entrypoints. Період, мінімальне
   покриття трафіку та критерії нульового usage визнач до спостереження.
5. Лише після cutover обох бізнесів і достатнього zero-usage evidence видаляй
   стару гілку авторизації. Deprecated DB-поля — окрема approved cleanup migration;
   не змішуй destructive cleanup зі звичайним auth-cutover.

Готово коли: final access/denial/orphan/compatibility reports підтверджують усі
бізнеси й enabled домени; немає implicit Park fallback або активного legacy доступу;
немає незакритого enabled NOT_MIGRATED. FINAL_ACCEPTANCE.md має факти й residuals.

Live QA: кожен бізнес/організація, різні ролі, account switching, revoke,
основні робочі модулі та контрольована перевірка після відключення compatibility.
Ризики: нуль трафіку не доводить безпечне видалення; schema cleanup/реальні дані
потребують окремого дозволу. Невирішений домен не називай завершеним.
```

## Чому саме такий порядок

1. Спочатку registry/UI та service boundaries: новий бізнес має бути коректно налаштований, а внутрішні зв’язки — перевірені до масового перенесення даних.
2. Історичні власники й публічність — рішення власника, тому їх відділено від механічної SQL-реалізації.
3. Public/jobs та інтеграції можуть обходити HTTP membership; без них «закриті маршрути» не означають повну ізоляцію.
4. Незалежне наскрізне приймання передує production. Остаточні критерії відрізняють безпечний обмежений реліз від повної моделі.
5. Майстерня/CRM мігруються окремо; compatibility видаляється після фактичної перевірки обох, а не за датою чи відсутністю логів.
