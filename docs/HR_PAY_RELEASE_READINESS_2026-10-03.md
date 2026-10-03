# HR-PAY-10 — підготовка випуску та точний залишковий блокер

Production impact: yes. **HOLD: production не змінено; фінальний manifest ще не готовий до підтвердження.**

## Виконано в межах погодження

- Повторно прочитано AGENTS, production runbook та фактичні докази HR-PAY-09. Workflow `hr-payroll` уже був реалізований у кандидатові; його не підмінено іншою задачею.
- Перевірено literal allowlist: 54 HR-PAY файли від актуальної live-бази, тільки `routes/payroll.js` та `.github/workflows/ci.yml` як дозволені Red paths, тільки `374_payroll_day_exceptions.sql`. CI diff додає лише завантаження HR-PAY browser evidence; triggers, permissions і secrets не змінено.
- Посилено `scripts/production-block-controller.js`: пошук тільки `CI` / `ci.yml`, подія `push`, production-гілка і точний release SHA. Після очікування перевіряються всі 8 потрібних jobs; відсутній, skipped чи невдалий job зупиняє виконання. Перед upload повторно перевіряється live/remote drift.
- `tests/production-block-controller.test.js`: **57/57 PASS**, включно зі стороннім Red path, зайвою міграцією, target/SHA drift, простроченням, 3 спробами, неправильним підтвердженням, чужим workflow/PR/feature CI та пропущеними required jobs.
- Сумісність нового CI guard зі справжніми GitHub JSON metadata перевірена на відомому зеленому production run `37117533584`. Це перевірка формату guard, не доказ нового кандидата.
- Актуальну live-базу `97269de204726f4de9f9e6dd80d6e14a25c0f981` приєднано merge без переписування історії. Збережені HR-PAY зміни, production UI та обидва переліки unit-тестів. Сторонні dirty зміни OneDrive не включено.
- `node scripts/version-sync.js` — PASS для успадкованої live-версії `0.82.52`; це ще не новий HR-PAY release marker.

Фінальний SHA цієї підготовки, локальний baseline, CI URL та результати jobs зберігаються після перевірки в [санітизованому доказі](../output/hr-pay/hr-pay-10-ci-proof.json). Повний локальний лог: `output/hr-pay/hr-pay-10-npm-test.log`. Скриншоти та `journey-evidence.json` exact-SHA CI зберігаються локально під `output/hr-pay/hr-pay10-browser-<SHA>/`.

## Перевірена production identity та розходження

- Live preflight: **0.82.52**, SHA `97269de204726f4de9f9e6dd80d6e14a25c0f981`, `codex/eventgenix-production`.
- Railway: project `fortunate-appreciation` / `bc28b46c-d4bc-491c-893a-d8401c633668`, environment `production`, service `8223324090` / `3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`, domain `8223324090-production.up.railway.app`. Активний deployment на момент preflight: `5eeb471e-002d-458f-8b40-8418da05b278`, SUCCESS. Жодного `railway link` або settings update.
- Remote production на момент preflight: `7277b1987b05555c7e1ca8ad8f6593fb68c2965b`, клієнтський реліз після live. Його [CI 37118270373](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/37118270373) мав failure в `Omni browser regression / Run Omni lead links PostgreSQL integration`.
- Чужий невипущений реліз не включено в HR-PAY payload і не переписано. Перед остаточним HR-PAY merge/manifest потрібно знову перевірити live/remote; автор іншого релізу має завершити свій випуск або надати інший погоджений стан production. Наявний controller зупиняє drift.

## Блокер продукту, який не усувається allowlist controller

Новий GET-аудит поточного live повторно підтвердив `403 staff_not_migrated` для зарплатних профілів. Аудит — 46 працівників / 59 пар, PARTIAL; суми й ПІБ у доказах не збережено. Файл: `output/hr-pay/hr-pay-10-api-preflight.json`.

Причина — production membership gate у `requireLegacyBusinessSurface`, а не неправильна назва бізнесу чи відсутня зарплатна capability. Чинні `parkHrStaffCardRead` і `parkStaffScheduleAccess` відкривають лише конкретні кадрові/графікові маршрути. Дозволеного Park-шляху для профілів, dated conditions, винятків і зарплати немає. Actual-app доказ HR-PAY-09 чесно містить `journeyStatus: BLOCKED`, хоча окремі дозволені етапи розрахунку пройшли.

HR-PAY-10 прямо забороняє змінювати **auth policy**. Дозвіл на payroll Red path у release controller не дає дозволу змінювати бізнес-доступ. Розширення ролей, інших бізнесів чи обхід 403 не виконувались.

