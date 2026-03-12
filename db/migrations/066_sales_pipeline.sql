-- 066_sales_pipeline.sql — Sales pipeline stages for leads
-- v25.4.0

ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline_stage VARCHAR(30) DEFAULT 'new';
-- stages: new, contacted, demo, proposal, negotiation, won, lost
ALTER TABLE leads ADD COLUMN IF NOT EXISTS milestone_tags TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads(pipeline_stage);
