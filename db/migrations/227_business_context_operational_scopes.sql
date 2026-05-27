-- MIGRATION_KIND: mixed
-- SAFETY: Additive business_context columns and idempotent backfills for operational warehouse/finance data. No rows are deleted; existing rows remain in event_genix unless current owner/reference data clearly maps them to dar.
-- ROLLBACK: Drop the added scoped indexes/constraints, export or merge non-event_genix operational rows, then drop business_context columns from the listed tables if the multi-business model is reverted.
-- OPERATOR_APPROVAL: required

ALTER TABLE warehouse_locations
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE warehouse_stock
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE warehouse_history
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE warehouse_stock_movements
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE finance_categories
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE finance_transactions
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE budget_plans
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE cash_register_shifts
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE currency_conversions
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE receipts
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE finance_accounts
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

UPDATE warehouse_stock
SET business_context = CASE WHEN COALESCE(owner, 'park') = 'dar' THEN 'dar' ELSE 'event_genix' END
WHERE business_context IS NULL
   OR business_context = ''
   OR (
        business_context = 'event_genix'
        AND COALESCE(owner, 'park') = 'dar'
   );

UPDATE warehouse_history h
SET business_context = COALESCE(ws.business_context, 'event_genix')
FROM warehouse_stock ws
WHERE h.stock_id = ws.id
  AND COALESCE(h.business_context, 'event_genix') <> COALESCE(ws.business_context, 'event_genix');

UPDATE warehouse_stock_movements m
SET business_context = COALESCE(ws.business_context, 'event_genix')
FROM warehouse_stock ws
WHERE m.warehouse_stock_id = ws.id
  AND COALESCE(m.business_context, 'event_genix') <> COALESCE(ws.business_context, 'event_genix');

UPDATE warehouse_locations wl
SET business_context = scoped.business_context
FROM (
    SELECT
        location_id,
        CASE
            WHEN COUNT(*) FILTER (WHERE COALESCE(business_context, 'event_genix') <> 'dar') = 0
             AND COUNT(*) FILTER (WHERE COALESCE(business_context, 'event_genix') = 'dar') > 0
            THEN 'dar'
            ELSE 'event_genix'
        END AS business_context
    FROM warehouse_stock
    WHERE location_id IS NOT NULL
    GROUP BY location_id
) scoped
WHERE wl.id = scoped.location_id
  AND COALESCE(wl.business_context, 'event_genix') <> scoped.business_context;

UPDATE finance_categories
SET business_context = 'event_genix'
WHERE business_context IS NULL OR business_context = '';

UPDATE finance_transactions
SET business_context = COALESCE(b.business_context, 'event_genix')
FROM bookings b
WHERE finance_transactions.booking_id = b.id
  AND COALESCE(finance_transactions.business_context, 'event_genix') <> COALESCE(b.business_context, 'event_genix');

UPDATE receipts
SET business_context = COALESCE(b.business_context, business_context, 'event_genix')
FROM bookings b
WHERE receipts.booking_id = b.id
  AND COALESCE(receipts.business_context, 'event_genix') <> COALESCE(b.business_context, 'event_genix');

UPDATE currency_conversions
SET business_context = COALESCE(b.business_context, business_context, 'event_genix')
FROM bookings b
WHERE currency_conversions.booking_id = b.id
  AND COALESCE(currency_conversions.business_context, 'event_genix') <> COALESCE(b.business_context, 'event_genix');

INSERT INTO finance_categories (business_context, name, type, icon, color, is_system, sort_order)
SELECT ctx.business_context, fc.name, fc.type, fc.icon, fc.color, fc.is_system, fc.sort_order
FROM (VALUES ('dar'), ('maysternya_doli'), ('crm')) AS ctx(business_context)
CROSS JOIN finance_categories fc
WHERE COALESCE(fc.business_context, 'event_genix') = 'event_genix'
  AND fc.is_active = true
  AND NOT EXISTS (
      SELECT 1
      FROM finance_categories existing
      WHERE COALESCE(existing.business_context, 'event_genix') = ctx.business_context
        AND existing.type = fc.type
        AND lower(trim(existing.name)) = lower(trim(fc.name))
  );

ALTER TABLE budget_plans
    DROP CONSTRAINT IF EXISTS budget_plans_year_month_category_id_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'budget_plans_business_year_month_category_key'
    ) THEN
        ALTER TABLE budget_plans
            ADD CONSTRAINT budget_plans_business_year_month_category_key
            UNIQUE (business_context, year, month, category_id);
    END IF;
END $$;

ALTER TABLE finance_accounts
    DROP CONSTRAINT IF EXISTS finance_accounts_name_unique;

INSERT INTO finance_accounts (
    business_context, name, emoji, description, type, is_active, sort_order,
    created_by, is_personal, owner_telegram_id, owner_username, crm_created_by
)
SELECT
    ctx.business_context,
    fa.name,
    fa.emoji,
    fa.description,
    fa.type,
    fa.is_active,
    fa.sort_order,
    fa.created_by,
    fa.is_personal,
    fa.owner_telegram_id,
    fa.owner_username,
    fa.crm_created_by
FROM (VALUES ('dar'), ('maysternya_doli'), ('crm')) AS ctx(business_context)
CROSS JOIN finance_accounts fa
WHERE COALESCE(fa.business_context, 'event_genix') = 'event_genix'
  AND fa.is_active = true
  AND NOT EXISTS (
      SELECT 1
      FROM finance_accounts existing
      WHERE COALESCE(existing.business_context, 'event_genix') = ctx.business_context
        AND lower(trim(existing.name)) = lower(trim(fa.name))
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_accounts_business_name_active
    ON finance_accounts(business_context, lower(trim(name)))
    WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_shifts_one_open_per_business
    ON cash_register_shifts(business_context)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_warehouse_locations_business_active_sort
    ON warehouse_locations(business_context, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_warehouse_stock_business_active
    ON warehouse_stock(business_context, is_active, category, location_id);

CREATE INDEX IF NOT EXISTS idx_warehouse_history_business_created
    ON warehouse_history(business_context, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_warehouse_movements_business_created
    ON warehouse_stock_movements(business_context, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_finance_categories_business_type
    ON finance_categories(business_context, type, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_finance_transactions_business_date
    ON finance_transactions(business_context, date, type);

CREATE INDEX IF NOT EXISTS idx_budget_plans_business_year_month
    ON budget_plans(business_context, year, month);

CREATE INDEX IF NOT EXISTS idx_receipts_business_number
    ON receipts(business_context, receipt_number);

CREATE INDEX IF NOT EXISTS idx_currency_conversions_business_created
    ON currency_conversions(business_context, created_at DESC);
