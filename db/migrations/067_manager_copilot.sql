-- Migration 067: Manager AI Copilot tables
-- Created: 2026-03-13 | Author: Клешня 🦞

-- Feedback on AI suggestions (👍/👎)
CREATE TABLE IF NOT EXISTS manager_feedback (
    id          SERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(id) ON DELETE CASCADE,
    scenario    VARCHAR(50),
    client_text TEXT,
    suggestion  TEXT,
    rating      SMALLINT CHECK (rating IN (1, -1)), -- 1=good, -1=bad
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manager_feedback_user_id ON manager_feedback(user_id, created_at DESC);

-- Call debriefs
CREATE TABLE IF NOT EXISTS call_debriefs (
    id              SERIAL PRIMARY KEY,
    user_id         INT REFERENCES users(id) ON DELETE CASCADE,
    client_name     VARCHAR(255),
    call_result     VARCHAR(50), -- 'hot','interested','callback','rejected'
    duration_min    INT,
    notes           TEXT,
    main_objection  VARCHAR(100),
    what_worked     TEXT,
    what_improve    TEXT,
    ai_score        SMALLINT,    -- 1-10
    ai_analysis     JSONB,       -- {good: [], improve: [], nextStep: ""}
    next_step       TEXT,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_debriefs_user_id ON call_debriefs(user_id, created_at DESC);

-- Lead interactions tracker
CREATE TABLE IF NOT EXISTS lead_interactions (
    id              SERIAL PRIMARY KEY,
    lead_id         INT REFERENCES leads(id) ON DELETE CASCADE,
    user_id         INT REFERENCES users(id),
    type            VARCHAR(50) NOT NULL,
    -- types: 'call', 'message_sent', 'status_change', 'note',
    --        'landing_submission', 'debrief', 'meeting', 'reply_received',
    --        'meeting_prep', 'message_draft', 'message_sent_tg'
    summary         TEXT,
    details         JSONB,
    follow_up_date  DATE,
    follow_up_done  BOOLEAN DEFAULT false,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_interactions_lead_id ON lead_interactions(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_interactions_user_id ON lead_interactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_interactions_followup ON lead_interactions(follow_up_date) WHERE follow_up_done = false;
