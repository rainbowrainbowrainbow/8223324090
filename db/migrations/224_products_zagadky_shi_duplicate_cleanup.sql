-- MIGRATION_KIND: mixed
-- SAFETY: Idempotently normalizes duplicate Event Genix program products named "Загадки ШІ". References move to one canonical row, duplicate product rows are soft-deactivated, and no historical bookings/reports are hard-deleted.
-- ROLLBACK: Reassign references from the canonical row back to exported duplicate IDs if required, then reactivate rows updated_by='migration_224_products_zagadky_shi_duplicate_cleanup' after confirming operator intent.
-- OPERATOR_APPROVAL: required
-- DATA_SCOPE: products rows in business_context='event_genix' and domain='program' where the normalized product name is "Загадки ШІ", grouped within their existing product category.

CREATE TEMP TABLE tmp_products_zagadky_shi_duplicates ON COMMIT DROP AS
WITH candidates AS (
    SELECT
        p.id,
        COALESCE(p.business_context, 'event_genix') AS business_context,
        COALESCE(p.domain, 'program') AS domain_key,
        COALESCE(p.category, '') AS category_key,
        lower(regexp_replace(trim(COALESCE(p.name, '')), '\s+', ' ', 'g')) AS name_key,
        COALESCE(p.is_active, true) AS is_active,
        p.created_at,
        (
            (SELECT COUNT(*) FROM bookings b WHERE b.program_id = p.id) +
            (SELECT COUNT(*) FROM leads l WHERE l.program_id = p.id) +
            (SELECT COUNT(*) FROM recurring_templates rt WHERE rt.product_id = p.id) +
            (SELECT COUNT(*) FROM booking_templates bt WHERE bt.product_id = p.id) +
            (SELECT COUNT(*) FROM price_rules pr WHERE pr.product_id = p.id) +
            (SELECT COUNT(*) FROM product_stock_requirements psr WHERE psr.product_id = p.id) +
            (SELECT COUNT(*) FROM automation_rules ar
             WHERE jsonb_typeof(ar.trigger_condition->'product_ids') = 'array'
               AND ar.trigger_condition->'product_ids' ? p.id)
        )::int AS reference_count
    FROM products p
    WHERE COALESCE(p.business_context, 'event_genix') = 'event_genix'
      AND COALESCE(p.domain, 'program') = 'program'
      AND lower(regexp_replace(trim(COALESCE(p.name, '')), '\s+', ' ', 'g')) = lower('Загадки ШІ')
),
ranked AS (
    SELECT
        c.*,
        FIRST_VALUE(c.id) OVER (
            PARTITION BY c.business_context, c.domain_key, c.category_key, c.name_key
            ORDER BY c.reference_count DESC, c.is_active DESC, c.created_at ASC NULLS LAST, c.id ASC
        ) AS canonical_id,
        COUNT(*) OVER (
            PARTITION BY c.business_context, c.domain_key, c.category_key, c.name_key
        ) AS duplicate_count
    FROM candidates c
)
SELECT *
FROM ranked
WHERE duplicate_count > 1;

UPDATE bookings b
SET program_id = t.canonical_id
FROM tmp_products_zagadky_shi_duplicates t
WHERE t.id <> t.canonical_id
  AND b.program_id = t.id;

UPDATE leads l
SET program_id = t.canonical_id
FROM tmp_products_zagadky_shi_duplicates t
WHERE t.id <> t.canonical_id
  AND l.program_id = t.id;

UPDATE recurring_templates rt
SET product_id = t.canonical_id
FROM tmp_products_zagadky_shi_duplicates t
WHERE t.id <> t.canonical_id
  AND rt.product_id = t.id;

UPDATE booking_templates bt
SET product_id = t.canonical_id,
    product_code = COALESCE(NULLIF(bt.product_code, ''), p.code),
    product_name = COALESCE(NULLIF(bt.product_name, ''), p.name)
FROM tmp_products_zagadky_shi_duplicates t
JOIN products p ON p.id = t.canonical_id
WHERE t.id <> t.canonical_id
  AND bt.product_id = t.id;

UPDATE price_rules pr
SET product_id = t.canonical_id,
    updated_at = NOW(),
    updated_by = COALESCE(pr.updated_by, 'migration_224_products_zagadky_shi_duplicate_cleanup')
FROM tmp_products_zagadky_shi_duplicates t
WHERE t.id <> t.canonical_id
  AND pr.product_id = t.id;

DELETE FROM product_stock_requirements psr
USING tmp_products_zagadky_shi_duplicates t
WHERE t.id <> t.canonical_id
  AND psr.product_id = t.id
  AND psr.stock_id IS NOT NULL
  AND EXISTS (
      SELECT 1
      FROM product_stock_requirements existing
      WHERE existing.product_id = t.canonical_id
        AND existing.stock_id = psr.stock_id
  );

UPDATE product_stock_requirements psr
SET product_id = t.canonical_id,
    updated_at = NOW(),
    updated_by = COALESCE(psr.updated_by, 'migration_224_products_zagadky_shi_duplicate_cleanup')
FROM tmp_products_zagadky_shi_duplicates t
WHERE t.id <> t.canonical_id
  AND psr.product_id = t.id;

WITH rewritten_rules AS (
    SELECT
        ar.id,
        jsonb_set(
            ar.trigger_condition,
            '{product_ids}',
            (
                SELECT jsonb_agg(product_id ORDER BY first_ordinal)
                FROM (
                    SELECT
                        COALESCE(m.canonical_id, ids.value) AS product_id,
                        MIN(ids.ordinality) AS first_ordinal
                    FROM jsonb_array_elements_text(ar.trigger_condition->'product_ids') WITH ORDINALITY AS ids(value, ordinality)
                    LEFT JOIN tmp_products_zagadky_shi_duplicates m
                        ON m.id = ids.value
                       AND m.id <> m.canonical_id
                    GROUP BY COALESCE(m.canonical_id, ids.value)
                ) normalized_ids
            ),
            true
        ) AS trigger_condition
    FROM automation_rules ar
    WHERE jsonb_typeof(ar.trigger_condition->'product_ids') = 'array'
      AND EXISTS (
          SELECT 1
          FROM tmp_products_zagadky_shi_duplicates t
          WHERE t.id <> t.canonical_id
            AND ar.trigger_condition->'product_ids' ? t.id
      )
)
UPDATE automation_rules ar
SET trigger_condition = rr.trigger_condition
FROM rewritten_rules rr
WHERE ar.id = rr.id;

UPDATE products p
SET is_active = CASE WHEN p.id = t.canonical_id THEN true ELSE false END,
    availability_status = CASE WHEN p.id = t.canonical_id THEN 'active' ELSE 'hidden' END,
    updated_at = NOW(),
    updated_by = 'migration_224_products_zagadky_shi_duplicate_cleanup'
FROM tmp_products_zagadky_shi_duplicates t
WHERE p.id = t.id;

CREATE INDEX IF NOT EXISTS idx_products_active_scope_name_key
    ON products (
        COALESCE(business_context, 'event_genix'),
        COALESCE(domain, 'program'),
        category,
        lower(regexp_replace(trim(COALESCE(name, '')), '\s+', ' ', 'g'))
    )
    WHERE COALESCE(is_active, true) = true;
