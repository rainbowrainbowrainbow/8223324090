-- v20.9.22: Deactivate booking_cancelled_notify rule
-- Cancellation Telegram notifications were being sent to General topic (thread 0)
-- because telegram_thread_id was not configured. Disabling rule to stop unwanted messages.
-- The event publishEvent('booking.cancelled') was also removed from bookings.js.

UPDATE rule_definitions
SET is_active = false
WHERE code = 'booking_cancelled_notify';
