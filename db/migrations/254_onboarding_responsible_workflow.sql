-- MIGRATION_KIND: schema
-- SAFETY: Additive onboarding assignment workflow fields and indexes. Existing onboarding rows are preserved; legacy status values remain compatible.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Drop the added onboarding_progress columns/indexes and the seeded responsible onboarding template after exporting any assignment history that must be retained.

ALTER TABLE onboarding_progress
    ADD COLUMN IF NOT EXISTS responsible_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS assigned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS assigned_by_username VARCHAR(100),
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reassigned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS training_status VARCHAR(20) DEFAULT 'not_started',
    ADD COLUMN IF NOT EXISTS assignment_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS checklist_template_key VARCHAR(80),
    ADD COLUMN IF NOT EXISTS last_task_sync_at TIMESTAMPTZ;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'onboarding_progress_status_check'
    ) THEN
        ALTER TABLE onboarding_progress DROP CONSTRAINT onboarding_progress_status_check;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_onboarding_progress_status_v254'
    ) THEN
        ALTER TABLE onboarding_progress ADD CONSTRAINT chk_onboarding_progress_status_v254
            CHECK (status IN ('in_progress', 'completed', 'blocked', 'ready'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_onboarding_progress_training_status_v254'
    ) THEN
        ALTER TABLE onboarding_progress ADD CONSTRAINT chk_onboarding_progress_training_status_v254
            CHECK (training_status IN ('not_started', 'in_progress', 'blocked', 'ready', 'completed'));
    END IF;
END $$;

UPDATE onboarding_progress
SET training_status = CASE
        WHEN status = 'completed' THEN 'completed'
        WHEN completed_items > 0 THEN 'in_progress'
        ELSE COALESCE(training_status, 'not_started')
    END,
    assigned_at = COALESCE(assigned_at, started_at)
WHERE training_status IS NULL
   OR training_status NOT IN ('not_started', 'in_progress', 'blocked', 'ready', 'completed');

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_staff_active_v254
    ON onboarding_progress(staff_id, started_at DESC)
    WHERE status <> 'completed';

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_responsible_v254
    ON onboarding_progress(responsible_user_id)
    WHERE responsible_user_id IS NOT NULL AND status <> 'completed';

INSERT INTO onboarding_templates (name, department, items)
SELECT 'Відповідальний онбординг', NULL, '[
  {"key":"role_intro","title":"Вступ у роль","description":"Пояснити роль, очікування, зону відповідальності та перший робочий результат."},
  {"key":"access_tools","title":"Доступи та інструменти","description":"Видати CRM-доступи, показати робочі інструменти, матеріали й канали комунікації."},
  {"key":"rules_safety","title":"Правила, безпека і регламенти","description":"Провести інструктаж з правил компанії, безпеки, дисципліни та операційних регламентів."},
  {"key":"communication","title":"Стандарти комунікації","description":"Пояснити стандарти спілкування з гостями, командою, керівником і клієнтами."},
  {"key":"shadowing","title":"Shadowing, демо і практика під наглядом","description":"Провести демонстрацію, дати стажеру практику під контролем відповідального."},
  {"key":"readiness","title":"Підтвердження готовності","description":"Перевірити навички, закрити питання і підтвердити готовність до самостійної роботи."}
]'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM onboarding_templates WHERE name = 'Відповідальний онбординг'
);
