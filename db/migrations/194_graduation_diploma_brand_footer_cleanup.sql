-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotently updates only the seeded graduation diploma template identified by code; no customer, roster, booking, or export rows are changed.
-- ROLLBACK: Restore the v0.60.25 palette/footer values for code classic-graduation-2026 if the operator wants the earlier official template back.
-- DATA_SCOPE: One reference template row in graduation_diploma_templates where code = 'classic-graduation-2026'.

UPDATE graduation_diploma_templates
SET
    footer_text = '',
    principal_role = '',
    palette_json = '{"paper":"#fff7df","ink":"#173b63","muted":"#496273","gold":"#f5a51a","goldSoft":"#fee08a","accent":"#d61f72"}'::jsonb,
    layout_json = '{"format":"a4-portrait","sealLogoUrl":"/images/park-logo.png","officialFooter":""}'::jsonb,
    updated_at = NOW()
WHERE code = 'classic-graduation-2026';
