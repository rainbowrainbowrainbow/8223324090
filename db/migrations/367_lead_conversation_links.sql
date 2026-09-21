-- MIGRATION_KIND: schema
-- SAFETY: Additive link history only. The table is empty on creation; foreign keys, scope triggers, and partial unique indexes reject invalid or ambiguous links without rewriting existing leads or conversations.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Disable callers first, export any required link history, then drop the scope triggers/functions, indexes, and lead_conversation_links table. Existing leads and conversations are unchanged.

CREATE TABLE IF NOT EXISTS lead_conversation_links (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix',
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    is_origin BOOLEAN NOT NULL DEFAULT FALSE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    source VARCHAR(80) NOT NULL DEFAULT 'manual',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_lead_conversation_links_business_context_v367
        CHECK (BTRIM(business_context) <> '' AND business_context ~ '^[a-z][a-z0-9_]{2,63}$'),
    CONSTRAINT chk_lead_conversation_links_source_v367
        CHECK (BTRIM(source) <> '' AND LENGTH(BTRIM(source)) <= 80)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_conversation_links_pair_v367
    ON lead_conversation_links (business_context, lead_id, conversation_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_conversation_links_primary_v367
    ON lead_conversation_links (business_context, lead_id)
    WHERE is_primary;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_conversation_links_origin_v367
    ON lead_conversation_links (business_context, lead_id)
    WHERE is_origin;

CREATE INDEX IF NOT EXISTS idx_lead_conversation_links_lead_v367
    ON lead_conversation_links (business_context, lead_id, is_primary DESC, is_origin DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_conversation_links_conversation_v367
    ON lead_conversation_links (business_context, conversation_id, updated_at DESC);

CREATE OR REPLACE FUNCTION enforce_lead_conversation_link_scope_v367()
RETURNS TRIGGER AS $$
DECLARE
    linked_lead_business_context VARCHAR(64);
    linked_conversation_business_context VARCHAR(64);
BEGIN
    SELECT business_context
      INTO linked_lead_business_context
      FROM leads
     WHERE id = NEW.lead_id
     FOR KEY SHARE;

    SELECT business_context
      INTO linked_conversation_business_context
      FROM conversations
     WHERE id = NEW.conversation_id
     FOR KEY SHARE;

    IF linked_lead_business_context IS NULL
       OR linked_conversation_business_context IS NULL
       OR linked_lead_business_context <> NEW.business_context
       OR linked_conversation_business_context <> NEW.business_context THEN
        RAISE EXCEPTION 'lead_conversation_links must stay within one business context'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_lead_conversation_link_scope_drift_v367()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.business_context IS DISTINCT FROM OLD.business_context
       AND EXISTS (
           SELECT 1
             FROM lead_conversation_links lcl
            WHERE (TG_TABLE_NAME = 'leads' AND lcl.lead_id = NEW.id)
               OR (TG_TABLE_NAME = 'conversations' AND lcl.conversation_id = NEW.id)
       ) THEN
        RAISE EXCEPTION 'cannot change business context while lead conversation links exist'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_lead_conversation_link_scope_v367 ON lead_conversation_links;
CREATE TRIGGER trg_enforce_lead_conversation_link_scope_v367
    BEFORE INSERT OR UPDATE OF business_context, lead_id, conversation_id
    ON lead_conversation_links
    FOR EACH ROW
    EXECUTE FUNCTION enforce_lead_conversation_link_scope_v367();

DROP TRIGGER IF EXISTS trg_prevent_lead_conversation_link_lead_scope_drift_v367 ON leads;
CREATE TRIGGER trg_prevent_lead_conversation_link_lead_scope_drift_v367
    BEFORE UPDATE OF business_context
    ON leads
    FOR EACH ROW
    EXECUTE FUNCTION prevent_lead_conversation_link_scope_drift_v367();

DROP TRIGGER IF EXISTS trg_prevent_lead_conversation_link_conversation_scope_drift_v367 ON conversations;
CREATE TRIGGER trg_prevent_lead_conversation_link_conversation_scope_drift_v367
    BEFORE UPDATE OF business_context
    ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION prevent_lead_conversation_link_scope_drift_v367();

COMMENT ON TABLE lead_conversation_links IS
    'Canonical confirmed many-to-many CRM lead to Omni conversation links. Origin records the chat that created the lead; primary records the current preferred conversation.';
