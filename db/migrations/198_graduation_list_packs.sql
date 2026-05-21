-- MIGRATION_KIND: mixed
-- SAFETY: Additive graduation child-pack table, nullable quote links, and nullable child quote ownership so saved packs can be reused without creating a second child model.
-- ROLLBACK: Drop graduation_child_packs links from graduation_quotes/graduation_children, restore graduation_children.graduation_quote_id NOT NULL only after verifying no standalone pack children remain, then drop graduation_child_packs.
-- OPERATOR_APPROVAL: required
-- DATA_SCOPE: Backfills one default child pack for existing graduation quotes that already have diploma children; no passwords, tokens, finance, or private auth data is changed.

CREATE TABLE IF NOT EXISTS graduation_child_packs (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    institution_label TEXT,
    school_name TEXT,
    class_label TEXT,
    group_label TEXT,
    diploma_context_text TEXT,
    wording_mode TEXT NOT NULL DEFAULT 'standard'
        CHECK (wording_mode IN ('standard', 'institution_graduate')),
    note TEXT,
    graduation_quote_id INTEGER REFERENCES graduation_quotes(id) ON DELETE SET NULL,
    booking_id TEXT,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grad_child_packs_quote ON graduation_child_packs(graduation_quote_id) WHERE graduation_quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grad_child_packs_booking ON graduation_child_packs(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grad_child_packs_active ON graduation_child_packs(is_archived, updated_at DESC);

ALTER TABLE graduation_quotes ADD COLUMN IF NOT EXISTS child_pack_id INTEGER REFERENCES graduation_child_packs(id) ON DELETE SET NULL;
ALTER TABLE graduation_quotes ADD COLUMN IF NOT EXISTS diploma_context_locked BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE graduation_children ALTER COLUMN graduation_quote_id DROP NOT NULL;
ALTER TABLE graduation_children ADD COLUMN IF NOT EXISTS child_pack_id INTEGER REFERENCES graduation_child_packs(id) ON DELETE SET NULL;
ALTER TABLE graduation_children ADD COLUMN IF NOT EXISTS source_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_mode IN ('manual', 'import', 'pack_load', 'merged', 'booking_link'));

CREATE INDEX IF NOT EXISTS idx_grad_children_pack ON graduation_children(child_pack_id, sort_order, id) WHERE child_pack_id IS NOT NULL;

INSERT INTO graduation_child_packs (
    name,
    institution_label,
    diploma_context_text,
    wording_mode,
    graduation_quote_id,
    booking_id,
    created_by
)
SELECT
    COALESCE(NULLIF(q.quote_number, ''), CONCAT('graduation-', q.id)),
    COALESCE(NULLIF(q.quote_number, ''), CONCAT('Graduation ', q.id)),
    COALESCE(NULLIF(q.quote_number, ''), CONCAT('Graduation ', q.id)),
    'standard',
    q.id,
    q.booking_id,
    q.created_by
FROM graduation_quotes q
WHERE EXISTS (
    SELECT 1 FROM graduation_children c
    WHERE c.graduation_quote_id = q.id
)
AND NOT EXISTS (
    SELECT 1 FROM graduation_child_packs p
    WHERE p.graduation_quote_id = q.id
);

UPDATE graduation_quotes q
SET child_pack_id = p.id
FROM graduation_child_packs p
WHERE p.graduation_quote_id = q.id
  AND q.child_pack_id IS NULL;

UPDATE graduation_children c
SET child_pack_id = q.child_pack_id,
    source_mode = COALESCE(c.source_mode, 'manual')
FROM graduation_quotes q
WHERE c.graduation_quote_id = q.id
  AND q.child_pack_id IS NOT NULL
  AND c.child_pack_id IS NULL;
