# Omni: статуси Facebook та Instagram

База локального виправлення: production `0.81.209`, SHA
`b134a6b82f5f61c8b645642f6083667f783ef944`, гілка `codex/eventgenix-production`.
Production impact: yes — після деплою. Включено до кандидата релізу
`0.82.0 — Комунікація: на одній хвилі`; підтвердження деплою та live QA
фіксується окремо після проходження CI.

## Причина та зміна

`services/omni-hub.js` формував довгий технічний текст для успішного прийняття
запиту. `omni.html` віддавав перевагу збереженому `sendTruth.message`, тому
заміна лише нового тексту не виправляла історію після перезавантаження.

Для Facebook/Instagram UI тепер показує статус біля часу:

| Дані CRM | Статус |
| --- | --- |
| `saved` | Надсилається |
| `accepted` | Надіслано; підказка пояснює, що Meta прийняла повідомлення |
| `delivered` | Доставлено |
| `read` | Прочитано |
| `failed` | Не надіслано, причина залишається видимою |
| `later_failed` | Не доставлено, причина залишається видимою |
| `attempted`, `unknown`, немає доказів | Статус невідомий |

Збережений статус має пріоритет над старою успішною відповіддю у metadata.
Попередження про незбережений результат провайдера зберігається окремо.
Міграції історії, автоматичного повторного надсилання та підвищення статусів
за таймером або відповіддю співрозмовника немає.

## Шлях підтвердження

1. `routes/omnichannel.js`: `/webhook/meta` перевіряє підпис, бізнес,
   канал і `entry.id` підключеної сторінки/Instagram.
2. `services/omni-inbox.js`: `applyMetaReceipt()` обробляє `delivery` / `read`.
   SQL обмежений бізнесом, каналом, `sender.id`, вихідними повідомленнями
   та `provider_message_id`; для watermark також застосовується межа часу.
3. `read` не може бути знижений запізнілим delivery. Повідомлення не створюються повторно.
4. `notifyCRM()` надсилає подію для відповідного бізнесу без текстів повідомлень.
5. `ws:omni` оновлює відкритий чат через HTTP із перевіркою поточного бізнесу.

Цей шлях уже існував; production SQL та webhook handler не змінювалися.

## Перевірка підписок у Meta

Актуальні підписки у кабінеті цим локальним блоком не перевірені й не змінені.
На попередніх скриншотах було лише `messages`; це не доказ поточного стану.

У вашому застосунку відкрийте **Use cases → Messenger from Meta → Customize**:

- **Messenger API Settings → Webhooks**: для Facebook перевірити
  `messages`, `message_deliveries`, `message_reads` у підписках застосунку
  та потрібної сторінки. У вашому інтерфейсі керування доступне через
  **Edit Subscriptions** / керування підпискою в рядку сторінки.
- **Instagram settings → Webhooks → Edit Subscriptions**: перевірити
  `messages` і `messaging_seen`. Це назва події прочитання Instagram;
  її payload обробляється через `read`, зокрема `read.mid`.
- Працювати зі сторінкою Парку `113715163353818`, пов'язаною з Instagram
  `17841420736255093`. Зберігати інші чинні підписки.
- Без receipt UI залишає «Надіслано». Instagram може перейти відразу
  до «Прочитано» без окремого підтвердження доставки.

Поля звірено з офіційними SDK Meta:
[Facebook Page subscriptions](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/page.js),
[Instagram subscriptions](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/iguserforigonlyapi.py).
Доступні поля саме вашого Facebook Login setup потрібно звірити в кабінеті;
пряме читання документації Meta під час роботи повертало HTTP 429.

## Відтворювані перевірки

Node 22 / npm 10:

Виконано: 137 цільових тестів, parser check (1278 файлів), 4 UI smoke тести,
6 браузерних сценаріїв (два канали × три розміри); всі пройшли.
Скріншоти перевірено візуально. Результат CI фіксується для точного SHA релізу.

```powershell
node --test tests/omni-workspace-behavior.test.js tests/omni-send-truth.test.js tests/omni-inbox.test.js tests/omni-hardening.test.js
npm run check:syntax
npm run test:ui
$env:OMNI_META_STATUS_ONLY = '1'
npm run test:browser:omni
```

Browser smoke використовує локальні файли й штучні відповіді API, без Meta
або production-записів. Перевіряє обидва канали, 1366×768, 390×844, 320×640,
підказку через натискання/Enter, видимість помилок та відсутність overflow.

Для реальної перевірки SQL ізоляції та повторних/запізнілих receipts розширено
`tests/integration/omni-inbox-postgres.test.js`. Потрібен окремий локальний
PostgreSQL і `OMNI_TEST_DATABASE_URL` на `omni_fixture_test`; production
`DATABASE_URL` використовувати не можна. Запуск: `npm run test:integration:omni`.
Ця перевірка поки не виконана: локальний PostgreSQL не знайдено, Docker daemon недоступний.

## Live QA після дозволеного релізу

На власних тестових Facebook та Instagram акаунтах: вхідне повідомлення,
ручна відповідь у CRM, отримання/прочитання на акаунті співрозмовника,
перевірка статусу одразу й після reload. Перевірити старе успішне повідомлення.
Не надсилати повідомлень реальним клієнтам. Без Meta receipts залишати «Надіслано».
Цей сценарій потребує окремої перевірки після деплою; локальні тести
не підтверджують доставку через реальний Meta API.
