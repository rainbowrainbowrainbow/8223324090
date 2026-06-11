-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotently seeds Event Genix room resources for the room-first timeline. Existing bookings and animator lines are not deleted or reassigned.
-- ROLLBACK: UPDATE timeline_resources SET is_active = FALSE, updated_at = NOW() WHERE business_context = 'event_genix' AND type = 'room' AND metadata->>'source' = 'migration_263_room_timeline_resources';

INSERT INTO timeline_resources
    (business_context, resource_id, type, name, short_name, color, capacity, equipment, is_active, sort_order, metadata)
VALUES
    ('event_genix', 'room-marvel', 'room', 'Марвел', 'Марвел', '#10B981', NULL, '[]'::jsonb, TRUE, 10, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-ninja', 'room', 'Ніндзя', 'Ніндзя', '#3B82F6', NULL, '[]'::jsonb, TRUE, 20, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-minecraft', 'room', 'Майнкрафт', 'Майнкрафт', '#F97316', NULL, '[]'::jsonb, TRUE, 30, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-monster-high', 'room', 'Монстер Хай', 'Монстер Хай', '#8B5CF6', NULL, '[]'::jsonb, TRUE, 40, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-elza', 'room', 'Ельза', 'Ельза', '#06B6D4', NULL, '[]'::jsonb, TRUE, 50, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-rastishka', 'room', 'Растішка', 'Растішка', '#84CC16', NULL, '[]'::jsonb, TRUE, 60, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-rock', 'room', 'Рок', 'Рок', '#EC4899', NULL, '[]'::jsonb, TRUE, 70, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-minion', 'room', 'Міньйон', 'Міньйон', '#EAB308', NULL, '[]'::jsonb, TRUE, 80, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-pony', 'room', 'Поні', 'Поні', '#F43F5E', NULL, '[]'::jsonb, TRUE, 90, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-foodcourt', 'room', 'Фудкорт', 'Фудкорт', '#14B8A6', NULL, '[]'::jsonb, TRUE, 100, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-yellow-table', 'room', 'Жовтий стіл', 'Жовтий стіл', '#FACC15', NULL, '[]'::jsonb, TRUE, 110, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-sofa-1', 'room', 'Диван 1', 'Диван 1', '#64748B', NULL, '[]'::jsonb, TRUE, 120, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-sofa-2', 'room', 'Диван 2', 'Диван 2', '#64748B', NULL, '[]'::jsonb, TRUE, 130, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-sofa-3', 'room', 'Диван 3', 'Диван 3', '#64748B', NULL, '[]'::jsonb, TRUE, 140, '{"source":"migration_263_room_timeline_resources"}'::jsonb),
    ('event_genix', 'room-sofa-4', 'room', 'Диван 4', 'Диван 4', '#64748B', NULL, '[]'::jsonb, TRUE, 150, '{"source":"migration_263_room_timeline_resources"}'::jsonb)
ON CONFLICT (business_context, resource_id) DO UPDATE SET
    type = EXCLUDED.type,
    name = EXCLUDED.name,
    short_name = EXCLUDED.short_name,
    color = EXCLUDED.color,
    sort_order = EXCLUDED.sort_order,
    is_active = TRUE,
    metadata = timeline_resources.metadata || EXCLUDED.metadata,
    updated_at = NOW();
