-- MIGRATION_KIND: schema
-- SAFETY: Additive user-scoped habit, habit-impact, and check-in tables only. No tasks, recurring tasks, time entries, dependencies, seeds, or historic data are changed.
-- ROLLBACK: After application rollback, DROP TABLE IF EXISTS my_day_habit_checkins; DROP TABLE IF EXISTS my_day_habit_impacts; DROP TABLE IF EXISTS my_day_habits.

CREATE TABLE IF NOT EXISTS my_day_habits (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#22C55E',
    icon VARCHAR(32) NOT NULL DEFAULT '*',
    direction_id BIGINT REFERENCES my_day_directions(id) ON DELETE RESTRICT,
    metric VARCHAR(12) NOT NULL,
    target_value INTEGER NOT NULL,
    cadence VARCHAR(20) NOT NULL,
    selected_weekdays SMALLINT[] NOT NULL DEFAULT '{}',
    times_per_week SMALLINT,
    is_paused BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_my_day_habits_id_user UNIQUE (id, user_id),
    CONSTRAINT chk_my_day_habits_name CHECK (BTRIM(name) <> ''),
    CONSTRAINT chk_my_day_habits_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT chk_my_day_habits_icon CHECK (BTRIM(icon) <> '' AND LENGTH(icon) <= 32),
    CONSTRAINT chk_my_day_habits_metric CHECK (metric IN ('boolean','count','minutes')),
    CONSTRAINT chk_my_day_habits_target CHECK (target_value > 0 AND (metric <> 'boolean' OR target_value = 1)),
    CONSTRAINT chk_my_day_habits_cadence CHECK (cadence IN ('daily','selected_weekdays','times_per_week')),
    CONSTRAINT chk_my_day_habits_weekdays CHECK (selected_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
    CONSTRAINT chk_my_day_habits_weekdays_cadence CHECK ((cadence = 'selected_weekdays' AND CARDINALITY(selected_weekdays) > 0) OR (cadence <> 'selected_weekdays' AND selected_weekdays = '{}')),
    CONSTRAINT chk_my_day_habits_weekly_target CHECK ((cadence = 'times_per_week' AND times_per_week BETWEEN 1 AND 7) OR (cadence <> 'times_per_week' AND times_per_week IS NULL)),
    CONSTRAINT chk_my_day_habits_archive_timestamp CHECK ((is_archived = FALSE AND archived_at IS NULL) OR (is_archived = TRUE))
);
CREATE INDEX IF NOT EXISTS idx_my_day_habits_active ON my_day_habits (user_id, is_archived, is_paused, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_my_day_habits_direction ON my_day_habits (user_id, direction_id) WHERE direction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS my_day_habit_impacts (
    habit_id BIGINT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    impact_id BIGINT NOT NULL REFERENCES my_day_impacts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (habit_id, impact_id),
    CONSTRAINT fk_my_day_habit_impacts_habit_owner FOREIGN KEY (habit_id, user_id) REFERENCES my_day_habits(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_my_day_habit_impacts_user ON my_day_habit_impacts (user_id, impact_id, habit_id);

CREATE TABLE IF NOT EXISTS my_day_habit_checkins (
    id BIGSERIAL PRIMARY KEY,
    habit_id BIGINT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    local_date DATE NOT NULL,
    state VARCHAR(10) NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_my_day_habit_checkins_habit_owner FOREIGN KEY (habit_id, user_id) REFERENCES my_day_habits(id, user_id) ON DELETE CASCADE,
    CONSTRAINT chk_my_day_habit_checkins_state CHECK (state IN ('done','skipped')),
    CONSTRAINT chk_my_day_habit_checkins_value CHECK (value >= 0),
    UNIQUE (habit_id, user_id, local_date)
);
CREATE INDEX IF NOT EXISTS idx_my_day_habit_checkins_user_date ON my_day_habit_checkins (user_id, local_date, habit_id);