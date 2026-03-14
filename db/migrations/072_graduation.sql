-- 072_graduation.sql — Graduation Event Builder (v30.0.0)
-- Модуль "Випускний" — конструктор, пакети, збережені конфігурації

-- Глобальні параметри випускного
CREATE TABLE IF NOT EXISTS graduation_settings (
    key TEXT PRIMARY KEY,
    value REAL NOT NULL,
    label TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO graduation_settings (key, value, label) VALUES
    ('coefficient', 6.0, 'Коефіцієнт ціноутворення'),
    ('markup', 1.15, 'Надбавка (×1.15 = +15%)'),
    ('min_price_per_child', 599, 'Мінімальна ціна за дитину'),
    ('kickback_rate', 0.10, 'Відсоток відкату (10%)'),
    ('mk_external_rate', 0.80, 'МК: % зовнішньому підряднику')
ON CONFLICT (key) DO NOTHING;

-- Каталог послуг випускного
CREATE TABLE IF NOT EXISTS graduation_services (
    id SERIAL PRIMARY KEY,
    sort_order INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    duration_min INTEGER DEFAULT 0,
    price_park REAL DEFAULT 0,
    price_per_child REAL DEFAULT 0,
    price_type TEXT DEFAULT 'fixed',
    cost_host REAL DEFAULT 0,
    cost_costume REAL DEFAULT 0,
    cost_balloons_per_kid REAL DEFAULT 0,
    cost_aquagrim_per_kid REAL DEFAULT 0,
    cost_print_per_kid REAL DEFAULT 0,
    cost_design_per_kid REAL DEFAULT 0,
    cost_delivery REAL DEFAULT 0,
    cost_ice REAL DEFAULT 0,
    cost_other REAL DEFAULT 0,
    cost_box REAL DEFAULT 0,
    cost_markers REAL DEFAULT 0,
    cost_solution REAL DEFAULT 0,
    cost_cleaning REAL DEFAULT 0,
    cost_drinks_per_kid REAL DEFAULT 0,
    cost_type TEXT DEFAULT 'standard',
    category TEXT DEFAULT 'main',
    min_kids INTEGER DEFAULT 0,
    max_kids INTEGER DEFAULT 0,
    entry_rule JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grad_services_category ON graduation_services(category);
CREATE INDEX IF NOT EXISTS idx_grad_services_active ON graduation_services(is_active);

-- Готові пакети
CREATE TABLE IF NOT EXISTS graduation_packages (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Склад пакету (many-to-many)
CREATE TABLE IF NOT EXISTS graduation_package_items (
    id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES graduation_packages(id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES graduation_services(id) ON DELETE CASCADE,
    override_price REAL,
    UNIQUE(package_id, service_id)
);

-- Збережені конфігурації (кошики клієнтів)
CREATE TABLE IF NOT EXISTS graduation_quotes (
    id SERIAL PRIMARY KEY,
    quote_number TEXT UNIQUE,
    customer_id INTEGER,
    kids_count INTEGER NOT NULL DEFAULT 15,
    discount_percent REAL DEFAULT 0,
    selected_services JSONB,
    package_id INTEGER REFERENCES graduation_packages(id) ON DELETE SET NULL,
    total_per_child REAL,
    total_all REAL,
    total_cost REAL,
    total_profit REAL,
    profit_margin REAL,
    status TEXT DEFAULT 'draft',
    booking_id TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grad_quotes_status ON graduation_quotes(status);
CREATE INDEX IF NOT EXISTS idx_grad_quotes_number ON graduation_quotes(quote_number);

-- Seed: 25 послуг
INSERT INTO graduation_services (sort_order, name, description, duration_min, price_park, price_per_child, price_type, cost_host, cost_costume, cost_balloons_per_kid, cost_aquagrim_per_kid, cost_print_per_kid, cost_design_per_kid, cost_delivery, cost_ice, cost_other, cost_box, cost_markers, cost_solution, cost_cleaning, cost_drinks_per_kid, cost_type, category, entry_rule) VALUES
(1, 'Анімація', 'Весела розвага для всіх дітей з аніматорами у костюмах улюблених героїв. Захопливі ігри, живі танці, конкурси та безліч яскравих емоцій — справжнє неонове свято, яке ваші діти запам''ятають назавжди!', 60, 1300, 250, 'formula', 800, 60, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'standard', 'main', NULL),
(2, 'Анімація 2 години', 'Подвійна доза веселощів! 2 години нон-стоп розваг з аніматорами у костюмах улюблених героїв. Захопливі ігри, живі танці, конкурси — справжній марафон емоцій для вашого класу!', 120, 2400, 460, 'formula', 1600, 120, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'standard', 'main', NULL),
(3, 'Велком Зона', 'Велком-зона із ведучим — улюблений персонаж зустрічає дітей, допоможе батькам створити атмосферу свята з перших хвилин! Ведучий у яскравому костюмі проводить міні-ігри та знайомить дітей між собою.', 30, 0, 160, 'fixed', 400, 0, 0, 0, 0, 0, 0, 0, 50, 0, 0, 0, 0, 0, 'standard', 'main', NULL),
(4, 'Капсула часу', 'Ведучий збирає всіх учасників випускного, всі пишуть ким вони хочуть стати через 2 роки, які якості в собі хочуть розвинути. Листи запечатуються в красиву дерев''яну шкатулку. Капсула часу, диплом, вітання класу на сцені — це яскраве завершення вечірки!', 30, 0, 280, 'fixed', 400, 0, 0, 0, 0, 0, 90, 0, 0, 590, 100, 0, 0, 0, 'standard', 'main', NULL),
(5, 'Видача дипломів та вітання класу на сцені', 'Це яскраве завершення вечірки, всім дітям урочисто видають дипломи, ведучий допоможе зробити гарні фото на сцені. Кожен учасник відчуває себе справжньою зіркою!', 30, 0, 210, 'fixed', 400, 0, 0, 0, 10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 'standard', 'main', NULL),
(6, 'Вхід', 'Вхід до парку. Кількість входів залежить від кількості дітей.', 0, 0, 5, 'fixed', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'standard', 'extra', '{"8":1,"16":2,"99":3}'),
(7, 'Шоу Бульбашок', 'Доторкніться до дива на нашому шоу гігантських мильних бульбашок! Талановиті ведучі створюють захопливий дух видовище — гігантські бульбашки, бульбашки всередині бульбашок, і навіть діти всередині бульбашки!', 30, 2000, 390, 'formula', 800, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 120, 0, 0, 'standard', 'show', NULL),
(8, 'Паперова дискотека', 'Приєднуйтесь до нас на Паперовій дискотеці, щоб поринути у світ кольору та музики! 50 кг яскравого паперу, паперова пушка, запальна музика — кольоровий дощ і танці!', 30, 1900, 370, 'formula', 500, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 'standard', 'show', NULL),
(9, 'Шоу з сухим льодом', 'Шоу експериментів з сухим льодом — ця динамічна та інтерактивна вистава! Діти будуть вражені, спостерігаючи за ефектними хімічними реакціями, димовими каскадами та магічними перетвореннями!', 30, 2800, 540, 'formula', 700, 60, 0, 0, 0, 0, 90, 610, 0, 0, 0, 0, 0, 0, 'standard', 'show', NULL),
(10, 'Мафія', 'Інтелектуальна-психологічна настільна рольова гра у детективному жанрі. За сюжетом мешканцям міста, в якому оселилась мафія, потрібно обчислити всіх мафіозі. Захоплива гра для підлітків та дорослих!', 60, 2300, 300, 'fixed', 700, 0, 0, 0, 0, 0, 0, 0, 50, 0, 0, 0, 0, 0, 'standard', 'game', NULL),
(11, 'Аквагрим', 'Веселі та яскраві образи для дітей на вашому святі! Нехай маленькі гості насолодяться перетворенням на улюблених героїв за допомогою безпечних фарб. Професійний гример створить неповторний образ для кожної дитини!', 38, 960, 120, 'fixed', 450, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'standard', 'extra', NULL),
(12, 'Тимчасові тату', 'Всі учасники зможуть себе відчути унікальними завдяки різним тимчасовим тату на випускному! Унікальні аксесуари та образи для кожного!', 38, 640, 130, 'formula', 450, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'standard', 'extra', NULL),
(13, 'МК "Розпис футболок"', 'Майстер-клас ''Розпис футболки'' — мати річ з власним принтом — це круто! На майстер-класі з розпису текстилю кожна дитина створить свій унікальний дизайн на футболці, який залишиться як пам''ятний сувенір з випускного!', 90, 3000, 580, 'formula', 700, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'mk_external', 'masterclass', NULL),
(14, 'МК "Слайм"', 'Разом з досвідченими слаймерами діти зможуть зробити для себе цікаву та модну іграшку, яку зможуть забрати додому! Кожна дитина створює свій унікальний слайм — обирає колір, блискітки та текстуру!', 60, 2300, 450, 'formula', 700, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'mk_external', 'masterclass', NULL),
(15, 'МК "Піца"', 'Всі діти нарешті мають змогу зробити піцу власноруч! Це не тільки цікавий майстер-клас, а ще й смачна їжа для всього класу! Кожен вибирає начинку та створює свою авторську піцу!', 40, 1700, 330, 'formula', 700, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'mk_external', 'masterclass', NULL),
(16, 'МК "Термомозаїка"', 'На майстер-класі з мозаїки з використанням термозаймання ви зможете створити свою власну мозаїку — вибрати дизайн, скласти та запекти. Чудовий сувенір на пам''ять про випускний!', 60, 0, 330, 'fixed', 700, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'mk_external', 'masterclass', NULL),
(17, 'Тематична вечірка', 'Це ваша ідеальна вечірка! Якщо весь клас мріє зробити гангстер паті, гавайську вечірку, або може диско — ми організуємо все під ключ! Тематичні декорації, музика, костюми та програма!', 60, 0, 500, 'fixed', 700, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'standard', 'main', NULL),
(18, 'Солодка вата', 'Цілу годину наші майстри творитимуть справжнє диво — солодку вату для ваших випускників! Безлімітна солодка вата різних кольорів та смаків!', 60, 0, 190, 'fixed', 250, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 'standard', 'extra', NULL),
(19, 'Бармен шоу', 'Наші бармени-чарівники перетворять ваше свято на справжнє феєричне шоу! Захопливі експерименти з інгредієнтами, жонглювання шейкерами та безалкогольні коктейлі для всіх!', 60, 3200, 350, 'fixed', 350, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 70, 'standard', 'show', NULL),
(20, 'Програма "Гра в кальмара" Ч.1', 'Захоплива інтерактивна програма, натхненна популярним серіалом. Участь беруть три ведучих у яскравих костюмах. Кілька циклів ігор на швидкість, логіку та витримку!', 60, 0, 500, 'fixed', 700, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'standard', 'game', NULL),
(21, 'Програма "Гра в кальмара" Ч.2', 'Продовження легендарної програми. Ще два цикли ігор та фінальний сюрприз: об''єднання усіх набраних балів та визначення переможця! Подарунки для найкращих гравців!', 60, 0, 500, 'fixed', 700, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'standard', 'game', NULL),
(22, 'Подарунки', 'Милі сюрпризи для кожної дитини! Це можуть бути антистрес-іграшки, корисні канцелярські дрібнички чи тематичні сувеніри — кожен випускник отримає свій подаруночок!', 5, 0, 80, 'fixed', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'standard', 'extra', NULL),
(23, 'Неонова паперова дискотека', 'Яскраве диско-шоу з паперовою пушкою та неоновим світлом! Веселощі, рух і танці в атмосфері абсолютного неонового божевілля! Спеціальні ультрафіолетові лампи та флуоресцентний папір!', 30, 1900, 450, 'fixed', 500, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 'standard', 'neon', NULL),
(24, 'Неонові мильні бульбашки', 'Феєричне мильне шоу у неонових відтінках! Під ультрафіолетовим світлом бульбашки переливаються яскравими кольорами — магія та краса в кожній бульбашці!', 30, 2000, 430, 'fixed', 750, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 120, 0, 0, 'standard', 'neon', NULL),
(25, 'Неоновий аквагрим', 'Ваша яскрава індивідуальність засяє під неоновим світлом! Спеціальні фарби створюють унікальні малюнки, які світяться під ультрафіолетом — кожна дитина стає зіркою неонової вечірки!', 30, 0, 160, 'fixed', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'standard', 'neon', NULL)
ON CONFLICT (name) DO NOTHING;

-- Seed: 7 пакетів
INSERT INTO graduation_packages (name, slug, sort_order) VALUES
    ('Найкращий діджей', 'best-dj', 1),
    ('Супер свято', 'super-party', 2),
    ('Наукова вечірка', 'science-party', 3),
    ('Хєндмейд паті', 'handmade-party', 4),
    ('Піца паті', 'pizza-party', 5),
    ('Squid Game Party', 'squid-game', 6),
    ('Неон паті', 'neon-party', 7)
ON CONFLICT (slug) DO NOTHING;

-- Seed: package items (link services to packages by name)
-- best-dj: Вхід, Паперова дискотека, Аквагрим, Капсула часу, Видача дипломів
INSERT INTO graduation_package_items (package_id, service_id)
SELECT p.id, s.id FROM graduation_packages p, graduation_services s
WHERE p.slug = 'best-dj' AND s.name IN ('Вхід', 'Паперова дискотека', 'Аквагрим', 'Капсула часу', 'Видача дипломів та вітання класу на сцені')
ON CONFLICT DO NOTHING;

-- super-party: Вхід, Анімація, Капсула часу, Видача дипломів
INSERT INTO graduation_package_items (package_id, service_id)
SELECT p.id, s.id FROM graduation_packages p, graduation_services s
WHERE p.slug = 'super-party' AND s.name IN ('Вхід', 'Анімація', 'Капсула часу', 'Видача дипломів та вітання класу на сцені')
ON CONFLICT DO NOTHING;

-- science-party: Вхід, Велком Зона, Мафія, Шоу з сухим льодом
INSERT INTO graduation_package_items (package_id, service_id)
SELECT p.id, s.id FROM graduation_packages p, graduation_services s
WHERE p.slug = 'science-party' AND s.name IN ('Вхід', 'Велком Зона', 'Мафія', 'Шоу з сухим льодом')
ON CONFLICT DO NOTHING;

-- handmade-party: Вхід, МК Слайм, МК Піца, Капсула часу, Видача дипломів
INSERT INTO graduation_package_items (package_id, service_id)
SELECT p.id, s.id FROM graduation_packages p, graduation_services s
WHERE p.slug = 'handmade-party' AND s.name IN ('Вхід', 'МК "Слайм"', 'МК "Піца"', 'Капсула часу', 'Видача дипломів та вітання класу на сцені')
ON CONFLICT DO NOTHING;

-- pizza-party: Вхід, МК Піца, Анімація 2 години
INSERT INTO graduation_package_items (package_id, service_id)
SELECT p.id, s.id FROM graduation_packages p, graduation_services s
WHERE p.slug = 'pizza-party' AND s.name IN ('Вхід', 'МК "Піца"', 'Анімація 2 години')
ON CONFLICT DO NOTHING;

-- squid-game: Вхід, Гра в кальмара Ч.1, Ч.2, Подарунки
INSERT INTO graduation_package_items (package_id, service_id)
SELECT p.id, s.id FROM graduation_packages p, graduation_services s
WHERE p.slug = 'squid-game' AND s.name IN ('Вхід', 'Програма "Гра в кальмара" Ч.1', 'Програма "Гра в кальмара" Ч.2', 'Подарунки')
ON CONFLICT DO NOTHING;

-- neon-party: Вхід, Неонова паперова дискотека, Неонові мильні бульбашки, Неоновий аквагрим, Подарунки
INSERT INTO graduation_package_items (package_id, service_id)
SELECT p.id, s.id FROM graduation_packages p, graduation_services s
WHERE p.slug = 'neon-party' AND s.name IN ('Вхід', 'Неонова паперова дискотека', 'Неонові мильні бульбашки', 'Неоновий аквагрим', 'Подарунки')
ON CONFLICT DO NOTHING;
