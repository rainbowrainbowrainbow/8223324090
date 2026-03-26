-- v33.12.0: Notes visibility by department + channel link
ALTER TABLE quick_notes
    ADD COLUMN IF NOT EXISTS visible_to_depts TEXT[],
    ADD COLUMN IF NOT EXISTS channel_id INTEGER,
    ADD COLUMN IF NOT EXISTS title VARCHAR(200),
    ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#fef3c7',
    ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
