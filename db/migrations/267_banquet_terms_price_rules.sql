-- MIGRATION_KIND: seed
-- SAFETY: Idempotently adds missing banquet terms numeric settings to price_rules without changing existing operator-edited rows.
-- ROLLBACK: Delete price_rules where code is in ('banquet_own_cake_fee', 'banquet_cork_fee', 'banquet_menu_correction_deadline_days', 'banquet_date_change_deadline_days') after confirming they are no longer used by banquet summaries.
-- DATA_SCOPE: Reference numeric defaults for Event Genix banquet terms; existing rows with the same code are preserved.

INSERT INTO price_rules (code, name, value, unit, category, description, updated_by)
VALUES
    (
        'banquet_own_cake_fee',
        'Банкет: свій торт',
        500,
        'грн',
        'Банкетні умови',
        'Плата за власний торт у стандартних умовах замовлення банкету.',
        'migration_267_banquet_terms_price_rules'
    ),
    (
        'banquet_cork_fee',
        'Банкет: Cork Fee',
        100,
        'грн',
        'Банкетні умови',
        'Cork Fee у стандартних умовах замовлення банкету.',
        'migration_267_banquet_terms_price_rules'
    ),
    (
        'banquet_menu_correction_deadline_days',
        'Банкет: корегування меню',
        3,
        'доби',
        'Банкетні умови',
        'Максимальний строк корегування меню до дати банкету.',
        'migration_267_banquet_terms_price_rules'
    ),
    (
        'banquet_date_change_deadline_days',
        'Банкет: зміна дати',
        5,
        'діб',
        'Банкетні умови',
        'Максимальний строк зміни дати до дати банкету.',
        'migration_267_banquet_terms_price_rules'
    )
ON CONFLICT (code) DO NOTHING;
