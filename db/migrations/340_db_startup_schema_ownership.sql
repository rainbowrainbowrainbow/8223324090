-- MIGRATION_KIND: schema
-- SAFETY: Additive/idempotent ownership migration for schema contracts that were historically carried by initDatabase() startup compatibility SQL. It uses CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and COMMENT only. It does not insert, update, delete, or rewrite production data.
-- ROLLBACK: Drop only objects introduced by this migration after confirming runtime code no longer depends on them; otherwise leave the idempotent schema in place. No data rollback is required because this migration does not mutate data.

-- Legacy task automation fields formerly created only by startup compatibility SQL.
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS task_type VARCHAR(10) DEFAULT 'human',
    ADD COLUMN IF NOT EXISTS owner VARCHAR(50),
    ADD COLUMN IF NOT EXISTS deadline TIMESTAMP,
    ADD COLUMN IF NOT EXISTS time_window_start VARCHAR(10),
    ADD COLUMN IF NOT EXISTS time_window_end VARCHAR(10),
    ADD COLUMN IF NOT EXISTS dependency_ids INTEGER[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS control_policy JSONB DEFAULT '{"reminder_minutes":[60,30,10],"escalation_after_minutes":120}'::jsonb,
    ADD COLUMN IF NOT EXISTS escalation_level INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(30) DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS source_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_tasks_escalation ON tasks(escalation_level);

CREATE TABLE IF NOT EXISTS task_logs (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    action VARCHAR(30) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    actor VARCHAR(50) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_logs_created_at ON task_logs(created_at);

CREATE TABLE IF NOT EXISTS user_points (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    permanent_points INTEGER DEFAULT 0,
    monthly_points INTEGER DEFAULT 0,
    month VARCHAR(7) NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(username, month)
);

CREATE INDEX IF NOT EXISTS idx_user_points_username ON user_points(username);

CREATE TABLE IF NOT EXISTS point_transactions (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    points INTEGER NOT NULL,
    type VARCHAR(10) NOT NULL DEFAULT 'monthly',
    reason VARCHAR(200),
    task_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_point_transactions_username ON point_transactions(username);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT,
    ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(100);

CREATE TABLE IF NOT EXISTS user_action_log (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    target VARCHAR(100),
    meta JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_action_log_username ON user_action_log(username);
CREATE INDEX IF NOT EXISTS idx_user_action_log_created_at ON user_action_log(created_at);

CREATE TABLE IF NOT EXISTS user_streaks (
    username VARCHAR(50) PRIMARY KEY,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_active_date VARCHAR(20),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kleshnya_messages (
    id SERIAL PRIMARY KEY,
    scope VARCHAR(30) NOT NULL DEFAULT 'daily_greeting',
    target_date VARCHAR(20),
    target_user VARCHAR(50),
    message TEXT NOT NULL,
    context JSONB,
    source VARCHAR(20) DEFAULT 'template',
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kleshnya_messages_scope ON kleshnya_messages(scope, target_date);
CREATE INDEX IF NOT EXISTS idx_kleshnya_messages_expires ON kleshnya_messages(expires_at);

CREATE TABLE IF NOT EXISTS design_tags (
    design_id INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    tag VARCHAR(50) NOT NULL,
    PRIMARY KEY (design_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_design_tags_tag ON design_tags(tag);

CREATE INDEX IF NOT EXISTS idx_designs_collection ON designs(collection_id);
CREATE INDEX IF NOT EXISTS idx_designs_pinned ON designs(is_pinned);
CREATE INDEX IF NOT EXISTS idx_designs_publish_date ON designs(publish_date);

CREATE INDEX IF NOT EXISTS idx_contractors_active ON contractors(is_active);
CREATE INDEX IF NOT EXISTS idx_contractors_invite ON contractors(invite_token);

CREATE TABLE IF NOT EXISTS contractor_notifications (
    id SERIAL PRIMARY KEY,
    contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
    booking_id VARCHAR(50),
    rule_id INTEGER,
    message_id INTEGER,
    status VARCHAR(20) DEFAULT 'sent',
    responded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractor_notif_contractor ON contractor_notifications(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_notif_status ON contractor_notifications(status);

ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30),
    ADD COLUMN IF NOT EXISTS skip_notification BOOLEAN DEFAULT false;

ALTER TABLE certificates
    ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id),
    ADD COLUMN IF NOT EXISTS value_uah INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_customers_child_name ON customers(child_name);

CREATE TABLE IF NOT EXISTS finance_transactions (
    id SERIAL PRIMARY KEY,
    type VARCHAR(10) NOT NULL,
    category_id INTEGER REFERENCES finance_categories(id),
    amount INTEGER NOT NULL,
    description TEXT,
    date VARCHAR(20) NOT NULL,
    payment_method VARCHAR(30),
    booking_id VARCHAR(50),
    staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    certificate_id INTEGER REFERENCES certificates(id) ON DELETE SET NULL,
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_categories_type ON finance_categories(type);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_type ON finance_transactions(type);

COMMENT ON TABLE task_logs IS 'Task change ledger; durable owner moved from initDatabase startup compatibility to migration 340.';
COMMENT ON TABLE user_points IS 'Legacy task points aggregate; durable owner moved from initDatabase startup compatibility to migration 340.';
COMMENT ON TABLE point_transactions IS 'Legacy task points transaction ledger; durable owner moved from initDatabase startup compatibility to migration 340.';
COMMENT ON TABLE user_action_log IS 'User action audit log; durable owner moved from initDatabase startup compatibility to migration 340.';
COMMENT ON TABLE user_streaks IS 'Legacy user streak aggregate; durable owner moved from initDatabase startup compatibility to migration 340.';
COMMENT ON TABLE kleshnya_messages IS 'Kleshnya generated-message cache; durable owner moved from initDatabase startup compatibility to migration 340.';
COMMENT ON TABLE design_tags IS 'Design tag join table; durable owner moved from initDatabase startup compatibility to migration 340.';
COMMENT ON TABLE contractor_notifications IS 'Contractor notification delivery log; durable owner moved from initDatabase startup compatibility to migration 340.';