### Конкретний обсяг окремого погодження, необхідного для продовження

Вузький Park HR/payroll доступ: тільки `event_genix` / `park`, чинне membership, чинні salary/attendance capabilities, перевірена належність даних Park. Потрібен список дозволених method+path для:

1. HR-картки та налаштування професій/ставок, payroll profiles/версій і датованих призначень; без bulk apply або масового заповнення ставок.
2. GET `/api/hr/staff/:id/payroll-conditions`, PUT `/api/hr/staff/:id/payroll-day-exception` та потрібних індивідуальних payroll-profile/scheme маршрутів.
3. Фактичного часу, GET `/api/hr/salary` і зарплатного preview/range-preview/розшифрування; export лишається під чинною `export_data`.

Реалізація повинна використовувати вузький route guard за зразком чинних Park guards; не відкривати весь namespace. Чинні action guards не видаляти, ролі/permission registry не розширювати. Невизначену власність запису, чужий бізнес, revoked membership і відсутню salary capability блокувати. Не відкривати confirm/reverse/payment/close/settlement mutations у межах цього доступу. Усі мутаційні перевірки — тільки synthetic isolated PostgreSQL; production QA — read-only.

Після погодження потрібні позитивний membership-mode actual-app сценарій HR → графік → виняток → фактичний час → зарплата та негативні тести чужого бізнесу/відкликаного membership/відсутності доступу до сум. Нові файли guard і регресій тоді включаються до exact HR-PAY allowlist окремою перевіреною зміною.

## Що навмисно ще не виконано

Новий patch, release/cache/changelog commit, hash-bound manifest, production push і deploy не виконано: кандидат поки не відповідає продуктовому gate та live/remote не збігаються. Не видано fake controller confirmation. Після зняття блокерів треба повторно вибрати вільний patch, підготувати окремий український release commit, пройти exact-SHA CI й лише тоді показати один фінальний controller confirmation.

Rollback reference на момент preflight — live `97269de204726f4de9f9e6dd80d6e14a25c0f981`. Відкат лише коду через repository helper; журнал migration 374 і snapshots зберігаються. Перед фінальним manifest reference потрібно повторно звірити. Destructive SQL, backfill, зміни реальних кадрових записів, нарахувань і виплат заборонені та не виконані.

Нижче збережена історія HR-PAY-09/08/07; її старі live SHA не є поточною релізною базою.

---

# HR-PAY-09 — PostgreSQL, actual-app browser та аудит

Production impact: yes. **Випуск: HOLD. Повний production-сценарій не підтверджений через чинне бізнес-обмеження HR/payroll.**

Функціональний код (до документації та уточнення currency assertion у тесті): `fb3d6975ed68e2bc2dc819e9f84a3de16d10a218`, гілка `codex/hr-pay-release-review-20261003`.
Робоча копія: `C:/Users/Plotva/.codex/worktrees/hr-pay-release-review/EventGenix`.
Початкові HR-PAY-01…08 збережені. Сторонні зміни OneDrive не включені.

## Що змінено

- `services/hrPayReadiness.js`: аудит викликає спільний датований `resolvePayrollConditions`. Чинний профіль не оголошується відсутньою legacy-ставкою. Окремі причини: допуск, призначення, нечинний профіль, одиниця, місячна норма, неперевірене джерело.
- `scripts/audit-hr-pay-readiness.js`: додано `--source database` тільки через `TRUSTED_QA_OPERATOR_DATABASE_URL`; немає fallback до `DATABASE_URL`. Підключення та транзакція примусово READ ONLY; фіксовані SELECT, перевірка `transaction_read_only`, `ROLLBACK`, таймаути. У файлах немає ПІБ, сум, авторів чи вільного тексту причин.
- `services/hrPayrollConditions.js`: виправлено вибір неактивної зарплатної схеми. Вимкнена схема не змінює одиницю бази й не надає місячну норму.
- `js/hr-page.js`, `js/finance-page.js`, `services/payroll.js`: за screenshot actual-app знайдено й виправлено денну доплату, підписану як погодинну. Одиниця збережена і в заблокованих рядках; HR показує формулу та причину одноденного винятку. Додано unit/browser регресії у `tests/hr-pay-conditions-ui.test.js` та чинний actual-app файл.
- `tests/hr-pay-readiness.test.js`, `tests/hr-pay-conditions-server.test.js`: регресії пріоритету умов, неповних джерел, санітизації, read-only та неактивної схеми.
- `tests/integration/payroll-profiles-conditions.integration.test.js`: справжні PostgreSQL-перевірки допуску, двох місячних складових за кілька дат/блоків, відсутності, закритого нарахування та read-only аудиту.
- `tests/browser/hr-pay-actual-app-browser-smoke.js`: додано фактичний прихід, корекцію часу через HR UI, зарплатне розшифрування й незмінність snapshot після зміни каталогу. Жодних підроблених відповідей API. `journey-evidence.json` відділяє PASS окремих етапів від BLOCKED повного шляху.

