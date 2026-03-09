-- Migration 031: Game currency (wallets + transactions)
CREATE TABLE IF NOT EXISTS game_wallets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    coins INTEGER NOT NULL DEFAULT 1000,
    total_earned INTEGER NOT NULL DEFAULT 1000,
    total_spent INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coin_transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    type VARCHAR(50) NOT NULL,
    description TEXT,
    reference_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_user ON game_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON coin_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON coin_transactions(type);

-- Seed: give all existing users 1000 starter coins
INSERT INTO game_wallets (user_id, coins, total_earned)
SELECT id, 1000, 1000 FROM users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO coin_transactions (user_id, amount, type, description)
SELECT id, 1000, 'starter_bonus', 'Стартовий бонус 🎉'
FROM users
WHERE id NOT IN (SELECT user_id FROM coin_transactions WHERE type = 'starter_bonus');
