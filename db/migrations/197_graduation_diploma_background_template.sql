-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotently updates only the seeded graduation diploma template identified by code; no roster, booking, export, or user rows are changed.
-- ROLLBACK: Re-run migration 196_graduation_diploma_comic_style.sql or restore the previous layout_json/title/subtitle for code classic-graduation-2026.
-- DATA_SCOPE: One reference diploma template row in graduation_diploma_templates where code = 'classic-graduation-2026'.

UPDATE graduation_diploma_templates
SET
    name = 'Комікс-диплом з готовим фоном',
    title_text = 'ДИПЛОМ ВИПУСКНИКА',
    subtitle_text = 'за успішне завершення навчання,
старанність, допитливість
та яскраві досягнення',
    footer_text = '',
    principal_name = '',
    principal_role = '',
    palette_json = '{"paper":"#dfff1f","ink":"#1554ff","muted":"#2c76ff","gold":"#fff200","goldSoft":"#f2ff58","accent":"#f05a24"}'::jsonb,
    layout_json = '{"format":"a4-portrait","backgroundImageUrl":"/images/graduation/diploma-comic-template.png","sealLogoUrl":"/images/park-logo.png","officialFooter":"","style":"comic-template-overlay"}'::jsonb,
    updated_at = NOW()
WHERE code = 'classic-graduation-2026';
