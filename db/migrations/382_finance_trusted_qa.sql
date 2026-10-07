-- MIGRATION_KIND: schema
-- SAFETY: Additive test-run ownership and fail-closed writer fences apply only to exact registered finance QA entities. No existing business rows are reclassified or modified. Run ownership survives expiry and cleanup.
-- ROLLBACK: Disable new QA runs and retain ownership guards, registry and journal evidence. Use a compatible application; removing these guards or deploying a pre382 binary after QA records exist is unsafe.
-- OPERATOR_APPROVAL: required
-- DATA_SCOPE: Schema-only guards for exact finance_money_qa_runs ownership in event_genix; no existing record updates or date-scoped data changes.

-- Transaction-local limits: each lock wait is bounded; each DDL statement has its own deadline.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS finance_money_qa_runs (
    run_id BIGINT PRIMARY KEY REFERENCES trusted_qa_runs(id) ON DELETE RESTRICT,
    business_context VARCHAR(64) NOT NULL CHECK (business_context = 'event_genix'),
    plan_hash CHAR(64) NOT NULL CHECK (plan_hash ~ '^[a-f0-9]{64}$'),
    plan JSONB NOT NULL,
    max_operations INTEGER NOT NULL CHECK (max_operations BETWEEN 1 AND 40),
    max_amount_minor BIGINT NOT NULL CHECK (max_amount_minor BETWEEN 1 AND 1000000),
    max_positive_minor BIGINT NOT NULL CHECK (max_positive_minor BETWEEN 1 AND 3000000 AND max_positive_minor >= max_amount_minor),
    operation_count INTEGER NOT NULL DEFAULT 0 CHECK (operation_count BETWEEN 0 AND max_operations),
    positive_minor BIGINT NOT NULL DEFAULT 0 CHECK (positive_minor BETWEEN 0 AND max_positive_minor),
    UNIQUE (run_id, business_context)
);

DO $$ DECLARE table_name TEXT; BEGIN
    FOREACH table_name IN ARRAY ARRAY['finance_accounts', 'finance_categories', 'finance_manual_accounts',
        'finance_manual_booking_scopes', 'finance_manual_operations', 'finance_manual_legs', 'cash_register_shifts'] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS finance_qa_run_id BIGINT', table_name);
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_finance_qa_run_v382' AND conrelid = table_name::regclass) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT fk_finance_qa_run_v382 FOREIGN KEY (finance_qa_run_id, business_context) REFERENCES finance_money_qa_runs(run_id, business_context) ON DELETE RESTRICT', table_name);
        END IF;
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(finance_qa_run_id) WHERE finance_qa_run_id IS NOT NULL', 'idx_' || table_name || '_qa_v382', table_name);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION finance_qa_booking_run_v382(booking_ref TEXT) RETURNS BIGINT LANGUAGE sql STABLE STRICT AS $$
    SELECT e.run_id FROM trusted_qa_run_entities e JOIN finance_money_qa_runs f ON f.run_id = e.run_id
    WHERE e.entity_type = 'booking' AND e.entity_id = booking_ref LIMIT 1
$$;

CREATE OR REPLACE FUNCTION finance_qa_account_run_v382(account_ref TEXT, account_name_ref TEXT DEFAULT NULL) RETURNS BIGINT LANGUAGE sql STABLE AS $$
    SELECT a.finance_qa_run_id FROM finance_accounts a WHERE a.finance_qa_run_id IS NOT NULL
    AND (a.id::text = account_ref OR a.name = account_name_ref) LIMIT 1
$$;

CREATE OR REPLACE FUNCTION finance_qa_context_active_v382(run_ref BIGINT) RETURNS BOOLEAN LANGUAGE sql VOLATILE AS $$
    SELECT COALESCE(EXISTS(SELECT 1 FROM finance_money_qa_runs f JOIN trusted_qa_runs r ON r.id = f.run_id
        WHERE f.run_id = run_ref AND r.business_context = f.business_context
        AND r.id::text = current_setting('app.finance_qa_run_id', true)
        AND r.required_user_id::text = current_setting('app.finance_qa_actor_id', true)
        AND r.operator_user_id = r.required_user_id AND r.state = 'active' AND r.expires_at > clock_timestamp()), false)
