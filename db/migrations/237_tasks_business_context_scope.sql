-- MIGRATION_KIND: schema
-- SAFETY: Additive business_context scope for Tasks OS. Existing rows remain visible in the default Event Genix context unless they can be safely inferred from linked bookings, leads, customers, conversations, reports, or source entities. No task, subtask, log, dependency, or history rows are deleted.
-- ROLLBACK: Export non-event_genix task rows created after this migration, drop the scoped indexes, then drop tasks.business_context only if the task engine is intentionally returned to a global model.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

UPDATE tasks
   SET business_context = 'event_genix'
 WHERE business_context IS NULL OR trim(business_context) = '';

UPDATE tasks t
   SET business_context = COALESCE(b.business_context, t.business_context, 'event_genix')
  FROM bookings b
 WHERE t.source_type = 'booking'
   AND t.source_id = b.id::text
   AND COALESCE(t.business_context, 'event_genix') IS DISTINCT FROM COALESCE(b.business_context, 'event_genix');

UPDATE tasks t
   SET business_context = COALESCE(l.business_context, t.business_context, 'event_genix')
  FROM leads l
 WHERE (
        (t.source_type = 'lead' AND t.source_id = l.id::text)
        OR (t.source_entity_type = 'lead' AND t.source_entity_id = l.id::text)
       )
   AND COALESCE(t.business_context, 'event_genix') IS DISTINCT FROM COALESCE(l.business_context, 'event_genix');

UPDATE tasks t
   SET business_context = COALESCE(c.business_context, t.business_context, 'event_genix')
  FROM customers c
 WHERE t.source_entity_type = 'customer'
   AND t.source_entity_id = c.id::text
   AND COALESCE(t.business_context, 'event_genix') IS DISTINCT FROM COALESCE(c.business_context, 'event_genix');

UPDATE tasks t
   SET business_context = COALESCE(r.business_context, t.business_context, 'event_genix')
  FROM reports r
 WHERE (
        (t.source_type = 'report' AND t.source_id = r.id::text)
        OR (t.source_entity_type = 'report' AND t.source_entity_id = r.id::text)
       )
   AND COALESCE(t.business_context, 'event_genix') IS DISTINCT FROM COALESCE(r.business_context, 'event_genix');

UPDATE tasks t
   SET business_context = COALESCE(cnv.business_context, t.business_context, 'event_genix')
  FROM conversations cnv
 WHERE t.related_entity_type = 'conversation'
   AND t.related_entity_id = cnv.id::text
   AND COALESCE(t.business_context, 'event_genix') IS DISTINCT FROM COALESCE(cnv.business_context, 'event_genix');

CREATE INDEX IF NOT EXISTS idx_tasks_business_status_date
    ON tasks(business_context, status, date);

CREATE INDEX IF NOT EXISTS idx_tasks_business_owner_active
    ON tasks(business_context, owner_user_id, status, deadline)
    WHERE COALESCE(status, 'todo') NOT IN ('done','cancelled','archived');

CREATE INDEX IF NOT EXISTS idx_tasks_business_completed_at
    ON tasks(business_context, completed_at)
    WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_business_source
    ON tasks(business_context, source_type, source_id)
    WHERE source_type IS NOT NULL OR source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_business_entity
    ON tasks(business_context, source_entity_type, source_entity_id)
    WHERE source_entity_type IS NOT NULL AND source_entity_id IS NOT NULL;
