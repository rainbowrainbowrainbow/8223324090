-- MIGRATION_KIND: schema
-- SAFETY: Additive payroll-profile foundation only. Creates new empty tables, indexes, constraints, and validation triggers without backfilling or rewriting staff, payroll_schemes, staff_profession_rates, payroll_reports, or other legacy payroll data.
-- ROLLBACK: Export any payroll-profile history that must be preserved, then drop the v297 triggers/functions and the four new payroll-profile tables in reverse dependency order. Legacy payroll tables remain unchanged.

CREATE TABLE IF NOT EXISTS payroll_profiles (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(160) NOT NULL,
    profession_key VARCHAR(64) NOT NULL REFERENCES hr_professions(key) ON DELETE RESTRICT,
    profile_kind VARCHAR(16) NOT NULL DEFAULT 'shared',
    owner_staff_id INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
    is_default_for_profession BOOLEAN NOT NULL DEFAULT false,
    source_profile_id BIGINT,
    source_version_id BIGINT,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    activated_by VARCHAR(100),
    archived_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    CONSTRAINT chk_payroll_profiles_title
        CHECK (BTRIM(title) <> ''),
    CONSTRAINT chk_payroll_profiles_kind
        CHECK (profile_kind IN ('shared', 'personal')),
    CONSTRAINT chk_payroll_profiles_status
        CHECK (status IN ('draft', 'active', 'archived')),
    CONSTRAINT chk_payroll_profiles_owner_shape
        CHECK (
            (profile_kind = 'shared' AND owner_staff_id IS NULL)
            OR
            (profile_kind = 'personal' AND owner_staff_id IS NOT NULL)
        ),
    CONSTRAINT chk_payroll_profiles_default_shape
        CHECK (
            NOT is_default_for_profession
            OR (profile_kind = 'shared' AND status = 'active')
        ),
    CONSTRAINT chk_payroll_profiles_source_shape
        CHECK (
            (source_profile_id IS NULL AND source_version_id IS NULL)
            OR
            (source_profile_id IS NOT NULL AND source_version_id IS NOT NULL)
        ),
    CONSTRAINT chk_payroll_profiles_source_not_self
        CHECK (source_profile_id IS NULL OR source_profile_id <> id),
    CONSTRAINT uq_payroll_profiles_id_profession
        UNIQUE (id, profession_key)
);

CREATE TABLE IF NOT EXISTS payroll_profile_versions (
    id BIGSERIAL PRIMARY KEY,
    profile_id BIGINT NOT NULL REFERENCES payroll_profiles(id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL,
    rate_unit VARCHAR(16) NOT NULL,
    default_rate NUMERIC(12,2) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    change_reason TEXT,
    created_by VARCHAR(100),
    activated_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    CONSTRAINT chk_payroll_profile_versions_number
        CHECK (version_number > 0),
    CONSTRAINT chk_payroll_profile_versions_rate_unit
        CHECK (rate_unit IN ('hour', 'day', 'month')),
    CONSTRAINT chk_payroll_profile_versions_default_rate
        CHECK (default_rate > 0),
    CONSTRAINT chk_payroll_profile_versions_effective_range
        CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT uq_payroll_profile_versions_profile_number
        UNIQUE (profile_id, version_number),
    CONSTRAINT uq_payroll_profile_versions_profile_id
        UNIQUE (profile_id, id),
    CONSTRAINT uq_payroll_profile_versions_id_rate_unit
        UNIQUE (id, rate_unit)
);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_payroll_profiles_source_profile_profession'
          AND conrelid = 'payroll_profiles'::regclass
    ) THEN
        ALTER TABLE payroll_profiles
            ADD CONSTRAINT fk_payroll_profiles_source_profile_profession
            FOREIGN KEY (source_profile_id, profession_key)
            REFERENCES payroll_profiles(id, profession_key)
            ON UPDATE RESTRICT
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_payroll_profiles_source_version'
          AND conrelid = 'payroll_profiles'::regclass
    ) THEN
        ALTER TABLE payroll_profiles
            ADD CONSTRAINT fk_payroll_profiles_source_version
            FOREIGN KEY (source_profile_id, source_version_id)
            REFERENCES payroll_profile_versions(profile_id, id)
            MATCH FULL
            ON UPDATE RESTRICT
            ON DELETE RESTRICT
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END;
$migration$;

