# Продуктовий hotfix після live QA — 11.09.2026

Production impact: yes. Блок `PRODUCTS-LIVE-QA-FIX` підтверджено власником у поточному чаті о 10:26 UTC: до 12:26 UTC, одна релізна спроба. Дозволено точковий bootstrap `/graduation`, продуктовий hotfix, commit/push, зелений CI, штатний Railway deploy і read-only live QA.

База: `65195dd8ee9bf5dfee57e4ce5784524dc2c9a10c`, production `0.81.103`, гілка `codex/eventgenix-production`. Поточні production SHA і remote ref повторно звірені. Railway: `fortunate-appreciation / production / 8223324090`, домен `https://8223324090-production.up.railway.app`. Попередній deployment: `93cb45d3-4498-4d1e-92e0-92f53e2c504c`.

## Причини й мінімальні зміни

- `js/graduation.js`: PostgreSQL decimal-поля надходять рядками. Додавання склеювало ціни й собівартість; значення приводяться до числа перед додаванням. Ціни, коефіцієнти, формули, API і правило нульового override не змінені.
- `graduation.html`: standalone сторінка пропускала штатну перевірку сесії й hydration дозволів, через що sidebar був порожнім. Послідовність: verify → business profile → permissions → existing page access → ready shell → Sidebar → GradPage. Тимчасова помилка використовує shared retry helper; відсутні дозволи не активують конструктор. Embedded-гілка збережена.
- `js/programs-page.js`: кількість пакетів випускного читається з наявного `/graduation/packages`, як у viewer. Невдалий response дає явний unavailable стан.
- `js/graduation.js`: ручне число дітей у пакетах обмежене 1–99; Enter/Space відкривають картку без перехоплення вкладених controls; Escape закриває info modal; default зображення використовують наявні `*-banner.png`.
- `css/graduation.css`: темніший золотий текст лише всередині конструктора у світлій темі.

HR, shared auth/navigation/theme, DB, міграції, backend, залежності, secrets і hosting settings не редаговані. Shared release-маркери оновлює штатний version helper окремим комітом.

## Перевірки перед релізом

- 61 цільовий тест продуктового потоку та permission lifecycle — PASS.
- 75 тестів bootstrap/auth session після підключення канонічного transient helper — PASS.
- Перший повний baseline виявив вимогу shared transient helper; дефект усунуто без зміни shared коду або ослаблення тесту.
- Повний `npm test`, exact-SHA CI, deploy proof і live QA мають бути підтверджені release evidence. Цей документ не заявляє їх пройденими заздалегідь.

## Обов’язковий повтор на сайті

1. Перевірити точні SHA, branch, version, label через `/api/version`.
2. Свіжий `/graduation`: sidebar заповнений, info modal закривається мишею/Escape, навігація працює.
3. Анімація + Welcome, 15 дітей, 0%: 6770 ₴; 10%: 6093 ₴ за зафіксованими live цінами. Якщо response змінився, спочатку перерахувати очікуване з фактичних даних.
4. Усі сім пакетів: числові суми відповідають response, фото завантажуються; число 100 нормалізується до 99. Перевірити клавіатуру.
5. Products → Catalogs: фактичний count; каталог, refresh/back/forward, чужий каталог, правильний constructor link.
6. Світла/темна теми, 390/768/1440: доступні controls, без обрізання; console/network лише продуктової поверхні.

QA не створює/не змінює бронювання, пакети, клієнтів і фінансові записи. Save/publish/generation/Telegram/export не запускаються. Provider readiness, відсутні live edge cases, Art та backend business-context isolation лишаються NOT_TESTABLE у цьому read-only scope.

## Відкат

Попередній live SHA `65195dd8ee9bf5dfee57e4ce5784524dc2c9a10c` збережений як точна ціль для окремо дозволеного rollback через release helper після перевірки metadata/CI. Міграцій немає; відкат даних не потрібний. Не застосовувати force-push/reset чужих гілок. Ліміт поточного блоку — один deploy, автоматичний повтор не дозволений.
