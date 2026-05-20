-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotently updates only the seeded graduation diploma template identified by code; no roster, booking, export, or user rows are changed.
-- ROLLBACK: Re-run migration 194_graduation_diploma_brand_footer_cleanup.sql or restore the previous palette_json/layout_json for code classic-graduation-2026.
-- DATA_SCOPE: One reference diploma template row in graduation_diploma_templates where code = 'classic-graduation-2026'.

UPDATE graduation_diploma_templates
SET
    name = 'Комікс-диплом випускника',
    title_text = 'Диплом',
    subtitle_text = 'Нагороджується за сміливість, доброту, знання та готовність до нових пригод',
    footer_text = '',
    principal_name = '',
    principal_role = '',
    palette_json = '{"paper":"#dfff1f","ink":"#1554ff","muted":"#2c76ff","gold":"#fff200","goldSoft":"#f2ff58","accent":"#ff3b14"}'::jsonb,
    layout_json = '{"format":"a4-portrait","sealLogoUrl":"/images/park-logo.png","characterTopUrl":"/images/mr-zak-spring.png","characterBottomUrl":"/images/mr-zak-summer.png","officialFooter":"","style":"comic-hero"}'::jsonb,
    updated_at = NOW()
WHERE code = 'classic-graduation-2026';
