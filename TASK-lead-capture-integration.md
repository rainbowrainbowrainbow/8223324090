# TASK: Lead Capture Integration — Автоматичний збір лідів
**Версія:** v17.5.0  
**Гілка:** main → deployed  
**Repo:** `/tmp/crm-repo`

---

## 🎯 Контекст

НВ (стратегічний партнер) попросила: **"Потрібна інтеграція щоб ліди з цих джерел ішли в нашу систему"** — маючи на увазі автоматичний збір лідів з соцмереж/месенджерів замість ручного введення.

**Джерела:** Telegram, Facebook, Instagram, Viber, TikTok, Universal (для будь-якого іншого)

---

## 📊 Поточний стан системи

- Таблиця `leads` існує, є поле `source VARCHAR(50)` — але заповнюється тільки вручну
- Telegram webhook вже є: `POST /api/telegram/webhook` в `routes/telegram.js`
  - Верифікація через `X-Telegram-Bot-Api-Secret-Token` = `WEBHOOK_SECRET`
  - Обробляє команди (`/menu`, `/tasks` тощо) і callback_query
  - **Лід-логіку треба додати сюди** (не окремий ендпоінт)
- `sendTelegramMessage(chatId, text, opts)` є в `services/telegram.js`
- `pool` — з `../db`
- `createLogger('Name')` — з `../utils/logger`
- Нотифікації по бронюванням: `notifyTelegram(type, booking, extra)` — зразок для нашого notification сервісу

---

## 🔢 Версіонування

**Перед початком роботи:**
```bash
bash /root/.openclaw/workspace/scripts/crm-version.sh bump
```

Підняти версію до **v17.5.0** в `index.html`:
- tagline рядок з версією  
- всі `?v=X.X` теги JS/CSS → `?v=17.5`

Додати в `#changelogModal`:
```html
<div class="changelog-section">
  <h4>v17.5.0 — Lead Capture Integration (Клешня, ДД.ММ.РРРР)</h4>
  <ul>
    <li><b>Telegram Lead Capture</b> — нові звернення в бот автоматично стають лідами</li>
    <li><b>Webhook API</b> — ендпоінти для FB, IG, Viber, Universal</li>
    <li><b>Lead Sources UI</b> — фільтр і іконки по джерелах в таблиці лідів</li>
    <li><b>Нотифікації менеджерам</b> — сповіщення в Telegram при новому ліді</li>
    <li><b>DB Migration 045</b> — external_id, raw_payload, source_channel</li>
  </ul>
</div>
```

---

## 1. Міграція БД: `db/migrations/045_lead_capture.sql`

```sql
-- Lead Capture Integration v17.5.0

-- Розширити таблицю leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(200),
  ADD COLUMN IF NOT EXISTS raw_payload JSONB,
  ADD COLUMN IF NOT EXISTS source_channel VARCHAR(50);

-- Захист від дублів: один зовнішній ID = один лід
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_external_id
  ON leads(source_channel, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_source_channel ON leads(source_channel);

-- Оновити source_channel з існуючих source значень
UPDATE leads SET source_channel = source WHERE source IS NOT NULL AND source_channel IS NULL;
```

---

## 2. Сервіс нотифікацій лідів: `services/leadNotifier.js`

Новий файл:

```javascript
/**
 * services/leadNotifier.js — Сповіщення менеджерів про нові ліди
 * v17.5.0: Lead Capture Integration
 */
const { pool } = require('../db');
const { sendTelegramMessage } = require('./telegram');
const { createLogger } = require('../utils/logger');

const log = createLogger('LeadNotifier');

const SOURCE_LABELS = {
  telegram: '🔵 Telegram',
  facebook: '🔷 Facebook',
  instagram: '🟣 Instagram',
  viber: '🟢 Viber',
  tiktok: '⚫ TikTok',
  turbo: '🟠 Turbo',
  universal: '🌐 Universal',
  manual: '✏️ Ручний'
};

/**
 * Надіслати сповіщення про новий лід менеджерам/директорам
 * @param {Object} lead - об'єкт ліда з БД
 */
async function notifyNewLead(lead) {
  try {
    // Знайти менеджерів та директорів у яких є telegram_chat_id
    const result = await pool.query(
      `SELECT telegram_chat_id FROM users
       WHERE role IN ('manager', 'director', 'creator')
         AND telegram_chat_id IS NOT NULL
         AND is_active = true`
    );

    if (result.rows.length === 0) {
      log.warn('No managers with telegram_chat_id found for lead notification');
      return;
    }

    const sourceLabel = SOURCE_LABELS[lead.source_channel] || `📥 ${lead.source_channel || 'Невідомо'}`;
    const name = lead.client_name || 'Без імені';
    const phone = lead.phone ? `\n📞 ${lead.phone}` : '';
    const ig = lead.instagram ? `\n📸 @${lead.instagram}` : '';
    const notes = lead.notes ? `\n💬 ${lead.notes.slice(0, 200)}` : '';
    const assignedInfo = lead.assigned_name ? `\n👤 Призначено: ${lead.assigned_name}` : '';

    const text = `🔥 <b>Новий лід</b> [${sourceLabel}]\n\n`
      + `👤 <b>${name}</b>`
      + phone + ig + notes + assignedInfo
      + `\n\n<a href="https://${process.env.RAILWAY_PUBLIC_DOMAIN}/customers?tab=leads">Відкрити в CRM →</a>`;

    for (const row of result.rows) {
      sendTelegramMessage(row.telegram_chat_id, text, { parse_mode: 'HTML' })
        .catch(e => log.warn(`Failed to notify manager ${row.telegram_chat_id}: ${e.message}`));
    }
  } catch (err) {
    log.error('notifyNewLead error', err);
  }
}

module.exports = { notifyNewLead };
```

