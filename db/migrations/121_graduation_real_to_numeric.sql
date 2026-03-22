-- Migration 121: Fix graduation_services monetary columns from REAL to NUMERIC(10,2)
-- REAL (float4) causes rounding errors for currency calculations

DO $$
DECLARE
    col_rec RECORD;
BEGIN
    -- Convert all REAL columns in graduation_services to NUMERIC(10,2)
    FOR col_rec IN
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'graduation_services'
          AND data_type = 'real'
    LOOP
        EXECUTE format('ALTER TABLE graduation_services ALTER COLUMN %I TYPE NUMERIC(10,2)', col_rec.column_name);
    END LOOP;

    -- graduation_settings: value column
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'graduation_settings' AND column_name = 'value' AND data_type = 'real') THEN
        ALTER TABLE graduation_settings ALTER COLUMN value TYPE NUMERIC(10,2);
    END IF;
END
$$;
