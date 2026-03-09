-- Migration: 019_roles_system
-- Description: Expanded role system — 10 roles with access matrix
-- Date: 2026-02-26
-- Version: v20.1.0

-- Expand role column to support longer role names
ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(50);

-- Update existing users with new roles per TZ
UPDATE users SET role = 'creator' WHERE username = 'Sergey';
UPDATE users SET role = 'director' WHERE username IN ('Vitalina', 'Natalia');
UPDATE users SET role = 'manager' WHERE username IN ('Dasha', 'Anli');
UPDATE users SET role = 'animator' WHERE username IN ('Animator', 'Zhenya', 'Lera', 'Anna');

-- Keep admin test user as creator for testing
UPDATE users SET role = 'creator' WHERE username = 'admin';

-- Add is_active column for user deactivation
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Index for role-based queries
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
