# TASK 2 — сертифікати: реалізація та релізні докази

Дата реалізації: 2026-09-24. Базовий SHA ізольованої копії: ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79.

Актуальний статус на 2026-09-26: CERT-CLOSE-03 v0.82.18 і вузький follow-up v0.82.19 доставлено у production. Одноразове погашення одного серверно ізольованого QA-сертифіката та UI precheck у формі бронювання підтверджено live.

## CERT-CLOSE-03 — фактичний результат

- Release SHA a059e7ac29e585d75da1d36cbbf5ef6aa616be3b, source branch codex/eventgenix-production. [CI точного SHA](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36238494774): 8/8 jobs успішні, включно з обов'язковим Certificate redemption regression.
- Штатний manual Railway deploy: project fortunate-appreciation, environment production, service 8223324090, deployment acbeec32-5468-4fb9-b5a4-573857f3a58e — SUCCESS. Live /api/version підтвердив v0.82.18, точний SHA і source branch. Міграція 371 та її індекс присутні.
- Перед записом read-only preflight підтвердив ізольований тестовий акаунт ID 48, один run, один сертифікат, Park і TTL 30 хв. Через штатний API створено один QA-сертифікат, внутрішній ID 921. Код, recipient marker і токен до звіту не додано.
- Браузер: QR → окремий анонімний контекст → вхід тестового акаунта → збереження коду → доступне одноразове погашення → скасування без зміни стану → підтвердження через клавіатуру → used → повторне відкриття. Повторний POST відхилено з HTTP 409 certificate_used. Історія має рівно один certificate_used.
- На 390×844 немає горизонтального переповнення; кнопка доступна у viewport, Tab та Enter працюють. QA-код виключено з реєстру, а booking validate API повертає valid=true, canRedeem=false, qa_booking_unavailable. Звичайне бронювання не створювали.
- QA-run завершено штатно зі станом cleaned та entityCount=1. Операторський side-effect inventory не знайшов стійких платежів, фінансових зв'язків, клієнтських повідомлень чи зовнішніх подій. Використаний код залишився used, manifest збережено, історія містить один запис. Приватні тимчасові файли й браузерні сесії прибрано.
- Read-only aggregate audit після QA: 929 фізичних сертифікатів, із них один QA; бізнес-видимих 928. Категорії: 495 доведено одноразових, 3 точні абонементи, 431 невизначений. unsafeGrants=0, safeDenials=0. Інші зміни кількості від базового аудиту не приписуємо цьому QA-run.
- Локальний npm test на Node 22/npm 10 пройшов. CI кандидатного SHA 9492a8f90 мав один timeout браузерного smoke на закритті confirmation dialog; CI точного release SHA зелений. Цю нестабільність треба дослідити.
- На момент v0.82.18 в index.html не було certCodeInput, certValidationResult і кнопки Validate; тодішній release note завищував стан форми. Цей пункт закрито у v0.82.19, докази наведено нижче.

Повний release/QA proof і план відкату — docs/CERTIFICATE_CLOSE_03_RELEASE_PLAN.md.

## Booking precheck follow-up v0.82.19

- Дозволений блок `EG-20260926T115455Z-f4272c77`; точний release SHA `b0b466743e929d48681f741e8df571ee23d21b28`, production-гілка `codex/eventgenix-production`. [CI точного SHA](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36241568971): 8/8 jobs успішні, включно із certificate gate.
- Штатний manual Railway deployment `b9e00eee-9f54-4f0e-930f-fa6dc1b3c42b` — `SUCCESS`. Live version smoke: v0.82.19, точний SHA, branch і manifest metadata; timeline proof пройшов. У цьому follow-up немає міграції.
- В окремому браузері під тестовим акаунтом відкрита форма Park без збереження. Поле, кнопка й результат перевірки видимі. Для раніше використаного ізольованого QA-сертифіката ID 921 форма показала «Сертифікат уже використаний», без зеленого дозволу. На 390×844 ширина документа 390 px; Tab переходить із поля на кнопку. Нових QA-сертифікатів і бронювань не створено, тимчасовий код прибрано.
- Стабілізовано browser smoke очікуванням фокусу confirmation dialog; candidate CI і exact-SHA release CI зелені. Інші ролі та стани сертифікатів перевіряє ізольований gate.

## Реліз CERT-FINISH-01–04

- Release SHA: `ab9b3f46d1ff4bd5fa47aec2b7c3c56d7757d641`, source branch: `codex/eventgenix-production`.
- CI точного SHA: [робоча гілка](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36230299793) і [production-гілка](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36230582928), обидва runs — 8/8 jobs успішні. Обов'язковий `Certificate redemption regression` успішний в обох.
- Manual deploy через `npm run release:railway-up`; Railway project `fortunate-appreciation`, environment `production`, service `8223324090`, deployment `4096dde8-28a2-4bc4-a066-306e3a4f6750` — `SUCCESS`.
- Live `/api/version`: `0.82.16`, точний SHA вище, source branch `codex/eventgenix-production`, повний deployment manifest без конфліктів.
- До міграції read-only аудит: 918 сертифікатів; 484 точно одноразових, 3 точних абонементи, 431 невизначений тип. Після deploy ті самі агрегати, `priorVersionRollback.unsafeGrants=0`, `safeDenials=0`. Сирі коди, назви невідомих типів і дані отримувачів не виводилися. Деталі — `docs/CERTIFICATE_TYPE_MAPPING_REPORT.md`.
- CI перевірив PostgreSQL-погашення, конкурентність, rollback, права, booking→Express→PostgreSQL, браузерний smoke, мобільний стан і старі Telegram-посилання. Пропуск обов'язкового PostgreSQL-тесту робить gate червоним.
- Окремий браузерний контекст із локальним тестовим акаунтом: синтетичне QR-посилання → вхід → збереження коду → зрозумілий стан «не знайдено», без кнопки погашення. На 390×844 горизонтального переповнення немає; мобільний знімок перевірено. Production-записів QA створено **0**, платежів і зовнішніх повідомлень не було.

