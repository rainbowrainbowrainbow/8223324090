const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('products page exposes entertainment programs and catalogs IA', () => {
    const html = read('programs.html');
    const sidebar = read('js/components/sidebar.js');

    assert.match(html, /Products · Розважальні програми/);
    assert.match(html, /id="productIaTabs"/);
    assert.match(html, /id="catalogsPanel"/);
    assert.match(html, /id="catalogsGrid"/);
    assert.match(html, /id="productDocumentModal"/);
    assert.match(html, /Картку перевірено вручну/);
    assert.match(html, /Картка відповідає документу/);
    assert.match(sidebar, /label: 'Розважальні програми'/);
    assert.match(sidebar, /href: '\/programs#catalogs'/);
});

test('products frontend wires document linkage and catalog entry points', () => {
    const pageJs = read('js/programs-page.js');
    const apiJs = read('js/api.js');

    assert.match(pageJs, /apiUpdateProductDocument/);
    assert.match(pageJs, /apiGetProductCatalogs/);
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
});

test('design catalog deep links remain backed by the existing designs viewer', () => {
    const designsJs = read('js/designs-page.js');

    assert.match(designsJs, /openCatalogHash/);
    assert.match(designsJs, /catalog-/);
    assert.match(designsJs, /openCatalogPages\(catalogId\)/);
});