Нові міграції, залежності, auth/roles, secrets, CI triggers і hosting settings у HR-PAY-09 не змінювались. Чинний CI уже запускає розширені файли, тому зміни workflow не знадобилися.

## Перевірки

- `npm run check:runtime` — PASS, Node 22.23.1 / npm 10.9.8.
- `node --test tests/hr-pay-conditions-server.test.js tests/hr-pay-conditions-ui.test.js tests/hr-pay-readiness.test.js tests/hr-button-contract.test.js` — PASS, 69/69, без skipped.
- `npm test` — PASS локально до останнього уточнення одиниць у розшифруванні; фінальна редакція проходить повний baseline у точному CI нижче. Migration governance — 366 SQL файлів, діапазон 001–374. Нових міграцій HR-PAY-09 немає.
- PostgreSQL: `npm run test:integration:payroll-profiles:isolated` у GitHub Actions, PostgreSQL 16. Датовані HR-PAY регресії — PASS, 14/14, без skipped. Окремий чинний тест у `payroll-profiles.integration.test.js` перевіряє повторне збереження, пропущені ставки, редагування однієї та явне видалення.
- Actual-app: `npm run test:browser:hr-onboarding:fullstack:isolated` — реальний графік → фактичний час → зарплатне розшифрування доведено; повний HR-шлях має `journeyStatus: BLOCKED`. Фінальний посилений gate і його SHA записуються в CI-доказ нижче.
- Фінальний точний SHA, CI URL, висновки jobs і browser journey: [санітизований CI-доказ](../output/hr-pay/hr-pay-09-ci-proof.json). Він зберігається після завершення CI фінального HEAD; у цьому JSON відділені результат тестів і HOLD випуску.

Локальний `TEST_DATABASE_URL` відсутній; Docker не відповів, перевірку припинено без тривалої діагностики. Integration не підключався до production. PostgreSQL і browser перевірені чинним disposable CI.

Перший прогін `668a82b75bf11ebded0056731b6302f265ce8063` не називається PASS: PG 14/14 пройшли, browser зупинився на salary UI після початкового оновлення access context. Тест уточнено: використовується справжня кнопка retry, далі пошук відкриває потрібну групу. Той прогін також мав стороннє падіння Omni mobile layout на 1 px за допустимою межею. Повторний CI `f1ecadfa2fdf216d42f5b3fae687375115bedbe3` пройшов 8/8; візуальна перевірка його screenshot виявила помилковий підпис денної ставки, виправлений у фінальному кандидатові.

## Матриця наскрізного сценарію

| Етап | Фактичний результат |
| --- | --- |
| HR-картка в isolated compatibility fixture | BLOCKED: `staff_not_migrated`; потрібен позитивний membership-mode сценарій після погодженого Park lane |
| Графік, профіль, виняток, save/reopen, дата, conflict, повернення чернетки | PASS через справжній Express → PostgreSQL |
| Copy-week | API PASS: виняток на нову дату не переноситься; видимої кнопки у поточному layout немає, browser-клік не видається за перевірений |
| Обмеження salary access | PASS: суми не запитуються і не потрапляють до форми/чернетки; дозволене редагування графіка збережено |
| Фактичний час через HR UI | PASS: 11:00–17:00, перерва 30 хв → 330 хв фізичного часу |
| Синтетичне розшифрування | 270/год × 5,5 год = 1485, денна доплата 500 один раз; усього 1985. Години фізично не подвоюються |
| Snapshot | PASS: зміна каталогу після фіксації не змінює умови й результат |
| Денна/місячна одиниця, формула й причина | Виправлені та покриті 69 цільовими тестами; фінальний browser gate перевіряє `₴/день`, формулу та причину |

Докази browser зберігаються під `output/hr-pay/hr-pay09-browser-<SHA>/`; фінальний каталог зазначений у CI-доказі. Реальні production-суми тут не наведені.

На проміжному `fb3d6975ed68e2bc2dc819e9f84a3de16d10a218` PostgreSQL знову пройшов 14/14. Browser виявив лише невірне очікування валюти в новому assertion (`грн/день` замість канонічного `₴/день`); screenshot підтвердив правильну одиницю, формулу та причину. Assertion уточнено без зміни поведінки UI. Падіння цього прогону не позначається PASS.

