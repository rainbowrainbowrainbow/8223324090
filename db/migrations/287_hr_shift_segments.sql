-- MIGRATION_KIND: mixed
-- SAFETY: Additive normalized HR shift segments with a transactional, idempotent backfill. Existing hr_shifts, staff_schedule, hr_time_records, and their one-row-per-day constraints are not changed. The migration fails before DDL/backfill if legacy shift data cannot satisfy the new required segment fields.
-- ROLLBACK: Export hr_shift_segment_roles and hr_shift_segments if operators have started using them, then drop hr_shift_segment_roles followed by hr_shift_segments. Parent HR shifts, schedule rows, attendance rows, and their existing constraints remain unchanged.
-- DATA_SCOPE: Every hr_shifts row existing when this migration runs is represented by one equivalent primary-role segment; no staff_schedule-only rows or recruiting vacancies are materialized.

-- Release prerequisite: application writers must create segments and maintain the
-- hr_shifts envelope in the same transaction. This migration only backfills rows
-- present while the lock below is held; it intentionally adds no DB trigger.

-- Keep the preflight and backfill stable against concurrent staff, HR-shift, and
-- schedule writes. The order matches the runtime lock hierarchy. The migration
-- runner already wraps this file in one transaction.
LOCK TABLE staff, hr_shifts, staff_schedule IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    missing_profession_count BIGINT;
    noncanonical_profession_count BIGINT;
    zero_length_count BIGINT;
    null_break_count BIGINT;
    negative_break_count BIGINT;
    oversized_break_count BIGINT;
    non_minute_time_count BIGINT;
    noncanonical_schedule_profession_count BIGINT;
    unassigned_schedule_profession_count BIGINT;
