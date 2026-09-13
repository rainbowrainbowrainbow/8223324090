# SYS-MB: фактичні блокери та 4 задачі завершення для GPT-5.5

Перевірено 2026-09-13. Це конкретизація FINISH-01–04 після звірки коду, не новий дизайн системи й не production authorization.

## Фактичний checkpoint

- Робоче джерело: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-finish-02-r2-20260913`.
- Гілка: `codex/sys-mb-finish-02-r2-20260913`; HEAD `827b7ab4d0a9fa50a04dcb7c93d4392513c50f81`.
- FINISH-01 foundation: `7cc3699ac583c91783dbdb76219788d682f35ebe`.
- FINISH-02 prepare/telemetry: `e33a69c8dd9d1d6d98501ad5387cbe00e10b011c`.
- Свіжий GET `/api/version`: v0.81.153, `4214598e263057b1cb1524d7fb84f328031d288d`, `codex/eventgenix-production`, metadata complete. Це Design Board release, не публікація цього SYS-MB candidate.
- Сайт: `https://8223324090-production.up.railway.app`.
- Ціль: `fortunate-appreciation / production / 8223324090`; UUID сервісу `3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`, project `bc28b46c-d4bc-491c-893a-d8401c633668`.
- Перед кожним delivery звірити все заново; цей checkpoint не фіксує production назавжди.

## Що було неправильно в попередній передачі

1. **FINISH-02 не завершений за власними Done when.** `services/businessCutover.js` має `prepareReservedCutover`, але не має apply. Він записує надані hashes у journal, не перевіряє фактичний mapping проти production snapshot і не виконує cutover. Коректний статус: PARTIAL_IMPLEMENTATION, не LOCAL_IMPLEMENTATION_COMPLETE.
2. **Заповнити одну env-змінну недостатньо.** Назва `MULTIBUSINESS_AUDIT_DATABASE_URL` — інтерфейс локального collector. Відсутність значення не доводить відсутності будь-якого доступу. Перевірено: змінної немає в Process/User/Machine; у визначеному secrets-файлі є назви `TRUSTED_QA_OPERATOR_DATABASE_URL` і `TASK_AI_ROLLOUT_DATABASE_URL`, але їхні права й придатність для цього аудиту не встановлено. Значення не читалися у звіт. Агент має організувати технічний доступ, не вимагати від власника створення PostgreSQL ролі руками.
3. **Collector повертає агрегати, а не готовий mapping.** Потрібен окремий обмежений збір фактичних access/owner даних у захищений локальний артефакт. Порожні JSON templates і валідатор не створюють mapping.
4. **Production controller не підтримує цей тип релізу.** `scripts/production-block-policy.js:buildManifest` безумовно відхиляє Red paths; QA validator приймає тільки timeline/canary. Додаткове «дозволяю» саме по собі не створює підтримку Red SYS-MB workflow. Це обмеження репозиторного controller, не зовнішня автоматична відмова tool approval.
5. **Production QA lifecycle не дороблений.** FINISH-01 report прямо лишає writable fixtures недоступними; перемикач `window.__eventGenixLiveQaReadOnly` не є серверною гарантією відсутності побічних записів.
6. **Telemetry часткова.** Пошук викликів recorder показує лише `middleware/auth.js`; service/WS/providers/jobs/operator не інструментовані. HTTP `allowed` записується до domain authorization; raw context проходить regex, але не обмеження server registry; `configured=false` пропускає облік; fire-and-forget не має доказу втрат/reconciliation. Це не достатній zero-usage detector. Потрібні reproducer/tests перед виправленнями, а не заяви про доведену production вразливість.
7. **14 днів не блокують публікацію функціональності.** Вони потрібні для остаточного видалення старої авторизації після обох cutover. Точна нижня межа вікна: `max(14 повних UTC днів, найдовший enabled cycle + 24h)`, не сума цих періодів. Невідомий цикл/coverage лишає HOLD.

## Спільні правила для всіх чотирьох задач