Ізольована база браузерного runner працює у legacy compatibility mode. Її позитивні API-тести не підтверджують доступність цих маршрутів у production membership mode. Відмови не обходилися іншим бізнесом чи зміною прав.

## Read-only аудит на 2026-10-03

Два джерела перевірено незалежно:

| Джерело | Покриття | Результат |
| --- | --- | --- |
| Live API у Park | 46 працівників, 59 пар | PARTIAL: профілі — 403 `staff_not_migrated`; без висновку про відсутність ставок через цей 403 |
| Дозволене операторське DB-підключення | 57 активних записів, 70 пар | Профілі, версії, призначення, ставки й схеми прочитані; 6 непогоджених допусків, 1 непідтверджена місячна норма |
| Одноденні винятки в production | Таблиця `payroll_day_exceptions` відсутня | `schema_missing`, неперевірено; міграція 374 ще не випускалась |

API `active=true` використовує `scheduleableStaffWhere`: core pool, без freelance та завершених кадрових записів. DB-аудит має ширший явний критерій `staff.is_active = true`; різниця кількості не означає втрату працівників. Потенційна додаткова професія — перевірка налаштувань, а не вимога оплачувати всі професії кожному працівнику.

Команди (секрети попередньо завантажені локально, значення не виводяться):

```powershell
node scripts/audit-hr-pay-readiness.js --date 2026-10-03 --source api --output output/hr-pay/hr-pay-09-api-audit.json
node scripts/audit-hr-pay-readiness.js --date 2026-10-03 --source database --output output/hr-pay/hr-pay-09-database-audit.json
```

Санітизовані докази: `output/hr-pay/hr-pay-09-api-audit.json`, `hr-pay-09-database-audit.json`, `hr-pay-09-live-readonly.json`. Шляхи `output/` локальні й ignored. Аудит не доводить історичної втрати ставок і не виконує backfill.

## Що саме блокує випуск

Live повторно перевірено 2026-10-03T10:41:56Z: **0.82.51**, SHA `98ad5e139e8409407f7f04bc9ba9ade45567921d`, branch `codex/eventgenix-production`.
«Сьогодні», розгорнутий графік і HR-картка відкрилися. Вкладка профілів показує обмеження: GET `/api/hr/payroll-profiles` — 403 `staff_not_migrated`; GET `/api/payroll/preview` — 403 `payroll_not_migrated`. GET картки — 200. HTML 200 не називається успішним завантаженням зарплатних даних.

Причина встановлена в `requireLegacyBusinessSurface`, `parkHrStaffCardRead` та `parkStaffScheduleAccess`: є вузькі Park-маршрути картки/графіка, але payroll namespace і потрібні HR/payroll маршрути не мають дозволеного membership-шляху. `park` є канонічним alias `event_genix`, це не інший бізнес. Помилки URL, яка б законно знімала це обмеження, не знайдено.

**Одна відсутня передумова:** окремо погоджений вузький Park HR/payroll доступ із визначеною власністю даних та чинними salary capabilities. Потрібні лише маршрути профілів/призначень, dated conditions/винятків, табеля й зарплати; інші бізнеси, revoked membership і користувачі без salary access мають залишитися закритими. Поточний HR-PAY-09 прямо забороняє розширення доступу, тому цей policy-блок не змінювався. Після його погодженої реалізації потрібен позитивний actual-app тест у production-подібному membership mode.

Реальні кадрові дані, нарахування, виплати й production schema не змінено. Production deploy не виконувався. HR-PAY-10 не переходить до manifest/deploy, доки цей блокер не знятий.

Нижче збережено попередні звіти HR-PAY-08/07 як історію; поточний статус наведений вище.

---
# HR-PAY-08 — інтерактивна оплата зміни

Production impact: yes. **Production release: HOLD. Production не змінено.**

Робоча копія: `C:/Users/Plotva/.codex/worktrees/hr-pay-release-review/EventGenix`.
Feature-гілка: `codex/hr-pay-release-review-20261003`. Сторонні зміни OneDrive не включені.
Функціональні commits: `71bb676448bf0a214fef6fab5ccbd1458517a300`, `2543cf20cbe79e6f73de5a81abd1dbfa01c6bb1f` та наступне уточнення browser selector.

## Зміни HR-PAY-08

