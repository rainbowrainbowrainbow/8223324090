-- Migration 133: Fix freelance duplicates + add named freelance animators
-- Duplicate freelance slots created by both initDatabase and migration 132

-- 1. Deactivate older duplicate freelance slots (from migration 132, lower IDs)
-- Keep the ones from initDatabase (higher IDs) as they're consistent
UPDATE staff SET is_active = false
WHERE id IN (
    SELECT s1.id FROM staff s1
    JOIN staff s2 ON s1.department = s2.department
        AND s1.position = s2.position
        AND s1.is_freelance = true AND s2.is_freelance = true
        AND s1.is_active = true AND s2.is_active = true
        AND s1.id < s2.id
);

-- 2. Add named freelance animators: Лера, Оля
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Лера', 'animators', 'Аніматор (фріланс)', 'animator', 'Аніматори', true, 'lera.freelance', true),
('Оля', 'animators', 'Аніматор (фріланс)', 'animator', 'Аніматори', true, 'olya.freelance', true)
ON CONFLICT DO NOTHING;
