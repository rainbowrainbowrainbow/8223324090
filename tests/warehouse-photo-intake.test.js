const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const {
    normalizeDraft,
    buildCaptionDraft,
    draftIsActionable,
    publicVisionStatus
} = require('../services/warehousePhotoIntake');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
}

function installCachedModule(id, exportsValue) {
    require.cache[id] = {
        id,
        filename: id,
        loaded: true,
        exports: exportsValue
    };
}

function loadWarehousePhotoIntakeService(pool) {
    const serviceId = require.resolve('../services/warehousePhotoIntake');
    const dbId = require.resolve('../db');
    const telegramId = require.resolve('../services/telegram');
    const previous = new Map([
        [serviceId, require.cache[serviceId]],
        [dbId, require.cache[dbId]],
        [telegramId, require.cache[telegramId]]
    ]);

    delete require.cache[serviceId];
    installCachedModule(dbId, { pool });
    installCachedModule(telegramId, {
        downloadTelegramFileById: async () => { throw new Error('unexpected Telegram download'); },
        getTelegramBotConfigStatus: () => ({ configured: false })
    });

    const service = require('../services/warehousePhotoIntake');
    return {
        service,
        restore() {
            delete require.cache[serviceId];
            for (const [id, entry] of previous) {
                if (entry) require.cache[id] = entry;
                else delete require.cache[id];
            }
        }
    };
}

function loadWarehouseAccessRouter(confirmIntake) {
    const routeId = require.resolve('../routes/warehouse');
    const dbId = require.resolve('../db');
    const authId = require.resolve('../middleware/auth');
    const costumeInventoryId = require.resolve('../services/costumeInventory');
    const photoIntakeId = require.resolve('../services/warehousePhotoIntake');
    const previous = new Map([
        [routeId, require.cache[routeId]],
        [dbId, require.cache[dbId]],
        [authId, require.cache[authId]],
        [costumeInventoryId, require.cache[costumeInventoryId]],
        [photoIntakeId, require.cache[photoIntakeId]]
    ]);

    delete require.cache[routeId];
    installCachedModule(dbId, {
        pool: {
            query: async () => { throw new Error('denied request reached database'); },
            connect: async () => { throw new Error('denied request reached database'); }
        }
    });
    installCachedModule(authId, {
        authenticateToken: (_req, _res, next) => next(),
        canUseAction: (user, action) => action !== 'view_revenue' || !user?.action_denylist?.includes(action),
        requireRole: (...roles) => (req, res, next) => (
            roles.includes(req.user?.role)
                ? next()
                : res.status(403).json({ error: 'Insufficient permissions' })
        )
    });
    installCachedModule(costumeInventoryId, {});
    installCachedModule(photoIntakeId, { confirmIntake });

    const router = require('../routes/warehouse');
    return {
        router,
        restore() {
            delete require.cache[routeId];
            for (const [id, entry] of previous) {
                if (entry) require.cache[id] = entry;
                else delete require.cache[id];
            }
        }
    };
}

async function withWarehouseAccessRouter(router, run) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        const revenueAllowed = req.get('x-test-revenue') === 'allowed';
        req.user = {
            role: 'creator',
            username: 'warehouse-access-test',
            action_denylist: revenueAllowed ? [] : ['view_revenue']
        };
        next();
    });
    app.use('/warehouse', router);

    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });

    try {
        await run('http://127.0.0.1:' + server.address().port);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
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

    it('blocks explicit photo-intake price writes before the service without view_revenue', async () => {
        const confirmCalls = [];
        const loaded = loadWarehouseAccessRouter(async (id, options) => {
            confirmCalls.push({ id, options });
            return { success: true, item: { id, draft: options.draft } };
        });

        try {
            await withWarehouseAccessRouter(loaded.router, async baseUrl => {
                const postConfirm = (body, allowed = false) => fetch(baseUrl + '/warehouse/photo-intake/91/confirm', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-test-revenue': allowed ? 'allowed' : 'denied'
                    },
                    body: JSON.stringify(body)
                });

                for (const payload of [{ draft: { price: 125 } }, { price: 125 }]) {
                    const deniedResponse = await postConfirm(payload);
                    assert.equal(deniedResponse.status, 403);
                    assert.deepEqual(await deniedResponse.json(), { error: 'Insufficient permissions' });
                }
                assert.equal(confirmCalls.length, 0);

                const operationalResponse = await postConfirm({ draft: { name: 'Paper cups', quantity: 12 } });
                assert.equal(operationalResponse.status, 200);
                assert.equal(confirmCalls.length, 1);
                assert.equal(confirmCalls[0].options.allowRevenueWrite, false);

                const allowedResponse = await postConfirm({ draft: { price: 125 } }, true);
                assert.equal(allowedResponse.status, 200);
                assert.equal(confirmCalls.length, 2);
                assert.equal(confirmCalls[1].options.draft.price, 125);
                assert.equal(confirmCalls[1].options.allowRevenueWrite, true);
            });
        } finally {
            loaded.restore();
        }
    });

    it('blocks a hidden stored draft price before warehouse persistence without view_revenue', async () => {
        const statements = [];
        let releaseCount = 0;
        const client = {
            async query(sql) {
                const statement = String(sql).trim();
                statements.push(statement);
                if (statement === 'BEGIN' || statement === 'ROLLBACK') return { rows: [], rowCount: 0 };
                if (statement.includes('SELECT * FROM warehouse_photo_intakes')) {
                    return {
                        rowCount: 1,
                        rows: [{
                            id: 91,
                            status: 'needs_review',
                            draft: {
                                name: 'Paper cups',
                                category: 'craft',
                                quantity: 12,
                                unit: 'шт',
                                price: 125
                            },
                            match_candidates: []
                        }]
                    };
                }
                throw new Error('denied confirmation reached warehouse write SQL: ' + statement);
            },
            release() {
                releaseCount += 1;
            }
        };
        const loaded = loadWarehousePhotoIntakeService({ connect: async () => client });

        try {
            const result = await loaded.service.confirmIntake(91, {
                actor: 'warehouse-access-test',
                draft: { name: 'Updated paper cups' },
                allowRevenueWrite: false
            });

            assert.deepEqual(result, { success: false, status: 403, error: 'Insufficient permissions' });
            assert.equal(releaseCount, 1);
            assert.equal(statements.filter(statement => statement === 'ROLLBACK').length, 1);
            assert.equal(statements.some(statement => /INSERT INTO warehouse_stock|UPDATE warehouse_stock/.test(statement)), false);
        } finally {
            loaded.restore();
        }
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
