-- 074_graduation_enhancements.sql — Graduation Constructor v2.0
-- #34: Деактивувати звичайну "Паперова дискотека" (залишити тільки неонову)
-- #34: Оновити пакет "Найкращий діджей" — замінити на неонову дискотеку

-- Деактивувати звичайну дискотеку
UPDATE graduation_services SET is_active = false, updated_at = NOW()
WHERE name = 'Паперова дискотека';

-- Оновити пакет best-dj: замінити звичайну дискотеку на неонову
DO $$
DECLARE
    v_pkg_id INTEGER;
    v_old_svc_id INTEGER;
    v_new_svc_id INTEGER;
BEGIN
    SELECT id INTO v_pkg_id FROM graduation_packages WHERE slug = 'best-dj';
    SELECT id INTO v_old_svc_id FROM graduation_services WHERE name = 'Паперова дискотека';
    SELECT id INTO v_new_svc_id FROM graduation_services WHERE name = 'Неонова паперова дискотека';

    IF v_pkg_id IS NOT NULL AND v_old_svc_id IS NOT NULL AND v_new_svc_id IS NOT NULL THEN
        DELETE FROM graduation_package_items WHERE package_id = v_pkg_id AND service_id = v_old_svc_id;
        INSERT INTO graduation_package_items (package_id, service_id)
        VALUES (v_pkg_id, v_new_svc_id)
        ON CONFLICT DO NOTHING;
    END IF;
END $$;
