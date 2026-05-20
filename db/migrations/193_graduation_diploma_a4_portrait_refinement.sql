-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotently updates only the seeded graduation diploma template identified by code; no customer, roster, booking, or export rows are changed.
-- ROLLBACK: Restore the previous layout_json/palette_json/title copy for code classic-graduation-2026 if the operator wants the old landscape template back.
-- DATA_SCOPE: One reference template row in graduation_diploma_templates where code = 'classic-graduation-2026'.

UPDATE graduation_diploma_templates
SET
    name = 'Класичний диплом випускника',
    title_text = 'Диплом випускника',
    subtitle_text = 'за яскравий випускний, сміливість мріяти та готовність до нових відкриттів',
    footer_text = 'Парк Закревського періоду',
    principal_name = 'Парк Закревського періоду',
    principal_role = 'організатор випускного',
    palette_json = '{"paper":"#fbf0d2","ink":"#24160f","muted":"#745b39","gold":"#b88a24","goldSoft":"#ead6a1","accent":"#6f241c"}'::jsonb,
    layout_json = '{"format":"a4-portrait","sealLogoUrl":"/images/park-logo.png","officialFooter":"Парк Закревського періоду"}'::jsonb,
    updated_at = NOW()
WHERE code = 'classic-graduation-2026';
