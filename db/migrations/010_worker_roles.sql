-- Migration 010: Digital Worker Forge v1 — standardized worker role templates
-- v17.10.0: Create worker_roles table for managing AI/bot/hybrid workers

CREATE TABLE IF NOT EXISTS worker_roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(200) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'bot',
    purpose TEXT NOT NULL,
    inputs JSONB DEFAULT '[]',
    actions JSONB DEFAULT '[]',
    limits JSONB DEFAULT '[]',
    escalations JSONB DEFAULT '[]',
    timers JSONB DEFAULT '{}',
    logs JSONB DEFAULT '[]',
    fallback TEXT,
    monitoring JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    version VARCHAR(20) DEFAULT '1.0',
    owner VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_roles_active ON worker_roles(is_active);

-- Seed 3 initial roles

INSERT INTO worker_roles (name, display_name, type, purpose, inputs, actions, limits, escalations, timers, logs, fallback, monitoring, owner, version)
VALUES
(
    'kleshnya',
    'Клешня (OpenClaw)',
    'bot',
    'Координатор задач, ескалації, нагадування. Основний цифровий воркер парку.',
    '["bookings", "tasks", "staff_schedule", "telegram_messages"]',
    '["create_task", "assign_task", "send_reminder", "escalate", "award_points", "send_telegram"]',
    '["no_financial_operations", "no_booking_delete", "no_user_management"]',
    '[{"level": 1, "action": "reminder", "after_minutes": 60}, {"level": 2, "action": "urgent_reminder", "after_minutes": 120}, {"level": 3, "action": "notify_admin", "after_minutes": 180}, {"level": 4, "action": "escalate_to_director", "after_minutes": 240}]',
    '{"reminder_interval_minutes": 60, "escalation_after_minutes": 120, "daily_digest": "09:00", "evening_report": "19:00"}',
    '["task_created", "task_completed", "task_escalated", "reminder_sent", "points_awarded"]',
    'При недоступності Telegram — логувати і повторити через 5 хв. При збої БД — зупинити і алертнути адміна.',
    '{"tasks_created_today": 0, "escalations_today": 0, "reminders_sent_today": 0}',
    'Сергій',
    '1.0'
),
(
    'svitlana',
    'Світлана Task Bot',
    'bot',
    'Ранкова розсилка задач аніматорам, трекінг виконання, вечірній звіт.',
    '["tasks", "staff_schedule", "hr_shifts"]',
    '["send_morning_tasks", "track_task_done", "send_evening_report", "notify_animator"]',
    '["no_task_creation", "no_financial_operations", "read_only_bookings"]',
    '[{"level": 1, "action": "repeat_task_list", "after_minutes": 120}, {"level": 2, "action": "notify_admin_undone", "after_minutes": 240}]',
    '{"morning_tasks": "shift_start_minus_30m", "evening_report": "19:00", "check_interval_minutes": 60}',
    '["tasks_sent", "task_marked_done", "evening_report_sent"]',
    'При недоступності Telegram — повторити через 10 хв (макс 3 рази).',
    '{"tasks_sent_today": 0, "tasks_done_today": 0, "reports_sent_today": 0}',
    'Сергій',
    '1.0'
),
(
    'warehouse_bot',
    'Warehouse Bot',
    'bot',
    'Моніторинг запасів, алерти про низький stock, автозамовлення при досягненні мінімуму.',
    '["warehouse_stock", "procurement_lists", "bookings"]',
    '["check_stock_levels", "send_low_stock_alert", "create_procurement_item", "update_stock_after_booking"]',
    '["no_financial_operations", "no_direct_purchases", "max_alert_3_per_day_per_item"]',
    '[{"level": 1, "action": "alert_warehouse_manager", "trigger": "stock_below_minimum"}, {"level": 2, "action": "alert_admin", "trigger": "stock_zero"}]',
    '{"stock_check_interval_minutes": 120, "alert_cooldown_hours": 24}',
    '["stock_checked", "low_stock_alert_sent", "procurement_item_created"]',
    'При збоях — логувати і продовжити перевірку інших товарів.',
    '{"items_checked_today": 0, "alerts_sent_today": 0}',
    'Сергій',
    '1.0'
)
ON CONFLICT (name) DO NOTHING;
