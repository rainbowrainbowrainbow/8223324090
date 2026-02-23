-- Migration 010: AI Workers (Digital Employees) backend (v17.3)
--
-- Two tables:
--   ai_workers      — registry of digital employees (Tymur, Svitlana, Taras, etc.)
--   ai_worker_tasks — task journal with persistent storage

-- ============================================================
-- 1. AI Workers registry
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_workers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    avatar      TEXT DEFAULT '🤖',
    role        TEXT NOT NULL,
    department  TEXT NOT NULL,
    status      TEXT DEFAULT 'planned' CHECK (status IN ('active', 'planned', 'disabled')),
    status_label TEXT,
    description TEXT,
    bot_token   TEXT,
    bot_chat_id TEXT,
    webhook_url TEXT,
    webhook_secret TEXT,
    capabilities JSONB DEFAULT '[]',
    integration TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. AI Worker tasks journal
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_worker_tasks (
    id           SERIAL PRIMARY KEY,
    worker_id    TEXT NOT NULL REFERENCES ai_workers(id) ON DELETE CASCADE,
    username     TEXT NOT NULL,
    task         TEXT NOT NULL,
    status       TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'queued', 'in_progress', 'done', 'failed')),
    result       TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_worker_tasks_worker ON ai_worker_tasks(worker_id);
CREATE INDEX IF NOT EXISTS idx_ai_worker_tasks_status ON ai_worker_tasks(status);

-- ============================================================
-- 3. Seed data — three initial digital employees
-- ============================================================

INSERT INTO ai_workers (id, name, avatar, role, department, status, status_label, description, capabilities, integration, webhook_url, webhook_secret) VALUES
(
    'tymur', 'Тимур', '🤝',
    'Взаємодія з підрядниками', 'Зовнішні комунікації',
    'active', 'Готовий до роботи',
    'Відповідає за комунікацію з постачальниками, підрядниками та партнерами. Формує запити, відстежує статуси замовлень, нагадує про дедлайни та веде архів контрактів.',
    '["Автоматичні запити постачальникам", "Відстеження статусів замовлень", "Нагадування про дедлайни контрактів", "Архів комунікацій з партнерами"]'::jsonb,
    'Telegram-бот @TimurParkRozvagbot. Підключений через API.',
    'https://tymur-bot-production.up.railway.app/order/create',
    'kleshnya-tymur-secret-2026'
),
(
    'svitlana', 'Світлана', '📋',
    'Контроль виконання задач', 'Операційний контроль',
    'planned', 'В розробці',
    'Моніторить виконання задач працівниками, відстежує дедлайни, надсилає нагадування та ескалює прострочені задачі. Формує щоденні звіти про продуктивність.',
    '["Моніторинг дедлайнів задач", "Автоматичні нагадування виконавцям", "Ескалація прострочених задач", "Щоденні звіти про продуктивність команди"]'::jsonb,
    'Буде інтегрована з системою задач та Telegram-сповіщеннями.',
    NULL, NULL
),
(
    'taras', 'Тарас', '📊',
    'Звіти та аналітика', 'Аналітичний відділ',
    'planned', 'В розробці',
    'Приймає звіти від працівників, обробляє та структурує дані, публікує результати на сайті. Автоматично генерує зведені звіти за період.',
    '["Прийом та валідація звітів", "Автоматична обробка даних", "Генерація зведених звітів", "Публікація результатів на сайт"]'::jsonb,
    'Буде інтегрований з модулями Фінанси, Аналітика та HR-звітами.',
    NULL, NULL
)
ON CONFLICT (id) DO NOTHING;
