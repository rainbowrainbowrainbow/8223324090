-- Migration: 028_price_rules_sync
-- Description: Link price_rules to products + add effective_from for scheduled pricing
-- Date: 2026-03-04
-- Version: v20.9.25

-- Add product_id link and effective_from date to price_rules
ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS product_id VARCHAR(50) REFERENCES products(id);
ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS effective_from DATE;

-- Create index for product lookup
CREATE INDEX IF NOT EXISTS idx_price_rules_product_id ON price_rules(product_id);

-- Auto-link existing price_rules to products by matching code pattern
UPDATE price_rules SET product_id = 'anim60' WHERE code = 'animation_60' AND product_id IS NULL;
UPDATE price_rules SET product_id = 'anim120' WHERE code = 'animation_120' AND product_id IS NULL;
