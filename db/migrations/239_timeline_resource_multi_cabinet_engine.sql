-- MIGRATION_KIND: schema
-- SAFETY: Adds an additive timeline_resources table for durable timeline resource rows. Existing bookings and lines_by_date rows are not deleted or reassigned; park timelines keep the legacy lines_by_date flow.
-- ROLLBACK: Export non-default timeline_resources rows created after this migration, then DROP INDEX idx_timeline_resources_business_type_active; DROP INDEX idx_timeline_resources_business_sort; DROP TABLE timeline_resources if the resource engine is intentionally reverted.

CREATE TABLE IF NOT EXISTS timeline_resources (
    id SERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix',
    resource_id VARCHAR(100) NOT NULL,
    type VARCHAR(32) NOT NULL DEFAULT 'cabinet',
    name VARCHAR(120) NOT NULL,
    short_name VARCHAR(60),
    color VARCHAR(20),
    capacity INTEGER,
    equipment JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (business_context, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_timeline_resources_business_type_active
    ON timeline_resources(business_context, type, is_active, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_timeline_resources_business_sort
    ON timeline_resources(business_context, sort_order, name);

INSERT INTO timeline_resources
    (business_context, resource_id, type, name, short_name, color, capacity, equipment, sort_order, metadata)
VALUES
    ('event_genix', 'edu-cabinet-1', 'cabinet', 'Кабінет 1', 'Каб. 1', '#10B981', 8, '[]'::jsonb, 10, '{"source":"default_education"}'::jsonb),
    ('event_genix', 'edu-cabinet-2', 'cabinet', 'Кабінет 2', 'Каб. 2', '#3B82F6', 10, '[]'::jsonb, 20, '{"source":"default_education"}'::jsonb),
    ('event_genix', 'edu-cabinet-3', 'cabinet', 'Кабінет 3', 'Каб. 3', '#F97316', 12, '[]'::jsonb, 30, '{"source":"default_education"}'::jsonb),
    ('event_genix', 'specialist-main', 'specialist', 'Спеціаліст', 'Спец.', '#0EA586', 1, '[]'::jsonb, 10, '{"source":"default_specialist"}'::jsonb),
    ('maysternya_doli', 'md-consult-room', 'specialist', 'Олександр', 'Олександр', '#0EA586', 1, '["online"]'::jsonb, 10, '{"source":"maysternya_default","online":true}'::jsonb)
ON CONFLICT (business_context, resource_id) DO NOTHING;

INSERT INTO timeline_resources
    (business_context, resource_id, type, name, short_name, color, capacity, equipment, sort_order, metadata)
SELECT
    COALESCE(l.business_context, 'maysternya_doli'),
    l.line_id,
    'specialist',
    l.name,
    l.name,
    COALESCE(l.color, '#0EA586'),
    1,
    '["online"]'::jsonb,
    10,
    '{"source":"lines_by_date_backfill","online":true}'::jsonb
FROM lines_by_date l
WHERE COALESCE(l.business_context, 'event_genix') = 'maysternya_doli'
  AND l.line_id = 'md-consult-room'
ON CONFLICT (business_context, resource_id) DO UPDATE SET
    name = EXCLUDED.name,
    short_name = EXCLUDED.short_name,
    color = EXCLUDED.color,
    updated_at = NOW();
