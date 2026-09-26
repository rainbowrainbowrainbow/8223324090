# TASK 2 — сертифікати: реалізація та релізні докази

Дата реалізації: 2026-09-24. Базовий SHA ізольованої копії: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`.
Актуальний статус на 2026-09-26: версія `0.82.16` доставлена; live write-QA погашення **не завершена** через відсутність ізоляції QA-сертифікатів.

## Реліз CERT-FINISH-01–04

- Release SHA: `ab9b3f46d1ff4bd5fa47aec2b7c3c56d7757d641`, source branch: `codex/eventgenix-production`.
- CI точного SHA: [робоча гілка](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36230299793) і [production-гілка](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36230582928), обидва runs — 8/8 jobs успішні. Обов'язковий `Certificate redemption regression` успішний в обох.
- Manual deploy через `npm run release:railway-up`; Railway project `fortunate-appreciation`, environment `production`, service `8223324090`, deployment `4096dde8-28a2-4bc4-a066-306e3a4f6750` — `SUCCESS`.
- Live `/api/version`: `0.82.16`, точний SHA вище, source branch `codex/eventgenix-production`, повний deployment manifest без конфліктів.
- До міграції read-only аудит: 918 сертифікатів; 484 точно одноразових, 3 точних абонементи, 431 невизначений тип. Після deploy ті самі агрегати, `priorVersionRollback.unsafeGrants=0`, `safeDenials=0`. Сирі коди, назви невідомих типів і дані отримувачів не виводилися. Деталі — `docs/CERTIFICATE_TYPE_MAPPING_REPORT.md`.
- CI перевірив PostgreSQL-погашення, конкурентність, rollback, права, booking→Express→PostgreSQL, браузерний smoke, мобільний стан і старі Telegram-посилання. Пропуск обов'язкового PostgreSQL-тесту робить gate червоним.
- Окремий браузерний контекст із локальним тестовим акаунтом: синтетичне QR-посилання → вхід → збереження коду → зрозумілий стан «не знайдено», без кнопки погашення. На 390×844 горизонтального переповнення немає; мобільний знімок перевірено. Production-записів QA створено **0**, платежів і зовнішніх повідомлень не було.

## Незакритий live-сценарій

Успішне погашення disposable QA-сертифіката, відмова повторного використання та live-історія **не перевірені**. Сертифікати не підтримують trusted disposable QA marker: звичайне створення публікує `certificate.created`, потрапляє до лічильників реєстру, а trusted QA registry підтримує бронювання, не сертифікати. Звичайний запис із текстовою позначкою не виконує умову ізоляції. За умовою CERT-FINISH-04 production QA-сертифікат не створювався.

Для закриття потрібно окремо додати серверно перевірюваний QA-маркер сертифіката, приглушити зовнішні side effects і виключити його з бізнес-звітів/лічильників, визначити точне прибирання або строк життя, перевірити це на ізольованій БД, а потім виконати один live браузерний сценарій видачі та погашення з перевіркою історії.

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
