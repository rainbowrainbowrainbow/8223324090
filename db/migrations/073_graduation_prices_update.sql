-- 073_graduation_prices_update.sql — Fix graduation prices
-- Migration 072 used ON CONFLICT DO NOTHING, so existing old prices were not updated.
-- This migration forces correct prices for all 25 services.

UPDATE graduation_services SET price_park = 1500, price_per_child = 290, cost_host = 800, cost_costume = 60, cost_balloons_per_kid = 5 WHERE name = 'Анімація';
UPDATE graduation_services SET price_park = 2500, price_per_child = 480, cost_host = 1600, cost_costume = 120, cost_balloons_per_kid = 5 WHERE name = 'Анімація 2 години';
UPDATE graduation_services SET price_park = 0, price_per_child = 160, cost_host = 400, cost_other = 50 WHERE name = 'Велком Зона';
UPDATE graduation_services SET price_park = 0, price_per_child = 280, cost_host = 400, cost_delivery = 90, cost_box = 590, cost_markers = 100 WHERE name = 'Капсула часу';
UPDATE graduation_services SET price_park = 0, price_per_child = 210, cost_host = 400, cost_print_per_kid = 10, cost_design_per_kid = 10 WHERE name = 'Видача дипломів та вітання класу на сцені';
UPDATE graduation_services SET price_park = 0, price_per_child = 5 WHERE name = 'Вхід';
UPDATE graduation_services SET price_park = 2400, price_per_child = 460, cost_host = 800, cost_costume = 60, cost_solution = 120 WHERE name = 'Шоу Бульбашок';
UPDATE graduation_services SET price_park = 2900, price_per_child = 560, cost_host = 500, cost_costume = 60, cost_cleaning = 100 WHERE name = 'Паперова дискотека';
UPDATE graduation_services SET price_park = 4400, price_per_child = 850, cost_host = 700, cost_costume = 60, cost_delivery = 90, cost_ice = 610 WHERE name = 'Шоу з сухим льодом';
UPDATE graduation_services SET price_park = 2700, price_per_child = 300, cost_host = 700, cost_other = 50 WHERE name = 'Мафія';
UPDATE graduation_services SET price_park = 960, price_per_child = 120, cost_host = 450, cost_aquagrim_per_kid = 5 WHERE name = 'Аквагрим';
UPDATE graduation_services SET price_park = 640, price_per_child = 130, cost_host = 450, cost_aquagrim_per_kid = 5 WHERE name = 'Тимчасові тату';
UPDATE graduation_services SET price_park = 3000, price_per_child = 580, cost_host = 700 WHERE name = 'МК "Розпис футболок"';
UPDATE graduation_services SET price_park = 2300, price_per_child = 450, cost_host = 700 WHERE name = 'МК "Слайм"';
UPDATE graduation_services SET price_park = 1700, price_per_child = 330, cost_host = 700 WHERE name = 'МК "Піца"';
UPDATE graduation_services SET price_park = 0, price_per_child = 330, cost_host = 700 WHERE name = 'МК "Термомозаїка"';
UPDATE graduation_services SET price_park = 0, price_per_child = 500, cost_host = 700 WHERE name = 'Тематична вечірка';
UPDATE graduation_services SET price_park = 0, price_per_child = 190, cost_host = 250, cost_markers = 100 WHERE name = 'Солодка вата';
UPDATE graduation_services SET price_park = 3200, price_per_child = 350, cost_host = 350, cost_drinks_per_kid = 70 WHERE name = 'Бармен шоу';
UPDATE graduation_services SET price_park = 0, price_per_child = 500, cost_host = 700 WHERE name = 'Програма "Гра в кальмара" Ч.1';
UPDATE graduation_services SET price_park = 0, price_per_child = 500, cost_host = 700 WHERE name = 'Програма "Гра в кальмара" Ч.2';
UPDATE graduation_services SET price_park = 0, price_per_child = 80 WHERE name = 'Подарунки';
UPDATE graduation_services SET price_park = 2900, price_per_child = 450, cost_host = 500, cost_costume = 60, cost_cleaning = 100 WHERE name = 'Неонова паперова дискотека';
UPDATE graduation_services SET price_park = 2700, price_per_child = 430, cost_host = 750, cost_costume = 60, cost_solution = 120 WHERE name = 'Неонові мильні бульбашки';
UPDATE graduation_services SET price_park = 0, price_per_child = 160 WHERE name = 'Неоновий аквагрим';

-- Also fix migration 072 seed to use UPSERT for future deployments
