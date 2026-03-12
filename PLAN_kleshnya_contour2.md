# ПЛАН: Контур 2 — Kleshnya як центр моніторингу + покращення Охоронця

> Мета: Kleshnya стає швидким центром слідкування за всім — агенти, чат, безпека.
> Допомагає Охоронцю, збирає саммарі, дає розробнику повну картину.

---

## Що є зараз (Контур 1)

### Kleshnya
- Чат-бот Claude Haiku + 11 бізнес-скілів
- Бізнес-контекст (бронювання, задачі, виручка, стріки)
- OpenClaw bridge для медіа-генерації
- Сесії, реакції, greeting
- **Проблема**: не слідкує за агентами, не допомагає Охоронцю, повільна

### Охоронець (Guardian v2.0)
- Silent watcher: не пише в канали, тільки DM директору
- Sensitive data masking (regex — телефони, картки, emails)
- AI conflict detection (OpenRouter/Anthropic fallback)
- Daily reports по каналах
- Muting (1 хв auto-mute)
- Mood system (emoji залежно від health каналу)
- Memory: зберігає контекст для AI аналізу
- Guardian actions log (mute, mask, warn, flag)
- **Проблеми**: немає зв'язку з Kleshnya, правила hardcoded, немає learning

---

## КОНТУР 2 — Покращення

### 2.1 — Покращення бази Охоронця

