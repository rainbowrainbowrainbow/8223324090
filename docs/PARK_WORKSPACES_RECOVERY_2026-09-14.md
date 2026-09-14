# Сертифікати й Art Director: відновлення для Парку

Production impact: yes.

## Погоджений обсяг

Блок `PARK-WORKSPACES-01`. Поточний запит власника «рнемонтуй швидко і на прод вистаувляй!!» прямо дозволяє виправити описане блокування сертифікатів/абонементів і Art Director для Парку та доставити виправлення. Початок блоку 2026-09-14 15:30 UTC; строк до 21:30 UTC, максимум три спроби релізу.

Ціль: production-гілка `codex/eventgenix-production`, Railway project `fortunate-appreciation` (`bc28b46c-d4bc-491c-893a-d8401c633668`), environment `production`, service `8223324090` (`3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`). Початковий live SHA `a50cafbb6d3ea52694cee6da4f71f057aa501e6a`, v0.81.173.

Дозволені зміни: адресні межі доступу цих двох наявних модулів для Парку, обробка помилок і доступності форм, регресійні тести, версія, commit/push, CI, ручний deploy через release helper, read-only live QA. Видачу й побічні події перевіряємо локальними синтетичними сценаріями. Реальна видача, відправлення повідомлень або зміна бізнес-даних під час QA не входять до виконання.

Не змінюються схема БД, історичні записи, облікові записи, налаштування/секрети Railway, реєстр налаштувань бізнесів, інтеграції або інші legacy-модулі. Початкова робоча копія зі сторонніми змінами збережена; робота ізольована у `.worktrees/park-certificates-art-recovery-20260914`.

## Причина та рішення

Park переведено в membership-модель, але `requireLegacyBusinessSurface` залишив сертифікати й Art недоступними для цієї моделі. Сторінки дозволяли вхід і натискання видачі, а список сертифікатів маскував HTTP-помилку порожнім реєстром.

`parkLegacyModuleAccess` відновлює поточні операції цих двох просторів лише для чинного single Park membership. Він перевіряє активний registry, відповідність business/org ID між трьома серверними представленнями членства, canonical page permissions і заборону записів у read-only scope. Стара compatibility-поведінка збережена. Інші бізнеси та aggregate не отримують цього доступу.

Чинні route roles залишаються обов'язковими. Одиночна видача й пакет окремо перевіряють `/certificates/new` та `/certificates/batch`; Art використовує canonical `/art`, включно з aliases. Серверний business profile надає `legacySurfaces` для узгодження інтерфейсу з адресним відновленням, не вмикаючи весь module registry.

Ризик: історичні таблиці залишаються спільними без business-колонок; їхній доступ обмежено Park namespace. Новий бізнес не можна підключати до цих таблиць без окремого розмежування. Чинні side effects звичайних операцій збережено, тому live QA не створює сертифікатів.

## Перевірка й доставка

Перевірки: позитивний Park сценарій для senior_manager/art_director; негативні чужий бізнес, aggregate, inactive/revoked/duplicate/mismatched membership, canonical/alias deny; actual Express видача на синтетичному DB; UI error/empty/single-submit; runtime/access/syntax/version та CI точного SHA. Після deploy — точна `/api/version`, реєстр і форма сертифікатів, Art overview/templates тестовим акаунтом без записів бізнес-даних.

Відкат: forward revert функціонального виправлення в новому patch-релізі з CI та release helper. Не переписувати git-історію, не запускати SQL rollback або downgrade в обхід version guard. Остаточні результати перевірок і release proof зберігаються в `output/park-workspaces-release/`.
