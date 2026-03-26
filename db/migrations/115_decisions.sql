-- v115: Decision Screen — таблиця рішень для директора
CREATE TABLE IF NOT EXISTS decisions (
    id              SERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    priority        VARCHAR(20) NOT NULL DEFAULT 'normal'
                    CHECK(priority IN ('critical','important','normal')),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','approved','rejected','deferred')),
    created_by      TEXT,
    created_by_id   INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_by      TEXT,
    decided_by_id   INTEGER,
    decided_at      TIMESTAMPTZ,
    decision_note   TEXT,
    source          VARCHAR(20) NOT NULL DEFAULT 'manual'
                    CHECK(source IN ('manual','kleshnya','bot','system','telegram')),
    expires_at      TIMESTAMPTZ,
    context_url     TEXT
);

CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_decisions_pending_priority ON decisions(priority, created_at) WHERE status = 'pending';

-- Seed: тестові рішення для першого запуску
INSERT INTO decisions (title, description, priority, source, created_by, context_url)
VALUES
    ('Закупівля браслетів', 'Залишок 12 шт. Потрібно 500. Ціна 2 400 грн.', 'critical', 'kleshnya', 'Клешня', '/warehouse'),
    ('Оновити програму Квест-Піратів', 'Додати нові загадки та реквізит для квесту', 'important', 'manual', 'Іра'),
    ('Замовити нові футболки для команди', 'Розміри: S×5, M×10, L×8, XL×3', 'normal', 'system', 'Система')
ON CONFLICT DO NOTHING;