$$;

CREATE OR REPLACE FUNCTION protect_finance_qa_record_v382() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE old_row JSONB; new_row JSONB; run_ref BIGINT; related_run BIGINT; key_name TEXT; related_id TEXT;
BEGIN
    IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
    run_ref := COALESCE((old_row->>'finance_qa_run_id')::bigint, (new_row->>'finance_qa_run_id')::bigint);
    IF TG_OP = 'UPDATE' AND old_row->>'finance_qa_run_id' IS DISTINCT FROM new_row->>'finance_qa_run_id' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finance QA ownership cannot be added, removed or transferred';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF run_ref IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finance QA evidence cannot be deleted'; END IF;
        RETURN OLD;
    END IF;
    IF TG_TABLE_NAME = 'finance_accounts' AND new_row->>'name' ~ '^QA FIN [0-9]+ · ' THEN
        -- Name-only legacy writers must never confuse a synthetic account with another account.
        PERFORM pg_advisory_xact_lock(hashtextextended('finance-qa-account-name:' || (new_row->>'name'), 0));
        IF EXISTS(SELECT 1 FROM finance_accounts a WHERE a.name = new_row->>'name'
            AND a.id::text <> new_row->>'id' AND (run_ref IS NOT NULL OR a.finance_qa_run_id IS NOT NULL)) THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finance QA account name must be globally unambiguous';
        END IF;
    END IF;
    -- A null marker cannot reference QA entities, including through an original reversal.
    IF TG_TABLE_NAME IN ('finance_manual_accounts', 'finance_manual_legs', 'cash_register_shifts') THEN
        related_run := finance_qa_account_run_v382(new_row->>'account_id');
        IF related_run IS DISTINCT FROM run_ref THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Manual account and QA run ownership must match';
        END IF;
    END IF;
    IF TG_TABLE_NAME IN ('finance_manual_booking_scopes', 'finance_manual_operations') AND new_row->>'booking_id' IS NOT NULL THEN
        related_run := finance_qa_booking_run_v382(new_row->>'booking_id');
        IF related_run IS DISTINCT FROM run_ref THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Manual booking and QA run ownership must match';
        END IF;
    END IF;
    IF TG_TABLE_NAME = 'finance_manual_operations' THEN
        IF new_row->>'category_id' IS NOT NULL THEN
            SELECT finance_qa_run_id INTO related_run FROM finance_categories WHERE id = (new_row->>'category_id')::integer;
            IF related_run IS DISTINCT FROM run_ref THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Manual category and QA run ownership must match'; END IF;
        END IF;
        IF new_row->>'original_id' IS NOT NULL THEN
            SELECT finance_qa_run_id INTO related_run FROM finance_manual_operations WHERE id = (new_row->>'original_id')::bigint;
            IF related_run IS DISTINCT FROM run_ref THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Original operation and QA run ownership must match'; END IF;
        END IF;
    END IF;
    IF TG_TABLE_NAME = 'finance_manual_legs' THEN
        SELECT finance_qa_run_id INTO related_run FROM finance_manual_operations WHERE id = (new_row->>'operation_id')::bigint;
        IF related_run IS DISTINCT FROM run_ref THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Manual leg and QA operation ownership must match'; END IF;
        IF new_row->>'shift_id' IS NOT NULL THEN
            SELECT finance_qa_run_id INTO related_run FROM cash_register_shifts WHERE id = (new_row->>'shift_id')::integer;
            IF related_run IS DISTINCT FROM run_ref THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Manual shift and QA run ownership must match'; END IF;
        END IF;
    END IF;
    IF run_ref IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('finance_accounts', 'finance_categories') THEN
        FOREACH key_name IN ARRAY ARRAY['name', 'type', 'business_context', 'is_personal', 'is_system'] LOOP
            IF (TG_TABLE_NAME = 'finance_accounts' OR key_name <> 'name') AND old_row->key_name IS DISTINCT FROM new_row->key_name THEN
                RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finance QA account identity and category ownership are immutable';
            END IF;
        END LOOP;
        IF run_ref::text = current_setting('app.finance_qa_finish_run_id', true)
            AND new_row->>'is_active' = 'false'
            AND (old_row - 'is_active' - 'updated_at') = (new_row - 'is_active' - 'updated_at') THEN RETURN NEW; END IF;
    END IF;
    IF NOT finance_qa_context_active_v382(run_ref) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An active exact finance QA transaction context is required';
    END IF;
    IF TG_TABLE_NAME = 'finance_accounts' AND (new_row->>'is_personal' = 'true'
        OR new_row->>'name' NOT LIKE 'QA FIN ' || run_ref::text || ' · %') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'QA accounts must keep their isolated server-assigned identity';
    END IF;
    IF TG_TABLE_NAME = 'finance_manual_operations' AND new_row->>'actor_user_id' <> current_setting('app.finance_qa_actor_id', true) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'QA operation actor must match its exact run';
    END IF;
    RETURN NEW;
