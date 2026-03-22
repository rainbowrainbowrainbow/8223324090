-- ══════════════════════════════════════════════
-- v118: Розширення finance_accounts для особистих рахунків
-- + finance_account_access для спільного доступу
-- ══════════════════════════════════════════════

-- Додаємо колонки для особистих рахунків
ALTER TABLE finance_accounts
    ADD COLUMN IF NOT EXISTS is_personal       BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS owner_telegram_id  BIGINT,
    ADD COLUMN IF NOT EXISTS owner_username     VARCHAR(100),
    ADD COLUMN IF NOT EXISTS bot_account_id     INTEGER,
    ADD COLUMN IF NOT EXISTS crm_created_by     VARCHAR(50);

-- Дозволяємо type 'personal'
ALTER TABLE finance_accounts DROP CONSTRAINT IF EXISTS finance_accounts_type_check;
ALTER TABLE finance_accounts ADD CONSTRAINT finance_accounts_type_check
    CHECK (type IN ('cash','card','bank','personal'));

CREATE INDEX IF NOT EXISTS idx_finance_accounts_personal ON finance_accounts(is_personal);
CREATE INDEX IF NOT EXISTS idx_finance_accounts_owner    ON finance_accounts(owner_telegram_id);

-- Таблиця доступів до рахунків
CREATE TABLE IF NOT EXISTS finance_account_access (
    id           SERIAL PRIMARY KEY,
    account_id   INTEGER NOT NULL REFERENCES finance_accounts(id) ON DELETE CASCADE,
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    telegram_id  BIGINT,
    can_view     BOOLEAN DEFAULT true,
    can_write    BOOLEAN DEFAULT true,
    granted_by   INTEGER REFERENCES users(id),
    granted_at   TIMESTAMP DEFAULT NOW(),
    UNIQUE (account_id, telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_account_access_account  ON finance_account_access(account_id);
CREATE INDEX IF NOT EXISTS idx_account_access_telegram ON finance_account_access(telegram_id);