- Графік читає датовані серверні умови окремо для бази й додаткової професії: назва, сума, одиниця, джерело та період дії.
- Альтернативний профіль записується як одноденний виняток із перевіреними сервером profile/version ID і знімком джерела. Постійний профіль не змінюється.
- Разова ставка має тип, суму й обов’язкову причину; її можна явно скасувати з поверненням до успадкованих умов. Місячна база має окрему погодинну/денну доплату; оклад не множиться на зміни.
- Preview відрізняє план від факту, враховує перерву й не вигадує суму за неповного часу. Основний блок іншої професії не додається до звичайної додаткової оплати; явний одноденний виняток має ту саму область дії, що й сервер.
- При першому виборі додаткової професії інтервал оплати підставляється з поточного часу блоку, а не зі старих вимкнених полів.
- Збереження перевіряє версію винятку та плану. Повтор після невідомого результату використовує той самий idempotency key. Платіжна форма заблокована під час запису; введення й фокус зберігаються при фонових читаннях.
- Чернетка часу, професій, перерв і приміток повертається з HR, включно з помилкою читання картки та retry. Прив’язка до акаунта/ролі/бізнесу, працівника й TTL збережена. Суми не записуються в sessionStorage.
- Зміна дати завантажує її власні умови. Copy-week не копіює журнал винятків; у чинному handler копіювання є явне попередження. Ізольований тест перевіряє реальний copy API та умови цільової дати; це не доказ доступності прихованої legacy-кнопки в поточному layout.
- Для користувача з правом редагування графіка, але без перегляду сум, перевірка чинної ставки виконується сервером під час збереження плану. Legacy прапорець погодинної ставки не блокує денний профіль; допуск та інші серверні перевірки зберігаються.
- GET і PUT умов оплати захищені чинним salary-view permission; PUT також потребує чинного manage-payroll-rules. Права не розширено. Помилки 403 не підміняються повідомленням про відсутню ставку.

Основні файли: `js/staff-page.js`, `js/hr-page.js`, `css/pages-hr-staff.css`, `routes/hr.js`, `services/hrPayrollConditions.js`.
До ще не випущеної additive міграції `374_payroll_day_exceptions.sql` додано nullable `selected_profile_snapshot`; backfill відсутній.
Новий тест: `tests/browser/hr-pay-actual-app-browser-smoke.js`. Він підключений до наявного disposable PostgreSQL runner і CI, без моків API.
Вузький HR allowlist включає саме цей тест і `.github/workflows/ci.yml` для публікації синтетичних screenshot artifacts. Фактичний candidate diff: 54 файли; сторонні protected paths не дозволено.

## Перевірки та докази

- Node 22.23.1 / npm 10.9.8. Локальний `npm test` PASS; повний schedule browser smoke PASS.
- Після точкових виправлень: 42 цільові unit перевірки PASS, picker/draft browser PASS; controller + isolated-runner contract — 66 PASS.
- [Перший CI HR-PAY-08](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/37114306561): Fast baseline та PostgreSQL payment cases пройшли; actual-app зупинився на відсутньому поверненні з HR 403. Це виправлено. Окремий збій Task Center responsive test не стосувався HR-PAY і не виправлявся зміною чужого коду.
- [Повторний CI](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/37114799604): actual-app підтвердив HR error-return, вибір профілю, запис його джерела й кастомну ставку. Далі виявлено неоднозначний CSS selector самого тесту; selector уточнено без послаблення перевірки.
- Остаточний exact-SHA CI, фактичні результати actual-app та перелік evidence зберігаються в [локальному санітизованому доказі](../output/hr-pay/hr-pay-08-ci-proof-2026-10-03.json). Screenshot artifacts містять лише синтетичні записи ізольованої БД. Наявність тестового файлу сама по собі не є PASS.

## Межі готовності

**Залишається реальний Park access blocker:** `/api/hr/staff/:id` у фактичному HR browser повертає `403 staff_not_migrated`; раніше read-only підтверджено також `payroll_not_migrated`. Новий actual-app тест явно фіксує цей стан і перевіряє безпечне повернення до чернетки. Він не видає його за успішне редагування постійних HR-умов.

Потрібний окремий обсяг перевірки власності даних і дозволеного доступу Park; TASK HR-PAY-08 прямо виключає розширення прав. Не прибирати business gate і не обходити його загальним дозволом namespace.
HR-PAY-09 має завершити аудит готовності та позитивний шлях HR → графік → attendance → payroll у дозволеному business context. HR-PAY-10 — свіжа production-база, release/cache/changelog commit, exact-SHA CI, hash-bound manifest і його фінальне підтвердження.

Версію не підвищено; production migrations/deploy, реальні кадрові дані, зарплати й виплати не змінювалися. Спроб production-випуску: 0.

Нижче збережено попередній звіт як історію; його пункт про відсутність picker не описує поточний код.

---

