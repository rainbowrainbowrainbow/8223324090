-- 043_coin_transactions_description.sql — Add description column to coin_transactions
-- v22.10.0
-- Many routes INSERT with 'description' column but table only has 'reason'

ALTER TABLE coin_transactions ADD COLUMN IF NOT EXISTS description TEXT;
