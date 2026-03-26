-- v33.5: System user + chat event rules
INSERT INTO users (username, name, role, password_hash)
SELECT 'system', 'Система 🤖', 'viewer', '$2b$10$disabled_account_hash'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'system');

-- Auto-publish rules for chat channels
-- channel_id: 1=#команда, 2=#бронювання, 3=#каса (verified live)
INSERT INTO rule_definitions (code, name, trigger_event, conditions, actions, is_active, priority)
VALUES
(
    'chat_booking_created',
    'Chat: нове бронювання → #бронювання',
    'booking.created',
    '{}',
    '[{"type":"chat_message","channel_id":2,"template":"📅 {date} {time} | {program_name} | {label}"}]',
    true, 10
),
(
    'chat_booking_cancelled',
    'Chat: скасоване бронювання → #бронювання',
    'booking.cancelled',
    '{}',
    '[{"type":"chat_message","channel_id":2,"template":"❌ Скасовано: {date} {time} | {label}"}]',
    true, 10
),
(
    'chat_finance_income',
    'Chat: дохід → #каса',
    'finance.income',
    '{}',
    '[{"type":"chat_message","channel_id":3,"template":"💰 +{amount} грн | {description}"}]',
    true, 10
),
(
    'chat_task_overdue',
    'Chat: прострочена задача → #команда',
    'task.overdue',
    '{}',
    '[{"type":"chat_message","channel_id":1,"template":"⚠️ Прострочена задача: {title}"}]',
    true, 10
)
ON CONFLICT (code) DO UPDATE SET is_active = true, actions = EXCLUDED.actions;
