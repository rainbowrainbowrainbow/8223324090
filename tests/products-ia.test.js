const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('products page exposes business-aware products IA', () => {
    const html = read('programs.html');
    const sidebar = read('js/components/sidebar.js');

    assert.match(html, /Products · Продукти Парку Закревського/);
    assert.match(html, /id="productsBusinessSelect"/);
    assert.match(html, /Парк Закревського/);
    assert.match(html, /Майстерня долі/);
    assert.match(html, /id="maysternyaPanel"/);
    assert.match(html, /Демо консультація/);
    assert.match(html, /Повна консультація/);
    assert.match(html, /id="productIaTabs"/);
    assert.match(html, /id="catalogsPanel"/);
    assert.match(html, /id="catalogsGrid"/);
    assert.match(html, /id="kitchenPanel"/);
    assert.match(html, /id="kitchenSubtabs"/);
    assert.match(html, /id="menuSectionFilter"/);
    assert.match(html, /id="kitchenGrid"/);
    assert.match(html, /id="pf-menu-section"/);
    assert.match(html, /id="pf-weight-value"/);
    assert.match(html, /id="pf-serving-unit"/);
    assert.match(html, /id="pf-price-variant-note"/);
    assert.match(html, /id="pf-availability-status"/);
    assert.match(html, /Холодні закуски/);
    assert.match(html, /Коктейлі та холодні напої/);
    assert.match(html, /id="productDocumentModal"/);
    assert.match(html, /Картку перевірено вручну/);
    assert.match(html, /Картка відповідає документу/);
    assert.match(sidebar, /label: 'Продукти'/);
    assert.match(sidebar, /href: '\/programs#catalogs'/);
});

test('products frontend wires document linkage and catalog entry points', () => {
    const pageJs = read('js/programs-page.js');
    const apiJs = read('js/api.js');

    assert.match(pageJs, /apiUpdateProductDocument/);
    assert.match(pageJs, /apiGetProductCatalogs/);
    assert.match(pageJs, /renderKitchenSubtabs/);
    assert.match(pageJs, /PRODUCT_BUSINESS_STORAGE_KEY/);
    assert.match(pageJs, /setProductBusinessContext/);
    assert.match(pageJs, /pzp_products_business_context/);
    assert.match(pageJs, /renderKitchenProducts/);
    assert.match(pageJs, /renderMenuSectionFilter/);
    assert.match(pageJs, /MENU_SECTION_ORDER/);
    assert.match(pageJs, /getMenuCompleteness/);
    assert.match(pageJs, /menuSection/);
    assert.match(pageJs, /weightValue/);
    assert.match(pageJs, /priceVariantNote/);
    assert.match(pageJs, /availabilityStatus/);
    assert.match(pageJs, /cakeDecoration/);
    assert.match(pageJs, /techCard/);
    assert.match(pageJs, /ingredients/);
    assert.match(pageJs, /sourceDocumentVerifiedManual/);
    assert.match(pageJs, /sourceCardMatchesDocument/);
    assert.match(pageJs, /openProductDocumentModal/);
    assert.match(apiJs, /apiGetProductCatalogs/);
    assert.match(apiJs, /apiUpdateProductDocument/);
    assert.match(apiJs, /\/products\/catalogs/);
    assert.match(apiJs, /\/source-document/);
});

test('products API reuses existing catalog engine and validates source documents', () => {
    const productsRoute = read('routes/products.js');
    const migration = read('db/migrations/191_products_source_document_linkage.sql');
    const kitchenMigration = read('db/migrations/199_products_kitchen_fields.sql');
    const menuMigration = read('db/migrations/200_products_menu_structure_fields.sql');

    assert.match(productsRoute, /router\.get\('\/catalogs'/);
    assert.match(productsRoute, /FROM catalog_definitions cd/);
    assert.match(productsRoute, /router\.patch\('\/:id\/source-document'/);
    assert.match(productsRoute, /SOURCE_DOCUMENT_KINDS/);
    assert.match(productsRoute, /source_document_kind must be google_doc, pdf, or link/);
    assert.match(migration, /source_document_url/);
    assert.match(migration, /source_document_verified_manual/);
    assert.match(migration, /source_card_matches_document/);
    assert.match(migration, /google_doc/);
    assert.match(migration, /pdf/);
    assert.match(migration, /link/);
    assert.match(productsRoute, /normalizeProductPayload/);
    assert.match(productsRoute, /kitchenType/);
    assert.match(productsRoute, /shortDescription/);
    assert.match(productsRoute, /techCard/);
    assert.match(productsRoute, /PRODUCT_AVAILABILITY_STATUSES/);
    assert.match(productsRoute, /menuSection/);
    assert.match(productsRoute, /servingUnit/);
    assert.match(productsRoute, /weightValue/);
    assert.match(productsRoute, /priceVariantNote/);
    assert.match(productsRoute, /availabilityStatus/);
    assert.match(kitchenMigration, /domain VARCHAR\(30\)/);
    assert.match(kitchenMigration, /kitchen_type VARCHAR\(30\)/);
    assert.match(kitchenMigration, /cake_decoration TEXT/);
    assert.match(menuMigration, /menu_section VARCHAR\(120\)/);
    assert.match(menuMigration, /serving_unit VARCHAR\(60\)/);
    assert.match(menuMigration, /weight_value VARCHAR\(120\)/);
    assert.match(menuMigration, /price_variant_note TEXT/);
    assert.match(menuMigration, /availability_status VARCHAR\(30\)/);
    assert.match(menuMigration, /products_availability_status_check/);
});

test('design catalog deep links remain backed by the existing designs viewer', () => {
    const designsJs = read('js/designs-page.js');

    assert.match(designsJs, /openCatalogHash/);
    assert.match(designsJs, /catalog-/);
    assert.match(designsJs, /openCatalogPages\(catalogId\)/);
});
