-- Migration 134: Separate trampolinists into own department
-- Currently all in 'animators' with role_type='instructor' — need own 'trampoline' dept

-- 1. Move trampolinists (instructor role) to 'trampoline' department
UPDATE staff SET department = 'trampoline'
WHERE department = 'animators' AND role_type = 'instructor' AND is_active = true;

-- 2. Also update freelance trampolinist slots
UPDATE staff SET department = 'trampoline'
WHERE department = 'animators' AND position ILIKE '%батутист%' AND is_active = true;