BEGIN
    SELECT
        COUNT(*) FILTER (
            WHERE profession_key IS NULL OR BTRIM(profession_key) = ''
        ),
        COUNT(*) FILTER (
            WHERE profession_key IS NOT NULL
              AND (
                  profession_key <> LOWER(BTRIM(profession_key))
                  OR BTRIM(profession_key) !~ '^[a-z0-9_:-]{1,64}$'
              )
        ),
        COUNT(*) FILTER (
            WHERE planned_start = planned_end
        ),
        COUNT(*) FILTER (
            WHERE break_minutes IS NULL
        ),
        COUNT(*) FILTER (
            WHERE break_minutes < 0
        ),
        COUNT(*) FILTER (
            WHERE break_minutes > EXTRACT(EPOCH FROM (
                (
                    DATE '2000-01-01' + planned_end
                    + CASE
                        WHEN planned_end <= planned_start THEN INTERVAL '1 day'
                        ELSE INTERVAL '0 day'
                      END
                ) - (DATE '2000-01-01' + planned_start)
            )) / 60
        ),
        COUNT(*) FILTER (
            WHERE EXTRACT(HOUR FROM planned_start) = 24
               OR EXTRACT(HOUR FROM planned_end) = 24
               OR EXTRACT(SECOND FROM planned_start) <> 0
               OR EXTRACT(SECOND FROM planned_end) <> 0
        )
    INTO
        missing_profession_count,
        noncanonical_profession_count,
        zero_length_count,
        null_break_count,
        negative_break_count,
        oversized_break_count,
        non_minute_time_count
    FROM hr_shifts;

    WITH eligible_schedule_rows AS (
        SELECT COALESCE(
                   NULLIF(BTRIM(ss.profession_key), ''),
                   NULLIF(BTRIM(s.role_type), '')
               ) AS profession_key,
               s.role_type,
               COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions
        FROM staff_schedule ss
        JOIN staff s ON s.id = ss.staff_id
        LEFT JOIN hr_shifts hs
          ON hs.staff_id = ss.staff_id
         AND hs.shift_date::text = LEFT(ss.date::text, 10)
        WHERE ss.status IN ('working', 'remote')
          AND LEFT(ss.date::text, 10) ~ '^\d{4}-\d{2}-\d{2}$'
          AND LEFT(ss.shift_start::text, 5) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          AND LEFT(ss.shift_end::text, 5) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          AND LEFT(ss.shift_start::text, 5) <> LEFT(ss.shift_end::text, 5)
          AND COALESCE(
                  NULLIF(BTRIM(ss.profession_key), ''),
                  NULLIF(BTRIM(s.role_type), '')
              ) IS NOT NULL
          AND s.is_active = true
          AND COALESCE(s.hr_pool_status, 'core') = 'core'
          AND COALESCE(s.is_freelance, false) = false
          AND (
              s.termination_date IS NULL
              OR s.termination_date::date > LEFT(ss.date::text, 10)::date
          )
          AND hs.id IS NULL
    )
    SELECT
        COUNT(*) FILTER (
            WHERE profession_key <> LOWER(BTRIM(profession_key))
               OR BTRIM(profession_key) !~ '^[a-z0-9_:-]{1,64}$'
        ),
        COUNT(*) FILTER (
            WHERE profession_key <> LOWER(LEFT(
                      REGEXP_REPLACE(
                          REGEXP_REPLACE(BTRIM(COALESCE(role_type, '')), '[[:space:]]+', '_', 'g'),
                          '[^a-zA-Z0-9_:-]',
                          '',
                          'g'
                      ),
                      64
                  ))
              AND NOT EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(secondary_professions) AS secondary(value)
                  WHERE profession_key = LOWER(LEFT(
                            REGEXP_REPLACE(
                                REGEXP_REPLACE(BTRIM(secondary.value), '[[:space:]]+', '_', 'g'),
                                '[^a-zA-Z0-9_:-]',
                                '',
                                'g'
                            ),
                            64
                        ))
              )
        )
    INTO
        noncanonical_schedule_profession_count,
        unassigned_schedule_profession_count
    FROM eligible_schedule_rows;

    IF missing_profession_count > 0 THEN
        RAISE EXCEPTION
            'Migration 287 cannot backfill % hr_shifts rows without profession_key',
            missing_profession_count
            USING HINT = 'Resolve the primary profession in hr_shifts before retrying; the migration will not invent a fallback role.';
    END IF;

    IF noncanonical_profession_count > 0 THEN
        RAISE EXCEPTION
            'Migration 287 cannot backfill % hr_shifts rows with noncanonical profession_key',
            noncanonical_profession_count
            USING HINT = 'Normalize legacy keys to lowercase [a-z0-9_:-] before retrying; the migration will not rewrite business roles implicitly.';
    END IF;

    IF noncanonical_schedule_profession_count > 0 THEN
        RAISE EXCEPTION
            'Migration 287 found % eligible staff_schedule-only rows with noncanonical profession_key',
            noncanonical_schedule_profession_count
            USING HINT = 'Normalize the effective schedule profession key before retrying; read-side HR backfill uses strict profession keys.';
    END IF;

    IF unassigned_schedule_profession_count > 0 THEN
        RAISE EXCEPTION
            'Migration 287 found % eligible staff_schedule-only rows whose profession is absent from the staff HR card',
            unassigned_schedule_profession_count
            USING HINT = 'Add each effective schedule profession to role_type or secondary_professions before retrying; the migration will not change staff role assignments.';
    END IF;

    IF zero_length_count > 0 THEN
        RAISE EXCEPTION
            'Migration 287 cannot backfill % zero-length hr_shifts rows',
            zero_length_count
            USING HINT = 'Resolve planned_start = planned_end before retrying; overnight shifts remain supported when start and end differ.';
    END IF;

    IF null_break_count > 0 THEN
        RAISE EXCEPTION
            'Migration 287 cannot backfill % hr_shifts rows with NULL break_minutes',
            null_break_count
            USING HINT = 'Resolve NULL legacy break values before retrying; the migration preserves the parent envelope literally.';
    END IF;

    IF negative_break_count > 0 THEN
        RAISE EXCEPTION
            'Migration 287 cannot backfill % hr_shifts rows with negative break_minutes',
            negative_break_count
            USING HINT = 'Correct negative legacy break values before retrying.';
    END IF;

    IF oversized_break_count > 0 THEN
        RAISE EXCEPTION
            'Migration 287 cannot backfill % hr_shifts rows whose break exceeds shift duration',
            oversized_break_count
            USING HINT = 'Correct oversized legacy break values before retrying; the shared day-plan service rejects negative paid minutes.';
    END IF;

    IF non_minute_time_count > 0 THEN
        RAISE EXCEPTION
            'Migration 287 cannot backfill % hr_shifts rows outside minute-precision HH:mm time',
            non_minute_time_count
            USING HINT = 'Normalize legacy 24:00 or non-zero seconds before retrying; the shared API intentionally accepts minute precision only.';
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS hr_shift_segments (
    id BIGSERIAL PRIMARY KEY,
    hr_shift_id INTEGER NOT NULL REFERENCES hr_shifts(id) ON DELETE CASCADE,
    profession_key VARCHAR(64) NOT NULL,
    planned_start TIME NOT NULL,
    planned_end TIME NOT NULL,
    break_minutes INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_hr_shift_segments_distinct_time
        CHECK (planned_start <> planned_end),
    CONSTRAINT chk_hr_shift_segments_break_minutes_nonnegative
        CHECK (break_minutes >= 0),
    CONSTRAINT uq_hr_shift_segments_exact
        UNIQUE (hr_shift_id, profession_key, planned_start, planned_end)
);

CREATE TABLE IF NOT EXISTS hr_shift_segment_roles (
    id BIGSERIAL PRIMARY KEY,
    segment_id BIGINT NOT NULL REFERENCES hr_shift_segments(id) ON DELETE CASCADE,
    profession_key VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_hr_shift_segment_roles_segment_profession
        UNIQUE (segment_id, profession_key)
);

CREATE INDEX IF NOT EXISTS idx_hr_shift_segments_shift_sort
    ON hr_shift_segments(hr_shift_id, sort_order, id);

INSERT INTO hr_shift_segments (
    hr_shift_id,
    profession_key,
    planned_start,
    planned_end,
    break_minutes,
    notes,
    sort_order,
    created_by,
    updated_by,
    created_at,
    updated_at
)
SELECT
    hs.id,
    hs.profession_key,
    hs.planned_start,
    hs.planned_end,
    hs.break_minutes,
    NULL,
    0,
    hs.created_by,
    'migration_287_hr_shift_segments',
    COALESCE(hs.created_at, NOW()),
    COALESCE(hs.updated_at, hs.created_at, NOW())
FROM hr_shifts hs
WHERE NOT EXISTS (
    SELECT 1
    FROM hr_shift_segments existing
    WHERE existing.hr_shift_id = hs.id
)
ON CONFLICT (hr_shift_id, profession_key, planned_start, planned_end) DO NOTHING;
