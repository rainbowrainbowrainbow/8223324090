-- ══════════════════════════════════════════════
-- v120: Розширення finance_transactions для звітного бота
-- ══════════════════════════════════════════════

-- Додати object_name і source (account_name вже є)
ALTER TABLE finance_transactions
    ADD COLUMN IF NOT EXISTS object_name  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS source       VARCHAR(30) DEFAULT 'manual';

-- Маппінг категорій бота → finance_categories
CREATE TABLE IF NOT EXISTS report_bot_category_map (
    bot_category        VARCHAR(50) PRIMARY KEY,
    finance_category_id INTEGER REFERENCES finance_categories(id),
    object_name         VARCHAR(100)
);

INSERT INTO report_bot_category_map (bot_category, finance_category_id) VALUES
('реквізит', NULL), ('їжа', NULL), ('оренда', 7), ('зарплата', 6),
('квест', NULL), ('свято', NULL), ('інше', NULL),
('закупки', 8), ('реклама', 9), ('комунальні', 10)
ON CONFLICT DO NOTHING;
