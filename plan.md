# План реалізації: OmniClaw — Омніканальна комунікація v1.0

## Аналіз поточного стану

- **Версія**: 23.1.0 → бампимо до **23.2.0**
- **Бранч**: `claude/update-snapshot-version-OJyXi` (правильний)
- **Остання міграція**: 051 → нова буде **052_omnichannel.sql** (НЕ 011 як в ТЗ)
- **Скрипт `scripts/crm-version.sh`**: НЕ ІСНУЄ — робимо bump вручну
- **`askKleshnya` в kleshnya.js**: НЕ ІСНУЄ — kleshnya.js це task management
- **AI для чату**: `generateChatResponse()` з `services/kleshnya-chat.js` — використаємо як базу
- **Залежності**: `sendTelegramMessage` ✅, `getWSS` ✅ — існують і експортуються
- **31 тег** `?v=23.1.0` в index.html → замінимо на `?v=23.2.0`
- **npm**: `axios` і `form-data` — ТЗ каже додати, але всі сервіси використовують native `https`. Тому **НЕ ставимо зайві залежності** — все робиться через `https` модуль

## Корекції до ТЗ (критичні)

1. **Міграція 011 → 052** — нумерація має бути послідовною
2. **`askKleshnya`** не існує — в `omni-hub.js` замінимо на `generateChatResponse` з `kleshnya-chat.js`, з адаптацією для омніканальних повідомлень
3. **`npm install axios form-data`** — НЕ ПОТРІБНО, всі канальні сервіси вже написані на native `https`
4. **Змінні .env** — НЕ чіпаємо .env (його може не бути), додамо валідацію в `validateEnv.js`
5. **`sendToChannel` в omni-hub.js** — `channelMeta` для viber використовує `user_id`, але в normalizer зберігається без нього — виправимо
6. **Версія cache-bust в omni.html** — використаємо `23.2.0` замість `X.X`

## Порядок реалізації (16 кроків)

### Крок 1: Version Bump
- `package.json`: `23.1.0` → `23.2.0`
- `index.html`: 31× `?v=23.1.0` → `?v=23.2.0`
- `index.html`: tagline `v23.2.0 — OmniClaw`
- `index.html`: changelog button `Що нового у v23.2.0`

### Крок 2: DB міграція
- Створити `db/migrations/052_omnichannel.sql`
- Таблиці: `conversations`, `conversation_messages`, `quick_replies`
- Індекси, тригери, дефолтні quick replies
- Міграція автоматично підхопиться через `migrate.js` (він читає всі .sql з папки)

### Крок 3: Message Normalizer
- Створити `services/omni-normalizer.js`
- 6 нормалайзерів: Telegram, Viber, SMS, Facebook, Instagram, Binotel
- Єдиний формат повідомлень

### Крок 4: OmniHub — центральний сервіс
- Створити `services/omni-hub.js`
- `findOrCreateConversation()` — пошук/створення розмов
- `saveInboundMessage()` / `saveOutboundMessage()`
- `processInboundMessage()` — головний обробник
- `generateAndSendAIResponse()` — через `generateChatResponse` з kleshnya-chat (НЕ `askKleshnya`)
- `sendToChannel()` — routing відповідей
- `notifyCRM()` — WebSocket broadcast

### Крок 5: Viber сервіс
- Створити `services/omni-viber.js`
- `sendViber()`, `setViberWebhook()`

### Крок 6: SMS сервіс
- Створити `services/omni-sms.js`
- `sendSMS()`, `sendBulkSMS()`

### Крок 7: Facebook сервіс
- Створити `services/omni-facebook.js`
- `sendFacebook()`, `replyToComment()`, `getUserProfile()`

### Крок 8: Instagram сервіс
- Створити `services/omni-instagram.js`
- `sendInstagram()` (DM + reply_comment)

### Крок 9: Routes
- Створити `routes/omnichannel.js`
- Webhooks (публічні): viber, sms, meta (FB+IG), binotel
- CRM API (auth): conversations list, messages, send, patch, stats, quick-replies, setup-viber

### Крок 10: Підключити в server.js
- `app.use('/api/omni', require('./routes/omnichannel'));`

### Крок 11: UI — omni.html
- Створити `omni.html`
- Grid layout: sidebar (conversations list) + chat area
- Фільтри каналів, бульбашки повідомлень, input area
- WebSocket авто-оновлення
- Версія `?v=23.2.0` на всіх CSS/JS тегах

### Крок 12: Навігація в index.html
- Додати посилання на omni.html в sidebar nav (admin-only)

### Крок 13: Changelog в index.html
- Новий запис v23.2.0 — OmniClaw з переліком фіч

### Крок 14: SNAPSHOT.md
- Оновити версію, додати OmniClaw опис

### Крок 15: Коміт + Push
- `feat: [claude-code] OmniClaw — омніканальна комунікація v1.0`
- Push до `claude/update-snapshot-version-OJyXi`

### Крок 16: Валідація
- Перевірити що файли створені правильно
- Перевірити version sync

## Файли які створюються (9 нових)
1. `db/migrations/052_omnichannel.sql`
2. `services/omni-normalizer.js`
3. `services/omni-hub.js`
4. `services/omni-viber.js`
5. `services/omni-sms.js`
6. `services/omni-facebook.js`
7. `services/omni-instagram.js`
8. `routes/omnichannel.js`
9. `omni.html`

## Файли які редагуються (3)
1. `package.json` — version bump
2. `index.html` — version tags, tagline, changelog button, changelog entry, nav link
3. `SNAPSHOT.md` — оновлення стану
4. `server.js` — підключення route

## Що НЕ робимо
- ❌ `npm install axios form-data` — непотрібно, все на native https
- ❌ Редагування `.env` — env змінні додаються адміном при деплої
- ❌ `scripts/crm-version.sh` — не існує, робимо вручну
- ❌ Редагування інших 24 HTML файлів (version sync) — це окрема задача, зараз тільки index.html + omni.html
