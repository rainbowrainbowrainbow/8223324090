-- MIGRATION_KIND: mixed
-- SAFETY: Adds isolated admission ticket catalog, append-only tariff history, and deterministic Event Genix reference rows. Existing bookings, booking snapshots, price_rules, banquet_entry_* rows, payments, deposits, and menu data are not updated or deleted.
-- ROLLBACK: Export admission ticket catalog/history first, then drop the v300 triggers/functions and admission_ticket_tariff_audit, admission_ticket_tariff_versions, admission_ticket_types in reverse dependency order. Legacy price_rules remain unchanged.
-- OPERATOR_APPROVAL: required
-- DATA_SCOPE: Six Event Genix system ticket types and their complete 2 admission contexts x 2 day types tariff matrix, effective from 2026-07-14, using owner-approved prices supplied on 2026-07-18.

CREATE TABLE IF NOT EXISTS admission_ticket_types (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(160) NOT NULL,
    audience VARCHAR(16) NOT NULL,
    allocation_strategy VARCHAR(16) NOT NULL,
    requirement_text TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_admission_ticket_types_business_code
        UNIQUE (business_context, code),
    CONSTRAINT chk_admission_ticket_types_business_context
        CHECK (business_context ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_admission_ticket_types_code
        CHECK (code ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_admission_ticket_types_name
        CHECK (BTRIM(name) <> ''),
    CONSTRAINT chk_admission_ticket_types_audience
        CHECK (audience IN ('child', 'adult')),
    CONSTRAINT chk_admission_ticket_types_allocation
        CHECK (allocation_strategy IN ('manual', 'remainder')),
    CONSTRAINT chk_admission_ticket_types_required_remainders_active
        CHECK (
            code NOT IN ('regular_child', 'adult_companion')
            OR is_active = true
        )
);

CREATE TABLE IF NOT EXISTS admission_ticket_tariff_versions (
    id BIGSERIAL PRIMARY KEY,
    ticket_type_id BIGINT NOT NULL
        REFERENCES admission_ticket_types(id) ON DELETE RESTRICT,
    admission_context VARCHAR(32) NOT NULL,
    day_type VARCHAR(16) NOT NULL,
    availability VARCHAR(16) NOT NULL,
    amount_uah NUMERIC(12,2),
    effective_from DATE NOT NULL,
    revision INTEGER NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    change_note TEXT,
    CONSTRAINT uq_admission_ticket_tariff_revision
        UNIQUE (ticket_type_id, admission_context, day_type, revision),
    CONSTRAINT chk_admission_ticket_tariff_context
        CHECK (admission_context IN ('standard', 'reserved_table_room')),
    CONSTRAINT chk_admission_ticket_tariff_day
        CHECK (day_type IN ('weekday', 'weekend')),
    CONSTRAINT chk_admission_ticket_tariff_availability
        CHECK (availability IN ('available', 'unavailable')),
    CONSTRAINT chk_admission_ticket_tariff_amount
        CHECK (
            (
                availability = 'available'
                AND amount_uah IS NOT NULL
                AND amount_uah >= 0
            )
            OR
            (
                availability = 'unavailable'
                AND amount_uah IS NULL
            )
        ),
    CONSTRAINT chk_admission_ticket_tariff_revision_positive
        CHECK (revision > 0),
    CONSTRAINT chk_admission_ticket_tariff_actor
        CHECK (BTRIM(created_by) <> '')
);

CREATE TABLE IF NOT EXISTS admission_ticket_tariff_audit (
    id BIGSERIAL PRIMARY KEY,
    ticket_type_id BIGINT NOT NULL
        REFERENCES admission_ticket_types(id) ON DELETE RESTRICT,
    business_context VARCHAR(64) NOT NULL,
    ticket_type_code VARCHAR(64) NOT NULL,
    admission_context VARCHAR(32) NOT NULL,
    day_type VARCHAR(16) NOT NULL,
    old_tariff_version_id BIGINT
        REFERENCES admission_ticket_tariff_versions(id) ON DELETE RESTRICT,
    new_tariff_version_id BIGINT NOT NULL
        REFERENCES admission_ticket_tariff_versions(id) ON DELETE RESTRICT,
    old_availability VARCHAR(16),
    new_availability VARCHAR(16) NOT NULL,
    old_amount_uah NUMERIC(12,2),
    new_amount_uah NUMERIC(12,2),
    effective_from DATE NOT NULL,
    actor VARCHAR(100) NOT NULL,
    change_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_admission_ticket_tariff_audit_context
        CHECK (admission_context IN ('standard', 'reserved_table_room')),
    CONSTRAINT chk_admission_ticket_tariff_audit_day
        CHECK (day_type IN ('weekday', 'weekend')),
    CONSTRAINT chk_admission_ticket_tariff_audit_old_availability
        CHECK (old_availability IS NULL OR old_availability IN ('available', 'unavailable')),
    CONSTRAINT chk_admission_ticket_tariff_audit_new_availability
        CHECK (new_availability IN ('available', 'unavailable')),
    CONSTRAINT chk_admission_ticket_tariff_audit_actor
        CHECK (BTRIM(actor) <> '')
);

CREATE INDEX IF NOT EXISTS idx_admission_ticket_types_business_active_v300
    ON admission_ticket_types (business_context, is_active, sort_order, code);

CREATE INDEX IF NOT EXISTS idx_admission_ticket_tariffs_resolver_v300
    ON admission_ticket_tariff_versions (
        ticket_type_id,
        admission_context,
        day_type,
        effective_from DESC,
        revision DESC
    );

CREATE INDEX IF NOT EXISTS idx_admission_ticket_tariff_audit_lookup_v300
    ON admission_ticket_tariff_audit (
        business_context,
        ticket_type_code,
        admission_context,
        day_type,
        created_at DESC
    );

CREATE OR REPLACE FUNCTION admission_ticket_type_guard_v300()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Admission ticket types cannot be physically deleted'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.code IS DISTINCT FROM OLD.code
       OR NEW.business_context IS DISTINCT FROM OLD.business_context
       OR NEW.audience IS DISTINCT FROM OLD.audience
       OR NEW.allocation_strategy IS DISTINCT FROM OLD.allocation_strategy THEN
        RAISE EXCEPTION 'Admission ticket code, business context, audience, and allocation strategy are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.code IN ('regular_child', 'adult_companion')
       AND NEW.is_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Required remainder ticket types cannot be deactivated'
            USING ERRCODE = '55000';
    END IF;

    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admission_ticket_type_guard_v300
    ON admission_ticket_types;
CREATE TRIGGER trg_admission_ticket_type_guard_v300
BEFORE UPDATE OR DELETE ON admission_ticket_types
FOR EACH ROW EXECUTE FUNCTION admission_ticket_type_guard_v300();

CREATE OR REPLACE FUNCTION admission_ticket_tariff_append_only_v300()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Admission ticket tariff versions are append-only'
        USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_admission_ticket_tariff_append_only_v300
    ON admission_ticket_tariff_versions;
CREATE TRIGGER trg_admission_ticket_tariff_append_only_v300
BEFORE UPDATE OR DELETE ON admission_ticket_tariff_versions
FOR EACH ROW EXECUTE FUNCTION admission_ticket_tariff_append_only_v300();

INSERT INTO admission_ticket_types (
    business_context,
    code,
    name,
    audience,
    allocation_strategy,
    requirement_text,
    is_system,
    is_active,
    sort_order
)
VALUES
    (
        'event_genix',
        'regular_child',
        'Звичайний дитячий',
        'child',
        'remainder',
        NULL,
        true,
        true,
        10
    ),
    (
        'event_genix',
        'under_3_child',
        'Дитина до 3 років',
        'child',
        'manual',
        'Лише у будні та за наявності свідоцтва про народження.',
        true,
        true,
        20
    ),
    (
        'event_genix',
        'discounted_child',
        'Пільговий дитячий',
        'child',
        'manual',
        'Для багатодітних сімей, УБД, дітей з інвалідністю, сиріт або ВПО.',
        true,
        true,
        30
    ),
    (
        'event_genix',
        'birthday_child',
        'Іменинник',
        'child',
        'manual',
        'За наявності свідоцтва про народження.',
        true,
        true,
        40
    ),
    (
        'event_genix',
        'adult_companion',
        'Дорослий супроводжуючий',
        'adult',
        'remainder',
        'Супровід без ігрового доступу до батутів.',
        true,
        true,
        50
    ),
    (
        'event_genix',
        'adult_game',
        'Дорослий ігровий',
        'adult',
        'manual',
        'Ігровий квиток із доступом до батутів.',
        true,
        true,
        60
    )
ON CONFLICT (business_context, code) DO UPDATE SET
    name = EXCLUDED.name,
    audience = EXCLUDED.audience,
    allocation_strategy = EXCLUDED.allocation_strategy,
    requirement_text = EXCLUDED.requirement_text,
    is_system = true,
    is_active = true,
    sort_order = EXCLUDED.sort_order;

WITH seed_tariffs (
    code,
    admission_context,
    day_type,
    availability,
    amount_uah
) AS (
    VALUES
        ('regular_child',     'standard',            'weekday', 'available',   350.00::numeric),
        ('regular_child',     'standard',            'weekend', 'available',   400.00::numeric),
        ('regular_child',     'reserved_table_room', 'weekday', 'available',   310.00::numeric),
        ('regular_child',     'reserved_table_room', 'weekend', 'available',   350.00::numeric),
        ('under_3_child',     'standard',            'weekday', 'available',   175.00::numeric),
        ('under_3_child',     'standard',            'weekend', 'unavailable', NULL::numeric),
        ('under_3_child',     'reserved_table_room', 'weekday', 'available',   175.00::numeric),
        ('under_3_child',     'reserved_table_room', 'weekend', 'unavailable', NULL::numeric),
        ('discounted_child',  'standard',            'weekday', 'available',   175.00::numeric),
        ('discounted_child',  'standard',            'weekend', 'available',   200.00::numeric),
        ('discounted_child',  'reserved_table_room', 'weekday', 'available',   175.00::numeric),
        ('discounted_child',  'reserved_table_room', 'weekend', 'available',   200.00::numeric),
        ('birthday_child',    'standard',            'weekday', 'available',    10.00::numeric),
        ('birthday_child',    'standard',            'weekend', 'available',    10.00::numeric),
        ('birthday_child',    'reserved_table_room', 'weekday', 'available',    10.00::numeric),
        ('birthday_child',    'reserved_table_room', 'weekend', 'available',    10.00::numeric),
        ('adult_companion',   'standard',            'weekday', 'available',    10.00::numeric),
        ('adult_companion',   'standard',            'weekend', 'available',    10.00::numeric),
        ('adult_companion',   'reserved_table_room', 'weekday', 'available',    10.00::numeric),
        ('adult_companion',   'reserved_table_room', 'weekend', 'available',    10.00::numeric),
        ('adult_game',        'standard',            'weekday', 'available',    75.00::numeric),
        ('adult_game',        'standard',            'weekend', 'available',    75.00::numeric),
        ('adult_game',        'reserved_table_room', 'weekday', 'available',    75.00::numeric),
        ('adult_game',        'reserved_table_room', 'weekend', 'available',    75.00::numeric)
)
INSERT INTO admission_ticket_tariff_versions (
    ticket_type_id,
    admission_context,
    day_type,
    availability,
    amount_uah,
    effective_from,
    revision,
    created_by,
    change_note
)
SELECT
    ticket_type.id,
    seed.admission_context,
    seed.day_type,
    seed.availability,
    seed.amount_uah,
    DATE '2026-07-14',
    1,
    'migration_300_admission_ticket_catalog',
    'Початкова погоджена тарифна матриця від 14.07.2026'
FROM seed_tariffs seed
JOIN admission_ticket_types ticket_type
  ON ticket_type.business_context = 'event_genix'
 AND ticket_type.code = seed.code
ON CONFLICT (
    ticket_type_id,
    admission_context,
    day_type,
    revision
) DO NOTHING;

INSERT INTO admission_ticket_tariff_audit (
    ticket_type_id,
    business_context,
    ticket_type_code,
    admission_context,
    day_type,
    old_tariff_version_id,
    new_tariff_version_id,
    old_availability,
    new_availability,
    old_amount_uah,
    new_amount_uah,
    effective_from,
    actor,
    change_note
)
SELECT
    ticket_type.id,
    ticket_type.business_context,
    ticket_type.code,
    tariff.admission_context,
    tariff.day_type,
    NULL,
    tariff.id,
    NULL,
    tariff.availability,
    NULL,
    tariff.amount_uah,
    tariff.effective_from,
    tariff.created_by,
    tariff.change_note
FROM admission_ticket_types ticket_type
JOIN admission_ticket_tariff_versions tariff
  ON tariff.ticket_type_id = ticket_type.id
 AND tariff.revision = 1
 AND tariff.created_by = 'migration_300_admission_ticket_catalog'
WHERE ticket_type.business_context = 'event_genix'
  AND NOT EXISTS (
      SELECT 1
      FROM admission_ticket_tariff_audit audit
      WHERE audit.new_tariff_version_id = tariff.id
  );

COMMENT ON TABLE admission_ticket_types IS
    'Version-independent admission ticket type catalog scoped by business_context.';

COMMENT ON TABLE admission_ticket_tariff_versions IS
    'Append-only tariff versions selected by event date, admission context, day type, effective_from, and revision.';

COMMENT ON TABLE admission_ticket_tariff_audit IS
    'Durable tariff mutation audit with actor and old/new values. Seed revisions are recorded as old=NULL.';
