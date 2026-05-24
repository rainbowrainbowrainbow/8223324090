-- MIGRATION_KIND: seed
-- SAFETY: Additive achievement seeds only; no user/task rows are rewritten.
-- ROLLBACK: Delete or deactivate the achievement codes seeded here if task decomposition achievements must be removed.
-- DATA_SCOPE: Reference rows in achievements for personal task/decomposition milestones.

INSERT INTO achievements (code, name, description, icon, category, type, rarity, reward_coins, condition)
VALUES
    ('task_10_done', 'Перші 10 задач', 'Виконати 10 задач у CRM.', '✅', 'work', 'one_time', 'common', 20, '{"type":"tasks_completed","count":10}'::jsonb),
    ('task_decompose_5', '5 декомпозованих задач', 'Створити або отримати 5 задач із підзадачами.', '🧩', 'work', 'one_time', 'uncommon', 30, '{"type":"decomposed_tasks","count":5}'::jsonb),
    ('task_decompose_5_done', '5 задач із підзадачами завершено', 'Завершити 5 задач, які були розбиті на підзадачі.', '🏁', 'work', 'one_time', 'rare', 60, '{"type":"decomposed_tasks_completed","count":5}'::jsonb),
    ('subtask_10_done', '10 підзадач виконано', 'Закрити 10 підзадач у декомпозованих задачах.', '☑️', 'work', 'one_time', 'uncommon', 35, '{"type":"subtasks_completed","count":10}'::jsonb),
    ('task_ai_decompose_done', 'AI-декомпозиція доведена до кінця', 'Завершити задачу, де є AI-підзадачі.', '✨', 'work', 'one_time', 'rare', 75, '{"type":"ai_decomposed_tasks_completed","count":1}'::jsonb),
    ('task_template_done', 'Шаблон доведено до кінця', 'Завершити задачу, де є підзадачі з шаблону.', '📋', 'work', 'one_time', 'uncommon', 45, '{"type":"template_decomposed_tasks_completed","count":1}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    category = EXCLUDED.category,
    type = EXCLUDED.type,
    rarity = EXCLUDED.rarity,
    reward_coins = EXCLUDED.reward_coins,
    condition = EXCLUDED.condition,
    is_active = true;
