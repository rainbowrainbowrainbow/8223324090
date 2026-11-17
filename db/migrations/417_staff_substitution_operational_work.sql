-- MIGRATION_KIND: schema
-- SAFETY: Adds an empty registry for explicit Park operational task links. No legacy assignee is mapped or rewritten.
-- ROLLBACK: Disable registration and preserve existing task and substitution history.

CREATE TABLE IF NOT EXISTS staff_substitution_operational_work (
    id BIGSERIAL PRIMARY KEY,
    source_type TEXT NOT NULL CHECK (source_type IN ('support_ticket','content_item','training_delivery','report_preparation')),
    source_id INTEGER NOT NULL,
    work_date DATE NOT NULL,
    task_id INTEGER NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
    registered_staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
    registered_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_type, source_id, work_date)
);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname='staff_substitution_operational_work_immutable_v417'
          AND tgrelid='staff_substitution_operational_work'::regclass
    ) THEN
        CREATE TRIGGER staff_substitution_operational_work_immutable_v417 BEFORE UPDATE OR DELETE
            ON staff_substitution_operational_work FOR EACH ROW EXECUTE FUNCTION protect_staff_substitution_history_v392();
    END IF;
END;
$migration$;
