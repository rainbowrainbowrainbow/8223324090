-- MIGRATION_KIND: seed
-- SAFETY: Idempotently adds missing banquet entry price rules to price_rules without changing existing operator-edited rows.
-- ROLLBACK: Delete price_rules where code is in ('banquet_entry_weekday_child', 'banquet_entry_weekend_child') after confirming banquet entry pricing is disabled or replaced.
-- DATA_SCOPE: Reference per-child entry defaults for Event Genix banquet packages; existing rows with the same code are preserved.

INSERT INTO price_rules (code, name, value, unit, category, description, updated_by)
VALUES
    (
        'banquet_entry_weekday_child',
        'Вхід будні',
        300,
        'грн/дитина',
        'banquet',
        'Вхід у будні за одну дитину',
        'migration_268_banquet_entry_price_rules'
    ),
    (
        'banquet_entry_weekend_child',
        'Вхід вихідні',
        400,
        'грн/дитина',
        'banquet',
        'Вхід у вихідні за одну дитину',
        'migration_268_banquet_entry_price_rules'
    )
ON CONFLICT (code) DO NOTHING;
