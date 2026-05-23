-- MIGRATION_KIND: schema
-- SAFETY: Additive products.business_context scope and scoped indexes. Existing product rows keep the legacy Event Genix context; Maysternya Doli gets its own seeded consultation products.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Delete or export maysternya_doli products, drop idx_products_business_* indexes, then drop products.business_context if no non-event_genix products remain.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

UPDATE products
SET business_context = 'event_genix'
WHERE business_context IS NULL OR business_context = '';

CREATE INDEX IF NOT EXISTS idx_products_business_active
    ON products(business_context, is_active);

CREATE INDEX IF NOT EXISTS idx_products_business_domain_category
    ON products(business_context, domain, category, sort_order);

CREATE INDEX IF NOT EXISTS idx_products_business_code
    ON products(business_context, code);

INSERT INTO products (
    id, business_context, code, label, name, icon, category, duration, price, hosts,
    description, domain, kitchen_type, availability_status,
    is_per_child, has_filler, is_custom, is_active, sort_order, updated_by
) VALUES
    (
        'md_demo_consult_15', 'maysternya_doli', 'Демо', 'Демо консультація(15)',
        'Демо консультація', '◇', 'custom', 15, 0, 1,
        'Коротка демо консультація на 15 хвилин.',
        'program', NULL, 'active', false, false, false, true, 1, 'migration_209'
    ),
    (
        'md_full_consult_40', 'maysternya_doli', 'Повна', 'Повна консультація(90)',
        'Повна консультація', '◆', 'custom', 90, 0, 1,
        'Повна консультація на 90 хвилин.',
        'program', NULL, 'active', false, false, false, true, 2, 'migration_209'
    )
ON CONFLICT (id) DO UPDATE SET
    business_context = EXCLUDED.business_context,
    label = EXCLUDED.label,
    name = EXCLUDED.name,
    duration = EXCLUDED.duration,
    description = EXCLUDED.description,
    domain = EXCLUDED.domain,
    kitchen_type = EXCLUDED.kitchen_type,
    availability_status = EXCLUDED.availability_status,
    is_active = EXCLUDED.is_active,
    updated_at = NOW(),
    updated_by = EXCLUDED.updated_by
WHERE products.business_context IN ('event_genix', 'maysternya_doli');
