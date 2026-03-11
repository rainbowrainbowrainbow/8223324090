-- v22.18: Auto-reviews after events + Team pulse tracker

-- Event reviews from customers
CREATE TABLE IF NOT EXISTS event_reviews (
    id SERIAL PRIMARY KEY,
    booking_id VARCHAR(50) REFERENCES bookings(id) ON DELETE SET NULL,
    customer_name VARCHAR(200),
    customer_phone VARCHAR(50),
    telegram_chat_id BIGINT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_reviews_booking ON event_reviews (booking_id);
CREATE INDEX IF NOT EXISTS idx_event_reviews_rating ON event_reviews (rating);

-- Track which bookings already had review requests sent
CREATE TABLE IF NOT EXISTS review_requests_sent (
    booking_id VARCHAR(50) PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
    sent_at TIMESTAMP DEFAULT NOW()
);

-- Team pulse — anonymous daily mood tracker (#23)
CREATE TABLE IF NOT EXISTS team_pulse (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
    comment TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_pulse_date ON team_pulse (date);
