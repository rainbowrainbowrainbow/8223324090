-- v30.3: Booking templates — save/load reusable booking presets
CREATE TABLE IF NOT EXISTS booking_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    product_id VARCHAR(50),
    product_code VARCHAR(50),
    product_name VARCHAR(255),
    category VARCHAR(50),
    duration INTEGER DEFAULT 60,
    price NUMERIC(10,2),
    room VARCHAR(100),
    kids_count INTEGER,
    hosts INTEGER DEFAULT 1,
    second_animator_name VARCHAR(255),
    pinata_filler VARCHAR(255),
    costume VARCHAR(255),
    notes TEXT,
    is_favorite BOOLEAN DEFAULT false,
    usage_count INTEGER DEFAULT 0,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_templates_favorite ON booking_templates(is_favorite);
CREATE INDEX IF NOT EXISTS idx_booking_templates_usage ON booking_templates(usage_count DESC);
