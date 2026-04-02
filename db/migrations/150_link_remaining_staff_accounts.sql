-- v41.1: Auto-link remaining staff to existing user accounts
-- Verified pairs from DB: slavytska.anna→Anna, franchuk.artem→Artem

-- Anna (animator) → Славицька Анна (staff, unique_person_key=slavytska.anna)
INSERT INTO employee_profiles (staff_id, user_id, full_name, role, department, is_active)
SELECT s.id, u.id, s.name, s.role_type, s.department, true
FROM staff s CROSS JOIN users u
WHERE s.unique_person_key = 'slavytska.anna' AND s.is_active = true
  AND u.username = 'Anna' AND u.is_active = true
  AND NOT EXISTS (SELECT 1 FROM employee_profiles ep WHERE ep.staff_id = s.id AND ep.is_active = true)
ON CONFLICT DO NOTHING;

-- Artem (admin) → Франчук Артем (staff, unique_person_key=franchuk.artem)
INSERT INTO employee_profiles (staff_id, user_id, full_name, role, department, is_active)
SELECT s.id, u.id, s.name, s.role_type, s.department, true
FROM staff s CROSS JOIN users u
WHERE s.unique_person_key = 'franchuk.artem' AND s.is_active = true
  AND u.username = 'Artem' AND u.is_active = true
  AND NOT EXISTS (SELECT 1 FROM employee_profiles ep WHERE ep.staff_id = s.id AND ep.is_active = true)
ON CONFLICT DO NOTHING;

-- NOTE: Lera (lera.freelance) skipped — is_freelance, no need for CRM account link
-- NOTE: slavytska.anna.mgr is a duplicate entry (same person, diff dept), gets linked via same staff_id
