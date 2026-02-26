-- Migration 018: Backend hardening — indexes, triggers, scheduler tracking, audit
-- v19.10.0 — [claude-code]
-- Date: 2026-02-26

-- ============================================
-- 1. MISSING INDEXES ON FK COLUMNS
-- ============================================

-- bookings FK indexes
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_recurring_template_id ON bookings(recurring_template_id);
CREATE INDEX IF NOT EXISTS idx_bookings_linked_to ON bookings(linked_to);
CREATE INDEX IF NOT EXISTS idx_bookings_line_id ON bookings(line_id);

-- tasks FK indexes
CREATE INDEX IF NOT EXISTS idx_tasks_template_id ON tasks(template_id);
CREATE INDEX IF NOT EXISTS idx_tasks_afisha_id ON tasks(afisha_id);

-- afisha FK indexes
CREATE INDEX IF NOT EXISTS idx_afisha_template_id ON afisha(template_id);
CREATE INDEX IF NOT EXISTS idx_afisha_line_id ON afisha(line_id);

-- finance FK indexes
CREATE INDEX IF NOT EXISTS idx_finance_transactions_category ON finance_transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_booking ON finance_transactions(booking_id);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_date ON finance_transactions(date);

-- certificates FK indexes
CREATE INDEX IF NOT EXISTS idx_certificates_customer_id ON certificates(customer_id);

-- procurement FK indexes
CREATE INDEX IF NOT EXISTS idx_procurement_items_list ON procurement_items(list_id);
CREATE INDEX IF NOT EXISTS idx_procurement_items_stock ON procurement_items(stock_id);

-- discount FK indexes
CREATE INDEX IF NOT EXISTS idx_discount_usage_code ON discount_usage(discount_code_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_customer ON discount_usage(customer_id);

-- support FK indexes
CREATE INDEX IF NOT EXISTS idx_support_tickets_customer ON support_tickets(customer_id);

-- employee profiles
CREATE INDEX IF NOT EXISTS idx_employee_profiles_department ON employee_profiles(department);

-- ============================================
-- 2. SCHEDULER EXECUTION TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS scheduler_executions (
    id SERIAL PRIMARY KEY,
    scheduler_name VARCHAR(100) NOT NULL,
    last_run_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_run_date VARCHAR(10),
    result VARCHAR(20) DEFAULT 'success',
    consecutive_failures INTEGER DEFAULT 0,
    is_paused BOOLEAN DEFAULT false,
    error_message TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduler_executions_name
    ON scheduler_executions(scheduler_name);

-- Seed scheduler entries
INSERT INTO scheduler_executions (scheduler_name) VALUES
    ('checkAutoDigest'),
    ('checkAutoReminder'),
    ('checkAutoBackup'),
    ('checkRecurringTasks'),
    ('checkRecurringAfisha'),
    ('checkScheduledDeletions'),
    ('checkCertificateExpiry'),
    ('checkTaskReminders'),
    ('checkWorkDayTriggers'),
    ('checkMonthlyPointsReset'),
    ('checkStreakUpdates'),
    ('checkBirthdayGreetings'),
    ('checkEventQueue'),
    ('checkSLABreach'),
    ('checkScheduledAnnouncements'),
    ('checkTaskOverdue'),
    ('checkCustomerRetention'),
    ('checkAutoReport'),
    ('checkHrAutoClose'),
    ('checkHrNoShow')
ON CONFLICT DO NOTHING;

-- ============================================
-- 3. CUSTOMER AGGREGATE TRIGGER
-- ============================================

-- Function to recalculate customer aggregates from actual bookings
CREATE OR REPLACE FUNCTION recalc_customer_aggregates()
RETURNS TRIGGER AS $$
DECLARE
    cust_id INTEGER;
BEGIN
    -- Determine which customer_id to recalculate
    IF TG_OP = 'DELETE' THEN
        cust_id := OLD.customer_id;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Recalculate both old and new customer if changed
        IF OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
            IF OLD.customer_id IS NOT NULL THEN
                UPDATE customers SET
                    total_bookings = COALESCE((
                        SELECT COUNT(*) FROM bookings
                        WHERE customer_id = OLD.customer_id AND linked_to IS NULL AND status != 'cancelled'
                    ), 0),
                    total_spent = COALESCE((
                        SELECT SUM(price) FROM bookings
                        WHERE customer_id = OLD.customer_id AND linked_to IS NULL AND status != 'cancelled'
                    ), 0),
                    last_visit = (
                        SELECT MAX(date::date) FROM bookings
                        WHERE customer_id = OLD.customer_id AND linked_to IS NULL AND status != 'cancelled'
                    ),
                    updated_at = NOW()
                WHERE id = OLD.customer_id;
            END IF;
        END IF;
        cust_id := NEW.customer_id;
    ELSE
        cust_id := NEW.customer_id;
    END IF;

    IF cust_id IS NOT NULL THEN
        UPDATE customers SET
            total_bookings = COALESCE((
                SELECT COUNT(*) FROM bookings
                WHERE customer_id = cust_id AND linked_to IS NULL AND status != 'cancelled'
            ), 0),
            total_spent = COALESCE((
                SELECT SUM(price) FROM bookings
                WHERE customer_id = cust_id AND linked_to IS NULL AND status != 'cancelled'
            ), 0),
            last_visit = (
                SELECT MAX(date::date) FROM bookings
                WHERE customer_id = cust_id AND linked_to IS NULL AND status != 'cancelled'
            ),
            updated_at = NOW()
        WHERE id = cust_id;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS trg_booking_customer_aggregates ON bookings;
CREATE TRIGGER trg_booking_customer_aggregates
    AFTER INSERT OR UPDATE OF customer_id, price, status OR DELETE
    ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION recalc_customer_aggregates();

-- ============================================
-- 4. SENSITIVE ACTION AUDIT TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id SERIAL PRIMARY KEY,
    action VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'admin',
    username VARCHAR(100),
    target VARCHAR(200),
    details JSONB DEFAULT '{}',
    ip_address VARCHAR(50),
    request_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_username ON admin_audit_log(username);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);

-- ============================================
-- 5. ADD updated_at COLUMN FOR OPTIMISTIC LOCKING ON TASKS
-- ============================================
-- (tasks table already has updated_at, just ensure it exists)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
