-- v38.4.0: Missing indexes + FK ON DELETE cleanup

-- 1. Create missing indexes
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_status_date ON leads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_program_id ON bookings(program_id);
CREATE INDEX IF NOT EXISTS idx_finance_trans_category ON finance_transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_staff_hire_date ON staff(hire_date);

-- 2. FK ON DELETE cleanup for critical tables

-- bookings.customer_id → ON DELETE SET NULL
DO $$ BEGIN
    ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_customer_id_fkey;
    ALTER TABLE bookings ADD CONSTRAINT bookings_customer_id_fkey
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- discount_usage.customer_id → ON DELETE SET NULL
DO $$ BEGIN
    ALTER TABLE discount_usage DROP CONSTRAINT IF EXISTS discount_usage_customer_id_fkey;
    ALTER TABLE discount_usage ADD CONSTRAINT discount_usage_customer_id_fkey
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
