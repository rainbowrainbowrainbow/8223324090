-- MIGRATION_KIND: mixed
-- SAFETY: Additive graduation diploma tables and nullable quote timing columns; idempotent with IF NOT EXISTS and ON CONFLICT guards.
-- ROLLBACK: Drop graduation_diploma_exports, graduation_children, graduation_diploma_templates and remove added graduation_quotes timing columns if operator rollback is required.
-- DATA_SCOPE: Seeds one non-user-facing default diploma template code classic-graduation-2026; no customer, staff, finance, or private user data is changed.

CREATE TABLE IF NOT EXISTS graduation_diploma_templates (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_default BOOLEAN DEFAULT false,
    title_text TEXT NOT NULL DEFAULT 'Диплом випускника',
    subtitle_text TEXT,
    footer_text TEXT,
    principal_name TEXT,
    principal_role TEXT,
    palette_json JSONB DEFAULT '{}'::jsonb,
    layout_json JSONB DEFAULT '{}'::jsonb,
    artwork_image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_grad_diploma_default_active
    ON graduation_diploma_templates (is_default)
    WHERE is_default = true AND is_active = true;

CREATE TABLE IF NOT EXISTS graduation_children (
    id SERIAL PRIMARY KEY,
    graduation_quote_id INTEGER NOT NULL REFERENCES graduation_quotes(id) ON DELETE CASCADE,
    booking_id TEXT,
    full_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    gender TEXT NOT NULL DEFAULT 'unspecified'
        CHECK (gender IN ('boy', 'girl', 'neutral', 'unspecified')),
    gender_source TEXT NOT NULL DEFAULT 'unknown'
        CHECK (gender_source IN ('manual', 'suggested', 'imported', 'unknown')),
    gender_confidence TEXT,
    class_label TEXT,
    custom_wish TEXT,
    auto_wish TEXT,
    final_wish TEXT,
    diploma_title_override TEXT,
    diploma_status TEXT NOT NULL DEFAULT 'draft'
        CHECK (diploma_status IN ('draft', 'generated', 'printed', 'exported')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grad_children_quote ON graduation_children(graduation_quote_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_grad_children_booking ON graduation_children(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grad_children_status ON graduation_children(diploma_status);

CREATE TABLE IF NOT EXISTS graduation_diploma_exports (
    id SERIAL PRIMARY KEY,
    graduation_quote_id INTEGER NOT NULL REFERENCES graduation_quotes(id) ON DELETE CASCADE,
    template_id INTEGER REFERENCES graduation_diploma_templates(id) ON DELETE SET NULL,
    export_kind TEXT NOT NULL CHECK (export_kind IN ('pdf_batch', 'pdf_single', 'print_sheet', 'csv', 'xlsx')),
    file_url TEXT,
    children_count INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grad_diploma_exports_quote ON graduation_diploma_exports(graduation_quote_id, created_at DESC);

ALTER TABLE graduation_quotes ADD COLUMN IF NOT EXISTS event_date DATE;
ALTER TABLE graduation_quotes ADD COLUMN IF NOT EXISTS event_start_time VARCHAR(10);
ALTER TABLE graduation_quotes ADD COLUMN IF NOT EXISTS event_end_time VARCHAR(10);
ALTER TABLE graduation_quotes ADD COLUMN IF NOT EXISTS event_time_mode TEXT DEFAULT 'floating'
    CHECK (event_time_mode IN ('manual', 'preset', 'floating'));
ALTER TABLE graduation_quotes ADD COLUMN IF NOT EXISTS service_timing JSONB DEFAULT '[]'::jsonb;

INSERT INTO graduation_diploma_templates (
    code,
    name,
    is_default,
    title_text,
    subtitle_text,
    footer_text,
    principal_name,
    principal_role,
    palette_json,
    layout_json,
    is_active
) VALUES (
    'classic-graduation-2026',
    'Класичний диплом випускника',
    true,
    'Диплом випускника',
    'за яскравий випускний, сміливість мріяти та готовність до нових відкриттів',
    'Парк Закревського періоду',
    'Команда Event Genix',
    'організатори випускного',
    '{"paper":"#fbf2dc","ink":"#2f2415","muted":"#7b6848","gold":"#b8860b","goldSoft":"#ecd68a","accent":"#7c2d12"}'::jsonb,
    '{"format":"a4-landscape","signatureLeft":"Класний керівник","signatureRight":"Організатор свята"}'::jsonb,
    true
) ON CONFLICT (code) DO UPDATE SET
    is_default = EXCLUDED.is_default,
    is_active = true,
    updated_at = NOW();
