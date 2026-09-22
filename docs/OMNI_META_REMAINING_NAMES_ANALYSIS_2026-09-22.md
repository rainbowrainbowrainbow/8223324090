# Facebook / Instagram: залишкові імена й теги

## Стан і відтворення

Read-only перевірка production підтвердила v0.82.4, SHA
`7095178709951a63e73decb340ddbe7b5076b185`, branch
`codex/eventgenix-production`. Upstream відповідає live.

У базі два Facebook-чати й два Instagram-чати; по одному Unknown у кожному
каналі. У шести Telegram і одному WhatsApp чаті імена непорожні.
Обидва Unknown належать event_genix. Дані інших бізнесів не змінювалися.

Очікування: ім'я співрозмовника, або отриманий від Meta username, або чесне
позначення каналу/ID, коли профіль ще не отримано. Технічний ID не є тегом.
Репродукція: відкрити існуючий Unknown-чат без нових inbound після релізу;
список та заголовок показують буквальне Unknown. Відкриття чернетки ліда для
Instagram додатково підставляє scoped ID у поле Instagram.

## Доведені причини

1. Новий Instagram-чат з'явився до v0.82.4 і був поза погодженим відновленням
   попередніх трьох записів. Останнє inbound передує upload релізу; після нього
   нового inbound немає. Enrichment запускається після нового повідомлення,
   а не після читання/відкриття чату. Автоматичного backfill навмисно немає.
2. Facebook — попередній профіль із Meta 100/33 (PROFILE_OBJECT_UNAVAILABLE).
   Збережений sender, recipient/Page і message ID були узгоджені. Причину
   недоступності саме цього scoped об'єкта не встановлено; це не доказ
   несправного токена, неправильного ID або конкретного відсутнього permission.
3. UI використовував customerName || externalId. Рядок Unknown truthy, тому
   запасне відображення не працювало. Це не кеш: Unknown збережено в БД.
4. Канонічний Instagram lookup уже використовував username за відсутності name,
   але без @. Новий тег виглядав як звичайне ім'я. UI чернетки ліда незалежно
   використовував externalId як Instagram-тег та приймав Unknown як ім'я.

У перевірених inbound metadata немає запасного name/username. Непорожні
sender_name у вихідних повідомленнях — імена операторів, вони непридатні для
відновлення співрозмовника. Історія та links не змінювалися.

## Локальне виправлення

- Канонічний lookup повертає @username, якщо Instagram name непридатне;
  порожній тег, Unknown, окремий @ і синтаксично непридатний username не
  приймаються; кілька початкових @ нормалізуються до одного.
- Спільний UI formatter обробляє blank/Unknown незалежно від регістру/пробілів;
  список, header, avatar та підписи assistant узгоджені без дублювання каналу.
- Технічний Meta ID відображається разом із каналом, без вигаданого @тегу.
- Чернетка ліда не переносить Unknown у clientName або scoped ID у instagram;
  наявний Instagram @handle використовується лише як тег у цій чернетці.
  Ручні поля відкритої чернетки зберігаються перед фоновим refresh списку.
- Умовний UPDATE, business isolation, exact profile-ID matching, cooldown,
  concurrency, дедуплікація та ліміти HTTP залишаються чинними. Повідомлення
  зберігаються до lookup. Немає нових API, scheduler, dependency або схеми БД.

Це підготовлені локальні зміни, а не підтверджений production-реліз.

## Перевірка

- Node 22.23.1 / npm 10.9.8: runtime check пройдено.
- До виправлення вибрані regression cases: 14 падінь із 16 тестів.
- Після виправлення чотири focused suites: 157/157 pass.
- Суміжні Omni/lead/history suites: 91/91 pass.
- Version consistency: pass; продуктову версію ще не підвищували.
- Static UI smoke та frontend regression: pass.

Команди:

```powershell
npm run check:runtime
node --test tests/omni-facebook-profile.test.js tests/omni-meta-profile-adapters.test.js tests/omni-meta-name-repair.test.js tests/omni-workspace-behavior.test.js
node --test tests/omni-lead-assistant.test.js tests/omni-hardening.test.js tests/omni-inbox.test.js tests/omni-completion.test.js tests/omni-history-pagination.test.js
npm run check:version
npm run test:ui
```

## Завершена read-only діагностика

22 вересня виконано точний inspect-only для двох записів із задачі. Обидва
timestamp дали рівно по одному збігу в event_genix; вибір не використовував
довільний Unknown або `LIMIT 1`. Чинні connection bindings присутні.

- Facebook: два inbound records; sender збігається з conversation external ID,
  recipient збігається з Page ID, external/webhook message IDs узгоджені, echo
  немає. Нових profile GET не виконано. Чинний доказ лишається
  `PROFILE_OBJECT_UNAVAILABLE` (Graph 100/33).
- Instagram: два inbound records; sender/external ID та message IDs узгоджені,
  recipient присутній, echo немає. Recipient не тотожний Facebook Page ID;
  це різні типи ID, замінювати їх не можна.

Combined diagnostic scope digest:
`d91fc01bc75376b253d5d6278214860c63226084f0e244269d97939b9d475e76`.

Точний Instagram recovery scope digest:
`839180666f8eb8f6fc78554fa78bd4aeb927019194d20c13df87d8103766adcb`.

Перед мережевим викликом перевірено абсолютний output path, створення каталогу,
запис/читання санітизованого preflight та `STARTED` marker із `wx`, який блокує
повторний запуск. Після цього виконано рівно один дозволений канонічний profile
GET (`name,username`) нового Instagram-чату. Результат: `READY`, success=true,
returned profile ID точно збігається з requested ID, доступні і name, і username.
Значення імені/username не виводилися та не записувалися. Бюджет цієї задачі:
1/1 GET використано; production UPDATE: 0. Попередній невдалий запуск окремо
залишається врахованим як використаний запит із невідомим результатом.

Для Facebook відкрито Meta for Developers, але браузер показав сторінку входу:
доступного авторизованого сеансу немає. Тому правильну Page у Dashboard,
видимість конкретного діалогу, App Mode, App Review/Advanced Access і Business
Asset User Profile Access у цій задачі не підтверджено. Це blocker перевірки,
а не доказ відсутнього permission. Налаштування й доступи не змінювалися.

Production UPDATE, commit, push і deploy у цій задачі не виконані. Новий
Instagram технічно готовий до bounded apply після окремого дозволу задачі 3:
повторно перевірити поточне blank/Unknown ім'я, business/channel/identity,
connection binding та exact profile ID, а потім змінити лише `customer_name`
і стандартний `updated_at`. Apply зробить новий profile GET; поточний dry-run
не передає значення імені як вхід для запису.
