-- Migration: 022_staff_trainer
-- Description: Staff training system — weekly prompts, materials, reviews
-- Date: 2026-02-26
-- Version: v20.4.0

-- Staff training inputs (raw responses from staff)
CREATE TABLE IF NOT EXISTS staff_training_inputs (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    staff_name VARCHAR(100),
    telegram_id BIGINT,
    content TEXT NOT NULL,
    week_number INTEGER NOT NULL,
    year INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    approved_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_inputs_week ON staff_training_inputs(year, week_number);
CREATE INDEX IF NOT EXISTS idx_training_inputs_staff ON staff_training_inputs(staff_id);
CREATE INDEX IF NOT EXISTS idx_training_inputs_status ON staff_training_inputs(status);

-- Approved training materials
CREATE TABLE IF NOT EXISTS training_materials (
    id SERIAL PRIMARY KEY,
    category VARCHAR(100) DEFAULT 'Загальне',
    title VARCHAR(255),
    content TEXT NOT NULL,
    source_input_id INTEGER REFERENCES staff_training_inputs(id) ON DELETE SET NULL,
    source_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    source_staff_name VARCHAR(100),
    week_number INTEGER NOT NULL,
    year INTEGER NOT NULL,
    approved_by_telegram_id BIGINT,
    approved_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_materials_category ON training_materials(category);
CREATE INDEX IF NOT EXISTS idx_training_materials_active ON training_materials(is_active);

-- Tracker for sent prompts (one per staff per week)
CREATE TABLE IF NOT EXISTS training_prompts_sent (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
    telegram_id BIGINT,
    week_number INTEGER NOT NULL,
    year INTEGER NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    responded BOOLEAN DEFAULT FALSE,
    responded_at TIMESTAMPTZ,
    UNIQUE(staff_id, week_number, year)
);

CREATE INDEX IF NOT EXISTS idx_training_prompts_week ON training_prompts_sent(year, week_number);

-- Add training_enabled to staff
ALTER TABLE staff ADD COLUMN IF NOT EXISTS training_enabled BOOLEAN DEFAULT TRUE;
