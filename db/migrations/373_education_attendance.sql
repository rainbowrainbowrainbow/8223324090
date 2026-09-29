-- MIGRATION_KIND: schema
-- SAFETY: Additive empty lesson attendance and immutable change-history tables. No existing bookings, children, or group memberships are rewritten.
-- ROLLBACK: Export both tables first; remove the attendance API/UI and then drop education_attendance_history before education_attendance only if no history must be retained.

CREATE TABLE IF NOT EXISTS education_attendance (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    booking_id VARCHAR(50) NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
    group_id BIGINT NOT NULL,
    child_id BIGINT NOT NULL REFERENCES customer_children(id) ON DELETE RESTRICT,
    lesson_date DATE NOT NULL,
    child_name_snapshot TEXT,
    parent_name_snapshot TEXT,
    status VARCHAR(16) CHECK (status IN ('present', 'absent', 'excused')),
    marked_by VARCHAR(100),
    marked_at TIMESTAMPTZ,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT education_attendance_booking_child_unique UNIQUE (booking_id, child_id),
    CONSTRAINT education_attendance_id_context_unique UNIQUE (id, business_context),
    CONSTRAINT education_attendance_group_context_fk FOREIGN KEY (group_id, business_context)
        REFERENCES education_groups(id, business_context) ON DELETE RESTRICT,
    CONSTRAINT education_attendance_mark_pair_check CHECK ((status IS NULL) = (marked_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_education_attendance_context_booking
    ON education_attendance (business_context, booking_id);
CREATE INDEX IF NOT EXISTS idx_education_attendance_context_group_date
    ON education_attendance (business_context, group_id, lesson_date);

CREATE TABLE IF NOT EXISTS education_attendance_history (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    attendance_id BIGINT NOT NULL,
    previous_status VARCHAR(16) CHECK (previous_status IN ('present', 'absent', 'excused')),
    new_status VARCHAR(16) CHECK (new_status IN ('present', 'absent', 'excused')),
    changed_by VARCHAR(100) NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT education_attendance_history_change_check CHECK (previous_status IS DISTINCT FROM new_status),
    CONSTRAINT education_attendance_history_attendance_context_fk FOREIGN KEY (attendance_id, business_context)
        REFERENCES education_attendance(id, business_context) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_education_attendance_history_context_attendance
    ON education_attendance_history (business_context, attendance_id, changed_at, id);
