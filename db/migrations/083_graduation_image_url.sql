-- 083_graduation_image_url.sql — Add image_url field to graduation_packages
-- Allows custom images per package (uploaded by Kleshnya later)

ALTER TABLE graduation_packages ADD COLUMN IF NOT EXISTS image_url TEXT;
