-- Migration: 021_navigation
-- Description: Program pricing table + navigation restructure
-- Date: 2026-02-26
-- Version: v20.3.0

-- Program-specific pricing rules (dynamic pricing per program)
-- NOTE: price_rules already exists from 011_center.sql for center-wide pricing.
-- This table is specifically for per-program dynamic pricing.
CREATE TABLE IF NOT EXISTS program_price_rules (
    id SERIAL PRIMARY KEY,
    program_id INTEGER,
    min_people INTEGER DEFAULT 1,
    max_people INTEGER,
    base_price DECIMAL(10,2),
    price_per_extra_person DECIMAL(10,2) DEFAULT 0,
    note VARCHAR(200),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_program_price_rules_program ON program_price_rules(program_id);
CREATE INDEX IF NOT EXISTS idx_program_price_rules_active ON program_price_rules(is_active);
