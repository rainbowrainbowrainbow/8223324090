-- MIGRATION_KIND: schema
-- SAFETY: Add empty historical test-drain state; no existing data changes.
-- ROLLBACK: Retain all history and active gates; use drain-aware compatibility code.
DO $migration$
BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_fiscal_shifts_id_profile_register_drain' AND conrelid = 'fiscal_shifts'::regclass) THEN
ALTER TABLE fiscal_shifts
    ADD CONSTRAINT uq_fiscal_shifts_id_profile_register_drain
    UNIQUE (id, fiscal_profile_id, fiscal_register_id);
END IF;
END;
$migration$;

CREATE TABLE IF NOT EXISTS fiscal_register_payment_drains (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL,
    fiscal_register_id BIGINT NOT NULL,
    fiscal_shift_id BIGINT NOT NULL UNIQUE,
    initiating_route_option_id VARCHAR(64) NOT NULL
        REFERENCES fiscal_sale_routes(route_option_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    scope_fingerprint CHAR(64) NOT NULL
        CHECK (scope_fingerprint ~ '^[0-9a-f]{64}$'),
    initiated_by_user_id INTEGER NOT NULL REFERENCES users(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    drain_idempotency_key VARCHAR(255) NOT NULL UNIQUE
        CHECK (drain_idempotency_key LIKE 'drain:%'),
    status VARCHAR(16) NOT NULL
        CHECK (status IN ('draining', 'closed', 'resumed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    resumed_at TIMESTAMPTZ,
    resumed_by_user_id INTEGER REFERENCES users(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    resume_idempotency_key VARCHAR(255) UNIQUE
        CHECK (resume_idempotency_key LIKE 'resume:%'),
    CHECK (
        (status = 'draining' AND closed_at IS NULL)
        OR (status IN ('closed', 'resumed') AND closed_at IS NOT NULL)
    ),
    CHECK (
        (status = 'resumed' AND resumed_at IS NOT NULL
         AND resumed_by_user_id IS NOT NULL AND resume_idempotency_key IS NOT NULL)
        OR (status <> 'resumed' AND resumed_at IS NULL
            AND resumed_by_user_id IS NULL AND resume_idempotency_key IS NULL)
    ),
    CHECK (closed_at IS NULL OR closed_at >= started_at),
    CHECK (resumed_at IS NULL OR resumed_at >= closed_at),
    CHECK (resumed_by_user_id IS NULL
           OR resumed_by_user_id = initiated_by_user_id),
    CONSTRAINT fk_payment_drains_exact_shift
        FOREIGN KEY (fiscal_shift_id, fiscal_profile_id, fiscal_register_id)
        REFERENCES fiscal_shifts(id, fiscal_profile_id, fiscal_register_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_drains_one_active_register
    ON fiscal_register_payment_drains (fiscal_register_id)
    WHERE status IN ('draining', 'closed');

CREATE OR REPLACE FUNCTION enforce_test_drain_lifecycle_v352()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'test_drain_history_immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'draining' THEN
            RAISE EXCEPTION 'test_drain_initial_state_invalid' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
    IF ROW(NEW.id, NEW.fiscal_profile_id, NEW.fiscal_register_id, NEW.fiscal_shift_id,
           NEW.initiating_route_option_id, NEW.scope_fingerprint, NEW.initiated_by_user_id,
           NEW.drain_idempotency_key, NEW.started_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.fiscal_profile_id, OLD.fiscal_register_id, OLD.fiscal_shift_id,
           OLD.initiating_route_option_id, OLD.scope_fingerprint, OLD.initiated_by_user_id,
           OLD.drain_idempotency_key, OLD.started_at)
       OR NOT ((OLD.status = 'draining' AND NEW.status = 'closed')
           OR (OLD.status = 'closed' AND NEW.status = 'resumed'
               AND NEW.closed_at IS NOT DISTINCT FROM OLD.closed_at)) THEN
        RAISE EXCEPTION 'test_drain_transition_invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

DO $migration$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_test_drain_lifecycle_v352' AND tgrelid='fiscal_register_payment_drains'::regclass) THEN
CREATE TRIGGER trg_test_drain_lifecycle_v352
    BEFORE INSERT OR UPDATE OR DELETE ON fiscal_register_payment_drains
    FOR EACH ROW EXECUTE FUNCTION enforce_test_drain_lifecycle_v352();
END IF; END; $migration$;

CREATE OR REPLACE FUNCTION record_closed_test_drain_v352()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE closed_drain fiscal_register_payment_drains%ROWTYPE;
BEGIN
    IF NEW.status = 'closed' AND NEW.lifecycle_stage = 'CLOSED' THEN
        FOR closed_drain IN
            UPDATE fiscal_register_payment_drains
               SET status = 'closed', closed_at = clock_timestamp()
             WHERE fiscal_shift_id = NEW.id AND fiscal_profile_id = NEW.fiscal_profile_id
               AND fiscal_register_id = NEW.fiscal_register_id AND status = 'draining'
             RETURNING *
        LOOP
            INSERT INTO fiscal_audit_events (fiscal_profile_id, actor_user_id, event_type,
                entity_table, entity_id, idempotency_key, after_snapshot)
            VALUES (closed_drain.fiscal_profile_id, closed_drain.initiated_by_user_id,
                'shared_test_closed', 'fiscal_register_payment_drains', closed_drain.id,
                'shared_test_closed:' || closed_drain.id,
                jsonb_build_object('id', closed_drain.id, 'status', 'closed', 'shiftId', NEW.id));
        END LOOP;
    END IF;
    RETURN NEW;
END;
$function$;
DO $migration$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_record_closed_test_drain_v352' AND tgrelid='fiscal_shifts'::regclass) THEN
CREATE TRIGGER trg_record_closed_test_drain_v352
    AFTER UPDATE OF status, lifecycle_stage ON fiscal_shifts
    FOR EACH ROW EXECUTE FUNCTION record_closed_test_drain_v352();
END IF; END; $migration$;
