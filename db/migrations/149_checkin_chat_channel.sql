-- v41.0: Create system chat channel for face check-in logs
INSERT INTO chat_channels (slug, name, description, type, is_default)
VALUES ('checkin-log', '📸 Check-in', 'Автоматичний журнал приходу/виходу працівників', 'general', false)
ON CONFLICT (slug) DO NOTHING;