#### A. Гнучкі правила (guardian_rules)
Зараз правила hardcoded. Потрібна таблиця:
```sql
CREATE TABLE guardian_rules (
  id SERIAL PRIMARY KEY,
  rule_type VARCHAR(30) NOT NULL,       -- 'keyword', 'regex', 'pattern', 'rate_limit'
  name VARCHAR(100) NOT NULL,
  pattern TEXT,                          -- regex або ключове слово
  action VARCHAR(30) NOT NULL,          -- 'flag', 'mask', 'mute', 'warn', 'notify'
  severity VARCHAR(10) DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
  channel_scope INT[],                   -- NULL = всі канали, або конкретні ID
  is_active BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',          -- { mute_duration: 60, notify_users: [1,2] }
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
- API: CRUD для правил через `/api/guardian/rules`
- Kleshnya може створювати правила: "Охоронець, слідкуй за словом X"
- Міграція переносить існуючі hardcoded правила в таблицю

#### B. Класифікація повідомлень
Зараз Guardian аналізує тільки конфлікти. Потрібна ширша класифікація:
- **critical** — конфіденційні дані, конфлікти, spam
- **important** — @mentions директора, фінансові теми, скарги
- **normal** — звичайне спілкування
- **noise** — стікери, "ок", "+"

Зберігати severity в `guardian_memory` (вже є) + новий індекс по severity.

#### C. Покращений AI аналіз
- Збільшити контекстне вікно (зараз тільки одне повідомлення)
- Передавати останні 5 повідомлень каналу для кращого розуміння контексту
- Окремий промпт для класифікації vs conflict detection
- Rate limit AI calls: max 1 call / 10 повідомлень (batch аналіз)

#### D. Guardian digest покращення
- Зараз daily report — сухий. Додати:
  - Тренди: "конфлікти зросли на 30%", "активність впала"
  - Top-3 важливих повідомлень дня
  - Рекомендації: "канал #техніка малоактивний, може об'єднати?"

---

### 2.2 — Kleshnya ↔ Guardian інтеграція

#### A. Kleshnya як інтерфейс до Охоронця
Нові скіли в kleshnya-chat.js:
- `/guard status` — стан Охоронця (mood, active mutes, today stats)
- `/guard report [channel]` — останній звіт або згенерувати новий
- `/guard rules` — список активних правил
- `/guard add-rule "pattern" action` — додати правило через чат
- `/guard mute @user [duration]` — замутити через Kleshnya
- `/guard unmute @user` — розмутити
- Природна мова: "що бачив охоронець сьогодні?" → AI summary guardian actions

#### B. Kleshnya отримує guardian events
- WebSocket: `guardian:event` → Kleshnya показує в activity feed
- Kleshnya може коментувати дії Охоронця: "Охоронець замаскував телефон у #команда"
- При critical → Kleshnya пушить notification розробнику

#### C. Спільна пам'ять
- Guardian зберігає в `guardian_memory` → Kleshnya може читати
- Kleshnya зберігає сесійний контекст → Guardian може використати для аналізу
- Спільна таблиця `ai_context_cache` для кешування між сервісами

---

### 2.3 — Agent Activity Tracking

#### Міграція: agent_activities
```sql
CREATE TABLE agent_activities (
  id SERIAL PRIMARY KEY,
  agent_tag VARCHAR(20) NOT NULL,        -- 'claude-code', 'kleshnya', 'anthropic', 'human'
  action_type VARCHAR(50) NOT NULL,      -- 'commit', 'pr', 'deploy', 'session', 'fix', 'feature'
  summary TEXT NOT NULL,
  details JSONB DEFAULT '{}',            -- { files: [], branch: '', diff_stat: '+100 -20' }
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agent_act_tag ON agent_activities(agent_tag);
CREATE INDEX idx_agent_act_time ON agent_activities(created_at DESC);
```

#### Service: agentTracker.js
- `logActivity(tag, type, summary, details)` — запис
- `parseGitLog(since)` — парсити git log → автоматично створювати activities
- `getActivityFeed(filter)` — лента з пагінацією і фільтром по агенту
- `generateSummary(period)` — Claude Haiku summary з activities за період

#### API: routes/agents.js
```
GET  /api/agents/activity      — лента (paginated, ?agent=, ?since=)
GET  /api/agents/summary       — AI summary за період (?period=today|week|session)
GET  /api/agents/status        — поточний статус агентів
POST /api/agents/activity      — webhook: зовнішній агент записує activity
```

#### Kleshnya скіли
- "що зробив клод сьогодні?" → AI summary agent activities
- "які PR відкриті?" → git/activity feed
- "що змінилось у файлі X?" → git log --follow
- `/agents` → статус всіх агентів
- `/summary` → саммарі за сьогодні

---

### 2.4 — Speed Improvements

#### A. Streaming відповідей
- Claude API з `stream: true` → SSE endpoint
- Фронтенд: поступовий рендер тексту (typewriter effect)
- Латенсі: замість 3-5с чекати → 0.5с до першого токена

#### B. In-memory кеш контексту
```javascript
// services/contextCache.js
const cache = new Map();
function getCached(key, ttlMs, fetchFn) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
  // fetch, store, return
}
```
- Bookings count: TTL 60с
- Team on shift: TTL 5хв
- Revenue stats: TTL 5хв
- Agent activities: TTL 30с

#### C. Prefetch
- При відкритті Kleshnya → паралельно: greeting + agent status + guardian mood
- Lazy load activity feed при скролі

#### D. Batch AI calls
- Guardian: замість AI call на кожне повідомлення → batch 5-10 повідомлень
- Kleshnya context: один запит замість 6-8 окремих DB queries

---

### 2.5 — UI: Developer Dashboard в Kleshnya

#### Agent Status Bar (зверху kleshnya.html)
```
┌───────────────────────────────────────────────────┐
│ 🤖 Claude: працює (claude/rbac)  │ 🦀 Клешня: idle │ 👁 Охоронець: 😊 спокійно │
└───────────────────────────────────────────────────┘
```

#### Activity Feed Tab
Новий таб поряд з сесіями:
```
┌─ Сесії ─┬─ Активність ─┐
│                         │
│ 14:32 [claude] feat: RBAC enforce        │
│        ↳ 3 files, +180 -20              │
│ 14:15 [guardian] mask: phone in #команда │
│ 13:50 [kleshnya] deploy v22.17          │
│ 13:20 [claude] PR #7 created            │
│                         │
│ ── Саммарі сьогодні ── │
│ Claude: 5 комітів, RBAC + Security      │
│ Guardian: 2 masks, 0 conflicts          │
│ [🔄 Оновити]                            │
└─────────────────────────┘
```

#### Quick Actions Panel
```
[Що зробив Claude?] [Звіт Охоронця] [Відкриті PR] [Статус]
```

---

## Порядок реалізації

| # | Що | Пріоритет | Залежності |
|---|---|-----------|------------|
| 1 | Міграція: guardian_rules + agent_activities | HIGH | — |
| 2 | guardian_rules CRUD + перенос hardcoded правил | HIGH | #1 |
| 3 | Покращена класифікація повідомлень Guardian | HIGH | #2 |
| 4 | agentTracker service + git log parser | HIGH | #1 |
| 5 | routes/agents.js API | HIGH | #4 |
| 6 | Kleshnya скіли: /guard, /agents, /summary | HIGH | #2, #5 |
| 7 | Kleshnya ↔ Guardian WebSocket bridge | MEDIUM | #6 |
| 8 | In-memory context cache | MEDIUM | — |
| 9 | Streaming відповідей (SSE) | MEDIUM | — |
| 10 | UI: Agent Status Bar | MEDIUM | #5 |
| 11 | UI: Activity Feed tab | MEDIUM | #5, #10 |
| 12 | UI: Summary Panel + Quick Actions | MEDIUM | #11 |
| 13 | Batch AI calls для Guardian | LOW | #3 |
| 14 | Guardian digest покращення (тренди, рекомендації) | LOW | #3 |
| 15 | Daily auto-summary cron | LOW | #4 |

---

## Файли

### Нові:
- `db/migrations/045_contour2_guardian_rules_agents.sql`
- `services/agentTracker.js` (~200 рядків)
- `services/contextCache.js` (~60 рядків)
- `routes/agents.js` (~150 рядків)
- `css/agents.css` (~200 рядків)

### Змінені:
- `services/guardian.js` — flexible rules, batch analysis, classification
- `routes/guardian.js` — rules CRUD
- `services/kleshnya-chat.js` — dev скіли (/guard, /agents, /summary)
- `kleshnya.html` — status bar, activity tab
- `js/kleshnya-page.js` (або js/agents-panel.js) — UI логіка
- `server.js` — підключити routes/agents.js, streaming endpoint
- `services/scheduler.js` — git log parsing cron

---

## Що НЕ входить в Контур 2
- Auto-deploy через чат (Контур 3)
- Code review через чат (Контур 3)
- GitHub API інтеграція (парсимо git log локально)
- Публічний моніторинг (тільки для розробника)
