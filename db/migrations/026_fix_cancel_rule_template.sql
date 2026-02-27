-- v20.9.1: Fix booking_cancelled_notify rule template
-- The original template used {booking_number} but the event payload only had booking_id.
-- Now the payload includes booking_number, label, time, program_name.
-- Update template to be more informative.

UPDATE rule_definitions
SET actions = '[{"type": "send_telegram", "template": "❌ Бронювання <b>{booking_number}</b> скасовано\n🎭 {label}\n🕐 {date} | {time}\n👤 Скасував: {cancelled_by}"}]'
WHERE code = 'booking_cancelled_notify';
