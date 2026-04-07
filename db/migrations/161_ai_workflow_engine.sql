-- v43.3: AI Workflow Engine — case contexts + feature flag
-- Stage 1: Feature flag
INSERT INTO feature_flags (code, name, description, is_enabled)
VALUES ('ai_workflow_v2', 'AI Workflow V2', 'Новий AI workflow engine з intake frame, research mode, task preview і case context', false)
ON CONFLICT (code) DO NOTHING;

-- Stage 6: Case context persistence
CREATE TABLE IF NOT EXISTS ai_cases (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    case_type VARCHAR(50) DEFAULT 'research',
    business_context TEXT,
    constraints TEXT,
    last_summary TEXT,
    messages JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(20) DEFAULT 'active',
    created_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_cases_user ON ai_cases(created_by, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_cases_status ON ai_cases(status);
