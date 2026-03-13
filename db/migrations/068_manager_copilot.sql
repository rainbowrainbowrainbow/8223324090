-- 068_manager_copilot.sql — Manager AI Copilot tables
-- v27.0.0

-- Feedback on AI coach suggestions (thumbs up/down)
CREATE TABLE IF NOT EXISTS manager_feedback (
    id          SERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(id) ON DELETE CASCADE,
    scenario    VARCHAR(50),
    client_text TEXT,
    suggestion  TEXT,
    rating      SMALLINT CHECK (rating IN (1, -1)),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manager_feedback_user ON manager_feedback(user_id, created_at DESC);

-- Call debriefs with AI analysis
CREATE TABLE IF NOT EXISTS call_debriefs (
    id              SERIAL PRIMARY KEY,
    user_id         INT REFERENCES users(id) ON DELETE CASCADE,
    lead_id         INT REFERENCES leads(id) ON DELETE SET NULL,
    client_name     VARCHAR(255),
    call_result     VARCHAR(50),
    duration_min    INT,
    notes           TEXT,
    main_objection  VARCHAR(100),
    what_worked     TEXT,
    what_improve    TEXT,
    ai_score        SMALLINT,
    ai_analysis     JSONB,
    next_step       TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_debriefs_user ON call_debriefs(user_id, created_at DESC);

-- Lead interaction tracking
CREATE TABLE IF NOT EXISTS lead_interactions (
    id              SERIAL PRIMARY KEY,
    lead_id         INT REFERENCES leads(id) ON DELETE CASCADE,
    user_id         INT REFERENCES users(id),
    type            VARCHAR(50) NOT NULL,
    summary         TEXT,
    details         JSONB,
    follow_up_date  DATE,
    follow_up_done  BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_interactions_lead ON lead_interactions(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_interactions_user ON lead_interactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_interactions_followup ON lead_interactions(follow_up_date) WHERE follow_up_done = false;

-- Add potential_value to leads for pipeline
ALTER TABLE leads ADD COLUMN IF NOT EXISTS potential_value INT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rooms_count INT;
