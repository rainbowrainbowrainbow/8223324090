const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    normalizeDraft,
    buildCaptionDraft,
    draftIsActionable,
    publicVisionStatus
} = require('../services/warehousePhotoIntake');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
}

describe('warehouse Telegram photo intake contract', () => {
    it('normalizes a vision draft into warehouse-safe fields', () => {
        const draft = normalizeDraft({
            name: '  Paper cups  ',
            quantity: '12',
            unit: 'pcs',
            category: 'unknown',
            notes: '  delivery box  ',
            confidence: 0.7
        });

        assert.equal(draft.name, 'Paper cups');
        assert.equal(draft.quantity, 12);
        assert.equal(draft.unit, 'шт');
        assert.equal(draft.category, 'craft');
        assert.equal(draft.notes, 'delivery box');
        assert.equal(draftIsActionable(draft), true);
    });

    it('keeps caption-only extraction as manual-review draft', () => {
        const draft = buildCaptionDraft('склад 24 уп паперові стакани');

        assert.equal(draft.quantity, 24);
        assert.equal(draft.unit, 'уп');
        assert.match(draft.name, /паперові стакани/i);
        assert.equal(draft.needsManualReview, true);
        assert.ok(draft.confidence < 0.5);
    });

    it('exposes real API, webhook, and warehouse UI integration points', () => {
        const route = readRepoFile('routes', 'warehouse.js');
        const telegramRoute = readRepoFile('routes', 'telegram.js');
        const html = readRepoFile('warehouse.html');
        const frontend = readRepoFile('js', 'warehouse-page.js');

        assert.match(route, /\/photo-intake\/status/);
        assert.match(route, /warehousePhotoIntake\.confirmIntake/);
        assert.match(telegramRoute, /hasWarehousePhotoInput/);
        assert.match(telegramRoute, /wh_intake_confirm:/);
        assert.match(html, /warehouseIntakeTitle/);
        assert.match(frontend, /confirmWarehouseIntake/);
    });

    it('keeps warehouse object editing discoverable and guarded', () => {
        const route = readRepoFile('routes', 'warehouse.js');
        const contractorsRoute = readRepoFile('routes', 'contractors.js');
        const html = readRepoFile('warehouse.html');
        const frontend = readRepoFile('js', 'warehouse-page.js');
        const api = readRepoFile('js', 'api.js');

        assert.match(route, /router\.post\('\/locations', requireRole\(\.\.\.MANAGE_ROLES\)/);
        assert.match(route, /router\.put\('\/locations\/:id', requireRole\(\.\.\.MANAGE_ROLES\)/);
        assert.match(route, /router\.delete\('\/locations\/:id', requireRole\(\.\.\.MANAGE_ROLES\)/);
        assert.match(route, /active_stock_count/);
        assert.match(route, /Location has active stock/);
        assert.match(route, /findDuplicateLocationName/);
        assert.match(route, /findDuplicateWarehouseStock/);
        assert.match(route, /validateWarehouseReferences/);
        assert.match(route, /COALESCE\(wl\.name, ''\) ILIKE/);
        assert.match(route, /COALESCE\(c\.name, ''\) ILIKE/);
        assert.match(route, /LEFT JOIN warehouse_locations wl ON wl\.id = ws\.location_id/);
        assert.match(contractorsRoute, /requireRole\('creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin'\)/);

        assert.match(html, /id="addLocationBtn"/);
        assert.match(html, /id="locationForm"/);
        assert.match(html, /warehouse-location-manage-btn/);
        assert.match(html, /wh-edit-inline-btn/);
        assert.match(html, /Пошук: назва, SKU, склад, підрядник/);

        assert.match(frontend, /openLocationStock\(locationId\)/);
        assert.match(frontend, /openLocationForm\(locationId = null\)/);
        assert.match(frontend, /event\.stopPropagation\(\); openLocationForm/);
        assert.match(frontend, /Редагувати картку/);
        assert.match(frontend, /const MANAGE_ROLES = \['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin'\]/);
        assert.match(frontend, /itemMatchesSearch/);
        assert.match(frontend, /locationSaveInFlight/);
        assert.match(frontend, /itemSaveInFlight/);
        assert.match(frontend, /btn\.addEventListener\('click', \(\) => \{[\s\S]*loadStock\(\);[\s\S]*\}\);/);

        assert.match(api, /async function apiCreateWarehouseLocation/);
        assert.match(api, /async function apiUpdateWarehouseLocation/);
        assert.match(api, /async function apiArchiveWarehouseLocation/);
    });

    it('does not expose the OpenAI secret while reporting readiness', () => {
        const status = publicVisionStatus();
        assert.equal(status.provider, 'openai');
        assert.equal(status.keyEnv, 'OPENAI_API_KEY');
        assert.equal(Object.prototype.hasOwnProperty.call(status, 'apiKey'), false);
    });
});
