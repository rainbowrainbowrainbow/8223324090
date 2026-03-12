-- Migration 014: Leo v2 (Contractor Ratings & Escalations) + Status Page
-- Date: 2026-02-25
-- Author: [claude-code]

-- Ensure contractors table exists (created by initDatabase, needed here for FK)
CREATE TABLE IF NOT EXISTS contractors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    specialty JSONB DEFAULT '[]',
    telegram_chat_id BIGINT,
    telegram_username VARCHAR(100),
    invite_token VARCHAR(50) UNIQUE,
    phone VARCHAR(30),
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- 1. Contractor Tasks — tracking assigned work
-- ============================================
CREATE TABLE IF NOT EXISTS contractor_tasks (
    id SERIAL PRIMARY KEY,
    contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
    booking_id VARCHAR(50),
    task_type VARCHAR(50) NOT NULL DEFAULT 'general',
    title VARCHAR(300) NOT NULL,
    description TEXT,
    status VARCHAR(30) DEFAULT 'assigned',
    assigned_at TIMESTAMP DEFAULT NOW(),
    acknowledged_at TIMESTAMP,
    completed_at TIMESTAMP,
    deadline TIMESTAMP,
    notes TEXT,
    created_by VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_contractor_tasks_contractor ON contractor_tasks(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_tasks_status ON contractor_tasks(status);
CREATE INDEX IF NOT EXISTS idx_contractor_tasks_deadline ON contractor_tasks(deadline);

-- ============================================
-- 2. Contractor Ratings — per-task rating
-- ============================================
CREATE TABLE IF NOT EXISTS contractor_ratings (
    id SERIAL PRIMARY KEY,
    contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
    task_id INTEGER REFERENCES contractor_tasks(id) ON DELETE SET NULL,
    response_time_minutes INTEGER,
    reliability_score INTEGER CHECK (reliability_score BETWEEN 1 AND 5),
    quality_score INTEGER CHECK (quality_score BETWEEN 1 AND 5),
    was_ghost BOOLEAN DEFAULT false,
    comment TEXT,
    rated_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractor_ratings_contractor ON contractor_ratings(contractor_id);

-- ============================================
-- 3. Contractor Escalations — when things go wrong
-- ============================================
CREATE TABLE IF NOT EXISTS contractor_escalations (
    id SERIAL PRIMARY KEY,
    contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
    task_id INTEGER REFERENCES contractor_tasks(id) ON DELETE SET NULL,
    reason VARCHAR(50) NOT NULL,
    description TEXT,
    severity VARCHAR(20) DEFAULT 'medium',
    status VARCHAR(30) DEFAULT 'open',
    resolved_at TIMESTAMP,
    resolved_by VARCHAR(100),
    resolution_notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractor_escalations_contractor ON contractor_escalations(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_escalations_status ON contractor_escalations(status);

-- ============================================
-- 4. Contractor Stats Cache — aggregated metrics
-- ============================================
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS avg_response_minutes NUMERIC(8,1) DEFAULT 0;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS avg_reliability NUMERIC(3,2) DEFAULT 0;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS avg_quality NUMERIC(3,2) DEFAULT 0;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS ghost_rate NUMERIC(5,2) DEFAULT 0;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS total_tasks INTEGER DEFAULT 0;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS completed_tasks INTEGER DEFAULT 0;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'general';
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS sla_response_minutes INTEGER DEFAULT 120;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS last_rated_at TIMESTAMP;

-- ============================================
-- 5. Status Page Incidents — for public status
-- ============================================
CREATE TABLE IF NOT EXISTS status_incidents (
    id SERIAL PRIMARY KEY,
    title VARCHAR(300) NOT NULL,
    description TEXT,
    severity VARCHAR(20) DEFAULT 'minor',
    status VARCHAR(30) DEFAULT 'investigating',
    affected_components JSONB DEFAULT '[]',
    started_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS status_incident_updates (
    id SERIAL PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES status_incidents(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL,
    message TEXT NOT NULL,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_incidents_status ON status_incidents(status);
CREATE INDEX IF NOT EXISTS idx_status_incident_updates_incident ON status_incident_updates(incident_id);

-- ============================================
-- 6. System Components — tracked services
-- ============================================
CREATE TABLE IF NOT EXISTS system_components (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50) DEFAULT 'core',
    status VARCHAR(30) DEFAULT 'operational',
    last_check_at TIMESTAMP DEFAULT NOW(),
    sort_order INTEGER DEFAULT 0,
    is_public BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_system_components_status ON system_components(status);

-- ============================================
-- 7. Seed: System Components
-- ============================================
INSERT INTO system_components (code, name, description, category, status, sort_order, is_public) VALUES
    ('api', 'API Server', 'Express.js REST API', 'core', 'operational', 1, true),
    ('database', 'Database', 'PostgreSQL 16', 'core', 'operational', 2, true),
    ('websocket', 'WebSocket', 'Live sync service', 'core', 'operational', 3, true),
    ('telegram_bot', 'Telegram Bot', 'Notifications & commands', 'integrations', 'operational', 4, true),
    ('backup', 'Backup Service', 'Daily DB backup to Telegram', 'infrastructure', 'operational', 5, true),
    ('scheduler', 'Task Scheduler', 'Auto-tasks, reminders, cleanup', 'infrastructure', 'operational', 6, true),
    ('auth', 'Authentication', 'JWT auth system', 'core', 'operational', 7, true),
    ('booking_engine', 'Booking Engine', 'Reservation management', 'business', 'operational', 8, true),
    ('certificate_service', 'Certificate Service', 'QR generation & validation', 'business', 'operational', 9, true),
    ('kleshnya', 'Kleshnya AI', 'AI assistant & chat', 'ai', 'operational', 10, true)
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 8. Seed: Sample contractor categories
-- ============================================
-- Update existing contractors with default category if they exist
UPDATE contractors SET category = 'general' WHERE category IS NULL;