- Прочитай AGENTS.md, production runbook, migration governance, вихідний FINISH_TASKS_GPT55.md, поточні manifests/decision/domain/acceptance документи. Код і нові докази мають пріоритет над старими PASS-заголовками.
- Продовжуй наявний candidate в окремому `codex/...` worktree. Збережи інші потоки. Не починай систему заново, не додавай задачі для кожного тесту. Веди спільний актуальний checkpoint із повними SHA та hashes артефактів.
- Не створюй підлеглих агентів без окремого запиту. Модель і reasoning користувач обирає у своєму інтерфейсі.
- Production дії — тільки в точному чинному scope. Підготуй конкретні scripts/diff/manifest/rollback перед єдиним питанням на відповідний блок; після дозволу продовжуй усі звичайні кроки без повторень. Не проси користувача самому вводити SQL або credentials у чат.
- Відрізняй необхідність дозволу від відсутності коду, рішення чи evidence. Не повторюй controller prepare, якщо незмінна причина вже доведена. Не видаляй denylist, не маскуй auth/QA під timeline і не обходь platform rejection.
- Секрети — лише в пам'яті або погодженому credential store; приватний mapping — поза Git і web root у сховищі з обмеженим доступом. У звітах — hashes, агрегати, approval references. Не dump усіх користувачів/клієнтів/секретів.
- Не змінюй ціни/формули, provider destinations/transport, hosting/CI settings, залежності чи production-записи поза окремо погодженими predicates. Не відкривай payroll через роль-власника. Deprecated columns не видаляти.
- Реальне тестування: Node 22/npm 10, focused tests, actual Express→PostgreSQL, browser, точний CI SHA й live QA. Кожен FAIL/HOLD має причину і конкретний наступний крок. Не занижуй required module list заради green.

## Задача 1 — SYS-MB-RECOVER-01: агент організовує доступ і готує рішення

**Goal:** отримати реальний preflight і заповнений проєкт mapping, не перекладаючи DevOps роботу на власника.

**Scope:** існуючі collectors у `scripts/audit-multibusiness-ownership.js`, `final-cutover/tools/`, mapping validator/exporter; локальний доступ і sanitized evidence. Production impact: read-only; лише якщо потрібне створення audit role — окремий точний provisioning block.

**Steps:**
1. Звір live/remote/Railway і реальний стан Парку/Дару. Не вважай FINISH-01 опублікованим за назвою локального commit.
2. Сам перевір відомі локальні джерела доступу, не друкуючи значень. Для існуючого дозволеного audit source перевір target, SELECT grants, inherited roles, ownership, superuser/BYPASSRLS, доступні writable functions. Назва змінної або READ ONLY transaction сама по собі не доводить найменших прав. Не перепризначай write-capable QA URL у readonly env для обходу правила.
3. Якщо придатного source немає: підготуй вузький ідемпотентний provisioning script для окремої audit role, конкретний список таблиць/колонок, CONNECT/USAGE/SELECT без write/DDL/role administration, TTL/retirement і secret-safe execution. Перевір локально. Покажи один точний AUDIT-PROVISION блок; після дозволу виконай сам через наявний дозволений операторський канал. Не змінюй app DATABASE_URL чи Railway settings. Якщо канал недоступний, назви точну зовнішню credential/login дію, а не абстрактне «налаштуй БД».
4. Збери actual schema/ledger, registry, власників, effective permissions/defaults, modules/settings, історичні roots/children, public/assets/jobs/providers. Доповни непокриті перевірки. Для mapping додай безпечний exporter необхідних access/owner полів; не зупиняйся на counts-only collector.
5. Сам склади пропозицію before→after без розширення доступів; unknown ownership лишай unresolved. Зведи один людський пакет: які бізнеси в якій організації, хто власник/працівники, які права MD делегуються, які модулі потрібні, хто володіє історичними матеріалами, які public links лишаються відкритими. Покажи рекомендацію й наслідок для кожної неоднозначності. Не вимагай від власника IDs/JSON; agent зіставляє погоджені назви з перевіреними IDs.

**Done when:** фактичний preflight з timestamp/source/hash; захищений заповнений draft mapping і access matrix; `OWNER_DECISIONS_REVIEW.md` з конкретними питаннями; `ACCESS_SETUP_EVIDENCE.md`; чесні unresolved rows. Один лише missing-env report не є завершенням.

**Live-site QA:** read-only source/version/profile evidence з перевіркою побічних ефектів. Без lifecycle writes, експорту реальних даних назовні або provider calls.

