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
    const staffPage = readRepoFile('js', 'staff-page.js');
    const ui = readRepoFile('js', 'ui.js');
    const warehouseRoute = readRepoFile('routes', 'warehouse.js');
    const warehousePage = readRepoFile('js', 'warehouse-page.js');
    const warehouseHtml = readRepoFile('warehouse.html');
    const migration = readRepoFile('db', 'migrations', '177_backoffice_foundation_v1.sql');

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

    it('keeps warehouse as explicit owner partition and does not invent transfer semantics', () => {
        assert.match(warehouseRoute, /const VALID_OWNERS = \['park', 'dar', 'shared'\]/);
        assert.match(warehouseRoute, /warehouseMode/);
        assert.match(warehouseRoute, /transferSemantics:\s*'missing-truth'/);
        assert.match(warehouseRoute, /COALESCE\(owner, 'park'\) =/);
        assert.match(warehousePage, /OWNER_LABELS/);
        assert.match(warehousePage, /getOwnerLabel/);
        assert.match(warehouseHtml, /wh-owner-badge/);
        assert.doesNotMatch(warehouseRoute, /router\.(post|put)\('\/transfer/);
        assert.doesNotMatch(migration, /CREATE TABLE\s+(IF NOT EXISTS\s+)?warehouses\b/i);
    });
});
