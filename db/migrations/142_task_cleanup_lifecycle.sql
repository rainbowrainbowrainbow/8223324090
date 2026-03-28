-- Migration 142: Task cleanup + lifecycle columns
-- v40.5.0: Clean duplicates, add health_score, archive old tasks

-- 1. Add lifecycle columns
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS health_score INTEGER DEFAULT 100;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP DEFAULT NOW();
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(50);

-- 2. Delete junk/test tasks (short garbage titles)
DELETE FROM tasks WHERE title IN ('лол', '123', '9889', 'жооопааа', '66555', '!!!!', 'працює', 'привітати', 'Тест 2 3');

-- 3. Deduplicate "Перевірити реквізит" — keep 1 per date
DELETE FROM tasks
WHERE title = 'Перевірити реквізит'
  AND id NOT IN (
    SELECT MIN(id) FROM tasks
    WHERE title = 'Перевірити реквізит'
    GROUP BY COALESCE(date, created_at::varchar(10))
  );

-- 4. Deduplicate "Підготувати зал *" — keep 1 per title+date
DELETE FROM tasks
WHERE title LIKE 'Підготувати зал%'
  AND id NOT IN (
    SELECT MIN(id) FROM tasks
    WHERE title LIKE 'Підготувати зал%'
    GROUP BY title, COALESCE(date, created_at::varchar(10))
  );

-- 5. Archive old overdue tasks (> 14 days past deadline)
UPDATE tasks SET
  status = 'archived',
  archived_at = NOW(),
  archive_reason = 'auto_expired',
  health_score = 0
WHERE status NOT IN ('done', 'cancelled', 'archived')
  AND date IS NOT NULL AND date != ''
  AND date::date < CURRENT_DATE - INTERVAL '14 days'
  AND (priority IS NULL OR priority != 'critical');

-- 6. Set health_score for remaining active tasks
UPDATE tasks SET health_score = GREATEST(0, LEAST(100,
  100
  - CASE WHEN date IS NOT NULL AND date != '' THEN GREATEST(0, EXTRACT(DAY FROM NOW() - date::date)::int * 5) ELSE 0 END
  - GREATEST(0, (EXTRACT(DAY FROM NOW() - COALESCE(updated_at, created_at))::int - 7) * 2)
))::int
WHERE status NOT IN ('done', 'cancelled', 'archived')
  AND archived_at IS NULL;

-- 7. Update last_activity_at from updated_at
UPDATE tasks SET last_activity_at = COALESCE(updated_at, created_at)
WHERE last_activity_at IS NULL OR last_activity_at = created_at;