**Notes/Risks:** створення DB role потребує конкретного дозволу, але технічну роботу виконує агент. Бізнес-власника не обирати за username чи global creator.

## Задача 2 — SYS-MB-RECOVER-02: доробити код, Red delivery і QA

**Goal:** підготувати реально runnable apply/domain/telemetry/QA пакети; усунути приховані незавершені частини FINISH-01/02.

**Scope:** локальні SYS-MB ownership/schema/access зміни з раніше погоджених FINISH-01/02, існуючий cutover service, домени матриці, telemetry, `scripts/production-block-{policy,controller}.js`, release helper інтеграція, SYS-MB fixture registry. Для нового protected tooling scope підготуй concrete patch proposal і отримай потрібний точний дозвіл; не виконуй production дій цією задачею.

**Steps:**
1. Виправ inaccurate completion labels. Звір успадкований cumulative diff з актуальною базою та hashes; усі нові FAIL відтвори мінімально.
2. Після погодження рішень задачі 1 реалізуй guarded reserved registration/apply MD/CRM: approved mapping hash і зовнішній approval reference, фактичний DB source fingerprint, locks, atomic membership/registry flip, exact receipts, unchanged-outside-target, partial/conflict/concurrency/no-op replay і access-safe forward rollback. Не довіряй клієнтському `APPROVED` або наданим hashes без перевірки змісту. У staging не змінюй defaults/authority. Узгодь mapping format для ще не створеного business без вигаданого ID.
3. Дороби required legacy catalogs/templates/recurring roots і children, token/assets publication, actorless jobs/retries/recipients; MD timeline без platform creator, opaque program IDs і no-write dryRun; CRM required modules. Protected people/payroll/payment/Art відкривай лише за конкретним погодженим контрактом; формули не змінюй. Якщо бізнес-рішення очікує, виконуй незалежні частини.
4. Дороби telemetry всіх entry families за exit gate: registry-bounded labels, окремі admission/domain decisions, denied/unknown/missing/implicit fallback, serialization окремо від grants, aggregate contexts, unavailable registry, durable restart/deploy evidence, loss detection і denominators. Перевір, що telemetry failures не змінюють доступ і не маскуються як zero usage.
5. Додай підтримуваний Red SYS-MB delivery шлях з exact file/migration hashes, reviewed descendant rules, approval binding, 6h/3 attempts, dry-run і fail-closed drift. Збережи стандартні Yellow обмеження. Додай тести expired/tampered/missing authorization, зміненого scope й неавторизованих Red paths. Не створюй універсальний bypass прапорець.
6. Дороби серверний registry-owned QA lifecycle: accounts/organizations/businesses/memberships/defaults, enrollment/chat, wallet, tasks/outbox, product price_rules, дочірні записи і retention. Локально доведи interrupted/repeated cleanup, захист реальних records і відсутність messages/payments/jobs side effects. Browser read-only flag не замінює цю реалізацію.
7. Actual-app PG/browser приймання всіх required доменів: Парк/Дар/MD/CRM, ≥2 організації, різні ролі, revoke same JWT, foreign IDs, rollback/concurrency, cross-tab/late responses/keyboard/390–768–1440. Збережи separate readiness кожного release та runnable commands.

**Done when:** apply працює на disposable production-like DB, нові migrations перевірені, approved mapping валідний, required domains зелені, telemetry coverage повна, Red dry-run і fixture cleanup доведені. `IMPLEMENTATION_RECOVERY_REPORT.md`, domain matrix, manifests/rollback/QA inventory. Порожні templates, HTTP-only counters або prepare-only API не є PASS.

**Live-site QA:** тільки необхідні read-only докази до наступної задачі; production writes тут не виконувати.

**Notes/Risks:** задачу можна почати незалежними tooling/telemetry/QA роботами до відповіді на business mapping. Це не право автоматично розширювати доступи.

## Задача 3 — SYS-MB-RECOVER-03: опублікувати і перемкнути бізнеси

**Goal:** доставити готову реалізацію на сайт і прийняти кожен бізнес. Production impact: yes.

**Scope:** перевірені runnable пакети задач 1–2; auth/schema/approved mapping apply, version, CI, Railway helper, registered live QA/cleanup. Без зміни unrelated production потоків.

