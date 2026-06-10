const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

const migration = read('db/migrations/201_kitchen_cakes_catalog.sql');
const menuMigration = read('db/migrations/220_kitchen_menu_2026_catalog.sql');

const expectedCakes = [
    ['Три шоколади', 110, 1, 'Три шари ніжного мусу на основі бельгійського шоколаду. Легкий, повітряний, делікатний смак із мʼякою шоколадною гармонією.'],
    ['Нутелла', 90, 2, 'Тонкі шоколадно-медові коржі із заварним кремом. Насичений, затишний і дуже ніжний смак з характером Нутелли.'],
    ['Сирно-йогуртовий', 95, 3, 'Легкий бісквіт, ніжна сирно-йогуртова начинка і вишня з приємною кислинкою. Свіжий і легкий торт, який дуже люблять діти.'],
    ['Форенуар', 115, 4, 'Шоколадний бісквіт, повітряний мус і соковита вишня. Насичений, елегантний і добре збалансований смак.'],
    ['Прага', 140, 5, 'Шоколадні коржі з ніжним кремом і легкою абрикосовою ноткою. Класика з глибоким шоколадним смаком.'],
    ['Снікерс', 110, 6, 'Шоколадні коржі, вершковий крем-чіз, солона карамель і обсмажені горіхи. Яскравий, насичений і впізнаваний смак.'],
    ['Медовик', 80, 7, 'Запашні медові коржі зі сметанковим кремом. Мʼякий, затишний і домашній варіант.'],
    ['Естерхазі', 140, 8, 'Меренгово-горіхові коржі з ніжним кремом. Благородний, вишуканий торт для особливих моментів.'],
    ['Смарагдовий', 110, 9, 'Зелений бісквіт на основі шпинату, цитрусова мʼятна нотка і делікатний чізкейк. Натуральний, легкий і дуже оригінальний смак.'],
    ['Хрещатий яр', 120, 10, 'Шоколадні коржі поєднані з хрусткими горіховими. Насичений, шляхетний і багатошаровий смак.'],
    ['Наполеон', 90, 11, 'Тонкі листкові коржі з ніжним кремом. Легка хрусткість і знайомий смак дитинства.'],
    ['Горіхово-маковий', 110, 12, 'Поєднання горіхів, маку, мʼяких коржів і ніжного масляного крему. Теплий, домашній і святковий смак.'],
    ['Мандариновий', 110, 13, 'Ніжний бісквіт, легкий мус і мандариново-хурмове компоте з маком. Свіжий, делікатний і цитрусовий.'],
    ['Чорнично-мусовий', 125, 14, 'Повітряний чорничний мус, чизкейк і тонкий бісквіт. Ягідний, ніжний і вишуканий.'],
    ['Орео', 100, 15, 'Шоколадні коржі, крем-чіз і шматочки печива Oreo. Ніжний торт із приємною хрумкою ноткою.'],
    ['Червоний оксамит', 115, 16, 'Мʼякі червоні коржі та вершковий крем-чіз. Ніжна текстура і делікатний смак, у який легко закохатись.'],
    ['Лісова казка', 105, 17, 'Шаровий зріз із природними кольорами коржів, ароматом халви й горіхами. Дуже ефектний і незвичний торт.'],
    ['Баунті', 100, 18, 'Шоколадний бісквіт і соковита кокосова прошарка. Ніжний тропічний смак із мʼякою текстурою.']
];

