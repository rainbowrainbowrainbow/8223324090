-- v33.8.0: Review ↔ customer link + average_rating
ALTER TABLE event_reviews
    ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_event_reviews_customer ON event_reviews(customer_id);

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS average_rating NUMERIC(3,2);

-- Backfill existing reviews via booking → customer
UPDATE event_reviews er
SET customer_id = b.customer_id
FROM bookings b
WHERE er.booking_id = b.id
  AND b.customer_id IS NOT NULL
  AND er.customer_id IS NULL;

-- Seed average_rating for existing customers
UPDATE customers c SET average_rating = sub.avg_r
FROM (
    SELECT er.customer_id, AVG(er.rating)::NUMERIC(3,2) AS avg_r
    FROM event_reviews er
    WHERE er.customer_id IS NOT NULL
    GROUP BY er.customer_id
) sub
WHERE sub.customer_id = c.id;
