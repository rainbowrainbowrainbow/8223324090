-- v43.1: Payroll compliance refinements
-- Add violation_date and evidence fields to salary_adjustments
ALTER TABLE salary_adjustments ADD COLUMN IF NOT EXISTS violation_date DATE;
ALTER TABLE salary_adjustments ADD COLUMN IF NOT EXISTS evidence_note TEXT;
ALTER TABLE salary_adjustments ADD COLUMN IF NOT EXISTS evidence_url TEXT;

-- Add FK for repeat_of_template_id (referential integrity)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depremium_templates_repeat_fk') THEN
        ALTER TABLE depremium_templates ADD CONSTRAINT depremium_templates_repeat_fk
            FOREIGN KEY (repeat_of_template_id) REFERENCES depremium_templates(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Add FK for salary_adjustments.template_id if missing
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salary_adj_template_fk') THEN
        ALTER TABLE salary_adjustments ADD CONSTRAINT salary_adj_template_fk
            FOREIGN KEY (template_id) REFERENCES depremium_templates(id) ON DELETE SET NULL;
    END IF;
END $$;
