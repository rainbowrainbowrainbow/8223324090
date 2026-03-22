-- Migration 123: Vacancies and job applications

CREATE TABLE IF NOT EXISTS job_vacancies (
    id                  SERIAL PRIMARY KEY,
    title               TEXT NOT NULL,
    role_type           TEXT NOT NULL,
    department          TEXT DEFAULT 'animators',
    description         TEXT,
    requirements        TEXT,
    salary_from         INTEGER,
    salary_to           INTEGER,
    schedule            TEXT,
    work_format         TEXT DEFAULT 'office'
                        CHECK (work_format IN ('office','remote','hybrid')),
    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','paused','filled','closed')),
    priority            TEXT DEFAULT 'normal'
                        CHECK (priority IN ('urgent','normal','low')),
    applications_count  INTEGER DEFAULT 0,
    views_count         INTEGER DEFAULT 0,
    created_by          TEXT,
    created_at          TIMESTAMP DEFAULT NOW(),
    closed_at           TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vacancies_status   ON job_vacancies(status);
CREATE INDEX IF NOT EXISTS idx_vacancies_role     ON job_vacancies(role_type);
CREATE INDEX IF NOT EXISTS idx_vacancies_priority ON job_vacancies(priority, status);

CREATE TABLE IF NOT EXISTS job_applications (
    id              SERIAL PRIMARY KEY,
    vacancy_id      INTEGER NOT NULL REFERENCES job_vacancies(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    phone           TEXT,
    telegram_username TEXT,
    telegram_id     BIGINT,
    source          TEXT DEFAULT 'manual'
                    CHECK (source IN ('manual','telegram','olx','work_ua','referral','other')),
    status          TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','contacted','interview','offer','hired','rejected')),
    cv_url          TEXT,
    notes           TEXT,
    salary_expectation INTEGER,
    interview_date  TIMESTAMP,
    added_by        TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_vacancy ON job_applications(vacancy_id);
CREATE INDEX IF NOT EXISTS idx_applications_status  ON job_applications(status);

-- Trigger: update applications_count on job_applications changes
CREATE OR REPLACE FUNCTION update_vacancy_app_count() RETURNS TRIGGER AS $$
BEGIN
    UPDATE job_vacancies SET applications_count = (
        SELECT COUNT(*) FROM job_applications WHERE vacancy_id = COALESCE(NEW.vacancy_id, OLD.vacancy_id)
    ) WHERE id = COALESCE(NEW.vacancy_id, OLD.vacancy_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vacancy_app_count ON job_applications;
CREATE TRIGGER trg_vacancy_app_count
    AFTER INSERT OR UPDATE OR DELETE ON job_applications
    FOR EACH ROW EXECUTE FUNCTION update_vacancy_app_count();

-- Seed: current open vacancies
INSERT INTO job_vacancies (title, role_type, department, status, priority, schedule, salary_from, salary_to) VALUES
    ('Інструктор батутів',  'trampoline_instructor', 'animators', 'open', 'urgent', 'Пт-Нд + свята, 10:00-20:00', 15000, 25000),
    ('Офіціант',            'waiter',     'cafe',      'open', 'normal', 'Гнучкий, 4-8 год/день',    12000, 18000),
    ('Бармен',              'bartender',  'cafe',      'open', 'normal', 'Гнучкий',                  13000, 20000),
    ('Повар',               'cook',       'cafe',      'open', 'normal', 'Пн-Пт 9:00-18:00',         14000, 22000),
    ('Шеф-повар',           'head_cook',  'cafe',      'open', 'urgent', 'Пн-Пт 8:00-17:00',         20000, 35000)
ON CONFLICT DO NOTHING;