# HR-PAY-07/10 — фактичний стан після серверної реалізації

Production impact: yes. **Рішення: HOLD. Production не змінено.**

Релізний Red-path blocker для routes/payroll.js усунено вузьким workflow `hr-payroll`.
Це не підтверджує готовність продукту: інтерактивний UI та Park payroll access залишаються блокерами.
Фінальний manifest, release/version commit і запит його підтвердження не створювалися.
Спроб production-випуску: 0. Версія не підвищувалася.

## Збережений кандидат і перевірки

- Робоча копія: C:/Users/Plotva/.codex/worktrees/hr-pay-release-review/EventGenix.
- Feature-гілка: `codex/hr-pay-release-review-20261003`; сторонні зміни OneDrive не включені.
- Останній SHA зміни runtime-логіки: `3741273a9911cc6ff0fdbfc96b4e3c3736412b21`.
- [CI цього SHA](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/37112615521): Fast baseline PASS; PostgreSQL 6/7 нових регресій PASS. Одна нова fixture не містила часу блоку; виправлена в наступному commit без послаблення очікування. Остаточний результат повторного CI зберігається в output/hr-pay/candidate-ci-proof-2026-10-03.json і фінальному звіті чату.
- Попередній SHA `4d6ae4f2c46f8ccdf82cde347215eae2f70e2b88`: [усі 8 CI jobs PASS](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/37112343930), включно з Fast baseline, HR/payroll PostgreSQL та наявним HR browser gate.
- Нові PostgreSQL сценарії на попередньому SHA дійсно виконані: append-only/null guard; повторний запит/409/два редактори; temporary поверх explicit; clock-in/clock-out, перерва, денна доплата один раз, незмінність після редагування довідника.
- До останнього SHA додано перевірки читання застосованих умов проти поточного каталогу, void одноденного винятку, місячної бази з денною доплатою та відсутності подвійної місячної складової.
- Локально controller: 54/54 PASS, у тому числі SHA/files/migrations/target drift, строк, ліміт спроб, точне підтвердження та зміна live/remote бази. Реальний diff із 52 файлів проходить точний allowlist.
- check:migrations PASS; check:syntax PASS; git diff --check PASS. Node 22.23.1 / npm 10.9.8. Локальна PostgreSQL недоступна; замість неї використано disposable PostgreSQL CI, без production БД.

## Що реалізовано

1. Збережено виправлення HR-PAY-01…06: пропущені ставки не видаляються, причини допуску відрізняються від відсутньої ставки, HR-картка/чернетка/перехід і preview перерви.
2. `services/hrPayrollConditions.js`: єдиний датований resolver; виняток → temporary → explicit → default → сумісний legacy. Додаткова професія не успадковує місячну базу іншої професії.
3. `374_payroll_day_exceptions.sql`: порожній append-only журнал із датою, одиницею, призначенням, автором/причиною, версією й idempotency key. Backfill відсутній. Збереження серіалізоване з attendance; frozen/closed історію змінювати не можна.
4. `services/hrAttendance.js`: snapshot v2 з умовами базової та додаткової оплати. Зміни довідника після фіксації не підміняють умови. За недостатньої історії — явний блокер.
5. `services/payrollConditionCalculation.js`, `services/payroll.js`, `routes/payroll.js`: годинна оплата за хвилинами; денна один раз за професію/дату; місячна за чинною підтвердженою нормою один раз у місячній складовій. Джерело, одиниця, формула й виняток передаються в розшифрування/експорт. Фізичні години не дублюються.
6. `routes/hr.js`: GET payroll-conditions та PUT payroll-day-exception під чинними salary permissions і business gate. GET повертає frozen applied conditions окремо від актуальних варіантів каталогу. Політика доступу не послаблювалася.
7. Production policy/controller: лише точні 52 файли і міграція 374; єдиний Red path — routes/payroll.js. Сторонні protected paths, інші міграції та workflows відхиляються. Готовий release SHA має бути підписаний до підтвердження; автоматичного bump після підтвердження немає. Перед виконанням повторно перевіряються live і remote.

## Блокери готовності

| Блокер | Доказ / потрібна дія |
| --- | --- |
| Park HR/payroll access | Read-only GET профілів повертає 403 staff_not_migrated, GET payroll preview — 403 payroll_not_migrated. Чинний business gate блокує namespace до визначення власності даних. Це не відсутня ставка й не брак звичайного salary permission. |
| HR-PAY-08 не завершений | Графік ще використовує legacy eligibility/годинний preview; новий dated API, вибір альтернативи/винятку й повідомлення про неперенесення винятку при копіюванні не підключені. Цей UI не видається за готовий. |
| HR-PAY-09 не завершений | Зелені наявні browser jobs не є наскрізним підтвердженням нового picker через Express → PostgreSQL. Потрібен actual-app сценарій після завершення UI і дозволеного Park access. |
| Фінальний випуск | Лише після попередніх пунктів: актуальна production-база, вільний patch, окремий release/cache/changelog commit, точна інвентаризація release-marker файлів, CI та hash-bound manifest. |

