-- v32.4: Reports module — reports + accountants tables
CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
    amount NUMERIC(12, 2) DEFAULT 0,
    description TEXT,
    category VARCHAR(100),
    submitted_by VARCHAR(200),
    submitted_by_id INTEGER REFERENCES staff(id),
    submitted_via VARCHAR(20) DEFAULT 'web' CHECK (submitted_via IN ('bot', 'web', 'manual')),
    photo_url TEXT,
    ocr_text TEXT,
    voice_transcript TEXT,
    raw_data JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'processing', 'done', 'rejected')),
    assigned_to INTEGER,
    assigned_at TIMESTAMP,
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accountants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    chat_id BIGINT,
    schedule JSONB DEFAULT '{}',
    is_on_duty BOOLEAN DEFAULT false,
    phone VARCHAR(50),
    staff_id INTEGER REFERENCES staff(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Default accountant: Іра
INSERT INTO accountants (name, chat_id, is_on_duty)
SELECT 'Іра', 940474424, true
WHERE NOT EXISTS (SELECT 1 FROM accountants WHERE chat_id = 940474424);

-- Index for fast filtering
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_reports_assigned_to ON reports(assigned_to);
