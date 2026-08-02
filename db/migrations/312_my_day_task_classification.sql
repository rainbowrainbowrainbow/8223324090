-- MIGRATION_KIND: schema
-- SAFETY: Additive user-scoped personal taxonomy and task-classification tables only. Existing tasks, users, and taxonomy receive no seeded or backfilled rows.
-- ROLLBACK: After application rollback, DROP TABLE IF EXISTS my_day_task_impacts; DROP TABLE IF EXISTS my_day_task_metadata; DROP TABLE IF EXISTS my_day_impacts; DROP TABLE IF EXISTS my_day_directions.

CREATE TABLE IF NOT EXISTS my_day_directions (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#6366F1',
    icon VARCHAR(32) NOT NULL DEFAULT '•',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_my_day_directions_name_not_blank CHECK (BTRIM(name) <> ''),
    CONSTRAINT chk_my_day_directions_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT chk_my_day_directions_icon_not_blank CHECK (BTRIM(icon) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_my_day_directions_user_name_ci
    ON my_day_directions (user_id, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_my_day_directions_catalog
    ON my_day_directions (user_id, is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS my_day_impacts (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#0EA5E9',
    icon VARCHAR(32) NOT NULL DEFAULT '•',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_my_day_impacts_name_not_blank CHECK (BTRIM(name) <> ''),
    CONSTRAINT chk_my_day_impacts_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT chk_my_day_impacts_icon_not_blank CHECK (BTRIM(icon) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_my_day_impacts_user_name_ci
    ON my_day_impacts (user_id, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_my_day_impacts_catalog
    ON my_day_impacts (user_id, is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS my_day_task_metadata (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    direction_id BIGINT REFERENCES my_day_directions(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_my_day_task_metadata_user_direction
    ON my_day_task_metadata (user_id, direction_id, task_id);

CREATE TABLE IF NOT EXISTS my_day_task_impacts (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    impact_id BIGINT NOT NULL REFERENCES my_day_impacts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, task_id, impact_id)
);

CREATE INDEX IF NOT EXISTS idx_my_day_task_impacts_user_task
    ON my_day_task_impacts (user_id, task_id, impact_id);