## Межа окремого погодження

Поточний TASK HR-PAY-10 прямо забороняє змінювати auth policy. Для Park access потрібен окремо погоджений вузький обсяг: підтвердити власність HR/payroll namespace за Park, дозволити тільки потрібні HR/payroll endpoint-и з чинними permissions та актуальним server-resolved membership; інші бізнеси, відсутній/revoked membership і користувачі без salary access мають залишитися закритими. Не можна просто прибрати requireLegacyBusinessSurface або дозволити весь namespace. Цей обсяг не реалізовувався й до поточного allowlist не доданий.

## Production та rollback

Остання звірка: 2026-10-03T09:20:16Z. Live і remote production узгоджені: **0.82.51**, `98ad5e139e8409407f7f04bc9ba9ade45567921d`, `codex/eventgenix-production`.
[Санітизований read-only доказ](../output/hr-pay/release-access-proof-2026-10-03.json) містить тільки SHA, версію, endpoint, HTTP status і error code — без ПІБ, сум і токенів.
Railway target залишається fortunate-appreciation / production / 8223324090; перед фінальним manifest потрібна свіжа звірка Railway identity.

Rollback для майбутнього погодженого випуску: попередній перевірений live SHA через repository helper. Нові таблиця/версії/snapshots залишаються; destructive SQL, видалення журналу й перерахунок закритих зарплат не допускаються. Реальні ставки, кадрові записи й виплати не змінювалися.

Нижче збережено попередній звіт як історію. Його твердження про відсутність commits/схеми/CI не є поточним статусом.

---
# Готовність HR-PAY до випуску — 3 жовтня 2026

**Рішення: HOLD.** Локальні виправлення та browser-сценарії перевірені, але повний шлях HR → графік → фактичний час → зарплата не підтверджений на PostgreSQL для цього кандидата. Разові ставки й незалежна оплата додаткової професії залишаються незавершеними. Production impact: yes.

## Кандидат і production

Реалізацію перенесено без конфліктів у окрему керовану копію на актуальну базу production. Сторонні зміни початкової локальної копії збережені й не включені.

- Кандидат: гілка `codex/hr-pay-release-review-20261003`; локальні зміни ще не закомічені.
- Базовий і повторно перевірений live SHA: `98ad5e139e8409407f7f04bc9ba9ade45567921d`.
- Production: `codex/eventgenix-production`, версія `0.82.51`; `/api/version` і remote ref узгоджені, metadata complete.
- Railway: `fortunate-appreciation` / `production` / `8223324090`; deployment `69dbe095-dc1c-4ea4-93f1-13f188698db1`, SUCCESS.
- [CI чинного production](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/37107272741): усі 8 checks зелені. Це перевірка базового SHA, а не незакомічених змін кандидата.

Commit, push, CI кандидата й deploy не виконувалися. Версію та lockfile не змінювали; схему БД не змінювали. Реальні нарахування й виплати не створювали та не редагували.

## Стан задач

| Задача | Перевірений результат | Що залишається |
| --- | --- | --- |
| HR-PAY-01 | Пропущені ставки зберігаються, видалення явне; причини блокування розділені у формі й серверній перевірці | Виконати нову PostgreSQL-регресію повторного збереження; історичну втрату реальних ставок не доведено |
| HR-PAY-02 | HR використовує чинні payroll_profiles; типові/персональні умови, три одиниці оплати, дати та джерела показані | Незалежна оплата додаткової професії при місячній базі залежить від HR-PAY-03 |
| HR-PAY-03 | Описані межі мінімального впровадження | Не реалізовані журнал одноденних винятків, їхня конкуренція та фіксація базових умов у attendance snapshots; потрібен погоджений обсяг зміни схеми |
| HR-PAY-04 | Перехід у HR відкриває працівника/професію/дату; чернетка повертається, ставки оновлюються, застаріла версія зміни блокується | Вибір альтернативного варіанта й створення разової ставки у графіку залежать від HR-PAY-03 |
| HR-PAY-05 | Preview враховує перерви; годинна база, один денний вихід, чинна місячна формула й пояснення перевірені локально; непідтримувані одиниці блокуються явно | Денна/місячна додаткова оплата та заміна частини окладу не готові; базова історична ставка ще не зафіксована HR-PAY-03 |
| HR-PAY-06 | Регресійні й browser-перевірки, частковий read-only аудит, звірка production та ізольований кандидат | PostgreSQL gate, повне читання профілів, CI кандидата і targeted live-site QA після дозволеного випуску |

