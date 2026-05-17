-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotently creates missing product-linked price_rules from existing products without deleting or deactivating data.
-- ROLLBACK: Unlink or delete price_rules with updated_by='migration_180_product_price_rules' after confirming product price links are no longer needed.
-- DATA_SCOPE: Existing products rows without a price_rules.product_id link at migration time.

WITH product_price_rules AS (
    SELECT
        p.id AS product_id,
        ('prod_' ||
            left(
                COALESCE(NULLIF(regexp_replace(lower(p.id), '[^a-z0-9]+', '_', 'g'), ''), 'item'),
                36
            ) ||
            '_' ||
            substr(md5(p.id), 1, 8)
        ) AS code,
        p.name,
        GREATEST(COALESCE(p.price, 0), 0)::int AS value,
        CASE WHEN p.is_per_child THEN 'грн/дитина' ELSE 'грн' END AS unit,
        COALESCE(NULLIF(p.category, ''), 'product') AS category,
        'Автоматична центральна ціна для ' || COALESCE(NULLIF(p.label, ''), p.name, p.id) AS description
    FROM products p
    WHERE NOT EXISTS (
        SELECT 1
        FROM price_rules pr
        WHERE pr.product_id = p.id
    )
)
INSERT INTO price_rules (code, name, value, unit, category, description, product_id, updated_by)
SELECT code, name, value, unit, category, description, product_id, 'migration_180_product_price_rules'
FROM product_price_rules
ON CONFLICT (code) DO UPDATE SET
    product_id = COALESCE(price_rules.product_id, EXCLUDED.product_id),
    name = COALESCE(NULLIF(price_rules.name, ''), EXCLUDED.name),
    unit = COALESCE(NULLIF(price_rules.unit, ''), EXCLUDED.unit),
    category = COALESCE(NULLIF(price_rules.category, ''), EXCLUDED.category),
    description = COALESCE(NULLIF(price_rules.description, ''), EXCLUDED.description),
    updated_at = NOW(),
    updated_by = CASE
        WHEN price_rules.product_id IS NULL THEN EXCLUDED.updated_by
        ELSE price_rules.updated_by
    END
WHERE price_rules.product_id IS NULL OR price_rules.product_id = EXCLUDED.product_id;
