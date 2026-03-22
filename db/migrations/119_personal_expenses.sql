-- ══════════════════════════════════════════════
-- v119: Особисті транзакції (ізольовано від компанії)
-- + Черга звітів бота
-- ══════════════════════════════════════════════

-- Транзакції по особистих рахунках
CREATE TABLE IF NOT EXISTS personal_account_transactions (
    id            SERIAL PRIMARY KEY,
    account_id    INTEGER NOT NULL REFERENCES finance_accounts(id) ON DELETE CASCADE,
    type          VARCHAR(10) NOT NULL CHECK (type IN ('income','expense')),
    amount        INTEGER NOT NULL,
    description   TEXT,
    category      VARCHAR(50),
    payment_method VARCHAR(30),
    date          DATE NOT NULL DEFAULT CURRENT_DATE,
    source        VARCHAR(20) DEFAULT 'report_bot',
    submitted_by_telegram BIGINT,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_tx_account ON personal_account_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_personal_tx_date    ON personal_account_transactions(date);

-- Загальна черга звітів бота (всі типи)
CREATE TABLE IF NOT EXISTS report_bot_submissions (
    id              SERIAL PRIMARY KEY,
    raw_type        VARCHAR(10),
    amount          INTEGER,
    description     TEXT,
    category        VARCHAR(50),
    account_name    VARCHAR(100),
    object_name     VARCHAR(100),
    submitted_by    VARCHAR(100),
    submitted_by_id BIGINT,
    photo_url       TEXT,
    ocr_text        TEXT,
    voice_transcript TEXT,
    status          VARCHAR(20) DEFAULT 'new',
    finance_transaction_id  INTEGER REFERENCES finance_transactions(id) ON DELETE SET NULL,
    personal_tx_id          INTEGER REFERENCES personal_account_transactions(id) ON DELETE SET NULL,
    notes           TEXT,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rbs_status ON report_bot_submissions(status);
CREATE INDEX IF NOT EXISTS idx_rbs_object ON report_bot_submissions(object_name);
CREATE INDEX IF NOT EXISTS idx_rbs_date   ON report_bot_submissions(created_at);
