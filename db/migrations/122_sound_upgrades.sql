-- Migration 122: Sound module upgrades
-- Add url column to sounds, extend category/type checks

ALTER TABLE sounds ADD COLUMN IF NOT EXISTS url TEXT;

-- Extend category check to include 'announcement'
ALTER TABLE sounds DROP CONSTRAINT IF EXISTS sounds_category_check;
ALTER TABLE sounds ADD CONSTRAINT sounds_category_check
    CHECK (category IN ('quest','atmosphere','effects','music','general','announcement'));

-- Extend sound_projects type check to include 'background'
ALTER TABLE sound_projects DROP CONSTRAINT IF EXISTS sound_projects_type_check;
ALTER TABLE sound_projects ADD CONSTRAINT sound_projects_type_check
    CHECK (type IN ('quest','program','event','background'));
