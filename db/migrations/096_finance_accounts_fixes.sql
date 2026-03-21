-- v33.5: Fix finance_accounts constraints
-- Add unique constraint on name (needed for ON CONFLICT in seed)
ALTER TABLE finance_accounts ADD CONSTRAINT finance_accounts_name_unique UNIQUE (name);

-- Add index on reports.account_id for query performance
CREATE INDEX IF NOT EXISTS idx_reports_account_id ON reports(account_id);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_account_id ON finance_transactions(account_id);