## Післярелізний пункт, закритий у v0.82.19

Повний live-сценарій одного ізольованого QA-сертифіката тепер перевірено у CERT-CLOSE-03: видача, QR → вхід, скасування, одне погашення, HTTP 409 на повторну спробу, рівно один запис історії та штатне закриття QA-run. Деталі й докази — у docs/CERTIFICATE_CLOSE_03_RELEASE_PLAN.md.

Історично форма v0.82.18 не містила поля й кнопки перевірки сертифіката, а кандидатний browser smoke один раз завершився timeout. У v0.82.19 форму підключено і перевірено live; browser smoke стабілізовано, exact-SHA CI зелений. Звичайне production-бронювання для цієї перевірки не створювали.

## Історична локальна реалізація TASK 2

## Реалізація

- `services/certificateRedemption.js`: чинний активний користувач і членство Парку перевіряються повторно в транзакції. Рядки користувача, членства та реєстру блокуються до завершення запису; сертифікат читається через `FOR UPDATE`.
- Дозволені основні ролі в активному членстві: reception, admin, manager, senior_manager, vice_director, director, creator. Security та animator можуть перевіряти код. Page deny та неактивне членство блокують погашення.
- Лише одиночний контекст `event_genix`, активний сертифікат типу `на одноразовий вхід` і чинна дата. Абонементи та довільні інші типи доступні лише для перевірки.
- SQL перевіряє дату на момент запису через `clock_timestamp()` у `Europe/Kyiv`, включно з останнім календарним днем.
- `POST /api/certificates/:id/redeem` змінює статус і додає історію з актором, кодом, старим/новим статусом, часом та business/organization ID в одній транзакції. Повторна спроба повертає 409.
- Звичайний `POST /api/bookings` викликає той самий сервіс у транзакції бронювання. `/full` явно відхиляє код сертифіката: цей маршрут не підтримував його атомарне використання.
- `PATCH /:id/status` більше не має гонки між читанням і записом: рядок блокується до перевірки terminal used. Пряме встановлення used залишається забороненим. Раніше прибране відновлення при скасуванні бронювання збережене.
- Інтерфейс показує кнопку лише за дозволом сервера, вимагає підтвердження, блокує повторне натискання та ігнорує застарілі відповіді після зміни кабінету. Деталі сертифіката ведуть на канонічну сторінку перевірки.
- Нових залежностей і міграцій немає. Захищений manifest бронювання не змінено.

## Виконана перевірка

- Node 22.23.1 / npm 10.9.8: runtime check пройдено.
- PostgreSQL 16 у локальній WSL, Node 22.22.2: реальні JWT, Express-маршрути сертифікатів і PostgreSQL, 7 сценаріїв / 8 TAP tests — pass. Кожен запуск створює власну БД і видаляє її у finally. DATABASE_URL не використовується.
- Два одночасні HTTP-запити: один 200, один 409, один аудит.
- Ролі, відкликане членство, оновлена роль при застарілому request actor, інший/агрегований бізнес, строк, terminal статуси та абонемент — перевірено.
- Помилка аудиту відкочує використання; помилка синтетичного запису бронювання у спільній транзакції відкочує сертифікат та аудит. Це перевірка сервісу з PostgreSQL, а не повного маршруту бронювання з усіма його таблицями.
- Реальний lock wait для паралельного PATCH: після погашення відновлення повертає 409.
- Маршрут бронювання: локальна suite `tests/booking-create-durability.test.js` — pass; використовує тестові залежності для інших бізнес-модулів.
- Chromium, 390×844, реальні HTML/CSS/page JS і shared confirm UI, синтетичний транспорт: scan/cancel без мутації, підтвердження, pending guard, verify-only, зміна кабінету та застарілий lookup — pass. Скриншоти `output/playwright/certificate-check/mobile-active.png` і `mobile-used.png` переглянуто, горизонтального переповнення немає.
- Static UI: 1325 checks + 4 frontend loading tests — pass.
- Access matrix, auth boundary, API surface, static surface, timeline protected surface — pass.

## Повторний запуск

Потрібні залежності репозиторію і Node 22. Для браузерного smoke потрібен уже встановлений Playwright, доступний через NODE_PATH; встановлення залежностей не є частиною цієї зміни.

```sh
node --test tests/certificates-contract.test.js tests/park-workspaces-routes.test.js tests/park-legacy-module-access.test.js
node --test tests/booking-create-durability.test.js
node tests/browser/certificates-check-browser-smoke.js
```

Для PostgreSQL використайте окремий loopback test URL у процесній `CERTIFICATE_TEST_DATABASE_URL`, або Linux peer authentication від користувача postgres:

```sh
CERTIFICATE_LOCAL_POSTGRES_TEST=1 node --test tests/integration/certificate-redemption-postgres.test.js
```

Без жодної з цих змінних PostgreSQL-suite позначається skipped — це не доказ проходження.

Повний application→PostgreSQL сценарій створення та скасування бронювання додано до CI у CERT-FINISH-01. Попередні локальні результати в цьому розділі залишені як історичний доказ TASK 2; актуальні релізні результати наведено вище.
