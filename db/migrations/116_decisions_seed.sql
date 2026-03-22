-- v116: Seed test decisions for Decision Screen
INSERT INTO decisions (title, description, priority, source, created_by, context_url)
SELECT 'Закупівля браслетів', 'Залишок 12 шт. Потрібно 500. Ціна 2 400 грн.', 'critical', 'kleshnya', 'Клешня', '/warehouse'
WHERE NOT EXISTS (SELECT 1 FROM decisions WHERE title = 'Закупівля браслетів' AND status = 'pending');

INSERT INTO decisions (title, description, priority, source, created_by)
SELECT 'Оновити програму Квест-Піратів', 'Додати нові загадки та реквізит', 'important', 'manual', 'Іра'
WHERE NOT EXISTS (SELECT 1 FROM decisions WHERE title = 'Оновити програму Квест-Піратів' AND status = 'pending');

INSERT INTO decisions (title, description, priority, source, created_by)
SELECT 'Замовити нові футболки для команди', 'Розміри: S×5, M×10, L×8, XL×3', 'normal', 'system', 'Система'
WHERE NOT EXISTS (SELECT 1 FROM decisions WHERE title = 'Замовити нові футболки для команди' AND status = 'pending');
