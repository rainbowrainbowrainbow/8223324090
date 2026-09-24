# TASK 2 — локальне атомарне погашення

Дата: 2026-09-24. Базовий SHA ізольованої копії: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`.
Стадія: локальна реалізація та перевірка; commit, push, CI, deploy і live-site QA не виконувалися.

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

## Наступна стадія

Окремо перевірити весь накопичений diff TASK 3–5 + TASK 2 перед релізом. Повний application→PostgreSQL сценарій створення/скасування бронювання і live QA ще не виконані. Для live QA використовувати лише дозволені синтетичні записи; реальні сертифікати не погашати.