---

## 3. Логіка Telegram Lead Capture — в `routes/telegram.js`

### 3.1 Додати імпорт на початку файлу (після існуючих require):

```javascript
const { notifyNewLead } = require('../services/leadNotifier');
```

### 3.2 Додати функцію `handleLeadCapture` перед `module.exports` або перед router:

```javascript
/**
 * v17.5.0: Обробити Telegram повідомлення як потенційний лід
 * Спрацьовує для приватних чатів (type === 'private'), не для групових
 */
async function handleLeadCapture(update) {
  const msg = update.message;
  if (!msg || msg.chat?.type !== 'private') return; // тільки приватні чати
  if (msg.text?.startsWith('/')) return; // команди обробляються окремо

  const user = msg.from;
  const telegramId = user?.id;
  if (!telegramId) return;

  const text = msg.text || msg.caption || '';

  try {
    // Перевірити чи вже є відкритий лід з цього telegram_id
    const existing = await pool.query(
      `SELECT id FROM leads
       WHERE telegram_id = $1 AND status NOT IN ('booked', 'closed', 'lost')
       LIMIT 1`,
      [telegramId]
    );

    if (existing.rows.length > 0) {
      // Лід вже є — оновити notes та last_contact_at
      await pool.query(
        `UPDATE leads SET
           notes = COALESCE(notes, '') || E'\n[TG] ' || $1,
           last_contact_at = NOW()
         WHERE id = $2`,
        [text.slice(0, 500), existing.rows[0].id]
      );
      return; // не дублювати
    }

    // Сформувати ім'я
    const firstName = user.first_name || '';
    const lastName = user.last_name || '';
    const clientName = [firstName, lastName].filter(Boolean).join(' ') || `TG_${telegramId}`;

    // Визначити external_id = telegram message_id + user_id
    const externalId = `tg_${telegramId}`;

    // Перевірити external_id (захист від race condition)
    const dupCheck = await pool.query(
      `SELECT id FROM leads WHERE source_channel = 'telegram' AND external_id = $1`,
      [externalId]
    );
    if (dupCheck.rows.length > 0) return;

    // Створити лід
    const result = await pool.query(
      `INSERT INTO leads
         (client_name, telegram_id, source, source_channel, external_id, notes, raw_payload, status)
       VALUES ($1, $2, 'telegram', 'telegram', $3, $4, $5, 'new')
       ON CONFLICT (source_channel, external_id) WHERE external_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        clientName,
        telegramId,
        externalId,
        text.slice(0, 1000) || null,
        JSON.stringify({ from: user, message_id: msg.message_id, text })
      ]
    );

    if (result.rows.length > 0) {
      log.info(`New lead from Telegram: ${clientName} (tg_id: ${telegramId})`);
      notifyNewLead(result.rows[0]).catch(() => {});

      // Відповісти юзеру в Telegram (опційно)
      await sendTelegramMessage(
        msg.chat.id,
        `👋 Дякуємо за звернення!\nНаш менеджер зв'яжеться з вами найближчим часом.\n\n🎉 Парк Закревського Періоду`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (err) {
    log.error('handleLeadCapture error', err);
  }
}
```

### 3.3 В обробнику `router.post('/webhook', ...)` — ПІСЛЯ блоку збереження chat/thread info і ПЕРЕД обробкою команд — додати виклик:

```javascript
// v17.5.0: Lead capture для нових звернень в приватному чаті
if (update.message && update.message.chat?.type === 'private' && !update.message.text?.startsWith('/')) {
  handleLeadCapture(update).catch(e => log.error('Lead capture error', e));
}
```

---

## 4. Нові webhook ендпоінти — в `routes/leads.js`

### 4.1 Додати на початку файлу:

```javascript
const crypto = require('crypto');
const { notifyNewLead } = require('../services/leadNotifier');

const UNIVERSAL_WEBHOOK_TOKEN = process.env.UNIVERSAL_WEBHOOK_TOKEN || '';
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || '';
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN || '';
const VIBER_AUTH_TOKEN = process.env.VIBER_AUTH_TOKEN || '';
```

### 4.2 Хелпер для створення ліда з webhook (додати після імпортів):

```javascript
/**
 * Створити лід з вебхук-даних, уникаючи дублів
 * @param {Object} data - { client_name, phone, telegram_id, instagram, notes, source_channel, external_id, raw_payload }
 */
async function createLeadFromWebhook(data) {
  const { client_name, phone, telegram_id, instagram, notes, source_channel, external_id, raw_payload } = data;

  // Перевірити дублікати по phone або external_id
  if (phone) {
    const dup = await pool.query(
      `SELECT id FROM leads WHERE phone = $1 AND status NOT IN ('booked','closed','lost') LIMIT 1`,
      [phone]
    );
    if (dup.rows.length > 0) {
      // Оновити existing лід
      await pool.query(
        `UPDATE leads SET notes = COALESCE(notes,'') || E'\n[' || $1 || '] ' || COALESCE($2,''),
                          last_contact_at = NOW()
         WHERE id = $3`,
        [source_channel, notes, dup.rows[0].id]
      );
      return null; // не новий лід
    }
  }

  const result = await pool.query(
    `INSERT INTO leads
       (client_name, phone, telegram_id, instagram, source, source_channel, external_id, notes, raw_payload, status)
     VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,'new')
     ON CONFLICT (source_channel, external_id) WHERE external_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      client_name || null,
      phone || null,
      telegram_id || null,
      instagram || null,
      source_channel,
      external_id || null,
      notes || null,
      raw_payload ? JSON.stringify(raw_payload) : null
    ]
  );

  return result.rows[0] || null;
}
```

### 4.3 Universal Webhook (найпростіший — для TikTok, Turbo, BnD та ін.):

```javascript
// POST /api/leads/webhook/universal?source=tiktok
// Body: { name, phone, message, instagram?, external_id? }
// Auth: Authorization: Bearer UNIVERSAL_WEBHOOK_TOKEN
router.post('/webhook/universal', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    if (!UNIVERSAL_WEBHOOK_TOKEN || authHeader !== `Bearer ${UNIVERSAL_WEBHOOK_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const source_channel = (req.query.source || 'universal').toLowerCase().slice(0, 50);
    const { name, phone, message, instagram, external_id } = req.body;

    if (!name && !phone) {
      return res.status(400).json({ error: 'Потрібно name або phone' });
    }

    const lead = await createLeadFromWebhook({
      client_name: name,
      phone,
      instagram,
      notes: message,
      source_channel,
      external_id: external_id || (phone ? `${source_channel}_${phone}` : null),
      raw_payload: req.body
    });

    if (lead) {
      notifyNewLead(lead).catch(() => {});
      log.info(`New lead via universal webhook [${source_channel}]: ${name || phone}`);
    }

    res.json({ success: true, created: !!lead });
  } catch (err) {
    log.error('Universal webhook error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});
```

### 4.4 Facebook Lead Ads:

```javascript
// GET /api/leads/webhook/facebook — верифікація
router.get('/webhook/facebook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
    log.info('Facebook webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// POST /api/leads/webhook/facebook — нові ліди з Facebook Lead Ads
router.post('/webhook/facebook', async (req, res) => {
  try {
    res.sendStatus(200); // Facebook чекає швидку відповідь

    const body = req.body;
    if (body.object !== 'page') return;

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'leadgen') continue;
        const leadgenId = change.value?.leadgen_id;
        const pageId = change.value?.page_id;
        if (!leadgenId) continue;

        // Отримати дані ліда через Graph API
        try {
          const apiUrl = `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${FB_PAGE_ACCESS_TOKEN}`;
          const https = require('https');
          const fbData = await new Promise((resolve, reject) => {
            https.get(apiUrl, (resp) => {
              let data = '';
              resp.on('data', chunk => data += chunk);
              resp.on('end', () => resolve(JSON.parse(data)));
            }).on('error', reject);
          });

          // Парсити field_data: [{name: 'full_name', values: ['Марія']}]
          const fields = {};
          for (const f of (fbData.field_data || [])) {
            fields[f.name] = f.values?.[0] || '';
          }

          const lead = await createLeadFromWebhook({
            client_name: fields.full_name || fields.first_name || null,
            phone: fields.phone_number || null,
            instagram: fields.instagram || null,
            notes: `Facebook Lead Ad | форма: ${fbData.ad_name || leadgenId}`,
            source_channel: 'facebook',
            external_id: `fb_${leadgenId}`,
            raw_payload: fbData
          });

          if (lead) {
            notifyNewLead(lead).catch(() => {});
            log.info(`New lead from Facebook: ${lead.client_name}`);
          }
        } catch (fbErr) {
          log.error(`Failed to fetch FB lead ${leadgenId}: ${fbErr.message}`);
        }
      }
    }
  } catch (err) {
    log.error('Facebook webhook error', err);
  }
});
```

### 4.5 Instagram (через Facebook Graph API — аналогічно FB):

```javascript
// GET /api/leads/webhook/instagram — верифікація (той самий verify_token)
router.get('/webhook/instagram', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
    log.info('Instagram webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// POST /api/leads/webhook/instagram — Instagram DM / Lead Ads
router.post('/webhook/instagram', async (req, res) => {
  try {
    res.sendStatus(200);
    const body = req.body;

    // Instagram messaging event
    for (const entry of (body.entry || [])) {
      for (const messaging of (entry.messaging || [])) {
        const senderId = messaging.sender?.id;
        const text = messaging.message?.text;
        if (!senderId || !text) continue;

        const lead = await createLeadFromWebhook({
          client_name: `IG_${senderId}`,
          notes: text.slice(0, 500),
          source_channel: 'instagram',
          external_id: `ig_${senderId}`,
          raw_payload: messaging
        });

        if (lead) {
          notifyNewLead(lead).catch(() => {});
          log.info(`New lead from Instagram DM: ig_${senderId}`);
        }
      }
    }
  } catch (err) {
    log.error('Instagram webhook error', err);
  }
});
```

### 4.6 Viber:

```javascript
// POST /api/leads/webhook/viber
router.post('/webhook/viber', async (req, res) => {
  try {
    // Верифікація підпису Viber
    if (VIBER_AUTH_TOKEN) {
      const sig = req.headers['x-viber-content-signature'] || '';
      const expectedSig = crypto
        .createHmac('sha256', VIBER_AUTH_TOKEN)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expectedSig) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    res.sendStatus(200);
    const event = req.body;
    if (!['message', 'conversation_started'].includes(event.event)) return;

    const sender = event.sender || {};
    const text = event.message?.text || 'Нове звернення через Viber';

    const lead = await createLeadFromWebhook({
      client_name: sender.name || `Viber_${sender.id}`,
      notes: text.slice(0, 500),
      source_channel: 'viber',
      external_id: `viber_${sender.id}`,
      raw_payload: event
    });

    if (lead) {
      notifyNewLead(lead).catch(() => {});
      log.info(`New lead from Viber: ${sender.name || sender.id}`);
    }
  } catch (err) {
    log.error('Viber webhook error', err);
  }
});
```

### 4.7 Статус вебхуків (для адміна):

```javascript
// GET /api/leads/webhook/status — перевірити які вебхуки налаштовані
router.get('/webhook/status', async (req, res) => {
  res.json({
    success: true,
    webhooks: {
      telegram: { configured: true, note: 'Вбудовано в /api/telegram/webhook' },
      facebook: { configured: !!FB_PAGE_ACCESS_TOKEN, endpoint: '/api/leads/webhook/facebook' },
      instagram: { configured: !!FB_PAGE_ACCESS_TOKEN, endpoint: '/api/leads/webhook/instagram' },
      viber: { configured: !!VIBER_AUTH_TOKEN, endpoint: '/api/leads/webhook/viber' },
      universal: {
        configured: !!UNIVERSAL_WEBHOOK_TOKEN,
        endpoint: '/api/leads/webhook/universal?source=<назва>',
        sources: ['tiktok', 'turbo', 'bnderoga', 'custom']
      }
    }
  });
});
```

---

## 5. ENV змінні — додати в Railway

В Railway Dashboard → Environment Variables:

```
UNIVERSAL_WEBHOOK_TOKEN=<генерувати: openssl rand -hex 32>
FB_VERIFY_TOKEN=<довільний рядок, наприклад: park_zakrevskogo_2026>
FB_PAGE_ACCESS_TOKEN=<з Facebook Developers Portal>
VIBER_AUTH_TOKEN=<з Viber Admin Panel>
```

> ⚠️ `TELEGRAM_BOT_TOKEN` і `WEBHOOK_SECRET` — вже є в Railway, не чіпати

---

## 6. Оновлення `server.js` — відкрити webhook-ендпоінти без auth middleware

В `server.js` знайти рядок де визначаються публічні шляхи (без JWT):
```javascript
req.path.startsWith('/auth/') || req.path === '/health' || ...
```

Додати до цього списку:
```javascript
|| req.path.startsWith('/api/leads/webhook/')
```

---

## 7. UI оновлення в `leads.html` (або `customers.html` якщо ліди злиті туди)

> ⚠️ Примітка: в `server.js` є редирект `/leads → /customers?tab=leads` — оновлювати треба `customers.html`

### 7.1 Фільтр-таби по source_channel

Додати панель фільтрів над таблицею лідів:
```html
<div class="leads-source-tabs">
  <button class="source-tab active" data-source="">Всі</button>
  <button class="source-tab" data-source="telegram">🔵 TG</button>
  <button class="source-tab" data-source="facebook">🔷 FB</button>
  <button class="source-tab" data-source="instagram">🟣 IG</button>
  <button class="source-tab" data-source="viber">🟢 Viber</button>
  <button class="source-tab" data-source="tiktok">⚫ TikTok</button>
  <button class="source-tab" data-source="turbo">🟠 Turbo</button>
  <button class="source-tab" data-source="manual">✏️ Ручні</button>
</div>
```

При кліку → передавати `?source=telegram` в `GET /api/leads`.

### 7.2 Бейдж джерела в рядку таблиці

Додати колонку або inline-бейдж біля імені ліда:
```javascript
const SOURCE_BADGES = {
  telegram: '<span class="source-badge tg">TG</span>',
  facebook: '<span class="source-badge fb">FB</span>',
  instagram: '<span class="source-badge ig">IG</span>',
  viber: '<span class="source-badge vb">Viber</span>',
  tiktok: '<span class="source-badge tt">TikTok</span>',
  turbo: '<span class="source-badge tu">Turbo</span>',
  manual: '<span class="source-badge mn">Ручний</span>'
};
```

CSS класи `.source-badge.tg`, `.source-badge.fb` тощо — маленький кольоровий бейдж.

### 7.3 Статистика по джерелах

В `GET /api/leads/stats` — додати розбивку по `source_channel`:
```sql
SELECT source_channel, COUNT(*) AS count FROM leads GROUP BY source_channel
```
Показати в блоці статистики зверху.

---

## 8. Тестування після деплою

```bash
# 1. Перевірити статус вебхуків
curl https://8223324090-production.up.railway.app/api/leads/webhook/status

# 2. Тест Universal (TikTok)
curl -X POST "https://8223324090-production.up.railway.app/api/leads/webhook/universal?source=tiktok" \
  -H "Authorization: Bearer $UNIVERSAL_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Тест Тікток", "phone": "+380991112233", "message": "Хочу квест на 10 дітей"}'

# 3. Перевірити лід в CRM
curl https://8223324090-production.up.railway.app/api/leads?limit=1
```

---

## 9. Деплой

```bash
cd /tmp/crm-repo
git add -A
git commit -m "v17.5.0: Lead Capture Integration — Telegram, FB, IG, Viber, Universal webhooks"
git push origin main      # фронтенд
git push origin deployed  # бекенд
railway up --detach        # деплой на Railway
```

---

## Пріоритет реалізації

| # | Компонент | Складність | Цінність |
|---|-----------|------------|---------|
| 1 | ✅ Міграція 045 | Низька | Обов'язково |
| 2 | ✅ `services/leadNotifier.js` | Низька | Висока |
| 3 | ✅ Telegram lead capture в `routes/telegram.js` | Середня | Дуже висока |
| 4 | ✅ Universal webhook в `routes/leads.js` | Низька | Висока |
| 5 | ✅ FB/IG webhook | Середня | Висока (потребує FB бізнес-акаунт) |
| 6 | ✅ Viber webhook | Середня | Середня (потребує Viber Business) |
| 7 | ✅ UI фільтри + бейджі | Низька | Висока (видимість) |
| 8 | ✅ ENV в Railway | Низька | Обов'язково |

**Telegram + Universal — запускати першими. FB/IG/Viber — після отримання токенів.**