Місячний оклад використовує наявну пропорцію оплачуваних планових хвилин до підтвердженої місячної норми. Нових правил неповного місяця не вигадували; відсутня норма та неоднозначна зміна умов блокують нарахування. Для переходів літнього/зимового часу потрібен ручний розгляд, якщо фізична й локальна тривалість різняться.

## Перевірки кандидата

- Цільові тести HR/ставок/attendance/payroll/audit: 110 пройшли. Після останнього виправлення preview додатково пройшли 32 перевірки чернетки, контексту та аудиту.
- Повний `node tests/browser/hr-team-browser-smoke.js`: PASS. Перевірені HR loading/error, налаштування оплати, безпечне редагування ставок, дерево професій.
- Повний `node tests/browser/staff-schedule-custom-range-browser-smoke.js`: PASS після виправлення знайденої регресії. За незавершеного часу чернетка тепер показує оновлену ставку, але не вигадує суму. Перевірені збереження/повторне відкриття, перерви, додаткові ролі, відновлення після HR, обмежений доступ, desktop/mobile.
- `npm test`: PASS, exit 0 на Node 22.23.1 / npm 10.9.8. Включає повний verify та sys-mb; основний unit-набір — 3292 PASS.
- Browser-тести використовують синтетичні відповіді API; вони не замінюють Express → PostgreSQL integration. Переглянуті мобільні screenshots HR і графіка знаходяться в `output/playwright/`.
- PostgreSQL-регресія додана в `tests/integration/payroll-profiles.integration.test.js`: повторні збереження, пропущені/незмінені ставки, редагування однієї ставки, явне видалення; fixture працює в транзакції з rollback. **Не виконана**: Docker contexts не відповіли в контрольованих пробах, тестового підключення немає. Канонічний runner завершився: `TEST_DATABASE_URL is required; DATABASE_URL is never used as a fallback`.

Копіювання тижня повторно перевіряє допустимість працівника на цільову дату та зберігає план через чинний серверний sync. Доля одноденного винятку при копіюванні **не перевірена і не реалізована**, оскільки самих винятків ще немає. Після HR-PAY-03 копіювання має прямо пояснювати, що виняток не переноситься автоматично.

## Read-only готовність даних Park

[JSON-звіт](../output/hr-pay/readiness-2026-10-03.json), дата роботи `2026-10-03`, перевірка `2026-10-03T08:12:43.422Z`, статус **PARTIAL**.

Покрито 46 активних працівників і 59 зв’язків працівник–професія. Знайдено 6 непогоджених допусків, 2 конфлікти одиниць оплати та 11 потенційних додаткових ролей без явної погодинної ставки за чинним legacy контрактом. Це кількість зв’язків, не унікальних працівників; одна роль може мати кілька причин. Це також не твердження, що кожному потрібна оплачувана додаткова професія.

Довідник повертає часткову проєкцію. Payroll profiles повернули 403; призначення профілів тому не зчитувалися. Нечинні профілі та успадковані ставки **залишаються неперевіреними**, а не позначаються відсутніми. Відсутність права читання й непогоджений допуск не трактуються як доказ втрати ставки.

Новий `npm run audit:hr-pay-readiness -- --date YYYY-MM-DD --output output/hr-pay/<report>.json` читає лише дозволені endpoint-и фіксованого production в контексті Park, звіряє live SHA до/після й зберігає лише ID, професії та причини. У звіті немає ПІБ, контактів, сум оплати, паролів або токенів. Масове заповнення/відновлення ставок не виконувалося й потребує перевіреного джерела та окремого дозволу.

## Умови зняття HOLD

1. Погодити та завершити HR-PAY-03 і залежні сценарії HR-PAY-02/04/05: незалежна додаткова оплата, одноденний виняток, дата, автор/причина, конкуренція, незмінність зафіксованої бази та явна поведінка копіювання.
2. Надати дозволений тестовий доступ до payroll profiles для read-only аудиту та окрему ізольовану PostgreSQL БД; виконати integration-контур кандидата. Не використовувати production як тестову БД.
3. У межах дозволеного релізу повторно звірити актуальний production SHA, підготувати commit/version hygiene, push і зелені CI checks точного кандидата; лише потім manual deploy та targeted live-site QA на безпечних тестових записах без реальних виплат.
