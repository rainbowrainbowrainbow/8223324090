-- Migration 071: Sales Funnel v29.1.0
-- Lead types, customer cards, mailing list, payment checkbox MVP

-- Leads: new columns for categorization
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_type VARCHAR(20) DEFAULT 'quality';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS quality_category VARCHAR(30);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leads_type ON leads(lead_type);

-- Customer cards (linked to leads)
CREATE TABLE IF NOT EXISTS customer_cards (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
    event_type VARCHAR(50),
    event_date DATE,
    guest_count INTEGER,
    children_count INTEGER,
    budget_approx INTEGER,
    how_found VARCHAR(100),
    email VARCHAR(100),
    channel VARCHAR(30),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_cards_lead ON customer_cards(lead_id);

-- Mailing list
CREATE TABLE IF NOT EXISTS mailing_list (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200),
    phone VARCHAR(50),
    email VARCHAR(100),
    source_channel VARCHAR(30),
    contact_value VARCHAR(200),
    lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'active',
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailing_phone ON mailing_list(phone) WHERE phone IS NOT NULL;

-- Bookings: payment method fields for Checkbox MVP
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS fiscal_required BOOLEAN DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkbox_receipt_id VARCHAR(100);

-- Index for payment queries
CREATE INDEX IF NOT EXISTS idx_bookings_payment ON bookings(payment_method);