test('cakes catalog migration contains the approved 18 records in fixed order', () => {
    const rowMatches = [...migration.matchAll(/\('cake_[^']+',\s*'CAKE-(\d{2})',\s*'([^']+)',\s*(\d+),\s*'([^']+)',\s*(\d+)\)/g)];

    assert.equal(rowMatches.length, 18);
    for (const [index, match] of rowMatches.entries()) {
        const [name, price, sortOrder, description] = expectedCakes[index];
        assert.equal(Number(match[1]), index + 1);
        assert.equal(match[2], name);
        assert.equal(Number(match[3]), price);
        assert.equal(match[4], description);
        assert.equal(Number(match[5]), sortOrder);
    }
});

test('cakes catalog preserves price semantics and idempotent product updates', () => {
    assert.match(migration, /domain = 'kitchen'/);
    assert.match(migration, /kitchen_type = 'cake'/);
    assert.match(migration, /availability_status = 'active'/);
    assert.match(migration, /serving_unit = '100г'/);
    assert.match(migration, /'грн\/100г' AS unit/);
    assert.match(migration, /ON CONFLICT \(id\) DO UPDATE SET/);
    assert.match(migration, /lower\(trim\(p\.name\)\) = lower\(trim\(c\.name\)\)/);
    assert.match(migration, /WHERE NOT EXISTS/);
    assert.doesNotMatch(migration, /kitchen_type = 'menu'/);
    assert.doesNotMatch(migration, /price_variant_note = '.*100/);
});

test('products runtime exposes kitchen cake price unit through canonical API and UI', () => {
    const productsRoute = read('routes/products.js');
    const programsPage = read('js/programs-page.js');

    assert.match(productsRoute, /PRODUCT_PRICE_JOIN/);
    assert.match(productsRoute, /priceUnit: priceFields\.priceUnit/);
    assert.match(productsRoute, /servingUnit: row\.serving_unit/);
    assert.match(productsRoute, /p\.kitchen_type = \$\$\{params\.length\}/);
    assert.match(programsPage, /function renderKitchenPrice\(product\)/);
    assert.match(programsPage, /product\.servingUnit/);
    assert.match(programsPage, /getKitchenType\(p\) === activeKitchenTab/);
});

test('menu 2026 migration seeds the full operator-provided product menu', () => {
    const rowMatches = [...menuMigration.matchAll(/^\('menu_2026_[^']+',\s*'MENU-(\d{3})',/gm)];
    const sectionMatches = [...menuMigration.matchAll(/^\('menu_2026_[^']+',\s*'MENU-\d{3}',\s*'[^']+',\s*'([^']+)'/gm)];
    const countsBySection = sectionMatches.reduce((acc, match) => {
        acc[match[1]] = (acc[match[1]] || 0) + 1;
        return acc;
    }, {});

    assert.equal(rowMatches.length, 85);
    assert.deepEqual(countsBySection, {
        'Холодні закуски': 10,
        'Салати': 8,
        'Гарячі закуски': 7,
        'Бургери': 4,
        'Піца': 10,
        'Додатки до піци': 6,
        'Мангальне меню': 5,
        'Основні страви': 9,
        'Перші страви': 2,
        'Гарніри': 5,
        'Гарячі напої': 10,
        'Коктейлі та холодні напої': 9
    });
    assert.match(menuMigration, /'MENU-001', 'Сирне плато', 'Холодні закуски'/);
    assert.match(menuMigration, /'MENU-040', 'Сирний бортик з крем-сиром', 'Додатки до піци'/);
    assert.match(menuMigration, /'MENU-077', 'Сік в асортименті', 'Коктейлі та холодні напої'/);
    assert.match(menuMigration, /'MENU-085', 'Швепс', 'Коктейлі та холодні напої'/);
});

test('menu 2026 migration is scoped to kitchen menu products and preserves price rules', () => {
    assert.match(menuMigration, /business_context = 'event_genix'/);
    assert.match(menuMigration, /domain = 'kitchen'/);
    assert.match(menuMigration, /kitchen_type = 'menu'/);
    assert.match(menuMigration, /availability_status = 'active'/);
    assert.match(menuMigration, /updated_by = 'migration_220_kitchen_menu_2026_catalog'/);
    assert.match(menuMigration, /ON CONFLICT \(id\) DO UPDATE SET/);
    assert.match(menuMigration, /lower\(trim\(p\.name\)\) = lower\(trim\(c\.name\)\)/);
    assert.match(menuMigration, /INSERT INTO price_rules/);
    assert.match(menuMigration, /'грн\/' \|\| serving_unit/);
    assert.match(menuMigration, /'0,2 л \/ 1 л - 50 \/ 180 грн'/);
    assert.doesNotMatch(menuMigration, /kitchen_type = 'cake'/);
});
