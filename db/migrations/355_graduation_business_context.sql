-- MIGRATION_KIND: schema
-- SAFETY: Adds business_context ownership to graduation tables, backfills legacy rows to event_genix, and replaces only global identity constraints that would block per-business graduation catalogs. No production data is deleted or reassigned away from the legacy default owner.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Drop the v355 business-context indexes/constraints and business_context columns only after exporting any per-business graduation data that must be preserved.

ALTER TABLE graduation_settings ADD COLUMN IF NOT EXISTS business_context TEXT NOT NULL DEFAULT 'event_genix';
ALTER TABLE graduation_services ADD COLUMN IF NOT EXISTS business_context TEXT NOT NULL DEFAULT 'event_genix';
ALTER TABLE graduation_packages ADD COLUMN IF NOT EXISTS business_context TEXT NOT NULL DEFAULT 'event_genix';
ALTER TABLE graduation_package_items ADD COLUMN IF NOT EXISTS business_context TEXT NOT NULL DEFAULT 'event_genix';
ALTER TABLE graduation_quotes ADD COLUMN IF NOT EXISTS business_context TEXT NOT NULL DEFAULT 'event_genix';
ALTER TABLE graduation_child_packs ADD COLUMN IF NOT EXISTS business_context TEXT NOT NULL DEFAULT 'event_genix';
ALTER TABLE graduation_children ADD COLUMN IF NOT EXISTS business_context TEXT NOT NULL DEFAULT 'event_genix';
ALTER TABLE graduation_diploma_templates ADD COLUMN IF NOT EXISTS business_context TEXT NOT NULL DEFAULT 'event_genix';
ALTER TABLE graduation_diploma_exports ADD COLUMN IF NOT EXISTS business_context TEXT NOT NULL DEFAULT 'event_genix';
ALTER TABLE graduation_automation_state ADD COLUMN IF NOT EXISTS business_context TEXT NOT NULL DEFAULT 'event_genix';

UPDATE graduation_package_items item
SET business_context = COALESCE(pkg.business_context, 'event_genix')
FROM graduation_packages pkg
WHERE item.package_id = pkg.id
  AND COALESCE(item.business_context, 'event_genix') IS DISTINCT FROM COALESCE(pkg.business_context, 'event_genix');

UPDATE graduation_child_packs pack
SET business_context = COALESCE(q.business_context, pack.business_context, 'event_genix')
FROM graduation_quotes q
WHERE pack.graduation_quote_id = q.id
  AND COALESCE(pack.business_context, 'event_genix') IS DISTINCT FROM COALESCE(q.business_context, 'event_genix');

UPDATE graduation_children child
SET business_context = COALESCE(q.business_context, child.business_context, 'event_genix')
FROM graduation_quotes q
WHERE child.graduation_quote_id = q.id
  AND COALESCE(child.business_context, 'event_genix') IS DISTINCT FROM COALESCE(q.business_context, 'event_genix');

UPDATE graduation_children child
SET business_context = COALESCE(pack.business_context, child.business_context, 'event_genix')
FROM graduation_child_packs pack
WHERE child.child_pack_id = pack.id
  AND child.graduation_quote_id IS NULL
  AND COALESCE(child.business_context, 'event_genix') IS DISTINCT FROM COALESCE(pack.business_context, 'event_genix');

UPDATE graduation_diploma_exports export
SET business_context = COALESCE(q.business_context, export.business_context, 'event_genix')
FROM graduation_quotes q
WHERE export.graduation_quote_id = q.id
  AND COALESCE(export.business_context, 'event_genix') IS DISTINCT FROM COALESCE(q.business_context, 'event_genix');

UPDATE graduation_automation_state state
SET business_context = COALESCE(q.business_context, state.business_context, 'event_genix')
FROM graduation_quotes q
WHERE state.graduation_quote_id = q.id
  AND COALESCE(state.business_context, 'event_genix') IS DISTINCT FROM COALESCE(q.business_context, 'event_genix');

ALTER TABLE graduation_settings DROP CONSTRAINT IF EXISTS graduation_settings_pkey;
ALTER TABLE graduation_services DROP CONSTRAINT IF EXISTS graduation_services_name_key;
ALTER TABLE graduation_packages DROP CONSTRAINT IF EXISTS graduation_packages_slug_key;
ALTER TABLE graduation_quotes DROP CONSTRAINT IF EXISTS graduation_quotes_quote_number_key;
ALTER TABLE graduation_diploma_templates DROP CONSTRAINT IF EXISTS graduation_diploma_templates_code_key;
DROP INDEX IF EXISTS uniq_grad_diploma_default_active;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'graduation_settings'::regclass
          AND conname = 'pk_graduation_settings_business_key_v355'
    ) THEN
        ALTER TABLE graduation_settings
            ADD CONSTRAINT pk_graduation_settings_business_key_v355 PRIMARY KEY (business_context, key);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'graduation_services'::regclass
          AND conname = 'uq_graduation_services_business_name_v355'
    ) THEN
        ALTER TABLE graduation_services
            ADD CONSTRAINT uq_graduation_services_business_name_v355 UNIQUE (business_context, name);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'graduation_packages'::regclass
          AND conname = 'uq_graduation_packages_business_slug_v355'
    ) THEN
        ALTER TABLE graduation_packages
            ADD CONSTRAINT uq_graduation_packages_business_slug_v355 UNIQUE (business_context, slug);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'graduation_quotes'::regclass
          AND conname = 'uq_graduation_quotes_business_number_v355'
    ) THEN
        ALTER TABLE graduation_quotes
            ADD CONSTRAINT uq_graduation_quotes_business_number_v355 UNIQUE (business_context, quote_number);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'graduation_diploma_templates'::regclass
          AND conname = 'uq_graduation_diploma_templates_business_code_v355'
    ) THEN
        ALTER TABLE graduation_diploma_templates
            ADD CONSTRAINT uq_graduation_diploma_templates_business_code_v355 UNIQUE (business_context, code);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_grad_diploma_default_active_business_v355
    ON graduation_diploma_templates (business_context)
    WHERE is_default = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_grad_settings_business_v355 ON graduation_settings (business_context, key);
CREATE INDEX IF NOT EXISTS idx_grad_services_business_active_v355 ON graduation_services (business_context, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_grad_packages_business_active_v355 ON graduation_packages (business_context, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_grad_package_items_business_package_v355 ON graduation_package_items (business_context, package_id, service_id);
CREATE INDEX IF NOT EXISTS idx_grad_quotes_business_status_v355 ON graduation_quotes (business_context, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_grad_quotes_business_number_v355 ON graduation_quotes (business_context, quote_number);
CREATE INDEX IF NOT EXISTS idx_grad_child_packs_business_quote_v355 ON graduation_child_packs (business_context, graduation_quote_id) WHERE graduation_quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grad_child_packs_business_active_v355 ON graduation_child_packs (business_context, is_archived, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_grad_children_business_quote_v355 ON graduation_children (business_context, graduation_quote_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_grad_children_business_pack_v355 ON graduation_children (business_context, child_pack_id, sort_order, id) WHERE child_pack_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grad_diploma_exports_business_quote_v355 ON graduation_diploma_exports (business_context, graduation_quote_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_grad_automation_state_business_due_v355 ON graduation_automation_state (business_context, automation_key, scheduled_for) WHERE state IN ('scheduled','blocked');
