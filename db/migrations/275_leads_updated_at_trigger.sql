-- MIGRATION_KIND: schema
-- SAFETY: Additive idempotent trigger for leads.updated_at; no data is deleted or rewritten except future UPDATE timestamps.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads; keep update_updated_at_column() if bookings still use it.

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