**Steps:**
1. Перевір prerequisites, live/remote/pending releases і реальний Park/Dar state. Якщо cumulative FINISH-01 досі локальний — включи та явно прийми цей prerequisite у першому погодженому release або випусти його окремо. Не ховай його всередині «лише telemetry».
2. Підготуй конкретний перший manifest: exact source/base SHA, auth/domain files, migration names/hashes, mapping hash/predicates, service, QA registry/counts/TTL, cleanup та forward rollback. Першим обирай бізнес із green readiness; не вимикай потрібні модулі для цього.
3. Отримай один чинний auth/migration/data/release/QA block для конкретного release через дороблений supported workflow. Усередині нього functional commit → окремий version/cache/changelog → exact-SHA push → required green CI → Railway helper deploy → погоджений atomic apply → live QA → cleanup. Порядок schema/code/apply має відповідати перевіреній backward compatibility; не запусти новий код проти непідготовленої схеми.
4. Перевір owner/worker, domains, same-JWT revoke, дві організації, aggregate read-only і незмінність доступу інших бізнесів. Exact live version/branch/SHA, audit receipts і cleanup обов'язкові; failure зупиняє наступний cutover.
5. Другий бізнес — новий preflight, manifest і окремий активний блок. Після обох PASS увімкни/підтвердь повний observation collector, startUtc/config/source/mapping hashes, denominators і schedule cycles. Код compatibility поки лишається.

**Done when:** сайт підтверджує точні release SHA; усі required domains прийняті, MD/CRM membership застосовані, Парк/Дар не регресували, QA fixtures очищені за політикою. `PRODUCTION_DELIVERY_REPORT.md` з CI/deploy/QA/apply/cleanup receipts; observation реально почався. Не завершувати локальним npm test.

**Live-site QA:** exact deployed version; тільки зареєстровані тестові записи, без реальних sends/payments/export. Неперевірений сценарій не позначати PASS.

**Notes/Risks:** 14-денне вікно не затримує цей функціональний release. Нове погодження потрібне лише для іншого бізнесу, scope/target drift або вичерпаного блоку.

## Задача 4 — SYS-MB-RECOVER-04: спостереження і остаточне видалення fallback

**Goal:** доказово завершити модель після production приймання. Production impact: yes тільки для фінального release.

**Scope:** exit gate, повна telemetry, мінімальне видалення legacy operational authority; compatibility response fields і technical creator зберегти.

**Steps:**
1. Перевір фактичні startUtc/coverage та обидва cutover receipts. Виміряй `max(14 повних UTC днів, найдовший enabled job/retry/retention cycle +24h)`, ≥30 real authorized operations у ≥5 днях для кожного бізнесу, усі потрібні entry families. Unknown cycle/coverage/loss — HOLD; counts null не перетворювати на 0.
2. Автоматизуй read-only збір на існуючих засобах після явного запиту користувача на моніторинг; без нових hosting settings. Якщо вікно триває, дай exact remaining/endUtc або конкретну невідому величину. Не блокуй shell на два тижні й не повторюй порожні HOLD-звіти.
3. Після PASS_MEASURED мінімально прибери operational grants/fallback із legacy arrays/global roles. Збережи serialization і platform technical functions. Прийми actual-app PG/browser і machine/public/job paths усіх бізнесів; не відновлюй доступ через fallback при DB error.
4. Підготуй exact manifest/rollback, отримай один чинний auth-release/QA block і виконай commit/version/push/exact-SHA CI/helper deploy/live QA/cleanup. Deprecated DB columns не видаляти.

**Done when:** `FINAL_ACCEPTANCE.md` має вимірювані докази, exact final live SHA, повну domain/access matrix і `GLOBAL_MODEL_COMPLETE=true` тільки за відсутності required HOLD. Якщо вікно не минуло — функціональність уже опублікована, статус лише фінального cleanup залишається RUNNING/HOLD.

**Live-site QA:** всі бізнеси/ролі, revoke, switching, domains, foreign denials і supported legacy clients на опублікованому SHA.

**Notes/Risks:** прискорювати можна реалізацію й delivery, але не вигадувати час або реальний traffic. Будь-яку зміну observation policy оформлювати окремо до оцінки, а не підганяти під наявні дані.
