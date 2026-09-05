-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotently seeds the approved 21-row DAR catalog and two discount rules. It does not configure Checkbox or enable a register.
-- DATA_SCOPE: products and price_rules whose ids/codes start with dar_, plus DAR discount rules.
-- ROLLBACK: Disable catalog-sale, then deactivate only DAR products with updated_by='migration_347_dar_catalog' and the two exact DAR discount-rule codes; retain price rules by default because they have no active flag, and delete only exact migration-owned rows after proving no ledger snapshot references them.

WITH catalog(id, code, timeline_code, name, price, unit_name, category, sale_config) AS (
 VALUES
 ('dar_daycare_month','D001','ДМіс','Денний догляд 09:00–13:00, місяць',7200,'місяць','Денний догляд','{"quantity_step_millis":1000,"minimum_quantity_millis":1000}'),
 ('dar_daycare_single_day','D002','День','Денний догляд, разовий день',650,'день','Денний догляд','{"quantity_step_millis":1000,"minimum_quantity_millis":1000}'),
 ('dar_school_prep_8','D003','ПШ8','Підготовка до школи — абонемент на 8 занять',1750,'абонемент','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"school_prep"}'),
 ('dar_logic_8','D004','Лог8','Логіка — абонемент на 8 занять',1750,'абонемент','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"logic"}'),
 ('dar_early_development_8','D005','РР8','Ранній розвиток — абонемент на 8 занять',1750,'абонемент','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"early_development"}'),
 ('dar_english_8','D006','Анг8','Англійська мова — абонемент на 8 занять',1750,'абонемент','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"english"}'),
 ('dar_choreography_8','D007','Хор8','Хореографія — абонемент на 8 занять',1750,'абонемент','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"choreography"}'),
 ('dar_painting_8','D008','Жив8','Живопис — абонемент на 8 занять',1750,'абонемент','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"painting"}'),
 ('dar_sculpting_creativity_8','D009','Ліп8','Ліплення та творчість — абонемент на 8 занять',1750,'абонемент','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"sculpting_creativity"}'),
 ('dar_art_therapy_8','D010','Арт8','Арт-терапія — абонемент на 8 занять',1750,'абонемент','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"art_therapy"}'),
 ('dar_school_prep_single','D011','ПШ1','Підготовка до школи — разове заняття',300,'заняття','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"school_prep"}'),
 ('dar_logic_single','D012','Лог1','Логіка — разове заняття',300,'заняття','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"logic"}'),
 ('dar_early_development_single','D013','РР1','Ранній розвиток — разове заняття',300,'заняття','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"early_development"}'),
 ('dar_english_single','D014','Анг1','Англійська мова — разове заняття',300,'заняття','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"english"}'),
 ('dar_choreography_single','D015','Хор1','Хореографія — разове заняття',300,'заняття','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"choreography"}'),
 ('dar_painting_single','D016','Жив1','Живопис — разове заняття',300,'заняття','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"painting"}'),
 ('dar_sculpting_creativity_single','D017','Ліп1','Ліплення та творчість — разове заняття',300,'заняття','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"sculpting_creativity"}'),
 ('dar_art_therapy_single','D018','Арт1','Арт-терапія — разове заняття',300,'заняття','Гуртки','{"quantity_step_millis":1000,"minimum_quantity_millis":1000,"club_direction":"art_therapy"}'),
 ('dar_speech_therapy_individual','D019','Логоп','Логопед — індивідуальне заняття',500,'заняття','Логопед','{"quantity_step_millis":1000,"minimum_quantity_millis":1000}'),
 ('dar_hourly_care_weekday','D020','ГодБ','Погодинний догляд — будні',200,'година','Погодинний догляд','{"quantity_step_millis":1000,"minimum_quantity_millis":1000}'),
 ('dar_hourly_care_weekend','D021','ГодВ','Погодинний догляд — вихідні',350,'година','Погодинний догляд','{"quantity_step_millis":1000,"minimum_quantity_millis":2000}')
)
INSERT INTO products (id,business_context,code,label,name,category,duration,price,domain,serving_unit,is_active,availability_status,timeline_code,sale_config,updated_by)
SELECT id,'dar',code,name,name,category,0,price,'program',unit_name,TRUE,'active',timeline_code,sale_config::jsonb,'migration_347_dar_catalog'
FROM catalog ON CONFLICT (id) DO NOTHING;

INSERT INTO price_rules(code,name,value,unit,category,description,product_id,updated_by)
SELECT products.id,products.name,prices.price,COALESCE(products.serving_unit,'грн'),products.category,'Approved DAR 2026–2027 catalog price',products.id,'migration_347_dar_catalog'
FROM products JOIN (SELECT pid, p AS price FROM (VALUES
 ('dar_daycare_month',7200),('dar_daycare_single_day',650),('dar_school_prep_8',1750),('dar_logic_8',1750),('dar_early_development_8',1750),('dar_english_8',1750),('dar_choreography_8',1750),('dar_painting_8',1750),('dar_sculpting_creativity_8',1750),('dar_art_therapy_8',1750),('dar_school_prep_single',300),('dar_logic_single',300),('dar_early_development_single',300),('dar_english_single',300),('dar_choreography_single',300),('dar_painting_single',300),('dar_sculpting_creativity_single',300),('dar_art_therapy_single',300),('dar_speech_therapy_individual',500),('dar_hourly_care_weekday',200),('dar_hourly_care_weekend',350)
) q(pid,p)) prices ON products.id=prices.pid
ON CONFLICT (code) DO NOTHING;

INSERT INTO sales_discount_rules (business_context,code,name,rate_bps,eligibility_mode,metadata) VALUES
('dar','dar_ubd_20','УБД 20%',2000,'explicit','{"requires_eligibility_confirmation":true}'),
('dar','dar_second_club_direction_10','Другий напрямок гуртка 10%',1000,'second_club_direction','{}')
ON CONFLICT (business_context,code) DO NOTHING;