END $$;

DO $$ DECLARE table_name TEXT; BEGIN
    FOREACH table_name IN ARRAY ARRAY['finance_accounts', 'finance_categories', 'finance_manual_accounts',
        'finance_manual_booking_scopes', 'finance_manual_operations', 'finance_manual_legs', 'cash_register_shifts'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_finance_qa_record_v382' AND tgrelid = table_name::regclass) THEN
            EXECUTE format('CREATE TRIGGER trg_finance_qa_record_v382 BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_finance_qa_record_v382()', table_name);
        END IF;
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION protect_finance_qa_plan_v382() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR (to_jsonb(OLD) - 'operation_count' - 'positive_minor') <> (to_jsonb(NEW) - 'operation_count' - 'positive_minor')
        OR NEW.operation_count < OLD.operation_count OR NEW.positive_minor < OLD.positive_minor
        OR NOT finance_qa_context_active_v382(OLD.run_id) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finance QA plan is immutable; only active bounded usage may increase';
    END IF;
    RETURN NEW;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_finance_qa_plan_v382' AND tgrelid = 'finance_money_qa_runs'::regclass) THEN
        CREATE TRIGGER trg_finance_qa_plan_v382 BEFORE UPDATE OR DELETE ON finance_money_qa_runs FOR EACH ROW EXECUTE FUNCTION protect_finance_qa_plan_v382();
    END IF;
END $$;

CREATE OR REPLACE FUNCTION protect_finance_qa_booking_v382() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE run_ref BIGINT;
BEGIN
    run_ref := finance_qa_booking_run_v382(OLD.id);
    IF run_ref IS NULL THEN IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
    IF TG_OP = 'UPDATE' AND run_ref::text = current_setting('app.finance_qa_finish_run_id', true)
        AND NEW.status = 'cancelled' AND NEW.skip_notification = true
        AND (to_jsonb(OLD) - 'status' - 'skip_notification' - 'updated_at') = (to_jsonb(NEW) - 'status' - 'skip_notification' - 'updated_at') THEN RETURN NEW; END IF;
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Registered finance QA bookings are immutable outside exact finish cancellation';
END $$;

CREATE OR REPLACE FUNCTION protect_finance_qa_registry_v382() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE run_ref BIGINT; booking_row JSONB; run_row RECORD;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT r.* INTO run_row FROM finance_money_qa_runs f JOIN trusted_qa_runs r ON r.id = f.run_id WHERE f.run_id = NEW.run_id;
        IF FOUND AND NEW.entity_type = 'booking' THEN
            SELECT to_jsonb(b) INTO booking_row FROM bookings b WHERE b.id = NEW.entity_id;
            IF booking_row IS NULL OR booking_row->>'business_context' IS DISTINCT FROM run_row.business_context
                OR booking_row->>'customer_id' IS NOT NULL OR booking_row->>'certificate_id' IS NOT NULL
                OR NULLIF(booking_row->>'linked_to', '') IS NOT NULL
                OR COALESCE((booking_row->>'paid_amount')::bigint, 0) <> 0
                OR booking_row->>'payment_status' IN ('paid', 'partial')
                OR booking_row#>>'{extra_data,disposableQa,runId}' IS DISTINCT FROM run_row.run_id
                OR booking_row#>>'{extra_data,disposableQa,testCustomerMarker}' IS DISTINCT FROM run_row.test_customer_marker
                OR booking_row#>>'{extra_data,disposableQa,source}' IS DISTINCT FROM 'trusted_qa'
                OR booking_row->>'skip_notification' IS DISTINCT FROM 'true' THEN
                RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finance QA booking registration requires an isolated canonical disposable booking';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    SELECT run_id INTO run_ref FROM finance_money_qa_runs WHERE run_id = OLD.run_id;
    IF run_ref IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.run_id IS DISTINCT FROM NEW.run_id
        OR OLD.entity_type IS DISTINCT FROM NEW.entity_type OR OLD.entity_id IS DISTINCT FROM NEW.entity_id) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finance QA registry ownership is permanent';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_finance_qa_booking_v382' AND tgrelid = 'bookings'::regclass) THEN
        CREATE TRIGGER trg_finance_qa_booking_v382 BEFORE UPDATE OR DELETE ON bookings FOR EACH ROW EXECUTE FUNCTION protect_finance_qa_booking_v382();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_finance_qa_registry_v382' AND tgrelid = 'trusted_qa_run_entities'::regclass) THEN
        CREATE TRIGGER trg_finance_qa_registry_v382 BEFORE INSERT OR UPDATE OR DELETE ON trusted_qa_run_entities FOR EACH ROW EXECUTE FUNCTION protect_finance_qa_registry_v382();
    END IF;
