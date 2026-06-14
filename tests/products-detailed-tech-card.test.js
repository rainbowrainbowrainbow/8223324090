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
    const aiMigration = read('db/migrations/225_products_menu_ai_card_workflow.sql');

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
    assert.match(aiMigration, /MIGRATION_KIND:/);
    assert.match(aiMigration, /ADD COLUMN IF NOT EXISTS allergens JSONB/);
    assert.match(aiMigration, /ADD COLUMN IF NOT EXISTS ai_card_draft JSONB/);
    assert.match(aiMigration, /ADD COLUMN IF NOT EXISTS ai_card_approved_blocks JSONB/);
    assert.match(aiMigration, /products_allergens_json_array_check/);
    assert.match(aiMigration, /idx_products_allergens_gin/);
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
    assert.match(productsRoute, /warehouse_stock[\s\S]+WHERE id = ANY\(\$1::int\[\]\)[\s\S]+COALESCE\(business_context, '\$\{DEFAULT_BUSINESS_CONTEXT\}'\) = \$2[\s\S]+FOR UPDATE/);
    assert.match(productsRoute, /INSERT INTO warehouse_history/);
    assert.match(productsRoute, /INSERT INTO warehouse_stock_movements/);
    assert.match(productsRoute, /VALUES \(\$1, 'issue'/);
    assert.match(productsRoute, /All ingredient rows must be linked to active warehouse stock before write-off/);
    assert.match(productsRoute, /MENU_ALLERGEN_CATALOG/);
    assert.match(productsRoute, /normalizeAllergenList/);
    assert.match(productsRoute, /generateMenuAiDraftWithOpenAI/);
    assert.match(productsRoute, /OPENAI_MENU_AI_MODEL/);
    assert.match(productsRoute, /\/responses/);
    assert.match(productsRoute, /router\.post\('\/menu-ai-draft'/);
    assert.match(productsRoute, /router\.get\('\/:id\/ai-card-draft'/);
    assert.match(productsRoute, /router\.put\('\/:id\/ai-card-draft'/);
    assert.match(productsRoute, /AI-assisted menu card draft, never canonical truth/);
    assert.match(productsRoute, /normalizeMenuImageStudio/);
    assert.match(productsRoute, /imageStudio/);
    assert.match(productsRoute, /buildFallbackMenuAiDraft/);
    assert.match(productsRoute, /loadMenuAiWarehouseItems/);
    assert.match(productsRoute, /ai_card_approved_blocks/);
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
    assert.match(programsHtml, /id="pf-allergens"/);
    assert.match(programsHtml, /id="productAiAutofillBtn"/);
    assert.match(programsHtml, /id="productAiReviewModal"/);
    assert.match(programsHtml, /js\/kitchen-menu-images\.js/);
    assert.match(programsHtml, /css\/pages-products\.css/);
    assert.match(programsHtml, /id="productAiApproveBlockBtn"/);
    assert.match(programsHtml, /id="productAiRegenerateBlockBtn"/);
    assert.match(programsHtml, /AI створює лише чернетку/);
    assert.match(programsHtml, /id="pf-tech-card-rows"/);
    assert.match(programsHtml, /id="addTechCardIngredientBtn"/);
    assert.match(programsHtml, /id="pf-tech-writeoff-btn"/);
    assert.match(programsJs, /loadProductWarehouseItems/);
    assert.match(programsJs, /MENU_ALLERGEN_OPTIONS/);
    assert.match(programsJs, /MENU_AI_BLOCKS/);
    assert.match(programsJs, /getAllergensFromForm/);
    assert.match(programsJs, /openMenuAiReviewWizard/);
    assert.match(programsJs, /renderKitchenCardVisual/);
    assert.match(programsJs, /renderKitchenMenuAiActions/);
    assert.match(programsJs, /saveKitchenMenuImageDraft/);
    assert.match(programsJs, /buildKitchenMenuImagePrompt/);
    assert.match(programsJs, /approveMenuAiBlock/);
    assert.match(programsJs, /regenerateMenuAiBlock/);
    assert.match(programsJs, /applyMenuAiReviewFinal/);
    assert.match(programsJs, /apiGenerateProductMenuAiDraft/);
    assert.match(programsJs, /apiSaveProductMenuAiDraft/);
    assert.match(programsJs, /renderTechCardIngredientRows/);
    assert.match(programsJs, /saveProductTechCardIfNeeded/);
    assert.match(programsJs, /submitTechCardWriteOff/);
    assert.match(programsJs, /techCardMode: domain === 'kitchen'/);
    assert.match(programsJs, /openProductForm\('\$\{productId\}', \{ focusWriteOff: true \}\)/);
    assert.match(apiJs, /apiGetProductTechCard/);
    assert.match(apiJs, /apiUpdateProductTechCard/);
    assert.match(apiJs, /apiWriteOffProductTechCard/);
    assert.match(apiJs, /apiGenerateProductMenuAiDraft/);
    assert.match(apiJs, /apiGetProductMenuAiDraft/);
    assert.match(apiJs, /apiSaveProductMenuAiDraft/);
});