CREATE TABLE IF NOT EXISTS payroll_profile_day_rates (
    id BIGSERIAL PRIMARY KEY,
    profile_version_id BIGINT NOT NULL,
    rate_unit VARCHAR(16) NOT NULL,
    iso_weekday SMALLINT NOT NULL,
    rate NUMERIC(12,2) NOT NULL,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_payroll_profile_day_rates_unit
        CHECK (rate_unit IN ('hour', 'day')),
    CONSTRAINT chk_payroll_profile_day_rates_weekday
        CHECK (iso_weekday BETWEEN 1 AND 7),
    CONSTRAINT chk_payroll_profile_day_rates_rate
        CHECK (rate > 0),
    CONSTRAINT uq_payroll_profile_day_rates_version_weekday
        UNIQUE (profile_version_id, iso_weekday),
    CONSTRAINT fk_payroll_profile_day_rates_version_unit
        FOREIGN KEY (profile_version_id, rate_unit)
        REFERENCES payroll_profile_versions(id, rate_unit)
        ON UPDATE RESTRICT
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS staff_payroll_profile_assignments (
    id BIGSERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
    profession_key VARCHAR(64) NOT NULL,
    profile_id BIGINT NOT NULL,
    assignment_kind VARCHAR(16) NOT NULL DEFAULT 'explicit',
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_staff_payroll_assignments_kind
        CHECK (assignment_kind IN ('explicit', 'temporary')),
    CONSTRAINT chk_staff_payroll_assignments_effective_range
        CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT chk_staff_payroll_assignments_temporary_range
        CHECK (assignment_kind <> 'temporary' OR effective_to IS NOT NULL),
    CONSTRAINT fk_staff_payroll_assignments_profile_profession
        FOREIGN KEY (profile_id, profession_key)
        REFERENCES payroll_profiles(id, profession_key)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_profiles_active_default_profession_v297
    ON payroll_profiles(profession_key)
    WHERE status = 'active'
      AND profile_kind = 'shared'
      AND is_default_for_profession = true;

CREATE INDEX IF NOT EXISTS idx_payroll_profiles_profession_status_v297
    ON payroll_profiles(profession_key, status, profile_kind);

CREATE INDEX IF NOT EXISTS idx_payroll_profiles_owner_v297
    ON payroll_profiles(owner_staff_id, status)
    WHERE owner_staff_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_profiles_source_v297
    ON payroll_profiles(source_profile_id, source_version_id)
    WHERE source_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_profile_versions_timeline_v297
    ON payroll_profile_versions(profile_id, effective_from, effective_to);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_assignments_timeline_v297
    ON staff_payroll_profile_assignments(staff_id, profession_key, effective_from, effective_to);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_assignments_profile_v297
    ON staff_payroll_profile_assignments(profile_id, effective_from, effective_to);

CREATE OR REPLACE FUNCTION enforce_payroll_profile_version_timeline_v297()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    new_lock_key BIGINT;
    old_lock_key BIGINT;
BEGIN
    IF NEW.profile_id IS NULL OR NEW.effective_from IS NULL THEN
        RETURN NEW;
    END IF;

    new_lock_key := hashtextextended(
        'payroll_profile_version:' || NEW.profile_id::text,
        0
    );

    IF TG_OP = 'UPDATE' AND OLD.profile_id IS DISTINCT FROM NEW.profile_id THEN
        old_lock_key := hashtextextended(
            'payroll_profile_version:' || OLD.profile_id::text,
            0
        );
        PERFORM pg_advisory_xact_lock(LEAST(old_lock_key, new_lock_key));
        IF old_lock_key <> new_lock_key THEN
            PERFORM pg_advisory_xact_lock(GREATEST(old_lock_key, new_lock_key));
        END IF;
    ELSE
        PERFORM pg_advisory_xact_lock(new_lock_key);
    END IF;

    IF EXISTS (
        SELECT 1
        FROM payroll_profile_versions existing
        WHERE existing.profile_id = NEW.profile_id
          AND existing.id IS DISTINCT FROM NEW.id
          AND existing.effective_from <= COALESCE(NEW.effective_to, 'infinity'::date)
          AND NEW.effective_from <= COALESCE(existing.effective_to, 'infinity'::date)
    ) THEN
        RAISE EXCEPTION
            'Payroll profile version periods overlap for profile %',
            NEW.profile_id
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION enforce_staff_payroll_assignment_v297()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    new_lock_key BIGINT;
    old_lock_key BIGINT;
    assigned_profile_kind VARCHAR(16);
    assigned_profile_owner INTEGER;
BEGIN
    IF NEW.staff_id IS NULL
        OR NEW.profession_key IS NULL
        OR NEW.profile_id IS NULL
        OR NEW.effective_from IS NULL
    THEN
        RETURN NEW;
    END IF;

    new_lock_key := hashtextextended(
        'payroll_assignment:' || NEW.staff_id::text || ':' || NEW.profession_key,
        0
    );

    IF TG_OP = 'UPDATE'
        AND (
            OLD.staff_id IS DISTINCT FROM NEW.staff_id
            OR OLD.profession_key IS DISTINCT FROM NEW.profession_key
        )
    THEN
        old_lock_key := hashtextextended(
            'payroll_assignment:' || OLD.staff_id::text || ':' || OLD.profession_key,
            0
        );
        PERFORM pg_advisory_xact_lock(LEAST(old_lock_key, new_lock_key));
        IF old_lock_key <> new_lock_key THEN
            PERFORM pg_advisory_xact_lock(GREATEST(old_lock_key, new_lock_key));
        END IF;
    ELSE
        PERFORM pg_advisory_xact_lock(new_lock_key);
    END IF;

    SELECT profile_kind, owner_staff_id
    INTO assigned_profile_kind, assigned_profile_owner
    FROM payroll_profiles
    WHERE id = NEW.profile_id
      AND profession_key = NEW.profession_key
    FOR SHARE;

    IF FOUND
        AND assigned_profile_kind = 'personal'
        AND assigned_profile_owner IS DISTINCT FROM NEW.staff_id
    THEN
        RAISE EXCEPTION
            'Personal payroll profile % can only be assigned to staff %',
            NEW.profile_id,
            assigned_profile_owner
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM staff_payroll_profile_assignments existing
        WHERE existing.staff_id = NEW.staff_id
          AND existing.profession_key = NEW.profession_key
          AND existing.id IS DISTINCT FROM NEW.id
          AND existing.effective_from <= COALESCE(NEW.effective_to, 'infinity'::date)
          AND NEW.effective_from <= COALESCE(existing.effective_to, 'infinity'::date)
    ) THEN
        RAISE EXCEPTION
            'Payroll profile assignment periods overlap for staff % and profession %',
            NEW.staff_id,
            NEW.profession_key
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION guard_payroll_profile_personal_owner_v297()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.profile_kind = 'personal'
        AND EXISTS (
            SELECT 1
            FROM staff_payroll_profile_assignments assignment
            WHERE assignment.profile_id = NEW.id
              AND assignment.staff_id IS DISTINCT FROM NEW.owner_staff_id
        )
    THEN
        RAISE EXCEPTION
            'Personal payroll profile % already has assignments for another staff member',
            NEW.id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_payroll_profile_versions_timeline_v297'
          AND tgrelid = 'payroll_profile_versions'::regclass
    ) THEN
        CREATE TRIGGER trg_payroll_profile_versions_timeline_v297
            BEFORE INSERT OR UPDATE ON payroll_profile_versions
            FOR EACH ROW
            EXECUTE FUNCTION enforce_payroll_profile_version_timeline_v297();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_staff_payroll_assignment_v297'
          AND tgrelid = 'staff_payroll_profile_assignments'::regclass
    ) THEN
        CREATE TRIGGER trg_staff_payroll_assignment_v297
            BEFORE INSERT OR UPDATE ON staff_payroll_profile_assignments
            FOR EACH ROW
            EXECUTE FUNCTION enforce_staff_payroll_assignment_v297();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_payroll_profile_personal_owner_v297'
          AND tgrelid = 'payroll_profiles'::regclass
    ) THEN
        CREATE TRIGGER trg_payroll_profile_personal_owner_v297
            BEFORE UPDATE OF profile_kind, owner_staff_id ON payroll_profiles
            FOR EACH ROW
            EXECUTE FUNCTION guard_payroll_profile_personal_owner_v297();
    END IF;
END;
$migration$;

COMMENT ON TABLE payroll_profiles IS
    'Versioned shared and staff-owned payroll condition profiles. Legacy payroll tables remain separate until an explicit resolver rollout.';

COMMENT ON TABLE payroll_profile_versions IS
    'Non-overlapping, inclusive effective-date versions of a payroll profile.';

COMMENT ON COLUMN payroll_profile_day_rates.rate_unit IS
    'Denormalized integrity key. The composite FK permits weekday overrides only for hour/day versions and blocks month versions.';

COMMENT ON TABLE staff_payroll_profile_assignments IS
    'Non-overlapping explicit or temporary staff overrides. Dates without an assignment resolve through the profession default profile in the future payroll resolver.';