END $$;

-- Deferred checks also catch a canonical booking's links created before its registry row.
-- These foreign domains never accept finance QA references, even with an active QA token.
CREATE OR REPLACE FUNCTION reject_foreign_finance_qa_reference_v382() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE row_data JSONB; ref TEXT; field_name TEXT; snapshot JSONB;
BEGIN
    row_data := to_jsonb(NEW);
    FOREACH field_name IN ARRAY ARRAY['booking_id', 'primary_booking_id', 'booking_a_id', 'booking_b_id', 'linked_to'] LOOP
        ref := row_data->>field_name;
        IF finance_qa_booking_run_v382(ref) IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Foreign writers cannot reference finance QA bookings';
        END IF;
    END LOOP;
    IF row_data->>'source_type' = 'booking' AND finance_qa_booking_run_v382(row_data->>'source_id') IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Fiscal orders cannot reference finance QA bookings';
    END IF;
    IF finance_qa_account_run_v382(row_data->>'account_id', row_data->>'account_name') IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Legacy, payroll, bot and personal writers cannot use finance QA accounts';
    END IF;
    IF EXISTS(SELECT 1 FROM finance_categories c WHERE c.finance_qa_run_id IS NOT NULL AND c.id::text IN (row_data->>'category_id', row_data->>'finance_category_id')) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Legacy writers cannot use finance QA categories';
    END IF;
    snapshot := COALESCE(row_data->'source_snapshot', '{}'::jsonb);
    IF finance_qa_booking_run_v382(COALESCE(snapshot->>'booking_id', snapshot->>'bookingId')) IS NOT NULL
        OR finance_qa_account_run_v382(COALESCE(snapshot->>'account_id', snapshot->>'accountId'), COALESCE(snapshot->>'account_name', snapshot->>'accountName')) IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Fiscal snapshots cannot reference finance QA money entities';
    END IF;
    RETURN NEW;
END $$;

DO $$ DECLARE table_name TEXT; BEGIN
    FOREACH table_name IN ARRAY ARRAY['bookings', 'budget_plans', 'report_bot_category_map', 'finance_transactions', 'reports', 'personal_account_transactions', 'report_bot_submissions',
        'receipts', 'payment_orders', 'banquet_deposits', 'banquet_groups', 'banquet_group_bookings', 'booking_banquet_links'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_foreign_finance_qa_fence_v382' AND tgrelid = table_name::regclass) THEN
            EXECUTE format('CREATE CONSTRAINT TRIGGER trg_foreign_finance_qa_fence_v382 AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_foreign_finance_qa_reference_v382()', table_name);
        END IF;
    END LOOP;
END $$;

COMMENT ON TABLE finance_money_qa_runs IS 'Exact approved finance QA run budget; isolated synthetic ownership is retained permanently after expiry and cleanup.';
