const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

describe('backoffice foundation v2 contracts', () => {
    const centerRoute = readRepoFile('routes', 'center.js');
    const centerPage = readRepoFile('js', 'center-page.js');
    const centerHtml = readRepoFile('center.html');
    const productsRoute = readRepoFile('routes', 'products.js');
    const designsPage = readRepoFile('js', 'designs-page.js');
    const designsHtml = readRepoFile('designs.html');
    const staffPage = readRepoFile('js', 'staff-page.js');
    const staffHtml = readRepoFile('staff.html');
    const sidebar = readRepoFile('js', 'components', 'sidebar.js');
    const sidebarAurora = readRepoFile('css', 'sidebar-aurora.css');
    const ui = readRepoFile('js', 'ui.js');
    const warehouseRoute = readRepoFile('routes', 'warehouse.js');
    const warehousePage = readRepoFile('js', 'warehouse-page.js');
    const warehouseHtml = readRepoFile('warehouse.html');
    const migration = readRepoFile('db', 'migrations', '177_backoffice_foundation_v1.sql');
    const warehouseMultiMigration = readRepoFile('db', 'migrations', '184_warehouse_multi_location_contractors.sql');
    const chatUniqueMigration = readRepoFile('db', 'migrations', '164_chat_channel_provisioning_unique.sql');
    const productPriceMigration = readRepoFile('db', 'migrations', '180_product_price_rules.sql');

    it('keeps department work legacy-compatible when final source image is missing', () => {
        assert.match(staffPage, /function getDepartmentOptionsFromStaffState/);
        assert.match(staffPage, /StaffState\.departments/);
        assert.match(staffPage, /LEGACY_DEPARTMENT_FALLBACK/);
        assert.doesNotMatch(staffPage, /const DEPTS = \[/);
        assert.match(staffPage, /STAFF_ROLE_OPTIONS_BY_DEPT/);
        assert.match(staffPage, /dependsOn:\s*'department'/);
        assert.match(staffPage, /optionsBy:\s*STAFF_ROLE_OPTIONS_BY_DEPT/);
        assert.doesNotMatch(staffPage, /ROLE_HIERARCHY|PAGE_ACCESS|SIDEBAR_ACCESS/);
    });

    it('supports department-aware select options in the shared form modal without changing auth', () => {
        assert.match(ui, /dependsOn/);
        assert.match(ui, /optionsBy/);
        assert.match(ui, /parent\.addEventListener\('change', rebuild\)/);
        assert.match(ui, /renderSelectOptions/);
    });

    it('completes price center product linkage without requiring a fake pricing source', () => {
        assert.match(centerRoute, /router\.get\('\/prices\/positions'/);
        assert.match(centerRoute, /FROM products p[\s\S]*LEFT JOIN price_rules pr ON pr\.product_id = p\.id/);
        assert.match(centerRoute, /linkSource:\s*'price_rules\.product_id'/);
        assert.match(centerRoute, /const hasProductLinkUpdate/);
        assert.match(centerRoute, /SELECT id FROM products WHERE id = \$1/);
        assert.doesNotMatch(centerRoute, /priceCenterV2|pricingEngineV2/);

        assert.match(centerPage, /apiCenterPricePositions/);
        assert.match(centerPage, /appendPricePositionsPanel/);
        assert.match(centerPage, /createPriceForProduct/);
        assert.match(centerHtml, /price-position-panel/);
    });

    it('keeps design price sheet tied to Price Center instead of duplicated product prices', () => {
        assert.match(productsRoute, /LEFT JOIN LATERAL \([\s\S]*FROM price_rules pr[\s\S]*WHERE pr\.product_id = p\.id/);
        assert.match(productsRoute, /priceSource:\s*hasCenterPrice \? 'price_rules' : 'products'/);
        assert.match(productsRoute, /upsertProductPriceRule/);
        assert.match(productsRoute, /buildProductPriceRuleCode/);

        assert.match(designsPage, /function renderPriceSourceBadge/);
        assert.match(designsPage, /priceSource === 'price_rules'/);
        assert.match(designsPage, /Центр ціни є основним прайсом/);
        assert.match(designsPage, /Ярлик:/);

        assert.match(designsHtml, /price-source-strip/);
        assert.match(designsHtml, /price-source-badge/);

        assert.match(productPriceMigration, /MIGRATION_KIND: data-fix/);
        assert.match(productPriceMigration, /INSERT INTO price_rules[\s\S]*product_id/);
        assert.match(productPriceMigration, /updated_by='migration_180_product_price_rules'/);
    });

    it('keeps chat channel unique migration executable in PL/pgSQL', () => {
        assert.match(chatUniqueMigration, /FROM chat_channels[\s\S]*WHERE line_id IS NOT NULL[\s\S]*AND type = 'room'[\s\S]*GROUP BY line_id/);
        assert.match(chatUniqueMigration, /EXECUTE 'CREATE UNIQUE INDEX uniq_chat_channels_room_line_active[\s\S]*type = ''room''/);
    });

    it('keeps the schedule all-departments chip readable in dark theme', () => {
        assert.match(staffHtml, /body\.dark-mode \.dept-chip\[data-dept="all"\]\.active/);
        assert.match(staffHtml, /\[data-theme="dark"\] \.dept-chip\[data-dept="all"\]\.active/);
        assert.match(staffHtml, /color:\s*#F8FAFC/);
        assert.match(staffHtml, /hover[\s\S]*color:\s*#FFFFFF/);
    });

    it('keeps sidebar menu clicks from drawing the floating active frame', () => {
        assert.match(sidebar, /function _ensureActiveIndicator\(\) \{[\s\S]*sidebarActiveIndicator'\)\?\.remove\(\);[\s\S]*\}/);
        assert.match(sidebar, /function _updateActiveIndicator\(\) \{[\s\S]*indicator\.remove\(\);[\s\S]*\}/);
        assert.match(sidebarAurora, /\.sidebar-active-indicator \{[\s\S]*display:\s*none !important/);
        assert.match(sidebarAurora, /\.sidebar-active-indicator\.visible \{[\s\S]*opacity:\s*0/);
    });

    it('keeps warehouse owner partition while declaring location transfer truth', () => {
        assert.match(warehouseRoute, /const VALID_OWNERS = \['park', 'dar', 'shared'\]/);
        assert.match(warehouseRoute, /warehouseMode/);
        assert.match(warehouseRoute, /transferSemantics:\s*'warehouse_stock_movements'/);
        assert.match(warehouseRoute, /COALESCE\(owner, 'park'\) =/);
        assert.match(warehousePage, /OWNER_LABELS/);
        assert.match(warehousePage, /getOwnerLabel/);
        assert.match(warehouseHtml, /wh-owner-badge/);
        assert.match(warehouseRoute, /router\.post\('\/stock\/:id\/transfer'/);
        assert.match(warehouseMultiMigration, /CREATE TABLE IF NOT EXISTS warehouse_locations/);
        assert.match(warehouseMultiMigration, /CREATE TABLE IF NOT EXISTS warehouse_stock_movements/);
        assert.doesNotMatch(migration, /CREATE TABLE\s+(IF NOT EXISTS\s+)?warehouses\b/i);
    });
});
