-- MIGRATION_KIND: schema
-- SAFETY: Adds reply substitution uniqueness and write guards without changing historical records.
-- ROLLBACK: Retain guards while reply substitutions remain active.

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_substitution_reply_v401
    ON staff_substitutions(business_context,source_id)
    WHERE source_type='inbox_reply' AND state<>'cancelled';

CREATE OR REPLACE FUNCTION guard_staff_substitution_reply_v401()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    message_id TEXT;
    scope TEXT;
BEGIN
    IF TG_TABLE_NAME='staff_substitutions' THEN
        IF NEW.source_type='task' THEN
            PERFORM 1 FROM tasks WHERE id::text=NEW.source_id FOR NO KEY UPDATE;
            IF EXISTS (SELECT 1 FROM tasks WHERE id::text=NEW.source_id AND source_type='conversation_reply') THEN
                RAISE EXCEPTION 'Reply escalation has one substitution source'
                    USING ERRCODE='23514', CONSTRAINT='staff_substitution_reply_alias_guard';
            END IF;
        END IF;
        RETURN NEW;
    ELSIF TG_TABLE_NAME='conversations' THEN
        IF TG_OP='UPDATE' THEN
            -- Inbound responses and the next expectation may advance normally.
            IF NEW.reply_expected_message_id IS DISTINCT FROM OLD.reply_expected_message_id
                OR (NEW.reply_owner_user_id,NEW.reply_owner,NEW.business_context)
                IS NOT DISTINCT FROM (OLD.reply_owner_user_id,OLD.reply_owner,OLD.business_context) THEN RETURN NEW; END IF;
        END IF;
        message_id := OLD.reply_expected_message_id::text;
    ELSE
        IF TG_OP='UPDATE' THEN
            IF NEW.source_type='conversation_reply' AND OLD.source_type IS DISTINCT FROM NEW.source_type
                AND EXISTS (SELECT 1 FROM staff_substitutions WHERE source_type='task' AND source_id=NEW.id::text AND state<>'cancelled') THEN
                RAISE EXCEPTION 'Reply escalation has one substitution source'
                    USING ERRCODE='23514', CONSTRAINT='staff_substitution_reply_alias_guard';
            END IF;
            IF (NEW.source_type,NEW.source_id,NEW.owner_user_id,NEW.business_context)
                IS NOT DISTINCT FROM (OLD.source_type,OLD.source_id,OLD.owner_user_id,OLD.business_context) THEN RETURN NEW; END IF;
        END IF;
        IF OLD.source_type='conversation_reply' THEN message_id := OLD.source_id; END IF;
    END IF;
    scope := COALESCE(OLD.business_context,'event_genix');
    IF EXISTS (SELECT 1 FROM staff_substitutions WHERE business_context=scope AND source_type='inbox_reply'
        AND source_id=message_id AND state='active'
        AND id::text IS DISTINCT FROM current_setting('eventgenix.substitution_command',true)) THEN
        RAISE EXCEPTION 'Reply expectation has an agreed substitution'
            USING ERRCODE='23514', CONSTRAINT='staff_substitution_reply_active_guard';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='reply_substitution_conversation_guard_v401' AND tgrelid='conversations'::regclass) THEN
        CREATE TRIGGER reply_substitution_conversation_guard_v401 BEFORE UPDATE OR DELETE ON conversations
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_reply_v401();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='reply_substitution_task_guard_v401' AND tgrelid='tasks'::regclass) THEN
        CREATE TRIGGER reply_substitution_task_guard_v401 BEFORE UPDATE OR DELETE ON tasks
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_reply_v401();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='reply_substitution_alias_guard_v401' AND tgrelid='staff_substitutions'::regclass) THEN
        CREATE TRIGGER reply_substitution_alias_guard_v401 BEFORE INSERT ON staff_substitutions
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_reply_v401();
    END IF;
END;
$migration$;
