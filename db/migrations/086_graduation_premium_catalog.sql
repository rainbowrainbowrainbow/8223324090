-- Migration 086: Premium catalog fields for graduation packages
-- Adds min_kids, max_kids, theme_emoji, service descriptions for catalog

-- Add kids range to packages
ALTER TABLE graduation_packages ADD COLUMN IF NOT EXISTS min_kids INTEGER DEFAULT 7;
ALTER TABLE graduation_packages ADD COLUMN IF NOT EXISTS max_kids INTEGER DEFAULT 50;

-- Update kids ranges per package
UPDATE graduation_packages SET min_kids = 7, max_kids = 50;

-- Add catalog_description to services (short one-liner for catalog cards)
ALTER TABLE graduation_services ADD COLUMN IF NOT EXISTS catalog_description TEXT;

-- Service catalog descriptions (short, punchy, for catalog cards)
UPDATE graduation_services SET catalog_description = 'Веселі та яскраві аквагрим-образи для дітей на вашому святі! Нехай маленькі гості насолоджуються перетворенням у фантастичних героїв та казкових тварин.' WHERE name LIKE 'Аквагрим';
UPDATE graduation_services SET catalog_description = 'Приєднуйтесь до нас на паперовій дискотеці, щоб поринути у світ кольору та музики! 80 кг яскравого паперу перетворюють місце проведення на райський куточок.' WHERE name LIKE 'Неонова паперова%';
UPDATE graduation_services SET catalog_description = 'Ведучий збирає всіх учасників випускного, всі пишуть ким хочуть стати через 10 років. Листи запечатуються в красиву дерев''яну шкатулку.' WHERE name LIKE 'Капсула%';
UPDATE graduation_services SET catalog_description = 'Кожен випускник урочисто отримує диплом на сцені та робить фото як справжня зірка! Яскраве завершення вечірки.' WHERE name LIKE 'Видача%';
UPDATE graduation_services SET catalog_description = 'Доторкніться до дива на шоу гігантських мильних бульбашок! Гігантські бульбашки, бульбашки всередині бульбашок, і навіть діти всередині бульбашки!' WHERE name LIKE 'Шоу Бульбашок%';
UPDATE graduation_services SET catalog_description = 'Динамічна та інтерактивна вистава з ефектними хімічними реакціями, димовими каскадами та магічними перетвореннями з сухим льодом!' WHERE name LIKE 'Шоу з сухим%';
UPDATE graduation_services SET catalog_description = 'Кожна дитина створить свій унікальний дизайн на футболці, який залишиться як пам''ятний сувенір з випускного!' WHERE name LIKE 'МК "Розпис%';
UPDATE graduation_services SET catalog_description = 'Разом з досвідченими слаймерами діти створять свій унікальний слайм — обирають колір, блискітки та текстуру!' WHERE name LIKE 'МК "Слайм%';
UPDATE graduation_services SET catalog_description = 'Всі діти мають змогу зробити піцу власноруч! Кожен вибирає начинку та створює свою авторську піцу!' WHERE name LIKE 'МК "Піца%';
UPDATE graduation_services SET catalog_description = 'Створіть свою власну мозаїку — вибрати дизайн, скласти та запекти. Чудовий сувенір на пам''ять про випускний!' WHERE name LIKE 'МК "Термо%';
UPDATE graduation_services SET catalog_description = 'Захоплюючі ігри, живі танці, конкурси та безліч яскравих емоцій з аніматорами у костюмах улюблених героїв!' WHERE name = 'Анімація';
UPDATE graduation_services SET catalog_description = 'Подвійна доза веселощів! 2 години нон-стоп розваг з аніматорами — справжній марафон емоцій для класу!' WHERE name = 'Анімація 2 години';
UPDATE graduation_services SET catalog_description = 'Улюблений персонаж зустрічає дітей! Міні-ігри та знайомства з перших хвилин — атмосфера свята гарантована.' WHERE name LIKE 'Велком%';
UPDATE graduation_services SET catalog_description = 'Інтелектуальна рольова гра у детективному жанрі — мешканцям міста потрібно обчислити всіх мафіозі!' WHERE name = 'Мафія';
UPDATE graduation_services SET catalog_description = 'Вхід до парку для всіх випускників. Кількість залежить від групи.' WHERE name = 'Вхід';
UPDATE graduation_services SET catalog_description = 'Всі учасники відчують себе унікальними завдяки різним тимчасовим тату на випускному!' WHERE name LIKE 'Тимчасові%';
UPDATE graduation_services SET catalog_description = 'Ваша ідеальна тематична вечірка — гангстер паті, гавайська, диско — все під ключ!' WHERE name LIKE 'Тематична%';
UPDATE graduation_services SET catalog_description = 'Цілу годину наші майстри творитимуть солодку вату для ваших випускників! Безлімітна, різних кольорів та смаків!' WHERE name LIKE 'Солодка%';
UPDATE graduation_services SET catalog_description = 'Феєричне шоу з жонглюванням шейкерами та безалкогольними коктейлями для всіх!' WHERE name LIKE 'Бармен%';
UPDATE graduation_services SET catalog_description = 'Захоплива інтерактивна програма з трьома ведучими — ігри на швидкість, логіку та витримку!' WHERE name LIKE '%кальмара% Ч.1';
UPDATE graduation_services SET catalog_description = 'Продовження легендарної програми — ще два цикли ігор та фінальний сюрприз з подарунками!' WHERE name LIKE '%кальмара% Ч.2';
UPDATE graduation_services SET catalog_description = 'Подарунки для випускників — маленький сюрприз від парку на пам''ять!' WHERE name LIKE 'Подарунки%';
UPDATE graduation_services SET catalog_description = '50 кг яскравого паперу під ультрафіолетом, паперова пушка та кольоровий дощ під запальну музику!' WHERE name = 'Неонова паперова дискотека';
UPDATE graduation_services SET catalog_description = 'Гігантські мильні бульбашки під ультрафіолетом — магічне неонове шоу!' WHERE name LIKE 'Неонові мильні%';
UPDATE graduation_services SET catalog_description = 'Яскравий аквагрим під ультрафіолетом — неонові образи, що світяться в темряві!' WHERE name LIKE 'Неоновий аквагрим%';
