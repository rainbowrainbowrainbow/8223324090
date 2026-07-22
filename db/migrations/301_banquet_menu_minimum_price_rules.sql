-- MIGRATION_KIND: seed
-- SAFETY: Idempotently adds missing banquet menu minimum and recommended deposit settings to price_rules without changing existing operator-edited rows.
-- ROLLBACK: Delete price_rules where code is in ('banquet_menu_minimum_room', 'banquet_menu_minimum_table', 'banquet_recommended_deposit') after confirming the menuWorkflow contract is disabled or replaced.
-- DATA_SCOPE: Reference numeric defaults for Event Genix banquet menu minimums and recommended deposit only; existing rows with the same code are preserved.

INSERT INTO price_rules (code, name, value, unit, category, description, updated_by)
VALUES
    (
        'banquet_menu_minimum_room',
        'Банкет: мінімум меню кімнатка',
        4000,
        'грн',
        'banquet',
        'Мінімальна сума меню для банкетного бронювання у кімнатці.',
        'migration_301_banquet_menu_minimum_price_rules'
    ),
    (
        'banquet_menu_minimum_table',
        'Банкет: мінімум меню столик',
        2500,
        'грн',
        'banquet',
        'Мінімальна сума меню для банкетного бронювання за столиком.',
        'migration_301_banquet_menu_minimum_price_rules'
    ),
    (
        'banquet_recommended_deposit',
        'Банкет: рекомендований завдаток',
        2000,
        'грн',
        'banquet',
        'Рекомендований завдаток для підтвердженого банкетного бронювання.',
        'migration_301_banquet_menu_minimum_price_rules'
    )
ON CONFLICT (code) DO NOTHING;
