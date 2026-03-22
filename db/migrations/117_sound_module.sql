-- v117: Sound module — бібліотека звуків
CREATE TABLE IF NOT EXISTS sounds (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    filename    TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    category    VARCHAR(20) NOT NULL DEFAULT 'general'
                CHECK(category IN ('quest','atmosphere','effects','music','general')),
    duration    REAL,
    file_size   INTEGER,
    uploaded_by TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sound_projects (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    type        VARCHAR(20) NOT NULL DEFAULT 'quest'
                CHECK(type IN ('quest','program','event')),
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sound_project_tracks (
    project_id  INTEGER NOT NULL REFERENCES sound_projects(id) ON DELETE CASCADE,
    sound_id    INTEGER NOT NULL REFERENCES sounds(id) ON DELETE CASCADE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, sound_id)
);

CREATE INDEX IF NOT EXISTS idx_sounds_category ON sounds(category);
