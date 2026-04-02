-- Migration 140: Create user account for Касян Катерина (HR)
-- v39.8.0: Safe version — checks if staff exists before linking

-- Create user (skip if exists)
INSERT INTO users (username, password_hash, name, role, is_active)
VALUES ('Kateryna', '$2b$10$u85LwAEkwqpCtVom0E0nhuSROmPX5N1SKG3qeHfkHvdBO7Ram3ldO', 'Касян Катерина', 'hr', true)
ON CONFLICT (username) DO NOTHING;

-- Link to staff record ONLY if staff_id=54 exists (won't exist on production yet)
INSERT INTO employee_profiles (user_id, staff_id, full_name, is_active)
SELECT u.id, s.id, 'Касян Катерина', true
FROM users u
CROSS JOIN staff s
WHERE u.username = 'Kateryna'
  AND s.name = 'Касян Катерина' AND s.is_active = true
  AND NOT EXISTS (SELECT 1 FROM employee_profiles ep WHERE ep.staff_id = s.id AND ep.is_active = true);
