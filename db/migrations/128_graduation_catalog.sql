-- v38.14: Add graduation catalog definition + pages
-- This adds the graduation catalog that was missing from initial seed

INSERT INTO catalog_definitions (id, name, emoji, description, ai_style, sort_order, is_active)
VALUES ('graduation', 'Випускний', '🎓', 'Каталог випускних програм', 'graduation party celebration illustration, school graduation, kids, balloons, white background', 0, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalog_settings (catalog_id) VALUES ('graduation') ON CONFLICT DO NOTHING;

INSERT INTO catalog_pages (catalog_id, page_number, title, subtitle, description, price, price_label, details) VALUES
('graduation', 0, 'Випускний 2025', '🎓 Парк Закревського періоду', 'Найкращий випускний для вашої дитини!', NULL, NULL, '{}'),
('graduation', 1, 'Super Party', '🎉 Найпопулярніший', 'Квест + Анімація + Шоу + Піньята. Повний набір розваг для незабутнього випускного.', 8500, 'від 8 500 ₴', '{"duration":"180 хв","kids":"до 30 дітей","includes":"Квест + Анімація + Шоу + Піньята"}'),
('graduation', 2, 'Neon Party', '✨ Неонова вечірка', 'Шоу неон-бульбашок + Паперове неон-шоу + Анімація в темряві.', 9200, 'від 9 200 ₴', '{"duration":"180 хв","kids":"до 30 дітей","includes":"Неон-шоу + Анімація + Піньята"}'),
('graduation', 3, 'Pizza Party', '🍕 Смачний випускний', 'МК Піца + Анімація + Піньята. Кожна дитина готує свою піцу!', 7800, 'від 7 800 ₴', '{"duration":"150 хв","kids":"до 25 дітей","includes":"МК Піца + Анімація + Піньята"}'),
('graduation', 4, 'Science Party', '🧪 Наукове шоу', 'Шоу сухий лід + Слайми + Анімація. Наука може бути веселою!', 8900, 'від 8 900 ₴', '{"duration":"180 хв","kids":"до 25 дітей","includes":"Наук.шоу + МК Слайми + Анімація"}'),
('graduation', 5, 'Best DJ', '🎧 DJ вечірка', 'Анімація + Неон + DJ-сет. Танцювальний випускний для старших.', 9500, 'від 9 500 ₴', '{"duration":"180 хв","kids":"до 30 дітей","includes":"DJ + Неон + Анімація + Піньята"}'),
('graduation', 6, 'Handmade Party', '🎨 Творчий випускний', 'Два МК на вибір + Анімація + Піньята. Кожен забирає свій виріб!', 7500, 'від 7 500 ₴', '{"duration":"150 хв","kids":"до 25 дітей","includes":"2 МК + Анімація + Піньята"}'),
('graduation', 7, 'Squid Game', '🦑 Гра в Кальмара', 'Квест Кальмар + Анімація + Піньята. Для сміливих випускників!', 9800, 'від 9 800 ₴', '{"duration":"180 хв","kids":"до 16 дітей","includes":"Квест Кальмар + Анімація + Піньята"}')
ON CONFLICT DO NOTHING;
