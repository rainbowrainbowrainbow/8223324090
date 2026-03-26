-- v33.7.0: Booking-linked chat channels
ALTER TABLE chat_channels
    ADD COLUMN IF NOT EXISTS linked_booking_id VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_chat_channels_booking
    ON chat_channels(linked_booking_id)
    WHERE linked_booking_id IS NOT NULL;
