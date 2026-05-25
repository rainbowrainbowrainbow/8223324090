const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('detailed menu tech-card schema extends products and stock requirements without replacing warehouse truth', () => {
    const migration = read('db/migrations/222_products_detailed_tech_cards.sql');

    assert.match(migration, /MIGRATION_KIND:/);
    assert.match(migration, /SAFETY:/);
    assert.match(migration, /ROLLBACK:/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS tech_card_mode/);
    assert.match(migration, /products_tech_card_mode_check/);
    assert.match(migration, /ALTER COLUMN stock_id DROP NOT NULL/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS ingredient_label/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS waste_percent/);
    assert.match(migration, /product_stock_requirements_link_or_label_check/);
    assert.match(migration, /idx_psr_product_sort/);
});

test('products API exposes detailed tech-card persistence and explicit warehouse write-off', () => {
    const productsRoute = read('routes/products.js');

    assert.match(productsRoute, /PRODUCT_TECH_CARD_MODES/);
    assert.match(productsRoute, /techCardMode: normalizeTechCardMode/);
    assert.match(productsRoute, /tech_card_mode=\$18/);
    assert.match(productsRoute, /router\.get\('\/:id\/tech-card'/);
    assert.match(productsRoute, /router\.put\('\/:id\/tech-card'/);
    assert.match(productsRoute, /router\.post\('\/:id\/tech-card\/write-off'/);
    assert.match(productsRoute, /getTechCardIngredientRows/);
    assert.match(productsRoute, /buildTechCardProcurementSignals/);
    assert.match(productsRoute, /warehouse_stock WHERE id = ANY\(\$1::int\[\]\) FOR UPDATE/);
    assert.match(productsRoute, /INSERT INTO warehouse_history/);
    assert.match(productsRoute, /INSERT INTO warehouse_stock_movements/);
    assert.match(productsRoute, /VALUES \(\$1, 'issue'/);
    assert.match(productsRoute, /All ingredient rows must be linked to active warehouse stock before write-off/);
});

test('procurement API and warehouse page surface kitchen tech-card demand signals', () => {
    const procurementRoute = read('routes/procurement.js');
    const warehouseHtml = read('warehouse.html');
    const warehouseJs = read('js/warehouse-page.js');
    const apiJs = read('js/api.js');

    assert.match(procurementRoute, /router\.get\('\/suggestions\/kitchen-demand'/);
    assert.match(procurementRoute, /linked_menu_count/);
    assert.match(procurementRoute, /base_menu_usage/);
    assert.match(procurementRoute, /source: 'kitchen_tech_card'/);
    assert.match(procurementRoute, /req\.body\.source === 'kitchen_tech_card'/);
    assert.match(warehouseHtml, /id="procKitchenDemandSignals"/);
    assert.match(warehouseJs, /loadProcurementKitchenDemand/);
    assert.match(warehouseJs, /renderProcurementKitchenDemand/);
    assert.match(warehouseJs, /createKitchenDemandProcurement/);
    assert.match(warehouseJs, /apiGetProcurementKitchenDemand/);
    assert.match(apiJs, /apiGetProcurementKitchenDemand/);
});

test('products UI lets operators edit rows, persist detailed mode, and trigger write-off', () => {
    const programsHtml = read('programs.html');
    const programsJs = read('js/programs-page.js');
    const apiJs = read('js/api.js');

    assert.match(programsHtml, /id="pf-tech-card-detailed"/);
    assert.match(programsHtml, /id="pf-tech-card-rows"/);
    assert.match(programsHtml, /id="addTechCardIngredientBtn"/);
    assert.match(programsHtml, /id="pf-tech-writeoff-btn"/);
    assert.match(programsJs, /loadProductWarehouseItems/);
    assert.match(programsJs, /renderTechCardIngredientRows/);
    assert.match(programsJs, /saveProductTechCardIfNeeded/);
    assert.match(programsJs, /submitTechCardWriteOff/);
    assert.match(programsJs, /techCardMode: domain === 'kitchen'/);
    assert.match(programsJs, /openProductForm\('\$\{productId\}', \{ focusWriteOff: true \}\)/);
    assert.match(apiJs, /apiGetProductTechCard/);
    assert.match(apiJs, /apiUpdateProductTechCard/);
    assert.match(apiJs, /apiWriteOffProductTechCard/);
});
