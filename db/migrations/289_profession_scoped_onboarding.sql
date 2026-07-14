-- MIGRATION_KIND: schema
-- SAFETY: Additive nullable scope column plus preflight duplicate guards and partial unique indexes. Legacy onboarding rows remain general with profession_key = NULL; no production rows are rewritten or removed.
-- ROLLBACK: Before dropping profession_key, export any profession-scoped onboarding rows and disable scoped writes. Then drop the two partial unique indexes, the non-blank check constraint, and the column.

ALTER TABLE onboarding_progress
    ADD COLUMN IF NOT EXISTS profession_key VARCHAR(64);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM onboarding_progress
        WHERE profession_key IS NULL
          AND status <> 'completed'
        GROUP BY staff_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Migration 289 blocked: duplicate active general onboarding_progress rows exist';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM onboarding_progress
        WHERE profession_key IS NOT NULL
          AND status <> 'completed'
        GROUP BY staff_id, profession_key
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Migration 289 blocked: duplicate active profession onboarding_progress rows exist';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_onboarding_progress_profession_key_nonblank_v289'
    ) THEN
        ALTER TABLE onboarding_progress
            ADD CONSTRAINT chk_onboarding_progress_profession_key_nonblank_v289
            CHECK (profession_key IS NULL OR BTRIM(profession_key) <> '');
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_progress_active_general_v289
    ON onboarding_progress(staff_id)
    WHERE profession_key IS NULL
      AND status <> 'completed';

CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_progress_active_profession_v289
    ON onboarding_progress(staff_id, profession_key)
    WHERE profession_key IS NOT NULL
      AND status <> 'completed';

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_profession_v289
    ON onboarding_progress(profession_key, started_at DESC)
    WHERE profession_key IS NOT NULL;

COMMENT ON COLUMN onboarding_progress.profession_key IS
    'NULL for general corporate onboarding; normalized hr_professions.key for profession-scoped onboarding.';
